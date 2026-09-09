package api

import (
	"os"
	"path/filepath"
	"strings"
)

// tiny fs/path helpers for the static handler

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

func joinPath(base, name string) string {
	return filepath.Join(base, filepath.FromSlash(name))
}

func containsDotDot(p string) bool { return strings.Contains(p, "..") }

// isUnder — cleaned path must stay inside the static root.
func isUnder(root, target string) bool {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	absTarget, err := filepath.Abs(target)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(absRoot, absTarget)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func hasPrefix(s, prefix string) bool { return strings.HasPrefix(s, prefix) }

