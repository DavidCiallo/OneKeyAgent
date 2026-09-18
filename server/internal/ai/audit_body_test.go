package ai

import (
	"unicode/utf8"
	"encoding/json"
	"strings"
	"testing"
)

// TestAuditRequestBodyKeepsTail — an oversized request body loses its earliest
// messages, not the newest ones: tool pairing breaks at the tail, and the
// stored document must stay valid JSON so it can be read with a viewer.
func TestAuditRequestBodyKeepsTail(t *testing.T) {
	old := func(s string) map[string]any {
		return map[string]any{"role": "user", "content": strings.Repeat(s, 5000)}
	}
	body := jStringify(map[string]any{
		"model": "deepseek-chat",
		"messages": []any{
			old("old-1-"), old("old-2-"), old("old-3-"),
			map[string]any{"role": "assistant", "tool_calls": []any{
				map[string]any{"id": "t1", "type": "function"},
			}},
			map[string]any{"role": "tool", "tool_call_id": "t1", "content": "tail-result"},
		},
	})
	if len(body) <= maxAuditReqBody {
		t.Fatalf("test body is only %d bytes; raise message sizes", len(body))
	}

	got := auditRequestBody(body, maxAuditReqBody)
	if len(got) > maxAuditReqBody {
		t.Fatalf("compacted body is %d bytes, want <= %d", len(got), maxAuditReqBody)
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("compacted body is not valid JSON: %v\n%s", err, got[:200])
	}
	if _, ok := parsed["_audit_truncated"]; !ok {
		t.Fatalf("compacted body lacks the truncation marker")
	}
	if !strings.Contains(got, "tail-result") {
		t.Fatalf("compacted body lost the newest message — the tail is the part worth keeping")
	}
	if strings.Contains(got, "old-1-") {
		t.Fatalf("compacted body kept the oldest message; the head should go first")
	}
	if !strings.Contains(got, `"tool_calls"`) {
		t.Fatalf("compacted body lost the assistant tool_calls")
	}
}

// TestAuditRequestBodyPassthroughAndFallback — small bodies are untouched and
// non-JSON bodies get a plain marked cut rather than being dropped.
func TestAuditRequestBodyPassthroughAndFallback(t *testing.T) {
	small := `{"model":"m","messages":[{"role":"user","content":"hi"}]}`
	if got := auditRequestBody(small, maxAuditReqBody); got != small {
		t.Fatalf("small body was rewritten: %s", got)
	}

	raw := "[" + strings.Repeat("x", maxAuditReqBody+10) + "]"
	got := auditRequestBody(raw, 64)
	if !strings.HasSuffix(got, "[truncated]") {
		t.Fatalf("non-JSON body missing the truncation marker: %q", got[len(got)-30:])
	}
	if len(got) > 64+len("\n…[truncated]") {
		t.Fatalf("cut body is %d bytes, want <= cap+marker", len(got))
	}
}

// TestCutWithMarkerRespectsRunes — truncation must not split a multi-byte
// rune, or the stored body ends in replacement garbage.
func TestCutWithMarkerRespectsRunes(t *testing.T) {
	s := strings.Repeat("好", 100) // 300 bytes of 3-byte runes
	got := cutWithMarker(s, 40)
	if !strings.HasSuffix(got, "[truncated]") {
		t.Fatalf("missing marker: %q", got)
	}
	head := strings.TrimSuffix(got, "\n…[truncated]")
	if !utf8.ValidString(head) {
		t.Fatalf("cut split a rune: %q", head[len(head)-6:])
	}
}
