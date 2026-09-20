package api

import (
	
"encoding/json"
	
"io"
	
"net/http"
	
"net/http/httptest"
	
"strings"
	
"testing"

	
"onekey/server/internal/httpx"
	
"onekey/server/internal/sync"
)

// TestShouldProxyUsageShortCircuits - the structural guards that must hold
// before any database / account work happens. These keep the forwarding branch
// inert on the main node (no Syncer) and stop a replica with no MAIN_DB_URL from
// forwarding nowhere.
func TestShouldProxyUsageShortCircuits(t *testing.T) {
	
ctx := &httpx.Ctx{Auth: "some-token"}

	
if (&App{Syncer: nil}).shouldProxyUsage(ctx) {
	
	
t.Error("main node must not proxy (no Syncer)")
	
}
	
if (&App{Syncer: &sync.Syncer{}}).shouldProxyUsage(ctx) {
	
	
t.Error("replica without MAIN_DB_URL must not proxy")
	
}
	
if (&App{}).shouldProxyUsage(&httpx.Ctx{}) {
	
	
t.Error("empty ctx on a main node must not proxy")
	
}
}

// TestForwardUsageParsesEnvelopeAndReturnsInnerData - the main database answers
// with its usual { success, data } envelope; forwardUsage must hand back the
// inner data so the caller returns it like any local result and wrap() re-wraps
// it. Returning the whole envelope, or a raw reply, would lose or double the
// envelope and the admin UI checks res.success / res.data.
func TestForwardUsageParsesEnvelopeAndReturnsInnerData(t *testing.T) {
	
inner := map[string]any{
	
	
"list":           []any{map[string]any{"account_id": "a1"}},
	
	
"recentSessions": []any{},
	
	
"totals":         map[string]any{"totalRequests": 3},
	
}
	
main := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	
	
if r.URL.Path != "/api/usage/sessions" {
	
	
	
t.Errorf("forwarded path = %q, want /api/usage/sessions", r.URL.Path)
	
	
}
	
	
if got := r.Header.Get("token"); got != "tok" {
	
	
	
t.Errorf("forwarded token = %q, want tok", got)
	
	
}
	
	
_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "message": "", "data": inner})
	
}))
	
defer main.Close()

	
app := &App{Syncer: newSyncerWithURL(main.URL)}
	
ctx := &httpx.Ctx{
	
	
Auth:    "tok",
	
	
RawBody: []byte("{}"),
	
	
R:       httptest.NewRequest(http.MethodPost, "/api/usage/sessions", strings.NewReader("{}")),
	
}
	
got, err := app.forwardUsage(ctx)
	
if err != nil {
	
	
t.Fatalf("forwardUsage: %v", err)
	
}
	
m, ok := got.(map[string]any)
	
if !ok {
	
	
t.Fatalf("forwardUsage returned %T, want map[string]any (inner data)", got)
	
}
	
if _, ok := m["list"]; !ok {
	
	
t.Fatalf("inner data missing list: %#v", m)
	
}
	
if _, ok := m["success"]; ok {
	
	
t.Fatalf("forwardUsage returned the whole envelope, not the inner data: %#v", m)
	
}
}

// TestForwardUsageRejectsErrorEnvelope - a main database answering success=false
// must surface an error rather than empty data that would look like "no usage".
func TestForwardUsageRejectsErrorEnvelope(t *testing.T) {
	
main := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	
	
_, _ = io.WriteString(w, `{"success":false,"message":"Authorization failed","data":null}`)
	
}))
	
defer main.Close()

	
app := &App{Syncer: newSyncerWithURL(main.URL)}
	
ctx := &httpx.Ctx{
	
	
Auth:    "tok",
	
	
RawBody: []byte("{}"),
	
	
R:       httptest.NewRequest(http.MethodPost, "/api/usage/sessions", strings.NewReader("{}")),
	
}
	
if _, err := app.forwardUsage(ctx); err == nil {
	
	
t.Fatal("forwardUsage accepted a failure envelope, want an error")
	
}
}

// newSyncerWithURL builds a Syncer pointed at url, for exercising forwardUsage.
func newSyncerWithURL(url string) *sync.Syncer {
	
return sync.New(nil, sync.Config{MainURL: url, Secret: "test-secret"})
}
