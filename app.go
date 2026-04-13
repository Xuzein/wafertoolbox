package main

import (
	"context"

	exportapp "waferbox/internal/application/export"
	"waferbox/internal/domain/wafer"
	"waferbox/internal/infrastructure/storage"
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

func toDomainPoints(points []WaferPoint) []wafer.Point {
	result := make([]wafer.Point, 0, len(points))
	for _, p := range points {
		result = append(result, wafer.Point{X: p.X, Y: p.Y})
	}
	return result
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
