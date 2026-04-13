package export

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image/png"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/xuri/excelize/v2"

	"waferbox/internal/domain/wafer"
)

type ByteStorage interface {
	SaveBytesToDownloads(fileName string, data []byte) (string, error)
}

type Service struct {
	storage ByteStorage
}

func NewService(storage ByteStorage) *Service {
	return &Service{storage: storage}
}

func decodeDataURL(dataURL string) ([]byte, error) {
	parts := strings.SplitN(dataURL, ",", 2)
	if len(parts) != 2 {
		return nil, errors.New("invalid data URL")
	}
	raw := parts[1]
	return base64.StdEncoding.DecodeString(raw)
}

func (s *Service) SaveBase64Image(dataURL string, fileName string) (string, error) {
	imageBytes, err := decodeDataURL(dataURL)
	if err != nil {
		return "", err
	}
	return s.storage.SaveBytesToDownloads(fileName, imageBytes)
}

func (s *Service) SaveWaferMapPNG(fileName string, req wafer.RenderRequest) (string, error) {
	img, err := wafer.RenderWaferMap(req)
	if err != nil {
		return "", err
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return "", err
	}
	return s.storage.SaveBytesToDownloads(fileName, buf.Bytes())
}

type MergedTestItemRow struct {
	Wafer  string
	Values []string
}

func normalizeXlsxFileName(fileName string) string {
	name := strings.TrimSpace(fileName)
	if name == "" {
		return "merged-test-item.xlsx"
	}
	if filepath.Ext(name) == "" {
		return name + ".xlsx"
	}
	return name
}

func (s *Service) SaveMergedTestItemExcel(fileName string, testItem string, rows []MergedTestItemRow) (string, error) {
	workbook := excelize.NewFile()
	sheetName := "Merged"
	defaultSheet := workbook.GetSheetName(0)
	workbook.SetSheetName(defaultSheet, sheetName)

	maxValuesLen := 0
	for _, row := range rows {
		if len(row.Values) > maxValuesLen {
			maxValuesLen = len(row.Values)
		}
	}

	if err := workbook.SetCellValue(sheetName, "A1", "Wafer"); err != nil {
		return "", err
	}
	for col := 0; col < maxValuesLen; col += 1 {
		cell, err := excelize.CoordinatesToCellName(col+2, 1)
		if err != nil {
			return "", err
		}
		header := testItem
		if maxValuesLen > 1 {
			header = testItem + "_" + strconv.Itoa(col+1)
		}
		if err := workbook.SetCellValue(sheetName, cell, header); err != nil {
			return "", err
		}
	}

	for rowIndex, row := range rows {
		excelRow := rowIndex + 2
		cell, err := excelize.CoordinatesToCellName(1, excelRow)
		if err != nil {
			return "", err
		}
		if err := workbook.SetCellValue(sheetName, cell, row.Wafer); err != nil {
			return "", err
		}

		for valueIndex, rawValue := range row.Values {
			valueCell, err := excelize.CoordinatesToCellName(valueIndex+2, excelRow)
			if err != nil {
				return "", err
			}
			value := strings.TrimSpace(rawValue)
			if value == "" {
				continue
			}
			if numeric, parseErr := strconv.ParseFloat(value, 64); parseErr == nil {
				if err := workbook.SetCellValue(sheetName, valueCell, numeric); err != nil {
					return "", err
				}
				continue
			}
			if err := workbook.SetCellValue(sheetName, valueCell, value); err != nil {
				return "", err
			}
		}
	}

	headerStyle, err := workbook.NewStyle(&excelize.Style{
		Font: &excelize.Font{
			Bold: true,
		},
	})
	if err != nil {
		return "", err
	}
	lastHeaderCell, err := excelize.CoordinatesToCellName(maxValuesLen+1, 1)
	if err != nil {
		return "", err
	}
	if err := workbook.SetCellStyle(sheetName, "A1", lastHeaderCell, headerStyle); err != nil {
		return "", err
	}
	if err := workbook.SetPanes(sheetName, &excelize.Panes{
		Freeze:      true,
		Split:       false,
		XSplit:      1,
		TopLeftCell: "B2",
		ActivePane:  "bottomRight",
	}); err != nil {
		return "", err
	}
	if err := workbook.SetColWidth(sheetName, "A", "A", 18); err != nil {
		return "", err
	}
	if maxValuesLen > 0 {
		lastDataCol, err := excelize.ColumnNumberToName(maxValuesLen + 1)
		if err != nil {
			return "", err
		}
		if err := workbook.SetColWidth(sheetName, "B", lastDataCol, 12); err != nil {
			return "", err
		}
	}

	var out bytes.Buffer
	if _, err := workbook.WriteTo(&out); err != nil {
		return "", err
	}
	return s.storage.SaveBytesToDownloads(normalizeXlsxFileName(fileName), out.Bytes())
}
