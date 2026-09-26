package api

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"onekey/server/internal/service"
)

const sampleIndex = `<html><head><title>x</title></head><body><div id="root"></div></body></html>`

func TestInjectBootConfigBeforeHead(t *testing.T) {
	out := string(injectBootConfig([]byte(sampleIndex), map[string]any{"show_home_page": false}))
	if strings.Index(out, "__APP_CONFIG__") > strings.Index(out, "</head>") {
		t.Fatal("boot config landed after </head>")
	}
	if !strings.Contains(out, `"show_home_page":false`) {
		t.Fatalf("flag missing from injection: %s", out)
	}
	if !strings.HasPrefix(out, "<html><head>") || !strings.HasSuffix(out, "</html>") {
		t.Fatalf("document was not otherwise preserved: %s", out)
	}
}

func TestInjectBootConfigWithoutHead(t *testing.T) {
	out := string(injectBootConfig([]byte(`<div id="root"></div>`), map[string]any{"show_home_page": true}))
	if !strings.HasPrefix(out, "<script>") {
		t.Fatalf("expected the config to be prepended, got: %s", out)
	}
	if !strings.HasSuffix(out, `<div id="root"></div>`) {
		t.Fatalf("original body lost: %s", out)
	}
}

// A value that closes the script tag would let the rest of the page be parsed as
// markup, so this asserts the escape rather than the flag.
func TestInjectBootConfigEscapesScriptTag(t *testing.T) {
	out := string(injectBootConfig([]byte(sampleIndex), map[string]any{"x": "</script><script>alert(1)"}))
	if strings.Contains(out, "</script><script>alert") {
		t.Fatalf("value was not escaped: %s", out)
	}
	if !strings.Contains(out, `\u003c/script\u003e`) {
		t.Fatalf("expected \\u003c escaping: %s", out)
	}
}

func TestServeIndexReflectsSetting(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte(sampleIndex), 0o644); err != nil {
		t.Fatal(err)
	}
	settings := service.NewSettings()
	app := &App{Settings: settings, staticDir: dir}

	// NewSettings carries no DB rows, so this is also the default-value path.
	rec := httptest.NewRecorder()
	app.serveIndex(rec)
	if rec.Code != 200 {
		t.Fatalf("status = %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/html; charset=utf-8" {
		t.Fatalf("content type = %q", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("cache control = %q, an injected body must not be cached", cc)
	}
	var cfg map[string]any
	if err := json.Unmarshal(extractConfig(t, rec.Body.String()), &cfg); err != nil {
		t.Fatal(err)
	}
	if cfg["show_home_page"] != true {
		t.Fatalf("default should enable the home page, got %v", cfg["show_home_page"])
	}

	settings.Set("show_home_page", "0")
	rec = httptest.NewRecorder()
	app.serveIndex(rec)
	if err := json.Unmarshal(extractConfig(t, rec.Body.String()), &cfg); err != nil {
		t.Fatal(err)
	}
	if cfg["show_home_page"] != false {
		t.Fatalf("setting override not honoured, got %v", cfg["show_home_page"])
	}
}

func TestBoolSetting(t *testing.T) {
	cases := map[string]bool{
		"":      true, // unset takes the documented default
		"1":     true,
		"true":  true,
		"0":     false,
		" 0 ":   false, // a pasted value with padding must still read as off
		"false": false,
		"FALSE": false,
	}
	for v, want := range cases {
		if got := boolSetting(v); got != want {
			t.Errorf("boolSetting(%q) = %v, want %v", v, got, want)
		}
	}
}

func TestServeIndexMissingFileIs404(t *testing.T) {
	rec := httptest.NewRecorder()
	(&App{Settings: service.NewSettings(), staticDir: t.TempDir()}).serveIndex(rec)
	if rec.Code != 404 {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

// extractConfig pulls the JSON payload back out of the injected script tag.
func extractConfig(t *testing.T, body string) []byte {
	t.Helper()
	const open = "<script>window.__APP_CONFIG__="
	i := strings.Index(body, open)
	if i < 0 {
		t.Fatalf("no boot config in: %s", body)
	}
	rest := body[i+len(open):]
	j := strings.Index(rest, ";</script>")
	if j < 0 {
		t.Fatalf("unterminated boot config in: %s", body)
	}
	return []byte(rest[:j])
}
