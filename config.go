package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// AppConfig holds persistent user preferences that need to survive restarts.
type AppConfig struct {
	Theme string `json:"theme"` // "system" | "light" | "dark"
}

func getConfigDir() string {
	cfgDir, err := os.UserConfigDir()
	if err != nil {
		home, _ := os.UserHomeDir()
		if home == "" {
			return ""
		}
		return filepath.Join(home, ".config", "waferbox")
	}
	return filepath.Join(cfgDir, "waferbox")
}

func getConfigPath() string {
	dir := getConfigDir()
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, "config.json")
}

// LoadConfig reads the persisted config; returns defaults on any error.
func LoadConfig() AppConfig {
	path := getConfigPath()
	if path == "" {
		return AppConfig{Theme: "system"}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return AppConfig{Theme: "system"}
	}
	var cfg AppConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return AppConfig{Theme: "system"}
	}
	if cfg.Theme == "" {
		cfg.Theme = "system"
	}
	return cfg
}

// SaveConfig writes the config to disk.
func SaveConfig(cfg AppConfig) error {
	path := getConfigPath()
	if path == "" {
		return nil
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}
