package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"strings"

	exportapp "waferbox/internal/application/export"
	"waferbox/internal/application/filmthickness"
	"waferbox/internal/domain/wafer"
	"waferbox/internal/infrastructure/storage"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx           context.Context
	exportService *exportapp.Service
}

func NewApp() *App {
	downloadStorage := storage.NewDownloadStorage()
	return &App{
		exportService: exportapp.NewService(downloadStorage),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// SetAppearance sets the native window appearance to match the frontend theme
// and persists the choice so the correct glass style is used at next launch.
// theme: "dark" -> NSAppearanceNameDarkAqua, "light" -> NSAppearanceNameAqua, "system" -> DefaultAppearance
func (a *App) SetAppearance(theme string) {
	setMacAppearance(theme)
	_ = SaveConfig(AppConfig{Theme: theme})
}

type WaferPoint struct {
	X int `json:"x"`
	Y int `json:"y"`
}

type WaferMapExportRequest struct {
	FileName        string       `json:"fileName"`
	RowCount        int          `json:"rowCount"`
	ColCount        int          `json:"colCount"`
	XDies           float64      `json:"xDies"`
	YDies           float64      `json:"yDies"`
	CenterX         float64      `json:"centerX"`
	CenterY         float64      `json:"centerY"`
	Radius          float64      `json:"radius"`
	MaxImageSize    int          `json:"maxImageSize"`
	BackgroundColor string       `json:"backgroundColor"`
	PassColor       string       `json:"passColor"`
	FailColor       string       `json:"failColor"`
	BorderColor     string       `json:"borderColor"`
	AxisColor       string       `json:"axisColor"`
	CircleColor     string       `json:"circleColor"`
	CenterColor     string       `json:"centerColor"`
	PassPoints      []WaferPoint `json:"passPoints"`
	FailPoints      []WaferPoint `json:"failPoints"`
}

type MergedTestItemRow struct {
	Wafer  string   `json:"wafer"`
	Values []string `json:"values"`
}

type MergedTestItemExcelRequest struct {
	FileName string              `json:"fileName"`
	TestItem string              `json:"testItem"`
	Rows     []MergedTestItemRow `json:"rows"`
}

type FilmThicknessAnalyzeRequest struct {
	FileName   string                   `json:"fileName"`
	DataBase64 string                   `json:"dataBase64"`
	OutputRoot string                   `json:"outputRoot"`
	Files      []FilmThicknessInputFile `json:"files"`
}

type FilmThicknessInputFile struct {
	FileName   string `json:"fileName"`
	DataBase64 string `json:"dataBase64"`
}

type FilmThicknessWaferResult struct {
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

type FilmThicknessDateResult struct {
	Date       string   `json:"date"`
	DirPath    string   `json:"dirPath"`
	PageImages []string `json:"pageImages"`
	WaferCount int      `json:"waferCount"`
}

type FilmThicknessAnalyzeResult struct {
	OutputRoot  string                     `json:"outputRoot"`
	SummaryPath string                     `json:"summaryPath"`
	WaferCount  int                        `json:"waferCount"`
	Dates       []FilmThicknessDateResult  `json:"dates"`
	Wafers      []FilmThicknessWaferResult `json:"wafers"`
	Warnings    []string                   `json:"warnings"`
}

func toDomainPoints(points []WaferPoint) []wafer.Point {
	result := make([]wafer.Point, 0, len(points))
	for _, p := range points {
		result = append(result, wafer.Point{X: p.X, Y: p.Y})
	}
	return result
}

func toMergedRows(rows []MergedTestItemRow) []exportapp.MergedTestItemRow {
	result := make([]exportapp.MergedTestItemRow, 0, len(rows))
	for _, row := range rows {
		result = append(result, exportapp.MergedTestItemRow{
			Wafer:  row.Wafer,
			Values: row.Values,
		})
	}
	return result
}

func toFilmThicknessResult(result filmthickness.Result) FilmThicknessAnalyzeResult {
	dates := make([]FilmThicknessDateResult, 0, len(result.Dates))
	for _, date := range result.Dates {
		dates = append(dates, FilmThicknessDateResult{
			Date:       date.Date,
			DirPath:    date.DirPath,
			PageImages: date.PageImages,
			WaferCount: date.WaferCount,
		})
	}

	wafers := make([]FilmThicknessWaferResult, 0, len(result.Wafers))
	for _, waferResult := range result.Wafers {
		wafers = append(wafers, FilmThicknessWaferResult{
			SortIndex:      waferResult.SortIndex,
			Date:           waferResult.Date,
			Time:           waferResult.Time,
			LotID:          waferResult.LotID,
			WaferID:        waferResult.WaferID,
			SlotNumber:     waferResult.SlotNumber,
			Recipe:         waferResult.Recipe,
			PointsMeasured: waferResult.PointsMeasured,
			E2Avg:          waferResult.E2Avg,
			E2Min:          waferResult.E2Min,
			E2Max:          waferResult.E2Max,
			E2Range:        waferResult.E2Range,
			UniformityPct:  waferResult.UniformityPct,
			ImagePath:      waferResult.ImagePath,
		})
	}

	return FilmThicknessAnalyzeResult{
		OutputRoot:  result.OutputRoot,
		SummaryPath: result.SummaryPath,
		WaferCount:  result.WaferCount,
		Dates:       dates,
		Wafers:      wafers,
		Warnings:    result.Warnings,
	}
}

func (a *App) SaveBase64Image(dataURL string, fileName string) (string, error) {
	return a.exportService.SaveBase64Image(dataURL, fileName)
}

func (a *App) SaveWaferMapPNG(req WaferMapExportRequest) (string, error) {
	renderReq := wafer.RenderRequest{
		RowCount:        req.RowCount,
		ColCount:        req.ColCount,
		XDies:           req.XDies,
		YDies:           req.YDies,
		CenterX:         req.CenterX,
		CenterY:         req.CenterY,
		Radius:          req.Radius,
		MaxImageSize:    req.MaxImageSize,
		BackgroundColor: req.BackgroundColor,
		PassColor:       req.PassColor,
		FailColor:       req.FailColor,
		BorderColor:     req.BorderColor,
		AxisColor:       req.AxisColor,
		CircleColor:     req.CircleColor,
		CenterColor:     req.CenterColor,
		PassPoints:      toDomainPoints(req.PassPoints),
		FailPoints:      toDomainPoints(req.FailPoints),
	}
	return a.exportService.SaveWaferMapPNG(req.FileName, renderReq)
}

func (a *App) SaveMergedTestItemExcel(req MergedTestItemExcelRequest) (string, error) {
	return a.exportService.SaveMergedTestItemExcel(req.FileName, req.TestItem, toMergedRows(req.Rows))
}

func (a *App) AnalyzeFilmThickness(req FilmThicknessAnalyzeRequest) (FilmThicknessAnalyzeResult, error) {
	files, err := toFilmThicknessInputFiles(req)
	if err != nil {
		return FilmThicknessAnalyzeResult{}, err
	}
	result, err := filmthickness.ProcessManyBytes(files, req.OutputRoot)
	if err != nil {
		return FilmThicknessAnalyzeResult{}, err
	}
	return toFilmThicknessResult(result), nil
}

func toFilmThicknessInputFiles(req FilmThicknessAnalyzeRequest) ([]filmthickness.InputFile, error) {
	rawFiles := req.Files
	if len(rawFiles) == 0 && strings.TrimSpace(req.DataBase64) != "" {
		rawFiles = []FilmThicknessInputFile{{
			FileName:   req.FileName,
			DataBase64: req.DataBase64,
		}}
	}

	files := make([]filmthickness.InputFile, 0, len(rawFiles))
	for _, file := range rawFiles {
		raw := file.DataBase64
		if idx := strings.Index(raw, ","); idx >= 0 {
			raw = raw[idx+1:]
		}
		data, err := base64.StdEncoding.DecodeString(raw)
		if err != nil {
			return nil, fmt.Errorf("%s: decode csv content: %w", file.FileName, err)
		}
		files = append(files, filmthickness.InputFile{
			SourceName: file.FileName,
			Data:       data,
		})
	}
	return files, nil
}

func (a *App) SelectFilmThicknessOutputRoot(defaultDirectory string) (string, error) {
	defaultDirectory = strings.TrimSpace(defaultDirectory)
	if defaultDirectory != "" {
		if info, err := os.Stat(defaultDirectory); err != nil || !info.IsDir() {
			defaultDirectory = ""
		}
	}
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:                "选择膜厚分析输出目录",
		DefaultDirectory:     defaultDirectory,
		CanCreateDirectories: true,
	})
}
