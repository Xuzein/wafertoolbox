//go:build darwin

package main

import (
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

func getMacOptions() *mac.Options {
	cfg := LoadConfig()
	appearance := mac.DefaultAppearance
	switch cfg.Theme {
	case "dark":
		appearance = mac.NSAppearanceNameDarkAqua
	case "light":
		appearance = mac.NSAppearanceNameAqua
	// "system" or anything else → DefaultAppearance (follow system)
	}

	return &mac.Options{
		Appearance: appearance,

		TitleBar: &mac.TitleBar{
			TitlebarAppearsTransparent: true,
			HideTitle:                  true,
			HideTitleBar:               false,
			FullSizeContent:            true,
			UseToolbar:                 false,
			HideToolbarSeparator:       true,
		},
		WebviewIsTransparent: true,
		WindowIsTranslucent:  true,
	}
}

func getWindowsOptions() *windows.Options {
	return nil
}

func isFrameless() bool {
	return false
}
