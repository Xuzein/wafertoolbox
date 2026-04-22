package main

import (
	"context"
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

var appContext context.Context

func main() {
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:     "Waferbox 工具箱",
		Width:     1024,
		Height:    768,
		Frameless: isFrameless(),
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		Debug: options.Debug{
			OpenInspectorOnStartup: true,
		},
		OnStartup: func(ctx context.Context) {
			appContext = ctx
			app.startup(ctx)
		},
		Bind: []interface{}{
			app,
		},
		Mac:     getMacOptions(),
		Windows: getWindowsOptions(),
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
