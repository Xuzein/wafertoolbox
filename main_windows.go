//go:build windows

package main

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

func getMacOptions() *mac.Options {
	return nil
}

func getWindowsOptions() *windows.Options {
	msg := windows.DefaultMessages()
	msg.MissingRequirements = "缺少运行环境 / Missing Requirements"
	msg.Webview2NotInstalled = "未检测到 Microsoft Edge WebView2 Runtime"
	msg.InstallationRequired = "应用运行依赖 WebView2。点击“确定”将尝试安装；如失败，请手动安装 Evergreen Runtime 后重试。"
	msg.UpdateRequired = "检测到 WebView2 版本过低。点击“确定”将尝试升级；如失败，请手动安装最新 Runtime。"
	msg.ContactAdmin = "当前设备缺少 WebView2 Runtime，请联系管理员安装，或访问 Microsoft 官方下载页面。"
	msg.DownloadPage = "本应用需要 WebView2 Runtime。点击“确定”打开下载页面。最低版本要求："
	msg.InvalidFixedWebview2 = "检测到本地固定版 WebView2 路径，但无效。请检查目录中是否包含 msedgewebview2.exe。"

	return &windows.Options{
		DisableWindowIcon:                 false,
		DisableFramelessWindowDecorations: true,
		WebviewIsTransparent:              false,
		WindowIsTranslucent:               false,
		WebviewUserDataPath:               resolveWebViewUserDataPath(),
		WebviewBrowserPath:                resolveFixedWebView2Path(),
		Messages:                          msg,
	}
}

func isFrameless() bool {
	return true
}

func resolveWebViewUserDataPath() string {
	localAppData := strings.TrimSpace(os.Getenv("LOCALAPPDATA"))
	if localAppData == "" {
		return ""
	}
	return filepath.Join(localAppData, "Waferbox", "WebView2")
}

func resolveFixedWebView2Path() string {
	exePath, err := os.Executable()
	if err != nil {
		return ""
	}
	baseDir := filepath.Dir(exePath)

	candidates := make([]string, 0, 6)
	if envDir := strings.TrimSpace(os.Getenv("WAFERBOX_WEBVIEW2_FIXED_DIR")); envDir != "" {
		if filepath.IsAbs(envDir) {
			candidates = append(candidates, envDir)
		} else {
			candidates = append(candidates, filepath.Join(baseDir, envDir))
		}
	}

	candidates = append(candidates,
		filepath.Join(baseDir, "webview2-fixed"),
		filepath.Join(baseDir, "webview2"),
	)

	matches, _ := filepath.Glob(filepath.Join(baseDir, "Microsoft.WebView2.FixedVersionRuntime*"))
	candidates = append(candidates, matches...)

	for _, candidate := range candidates {
		if isValidFixedWebView2Dir(candidate) {
			return candidate
		}
	}
	return ""
}

func isValidFixedWebView2Dir(dir string) bool {
	if strings.TrimSpace(dir) == "" {
		return false
	}
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		return false
	}
	_, err = os.Stat(filepath.Join(dir, "msedgewebview2.exe"))
	return err == nil
}
