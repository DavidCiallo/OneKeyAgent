package ai

// Request files — the unabridged copy of every relayed attempt, on the main
// node only.
//
// audit_log keeps a 40-row window of summaries: string leaves cut to a preview,
// bodies only on failures. These files are the other half — one JSON document
// per attempt, success or failure, holding the request body exactly as it went
// upstream.
//
// They are off by default and are switched on from the audit page for one
// window at a time. A debugging session leaves the directory behind; an always-on
// switch would turn every prompt the instance relays into a file nobody asked
// for, so the switch is the whole retention policy.

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// RequestFileWindow — how long one switch-on lasts.
const RequestFileWindow = 5 * time.Minute

type requestFiles struct {
	dir string

	mu sync.Mutex
	// until is when the current window ends; zero or past means off.
	until time.Time
}

// requestFileRecord — metadata plus the raw request. Request is kept as
// json.RawMessage so the file contains the body itself, not a string holding
// escaped JSON.
type requestFileRecord struct {
	Ts           int64           `json:"ts"`
	Success      bool            `json:"success"`
	StatusCode   int             `json:"status_code"`
	Endpoint     string          `json:"endpoint"`
	AccountID    string          `json:"account_id"`
	AccountName  string          `json:"account_name"`
	ModelAlias   string          `json:"model_alias"`
	ProviderID   string          `json:"provider_id"`
	ProviderName string          `json:"provider_name"`
	ApiType      string          `json:"api_type"`
	Stream       bool            `json:"stream"`
	DurationMs   int64           `json:"duration_ms"`
	TtftMs       int64           `json:"ttft_ms"`
	InputTokens  int64           `json:"input_tokens"`
	CachedInput  int64           `json:"cached_input_tokens"`
	OutputTokens int64           `json:"output_tokens"`
	Cost         float64         `json:"cost"`
	Err          string          `json:"err,omitempty"`
	Request      json.RawMessage `json:"request"`
	// Response is the upstream's failure body — the same text the audit row keeps
	// a summary of. Successes have nothing to put here: a streamed reply has no
	// single document to store.
	Response json.RawMessage `json:"response,omitempty"`
}

// EnableRequestFiles — point request files at dir. They stay off until an admin
// turns them on, and nothing is created on disk before that. A replica never
// calls this, so only the main node has them at all.
func (s *Server) EnableRequestFiles(dir string) {
	if dir == "" {
		return
	}
	s.files = &requestFiles{dir: dir}
}

// RequestFilesAvailable — whether this node can write request files at all.
func (s *Server) RequestFilesAvailable() bool { return s.files != nil }

// RequestFileStatus — whether files are being written right now, and when that
// stops (Unix ms; 0 when off). An expired window reads as off without anyone
// having to turn it off.
func (s *Server) RequestFileStatus() (bool, int64) {
	if s.files == nil {
		return false, 0
	}
	return s.files.state()
}

// SetRequestFiles — start one window, or stop now.
func (s *Server) SetRequestFiles(on bool) (int64, error) {
	if s.files == nil {
		return 0, fmt.Errorf("request files are only written by the main node")
	}
	return s.files.set(on)
}

func (f *requestFiles) set(on bool) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !on {
		f.until = time.Time{}
		return 0, nil
	}
	// Created on the first switch-on rather than at boot: a node that never uses
	// the files should not carry an empty directory.
	if err := os.MkdirAll(f.dir, 0o755); err != nil {
		f.until = time.Time{}
		return 0, err
	}
	f.until = time.Now().Add(RequestFileWindow)
	return f.until.UnixMilli(), nil
}

func (f *requestFiles) state() (bool, int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.until.IsZero() || !time.Now().Before(f.until) {
		return false, 0
	}
	return true, f.until.UnixMilli()
}

// jsonBody — a captured upstream body for the file. Almost always JSON, embedded
// as-is so it reads like the response did; anything else (an HTML page from a
// proxy in front of the provider) is written as a quoted string, because a raw
// fragment would make the whole record unparseable.
func jsonBody(s string) json.RawMessage {
	if s == "" {
		return nil
	}
	if json.Valid([]byte(s)) {
		return json.RawMessage(s)
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(s); err != nil {
		return nil
	}
	return bytes.TrimRight(buf.Bytes(), "\n")
}

// write — <model>-<provider>-<ts>.json, never overwriting: two attempts of the
// same pair inside one millisecond get -2, -3 on the end rather than losing one.
func (f *requestFiles) write(rec requestFileRecord) {
	if f == nil {
		return
	}
	if on, _ := f.state(); !on {
		return
	}
	// An empty RawMessage is invalid JSON to the marshaler; a missing body is
	// simply null in the file.
	if len(rec.Request) == 0 {
		rec.Request = nil
	}
	// Encoder rather than Marshal for the escaping switch: the HTML page a proxy
	// returns on a 502 is the case this file exists for, and \u003c in it is
	// unreadable.
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(rec); err != nil {
		fmt.Println("[Audit] request file marshal failed:", err)
		return
	}
	data := buf.Bytes()
	base := fmt.Sprintf("%s-%s-%d", fileSafeName(rec.ModelAlias), fileSafeName(rec.ProviderName), rec.Ts)
	for n := 0; n < 50; n++ {
		name := base
		if n > 0 {
			name = fmt.Sprintf("%s-%d", base, n+1)
		}
		fd, err := os.OpenFile(filepath.Join(f.dir, name+".json"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if errors.Is(err, os.ErrExist) {
			continue
		}
		if err != nil {
			fmt.Println("[Audit] request file create failed:", err)
			return
		}
		_, werr := fd.Write(data)
		fd.Close()
		if werr != nil {
			fmt.Println("[Audit] request file write failed:", werr)
		}
		return
	}
	fmt.Println("[Audit] request file skipped, 50 attempts of that name already exist:", base)
}

// fileSafeName — the model alias and provider name go into a path, so anything
// outside [A-Za-z0-9._-] (a slash in an alias, a space in a provider name)
// becomes "-". Bounded so a long alias cannot exceed a path component.
func fileSafeName(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '.', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteByte('-')
		}
	}
	out := strings.Trim(b.String(), "-")
	if len(out) > 60 {
		out = out[:60]
	}
	if out == "" {
		return "unknown"
	}
	return out
}
