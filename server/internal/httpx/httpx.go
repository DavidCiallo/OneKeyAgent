// Package httpx — request context extraction, response envelopes and CORS,
// mirroring server/lib/mount.ts behavior:
//   - handler input: query params overlaid by JSON body (body wins)
//   - auth: token / x-api-key / Authorization: Bearer header
//   - success: { success: true, data } ; error: 400 { success: false, message, data: null }
package httpx

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

type Ctx struct {
	W       http.ResponseWriter
	R       *http.Request
	M       map[string]any // merged query + body
	Auth    string
	RawBody []byte
}

// Read builds a Ctx, consuming the request body (parse: json → urlencoded →
// raw json fallback; identical order to mounthttp).
func Read(w http.ResponseWriter, r *http.Request) *Ctx {
	c := &Ctx{W: w, R: r, M: map[string]any{}}
	// query first (strings), body overlays
	for k, vs := range r.URL.Query() {
		if len(vs) > 0 {
			c.M[k] = vs[0]
		}
	}
	auth := r.Header.Get("token")
	if auth == "" {
		auth = r.Header.Get("x-api-key")
	}
	if auth == "" {
		auth = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	}
	c.Auth = auth

	body, err := io.ReadAll(io.LimitReader(r.Body, 64<<20))
	if err == nil {
		c.RawBody = body
		contentType := r.Header.Get("Content-Type")
		var parsed map[string]any
		ok := false
		switch {
		case strings.Contains(contentType, "application/json"):
			ok = json.Unmarshal(body, &parsed) == nil && parsed != nil
		case strings.Contains(contentType, "application/x-www-form-urlencoded"):
			parsed = parseForm(string(body))
			ok = parsed != nil
		default:
			if jerr := json.Unmarshal(body, &parsed); jerr == nil && parsed != nil {
				ok = true
			} else if p2 := parseForm(string(body)); p2 != nil {
				parsed = p2
				ok = true
			}
		}
		if ok {
			for k, v := range parsed {
				c.M[k] = v
			}
		}
	}
	return c
}

func parseForm(s string) map[string]any {
	if s == "" {
		return nil
	}
	vals, err := url.ParseQuery(s)
	if err != nil {
		return nil
	}
	out := map[string]any{}
	for k, vs := range vals {
		if len(vs) > 0 {
			out[k] = vs[0]
		}
	}
	return out
}

func (c *Ctx) Str(key string) string {
	if v, ok := c.M[key].(string); ok {
		return v
	}
	return ""
}

func (c *Ctx) Float(key string) float64 {
	switch v := c.M[key].(type) {
	case float64:
		return v
	case string:
		var f float64
		if _, err := fmtSscan(v, &f); err == nil {
			return f
		}
	}
	return 0
}

func (c *Ctx) Int(key string) int64 { return int64(c.Float(key)) }

func (c *Ctx) Bool(key string) bool {
	switch v := c.M[key].(type) {
	case bool:
		return v
	case string:
		return v == "true"
	}
	return false
}

func (c *Ctx) Obj(key string) map[string]any {
	if m, ok := c.M[key].(map[string]any); ok {
		return m
	}
	return nil
}

func (c *Ctx) Arr(key string) []any {
	if a, ok := c.M[key].([]any); ok {
		return a
	}
	return nil
}

func fmtSscan(s string, f *float64) (int, error) { return fmt.Sscanf(s, "%g", f) }

// ─────────────────── responses ───────────────────

func setCors(h http.Header) {
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	h.Set("Access-Control-Allow-Headers", "Content-Type, token, Authorization, x-api-key")
}

func JSON(w http.ResponseWriter, status int, body any) {
	b, err := json.Marshal(body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	setCors(w.Header())
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(b)
}

// OK — envelope { success: true, data }.
func OK(w http.ResponseWriter, data any) {
	JSON(w, http.StatusOK, map[string]any{"success": true, "data": data})
}

// Raw — unenveloped JSON body (raw routes).
func Raw(w http.ResponseWriter, body any) { JSON(w, http.StatusOK, body) }

// Fail — 400 { success: false, message, data: null }.
func Fail(w http.ResponseWriter, message string) {
	JSON(w, http.StatusBadRequest, map[string]any{
		"success": false, "message": message, "data": nil,
	})
}

// Options — CORS preflight answer.
func Options(w http.ResponseWriter) {
	setCors(w.Header())
	w.WriteHeader(http.StatusOK)
}

// TextStatus — plain-text status response (static handler fallbacks).
func TextStatus(w http.ResponseWriter, code int, body string) {
	w.WriteHeader(code)
	_, _ = w.Write([]byte(body))
}
