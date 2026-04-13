package storage

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type DownloadStorage struct{}

func NewDownloadStorage() *DownloadStorage {
	return &DownloadStorage{}
}

func sanitizeFileName(name string) string {
	fileName := strings.TrimSpace(name)
	if fileName == "" {
		fileName = "wafermap.png"
	}
	if filepath.Ext(fileName) == "" {
		fileName += ".png"
	}
	re := regexp.MustCompile(`[<>:"/\\|?*\x00-\x1F]`)
	return re.ReplaceAllString(fileName, "_")
}

func uniquePath(path string) string {
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return path
	}
	ext := filepath.Ext(path)
	base := strings.TrimSuffix(path, ext)
	for i := 1; i < 10000; i++ {
		next := fmt.Sprintf("%s(%d)%s", base, i, ext)
		if _, err := os.Stat(next); errors.Is(err, os.ErrNotExist) {
			return next
		}
	}
	return path
}

func (s *DownloadStorage) SaveBytesToDownloads(fileName string, data []byte) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		home = "."
	}

	targetDir := filepath.Join(home, "Downloads")
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		targetDir = "."
	}

	safeName := sanitizeFileName(fileName)
	fullPath := uniquePath(filepath.Join(targetDir, safeName))
	if err := os.WriteFile(fullPath, data, 0o644); err != nil {
		return "", err
	}
	return fullPath, nil
}
