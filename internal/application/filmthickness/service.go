package filmthickness

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/csv"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf16"

	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
)

const (
	defaultDateFolder = "unknown-date"
	waferRadiusMM     = 75.0
)

type Point struct {
	Index int
	X     float64
	Y     float64
	E2    float64
}

type Stats struct {
	Avg           float64
	Min           float64
	Max           float64
	Range         float64
	UniformityPct float64
}

type Wafer struct {
	SortIndex      int
	OriginalIndex  int
	Date           string
	TimeText       string
	TimeValue      time.Time
	LotID          string
	WaferID        string
	SlotNumber     string
	Recipe         string
	PointsMeasured string
	Points         []Point
	Stats          Stats
	ImagePath      string
	Warnings       []string
}

type WaferResult struct {
	SortIndex      int     `json:"sortIndex"`
	Date           string  `json:"date"`
	Time           string  `json:"time"`
	LotID          string  `json:"lotId"`
	WaferID        string  `json:"waferId"`
	SlotNumber     string  `json:"slotNumber"`
	Recipe         string  `json:"recipe"`
	PointsMeasured string  `json:"pointsMeasured"`
	E2Avg          float64 `json:"e2Avg"`
	E2Min          float64 `json:"e2Min"`
	E2Max          float64 `json:"e2Max"`
	E2Range        float64 `json:"e2Range"`
	UniformityPct  float64 `json:"uniformityPct"`
	ImagePath      string  `json:"imagePath"`
}

type DateResult struct {
	Date       string   `json:"date"`
	DirPath    string   `json:"dirPath"`
	PageImages []string `json:"pageImages"`
	WaferCount int      `json:"waferCount"`
}

type Result struct {
	OutputRoot  string        `json:"outputRoot"`
	SummaryPath string        `json:"summaryPath"`
	WaferCount  int           `json:"waferCount"`
	Dates       []DateResult  `json:"dates"`
	Wafers      []WaferResult `json:"wafers"`
	Warnings    []string      `json:"warnings"`
}

type InputFile struct {
	SourceName string
	Data       []byte
}

type blockParseResult struct {
	wafer    *Wafer
	warnings []string
}

type pointColumnIndex struct {
	point int
	x     int
	y     int
	e2    int
}

type rect struct {
	x int
	y int
	w int
	h int
}

var numberPattern = regexp.MustCompile(`[-+]?\d[\d,]*(?:\.\d+)?(?:[eE][-+]?\d+)?`)

func ProcessFile(inputPath string, outputRoot string) (Result, error) {
	data, err := os.ReadFile(inputPath)
	if err != nil {
		return Result{}, err
	}
	return ProcessBytes(data, filepath.Base(inputPath), outputRoot)
}

func ProcessBase64(dataBase64 string, sourceName string, outputRoot string) (Result, error) {
	raw := dataBase64
	if idx := strings.Index(raw, ","); idx >= 0 {
		raw = raw[idx+1:]
	}
	data, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return Result{}, fmt.Errorf("decode csv content: %w", err)
	}
	return ProcessBytes(data, sourceName, outputRoot)
}

func ProcessBytes(data []byte, sourceName string, outputRoot string) (Result, error) {
	return ProcessManyBytes([]InputFile{{SourceName: sourceName, Data: data}}, outputRoot)
}

func ProcessManyBytes(files []InputFile, outputRoot string) (Result, error) {
	if len(files) == 0 {
		return Result{}, errors.New("no csv files were provided")
	}

	wafers := make([]Wafer, 0)
	warnings := make([]string, 0)
	for _, file := range files {
		sourceName := fallback(file.SourceName, "uploaded.csv")
		fileWafers, fileWarnings, err := parseInputFile(file.Data)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("%s: skipped: %v", sourceName, err))
			continue
		}
		for _, warning := range fileWarnings {
			warnings = append(warnings, sourceName+": "+warning)
		}
		for _, wafer := range fileWafers {
			wafer.OriginalIndex = len(wafers)
			wafers = append(wafers, wafer)
		}
	}
	if len(wafers) == 0 {
		if len(warnings) > 0 {
			return Result{}, fmt.Errorf("no valid wafer blocks were parsed; %s", strings.Join(warnings, "; "))
		}
		return Result{}, errors.New("no valid wafer blocks were parsed")
	}

	sortWafers(wafers)
	for idx := range wafers {
		wafers[idx].SortIndex = idx + 1
	}

	root, err := resolveOutputRoot(outputRoot)
	if err != nil {
		return Result{}, err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return Result{}, err
	}

	dateResults, err := writeOutputs(root, wafers)
	if err != nil {
		return Result{}, err
	}
	summaryPath, err := writeSummary(root, wafers)
	if err != nil {
		return Result{}, err
	}

	return Result{
		OutputRoot:  root,
		SummaryPath: summaryPath,
		WaferCount:  len(wafers),
		Dates:       dateResults,
		Wafers:      toWaferResults(wafers),
		Warnings:    warnings,
	}, nil
}

func parseInputFile(data []byte) ([]Wafer, []string, error) {
	text, _, err := decodeCSVText(data)
	if err != nil {
		return nil, nil, err
	}
	rows, err := readCSVRows(text)
	if err != nil {
		return nil, nil, err
	}
	wafers, warnings, err := parseWafers(rows)
	if err != nil {
		return nil, nil, err
	}
	return wafers, warnings, nil
}

func decodeCSVText(data []byte) (string, string, error) {
	if len(data) == 0 {
		return "", "", errors.New("empty csv file")
	}
	if len(data) >= 2 && data[0] == 0xff && data[1] == 0xfe {
		return decodeUTF16LE(data[2:]), "UTF-16-LE", nil
	}
	if looksUTF16LE(data) {
		return decodeUTF16LE(data), "UTF-16-LE", nil
	}
	text := string(bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf}))
	text = strings.ReplaceAll(text, "\x00", "")
	return text, "UTF-8", nil
}

func looksUTF16LE(data []byte) bool {
	if len(data) < 16 {
		return false
	}
	sample := data
	if len(sample) > 4096 {
		sample = sample[:4096]
	}
	oddZeros := 0
	evenZeros := 0
	for i, b := range sample {
		if b != 0 {
			continue
		}
		if i%2 == 1 {
			oddZeros++
		} else {
			evenZeros++
		}
	}
	return oddZeros > len(sample)/8 && oddZeros > evenZeros*3
}

func decodeUTF16LE(data []byte) string {
	if len(data)%2 == 1 {
		data = data[:len(data)-1]
	}
	codeUnits := make([]uint16, len(data)/2)
	for i := range codeUnits {
		codeUnits[i] = binary.LittleEndian.Uint16(data[i*2:])
	}
	if len(codeUnits) > 0 && codeUnits[0] == 0xfeff {
		codeUnits = codeUnits[1:]
	}
	return string(utf16.Decode(codeUnits))
}

func readCSVRows(text string) ([][]string, error) {
	reader := csv.NewReader(strings.NewReader(text))
	reader.FieldsPerRecord = -1
	reader.LazyQuotes = true
	reader.TrimLeadingSpace = true
	rows, err := reader.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("read csv rows: %w", err)
	}
	for i := range rows {
		for j := range rows[i] {
			rows[i][j] = cleanCell(rows[i][j])
		}
	}
	return rows, nil
}

func parseWafers(rows [][]string) ([]Wafer, []string, error) {
	blocks := splitBlocks(rows)
	if len(blocks) == 0 {
		return nil, nil, errors.New("no Slot Number blocks found")
	}

	wafers := make([]Wafer, 0, len(blocks))
	var warnings []string
	for i, block := range blocks {
		parsed := parseBlock(block, i)
		warnings = append(warnings, parsed.warnings...)
		if parsed.wafer != nil {
			wafers = append(wafers, *parsed.wafer)
		}
	}
	return wafers, warnings, nil
}

func splitBlocks(rows [][]string) [][][]string {
	starts := make([]int, 0)
	for i, row := range rows {
		if _, ok := valueForKeys(row, "slotnumber"); ok {
			starts = append(starts, i)
		}
	}
	blocks := make([][][]string, 0, len(starts))
	for i, start := range starts {
		end := len(rows)
		if i+1 < len(starts) {
			end = starts[i+1]
		}
		blocks = append(blocks, rows[start:end])
	}
	return blocks
}

func parseBlock(block [][]string, originalIndex int) blockParseResult {
	slot, _ := valueForRows(block, "slotnumber")
	warnings := make([]string, 0)
	context := fmt.Sprintf("block %d slot %s", originalIndex+1, fallback(slot, "-"))

	headerIndex, columns, foundHeader := findPointHeader(block)
	if !foundHeader {
		return blockParseResult{warnings: []string{context + ": point table header with Point/X/Y/E2 not found"}}
	}

	points, pointWarnings := parsePoints(block[headerIndex+1:], columns, context)
	warnings = append(warnings, pointWarnings...)
	if len(points) == 0 {
		return blockParseResult{warnings: append(warnings, context+": no valid X/Y/E2 points found")}
	}

	timeText, _ := valueForRows(block, "time")
	date, parsedTime := parseDateTime(timeText)
	lotID, _ := valueForRows(block, "lotid")
	waferID, _ := valueForRows(block, "waferid")
	recipe, _ := valueForRows(block, "waferrecipe", "recipe")
	pointsMeasured, _ := valueForRows(block, "pointsmeasured")
	if pointsMeasured != "" {
		if measured, ok := parseInt(pointsMeasured); ok && measured != len(points) {
			warnings = append(warnings, fmt.Sprintf("%s: Points Measured=%d but parsed points=%d", context, measured, len(points)))
		}
	}

	wafer := &Wafer{
		OriginalIndex:  originalIndex,
		Date:           date,
		TimeText:       timeText,
		TimeValue:      parsedTime,
		LotID:          lotID,
		WaferID:        waferID,
		SlotNumber:     slot,
		Recipe:         recipe,
		PointsMeasured: pointsMeasured,
		Points:         points,
		Stats:          calcStats(points),
		Warnings:       warnings,
	}
	return blockParseResult{wafer: wafer, warnings: warnings}
}

func cleanCell(input string) string {
	text := strings.TrimSpace(input)
	text = strings.TrimPrefix(text, "\ufeff")
	text = strings.ReplaceAll(text, "\x00", "")
	return strings.TrimSpace(text)
}

func normKey(input string) string {
	input = strings.ToLower(cleanCell(input))
	var b strings.Builder
	for _, r := range input {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func splitLabelValue(input string) (string, string, bool) {
	text := cleanCell(input)
	for _, sep := range []string{":", "："} {
		if idx := strings.Index(text, sep); idx >= 0 {
			return text[:idx], strings.TrimSpace(text[idx+len(sep):]), true
		}
	}
	return text, "", false
}

func valueForRows(rows [][]string, keys ...string) (string, bool) {
	for _, row := range rows {
		if value, ok := valueForKeys(row, keys...); ok {
			return value, true
		}
	}
	return "", false
}

func valueForKeys(row []string, keys ...string) (string, bool) {
	keySet := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		keySet[normKey(key)] = struct{}{}
	}
	for i, cell := range row {
		label, value, hasSep := splitLabelValue(cell)
		if _, ok := keySet[normKey(label)]; ok {
			if hasSep && value != "" {
				return value, true
			}
			for j := i + 1; j < len(row); j++ {
				if cleanCell(row[j]) != "" {
					return cleanCell(row[j]), true
				}
			}
			return "", true
		}
	}
	return "", false
}

func findPointHeader(block [][]string) (int, pointColumnIndex, bool) {
	for rowIndex, row := range block {
		cols := pointColumnIndex{point: -1, x: -1, y: -1, e2: -1}
		for colIndex, cell := range row {
			switch normKey(cell) {
			case "point":
				cols.point = colIndex
			case "x":
				cols.x = colIndex
			case "y":
				cols.y = colIndex
			case "e2":
				cols.e2 = colIndex
			}
		}
		if cols.point >= 0 && cols.x >= 0 && cols.y >= 0 && cols.e2 >= 0 {
			return rowIndex, cols, true
		}
	}
	return -1, pointColumnIndex{}, false
}

func parsePoints(rows [][]string, columns pointColumnIndex, context string) ([]Point, []string) {
	points := make([]Point, 0, 64)
	var warnings []string
	for rowIndex, row := range rows {
		if len(row) <= maxInt(columns.point, columns.x, columns.y, columns.e2) {
			if len(points) > 0 && !isBlankRow(row) {
				warnings = append(warnings, fmt.Sprintf("%s: row after point header is incomplete at offset %d", context, rowIndex+1))
			}
			continue
		}
		x, okX := parseFloat(row[columns.x])
		y, okY := parseFloat(row[columns.y])
		e2, okE2 := parseFloat(row[columns.e2])
		if !okX || !okY || !okE2 {
			if len(points) > 0 && !isBlankRow(row) {
				warnings = append(warnings, fmt.Sprintf("%s: skipped incomplete point row at offset %d", context, rowIndex+1))
			}
			continue
		}
		pointIndex := len(points) + 1
		if parsedPoint, ok := parseInt(row[columns.point]); ok {
			pointIndex = parsedPoint
		}
		points = append(points, Point{Index: pointIndex, X: x, Y: y, E2: e2})
	}
	return points, warnings
}

func parseFloat(input string) (float64, bool) {
	text := cleanCell(input)
	if text == "" {
		return 0, false
	}
	match := numberPattern.FindString(text)
	if match == "" {
		return 0, false
	}
	match = strings.ReplaceAll(match, ",", "")
	value, err := strconv.ParseFloat(match, 64)
	return value, err == nil && !math.IsNaN(value) && !math.IsInf(value, 0)
}

func parseInt(input string) (int, bool) {
	value, ok := parseFloat(input)
	if !ok {
		return 0, false
	}
	return int(math.Round(value)), true
}

func isBlankRow(row []string) bool {
	for _, cell := range row {
		if cleanCell(cell) != "" {
			return false
		}
	}
	return true
}

func calcStats(points []Point) Stats {
	minValue := points[0].E2
	maxValue := points[0].E2
	sum := 0.0
	for _, point := range points {
		sum += point.E2
		if point.E2 < minValue {
			minValue = point.E2
		}
		if point.E2 > maxValue {
			maxValue = point.E2
		}
	}
	avg := sum / float64(len(points))
	e2Range := maxValue - minValue
	denominator := (maxValue + minValue) / 2
	uniformity := 0.0
	if denominator != 0 {
		uniformity = e2Range / denominator * 100
	}
	return Stats{
		Avg:           avg,
		Min:           minValue,
		Max:           maxValue,
		Range:         e2Range,
		UniformityPct: uniformity,
	}
}

func parseDateTime(input string) (string, time.Time) {
	text := cleanCell(input)
	if text == "" {
		return defaultDateFolder, time.Time{}
	}
	text = strings.Join(strings.Fields(text), " ")
	layouts := []string{
		"2006-01-02 15:04:05",
		"2006-01-02 15:04",
		"2006/01/02 15:04:05",
		"2006/01/02 15:04",
		"2006.01.02 15:04:05",
		"2006.01.02 15:04",
		"1/2/2006 3:04:05 PM",
		"1/2/2006 3:04 PM",
		"01/02/2006 15:04:05",
		"1/2/2006 15:04:05",
		"2006-01-02",
		"2006/01/02",
		"1/2/2006",
	}
	for _, layout := range layouts {
		if parsed, err := time.ParseInLocation(layout, text, time.Local); err == nil {
			return parsed.Format("2006-01-02"), parsed
		}
	}
	if date := extractDateText(text); date != "" {
		return date, time.Time{}
	}
	return defaultDateFolder, time.Time{}
}

func extractDateText(text string) string {
	patterns := []*regexp.Regexp{
		regexp.MustCompile(`\b(\d{4})[-/\.](\d{1,2})[-/\.](\d{1,2})\b`),
		regexp.MustCompile(`\b(\d{1,2})/(\d{1,2})/(\d{4})\b`),
	}
	for index, pattern := range patterns {
		match := pattern.FindStringSubmatch(text)
		if len(match) != 4 {
			continue
		}
		if index == 0 {
			year, _ := strconv.Atoi(match[1])
			month, _ := strconv.Atoi(match[2])
			day, _ := strconv.Atoi(match[3])
			return fmt.Sprintf("%04d-%02d-%02d", year, month, day)
		}
		month, _ := strconv.Atoi(match[1])
		day, _ := strconv.Atoi(match[2])
		year, _ := strconv.Atoi(match[3])
		return fmt.Sprintf("%04d-%02d-%02d", year, month, day)
	}
	return ""
}

func sortWafers(wafers []Wafer) {
	sort.SliceStable(wafers, func(i, j int) bool {
		a := wafers[i]
		b := wafers[j]
		if a.Date != b.Date {
			return a.Date < b.Date
		}
		if cmp := compareNatural(lotMain(a.LotID), lotMain(b.LotID)); cmp != 0 {
			return cmp < 0
		}
		if cmp := compareNatural(a.WaferID, b.WaferID); cmp != 0 {
			return cmp < 0
		}
		if cmp := compareNumericText(a.SlotNumber, b.SlotNumber); cmp != 0 {
			return cmp < 0
		}
		if !a.TimeValue.Equal(b.TimeValue) {
			if a.TimeValue.IsZero() {
				return false
			}
			if b.TimeValue.IsZero() {
				return true
			}
			return a.TimeValue.Before(b.TimeValue)
		}
		return a.OriginalIndex < b.OriginalIndex
	})
}

func compareNumericText(a string, b string) int {
	ai, aok := parseInt(a)
	bi, bok := parseInt(b)
	if aok && bok && ai != bi {
		if ai < bi {
			return -1
		}
		return 1
	}
	return compareNatural(a, b)
}

func compareNatural(a string, b string) int {
	ar := []rune(strings.ToLower(a))
	br := []rune(strings.ToLower(b))
	i, j := 0, 0
	for i < len(ar) && j < len(br) {
		if unicode.IsDigit(ar[i]) && unicode.IsDigit(br[j]) {
			ai := i
			for i < len(ar) && unicode.IsDigit(ar[i]) {
				i++
			}
			bj := j
			for j < len(br) && unicode.IsDigit(br[j]) {
				j++
			}
			an := strings.TrimLeft(string(ar[ai:i]), "0")
			bn := strings.TrimLeft(string(br[bj:j]), "0")
			if an == "" {
				an = "0"
			}
			if bn == "" {
				bn = "0"
			}
			if len(an) != len(bn) {
				if len(an) < len(bn) {
					return -1
				}
				return 1
			}
			if an != bn {
				if an < bn {
					return -1
				}
				return 1
			}
			continue
		}
		if ar[i] != br[j] {
			if ar[i] < br[j] {
				return -1
			}
			return 1
		}
		i++
		j++
	}
	if len(ar) == len(br) {
		return 0
	}
	if len(ar) < len(br) {
		return -1
	}
	return 1
}

func lotMain(lotID string) string {
	if idx := strings.Index(lotID, "."); idx >= 0 {
		return lotID[:idx]
	}
	return lotID
}

func resolveOutputRoot(outputRoot string) (string, error) {
	root := strings.TrimSpace(outputRoot)
	if root == "" {
		home, err := os.UserHomeDir()
		if err != nil || home == "" {
			root = filepath.Join(".", "tmp", "wafer_maps")
		} else {
			root = filepath.Join(home, "Downloads", "wafer_maps")
		}
	} else if strings.HasPrefix(root, "~") {
		home, err := os.UserHomeDir()
		if err != nil || home == "" {
			return "", errors.New("cannot expand ~ without user home directory")
		}
		root = filepath.Join(home, strings.TrimPrefix(root, "~"))
	}
	return filepath.Abs(root)
}

func writeOutputs(root string, wafers []Wafer) ([]DateResult, error) {
	dateGroups := make(map[string][]*Wafer)
	dateOrder := make([]string, 0)
	seenDate := make(map[string]bool)
	for i := range wafers {
		date := wafers[i].Date
		if date == "" {
			date = defaultDateFolder
		}
		if !seenDate[date] {
			seenDate[date] = true
			dateOrder = append(dateOrder, date)
		}
		dateGroups[date] = append(dateGroups[date], &wafers[i])
	}

	results := make([]DateResult, 0, len(dateOrder))
	for _, date := range dateOrder {
		dirPath := filepath.Join(root, date)
		if err := os.MkdirAll(dirPath, 0o755); err != nil {
			return nil, err
		}
		for _, wafer := range dateGroups[date] {
			fileName := fmt.Sprintf(
				"%03d_Lot-%s_Wafer-%s_Slot-%s.png",
				wafer.SortIndex,
				safeNamePart(wafer.LotID),
				safeNamePart(wafer.WaferID),
				safeNamePart(wafer.SlotNumber),
			)
			imagePath := filepath.Join(dirPath, fileName)
			if err := savePNG(imagePath, renderSingleWafer(*wafer)); err != nil {
				return nil, err
			}
			wafer.ImagePath = imagePath
		}
		pageImages, err := writeOverviewPages(dirPath, date, dateGroups[date])
		if err != nil {
			return nil, err
		}
		results = append(results, DateResult{
			Date:       date,
			DirPath:    dirPath,
			PageImages: pageImages,
			WaferCount: len(dateGroups[date]),
		})
	}
	return results, nil
}

func writeOverviewPages(dirPath string, date string, wafers []*Wafer) ([]string, error) {
	const perPage = 3
	totalPages := int(math.Ceil(float64(len(wafers)) / perPage))
	paths := make([]string, 0, totalPages)
	for page := 0; page < totalPages; page++ {
		start := page * perPage
		end := start + perPage
		if end > len(wafers) {
			end = len(wafers)
		}
		pagePath := filepath.Join(dirPath, fmt.Sprintf("%s_page_%02d.png", date, page+1))
		img := renderOverviewPage(date, page+1, totalPages, len(wafers), wafers[start:end])
		if err := savePNG(pagePath, img); err != nil {
			return nil, err
		}
		paths = append(paths, pagePath)
	}
	return paths, nil
}

func writeSummary(root string, wafers []Wafer) (string, error) {
	summaryPath := filepath.Join(root, "wafer_summary.csv")
	file, err := os.Create(summaryPath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	defer writer.Flush()
	header := []string{
		"sort_index",
		"date",
		"time",
		"lot_id",
		"wafer_id",
		"slot_number",
		"recipe",
		"points_measured",
		"e2_avg",
		"e2_min",
		"e2_max",
		"e2_range",
		"uniformity_pct",
		"image_path",
	}
	if err := writer.Write(header); err != nil {
		return "", err
	}
	for _, wafer := range wafers {
		imagePath, err := filepath.Rel(root, wafer.ImagePath)
		if err != nil {
			imagePath = wafer.ImagePath
		}
		row := []string{
			strconv.Itoa(wafer.SortIndex),
			wafer.Date,
			wafer.TimeText,
			wafer.LotID,
			wafer.WaferID,
			wafer.SlotNumber,
			wafer.Recipe,
			wafer.PointsMeasured,
			formatFloat(wafer.Stats.Avg, 4),
			formatFloat(wafer.Stats.Min, 4),
			formatFloat(wafer.Stats.Max, 4),
			formatFloat(wafer.Stats.Range, 4),
			formatFloat(wafer.Stats.UniformityPct, 4),
			filepath.ToSlash(imagePath),
		}
		if err := writer.Write(row); err != nil {
			return "", err
		}
	}
	return summaryPath, writer.Error()
}

func toWaferResults(wafers []Wafer) []WaferResult {
	result := make([]WaferResult, 0, len(wafers))
	for _, wafer := range wafers {
		result = append(result, WaferResult{
			SortIndex:      wafer.SortIndex,
			Date:           wafer.Date,
			Time:           wafer.TimeText,
			LotID:          wafer.LotID,
			WaferID:        wafer.WaferID,
			SlotNumber:     wafer.SlotNumber,
			Recipe:         wafer.Recipe,
			PointsMeasured: wafer.PointsMeasured,
			E2Avg:          wafer.Stats.Avg,
			E2Min:          wafer.Stats.Min,
			E2Max:          wafer.Stats.Max,
			E2Range:        wafer.Stats.Range,
			UniformityPct:  wafer.Stats.UniformityPct,
			ImagePath:      wafer.ImagePath,
		})
	}
	return result
}

func renderSingleWafer(wafer Wafer) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, 1040, 720))
	fillRect(img, img.Bounds(), white())
	drawText(img, 34, 42, "Film Thickness", rgba(18, 24, 38, 255), true)
	drawText(img, 34, 74, "Lot ID: "+fallback(wafer.LotID, "-"), textColor(), false)
	drawText(img, 34, 96, "Time: "+fallback(wafer.TimeText, "-"), textColor(), false)
	drawText(img, 34, 118, "Slot Number: "+fallback(wafer.SlotNumber, "-"), textColor(), false)
	drawText(img, 34, 140, "Wafer ID: "+fallback(wafer.WaferID, "-"), textColor(), false)
	drawText(img, 34, 162, "Uniformity: "+formatFloat(wafer.Stats.UniformityPct, 4)+"%", textColor(), false)
	drawText(img, 34, 184, "E2 Avg: "+formatFloat(wafer.Stats.Avg, 4), textColor(), false)
	if wafer.Recipe != "" {
		drawText(img, 34, 206, "Recipe: "+wafer.Recipe, textColor(), false)
	}
	drawWaferPlot(img, wafer, rect{x: 290, y: 72, w: 690, h: 600}, true)
	return img
}

func renderOverviewPage(date string, page int, totalPages int, imageCount int, wafers []*Wafer) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, 1740, 720))
	fillRect(img, img.Bounds(), white())
	drawText(img, 34, 42, "Date: "+date, rgba(18, 24, 38, 255), true)
	drawText(img, 34, 66, fmt.Sprintf("Page %d/%d", page, totalPages), textColor(), false)
	drawText(img, 180, 66, fmt.Sprintf("Images: %d (3 per page)", imageCount), textColor(), false)

	cardW := 540
	cardH := 600
	gap := 28
	startX := 34
	for i, wafer := range wafers {
		x := startX + i*(cardW+gap)
		card := image.Rect(x, 92, x+cardW, 92+cardH)
		fillRect(img, card, rgba(252, 252, 252, 255))
		strokeRect(img, card, rgba(220, 226, 235, 255))
		drawText(img, x+18, 122, "Time: "+fallback(wafer.TimeText, "-"), textColor(), false)
		drawText(img, x+18, 144, "Lot ID: "+fallback(wafer.LotID, "-"), textColor(), false)
		drawText(img, x+18, 166, "Wafer ID: "+fallback(wafer.WaferID, "-"), textColor(), false)
		drawText(img, x+18, 188, "Slot Number: "+fallback(wafer.SlotNumber, "-"), textColor(), false)
		drawWaferPlot(img, *wafer, rect{x: x + 20, y: 210, w: cardW - 40, h: 430}, false)
	}
	return img
}

func drawWaferPlot(img *image.RGBA, wafer Wafer, area rect, showLabels bool) {
	plotW := area.w - 82
	barX := area.x + plotW + 36
	barY := area.y + 56
	barH := area.h - 112
	barW := 22

	cx := area.x + plotW/2
	cy := area.y + area.h/2
	radius := int(math.Min(float64(plotW), float64(area.h)) * 0.43)
	fillCircle(img, cx, cy, radius, rgba(242, 244, 247, 255))
	strokeCircle(img, cx, cy, radius, rgba(189, 196, 208, 255))
	drawLine(img, cx-radius, cy, cx+radius, cy, rgba(220, 226, 235, 255))
	drawLine(img, cx, cy-radius, cx, cy+radius, rgba(220, 226, 235, 255))

	unitRadius := coordinateRadius(wafer.Points)
	for _, point := range wafer.Points {
		px := cx + int(math.Round(point.X/unitRadius*float64(radius)))
		py := cy - int(math.Round(point.Y/unitRadius*float64(radius)))
		sizeW := 58
		sizeH := 22
		if !showLabels {
			sizeW = 18
			sizeH = 18
		}
		box := image.Rect(px-sizeW/2, py-sizeH/2, px+sizeW/2, py+sizeH/2)
		fillRect(img, box, colorForValue(point.E2, wafer.Stats.Min, wafer.Stats.Max))
		strokeRect(img, box, rgba(148, 163, 184, 255))
		if showLabels {
			label := formatFloat(point.E2, 3)
			drawCenteredText(img, box, label, rgba(15, 23, 42, 255), false)
		}
	}

	drawColorBar(img, barX, barY, barW, barH, wafer.Stats.Min, wafer.Stats.Max)
}

func coordinateRadius(points []Point) float64 {
	maxAbs := 0.0
	for _, point := range points {
		maxAbs = math.Max(maxAbs, math.Abs(point.X))
		maxAbs = math.Max(maxAbs, math.Abs(point.Y))
	}
	if maxAbs <= waferRadiusMM*1.15 {
		return waferRadiusMM
	}
	if maxAbs == 0 {
		return waferRadiusMM
	}
	return maxAbs * 1.08
}

func drawColorBar(img *image.RGBA, x int, y int, w int, h int, minValue float64, maxValue float64) {
	for py := y; py < y+h; py++ {
		ratio := 1 - float64(py-y)/float64(maxInt(1, h-1))
		value := minValue + ratio*(maxValue-minValue)
		c := colorForValue(value, minValue, maxValue)
		fillRect(img, image.Rect(x, py, x+w, py+1), c)
	}
	strokeRect(img, image.Rect(x, y, x+w, y+h), rgba(148, 163, 184, 255))
	drawText(img, x+w+8, y+12, formatFloat(maxValue, 3), textColor(), false)
	drawText(img, x+w+8, y+h, formatFloat(minValue, 3), textColor(), false)
	drawText(img, x-2, y-12, "E2", textColor(), true)
}

func colorForValue(value float64, minValue float64, maxValue float64) color.RGBA {
	if maxValue <= minValue {
		return rgba(255, 255, 255, 255)
	}
	t := (value - minValue) / (maxValue - minValue)
	t = math.Max(0, math.Min(1, t))
	low := rgba(220, 38, 38, 255)
	high := rgba(255, 255, 255, 255)
	return rgba(
		uint8(float64(low.R)+(float64(high.R)-float64(low.R))*t),
		uint8(float64(low.G)+(float64(high.G)-float64(low.G))*t),
		uint8(float64(low.B)+(float64(high.B)-float64(low.B))*t),
		255,
	)
}

func savePNG(path string, img image.Image) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	return png.Encode(file, img)
}

func fillRect(img *image.RGBA, r image.Rectangle, c color.Color) {
	draw.Draw(img, r.Intersect(img.Bounds()), &image.Uniform{C: c}, image.Point{}, draw.Src)
}

func strokeRect(img *image.RGBA, r image.Rectangle, c color.Color) {
	drawLine(img, r.Min.X, r.Min.Y, r.Max.X-1, r.Min.Y, c)
	drawLine(img, r.Min.X, r.Max.Y-1, r.Max.X-1, r.Max.Y-1, c)
	drawLine(img, r.Min.X, r.Min.Y, r.Min.X, r.Max.Y-1, c)
	drawLine(img, r.Max.X-1, r.Min.Y, r.Max.X-1, r.Max.Y-1, c)
}

func fillCircle(img *image.RGBA, cx int, cy int, radius int, c color.Color) {
	r2 := radius * radius
	for y := cy - radius; y <= cy+radius; y++ {
		for x := cx - radius; x <= cx+radius; x++ {
			dx := x - cx
			dy := y - cy
			if dx*dx+dy*dy <= r2 && image.Pt(x, y).In(img.Bounds()) {
				img.Set(x, y, c)
			}
		}
	}
}

func strokeCircle(img *image.RGBA, cx int, cy int, radius int, c color.Color) {
	steps := 960
	prevX := cx + radius
	prevY := cy
	for i := 1; i <= steps; i++ {
		angle := 2 * math.Pi * float64(i) / float64(steps)
		x := cx + int(math.Round(math.Cos(angle)*float64(radius)))
		y := cy + int(math.Round(math.Sin(angle)*float64(radius)))
		drawLine(img, prevX, prevY, x, y, c)
		prevX = x
		prevY = y
	}
}

func drawLine(img *image.RGBA, x0 int, y0 int, x1 int, y1 int, c color.Color) {
	dx := int(math.Abs(float64(x1 - x0)))
	dy := -int(math.Abs(float64(y1 - y0)))
	sx := -1
	if x0 < x1 {
		sx = 1
	}
	sy := -1
	if y0 < y1 {
		sy = 1
	}
	err := dx + dy
	for {
		if image.Pt(x0, y0).In(img.Bounds()) {
			img.Set(x0, y0, c)
		}
		if x0 == x1 && y0 == y1 {
			return
		}
		e2 := 2 * err
		if e2 >= dy {
			err += dy
			x0 += sx
		}
		if e2 <= dx {
			err += dx
			y0 += sy
		}
	}
}

func drawText(img *image.RGBA, x int, y int, text string, c color.Color, bold bool) {
	drawer := font.Drawer{
		Dst:  img,
		Src:  image.NewUniform(c),
		Face: basicfont.Face7x13,
		Dot:  fixed.P(x, y),
	}
	drawer.DrawString(asciiText(text))
	if bold {
		drawer.Dot = fixed.P(x+1, y)
		drawer.DrawString(asciiText(text))
	}
}

func drawCenteredText(img *image.RGBA, r image.Rectangle, text string, c color.Color, bold bool) {
	label := asciiText(text)
	w := textWidth(label)
	x := r.Min.X + (r.Dx()-w)/2
	y := r.Min.Y + (r.Dy()+9)/2
	drawText(img, x, y, label, c, bold)
}

func textWidth(text string) int {
	advance := 0
	for range asciiText(text) {
		advance += 7
	}
	return advance
}

func asciiText(text string) string {
	var b strings.Builder
	for _, r := range text {
		if r >= 32 && r <= 126 {
			b.WriteRune(r)
		} else {
			b.WriteRune('?')
		}
	}
	return b.String()
}

func rgba(r uint8, g uint8, b uint8, a uint8) color.RGBA {
	return color.RGBA{R: r, G: g, B: b, A: a}
}

func white() color.RGBA {
	return rgba(255, 255, 255, 255)
}

func textColor() color.RGBA {
	return rgba(48, 55, 68, 255)
}

func safeNamePart(input string) string {
	text := strings.TrimSpace(input)
	if text == "" {
		text = "NA"
	}
	re := regexp.MustCompile(`[<>:"/\\|?*\x00-\x1F\s]+`)
	text = re.ReplaceAllString(text, "-")
	text = strings.Trim(text, "-.")
	if text == "" {
		return "NA"
	}
	return text
}

func formatFloat(value float64, digits int) string {
	return strconv.FormatFloat(value, 'f', digits, 64)
}

func fallback(value string, fallbackValue string) string {
	if strings.TrimSpace(value) == "" {
		return fallbackValue
	}
	return value
}

func maxInt(values ...int) int {
	maxValue := values[0]
	for _, value := range values[1:] {
		if value > maxValue {
			maxValue = value
		}
	}
	return maxValue
}
