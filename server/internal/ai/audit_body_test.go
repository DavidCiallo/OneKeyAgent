package ai

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"
)

// TestAuditBodySummaryKeepsStructure — the stored body keeps the JSON shape
// (keys, message count) while every long string is cut to a short preview. The
// trail answers "what kind of request failed", not "what exactly was said".
func TestAuditBodySummaryKeepsStructure(t *testing.T) {
	long := strings.Repeat("prompt-", 2000) // far beyond the preview length
	body := jStringify(map[string]any{
		"model": "deepseek-chat",
		"messages": []any{
			map[string]any{"role": "user", "content": long},
			map[string]any{"role": "assistant", "tool_calls": []any{
				map[string]any{"id": "t1", "type": "function"},
			}},
			map[string]any{"role": "tool", "tool_call_id": "t1", "content": "tail-result"},
		},
	})

	got := auditBodySummary(body, maxAuditReqBody)
	if len(got) >= len(body) {
		t.Fatalf("summary is %d bytes vs body %d — nothing was cut", len(got), len(body))
	}
	if len(got) > maxAuditReqBody {
		t.Fatalf("summary is %d bytes, want <= %d", len(got), maxAuditReqBody)
	}

	var parsed map[string]any
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("summary is not valid JSON: %v\n%.200s", err, got)
	}
	// Structure survives: model, the message list, and each message's keys.
	if parsed["model"] != "deepseek-chat" {
		t.Fatalf("model key lost: %v", parsed["model"])
	}
	msgs, ok := parsed["messages"].([]any)
	if !ok || len(msgs) != 3 {
		t.Fatalf("messages lost their shape: %#v", parsed["messages"])
	}
	first, _ := msgs[0].(map[string]any)
	if first["role"] != "user" {
		t.Fatalf("message role lost: %#v", first)
	}
	content, _ := first["content"].(string)
	if len(content) > auditFieldPreview+len("…[+ chars]")+20 {
		t.Fatalf("long field was not previewed: %d chars", len(content))
	}
	if !strings.Contains(content, "…[+") {
		t.Fatalf("preview lacks its truncation marker: %q", content)
	}
	// The tool-call structure is exactly what a 400 about tool pairing needs.
	if !strings.Contains(got, `"tool_calls"`) || !strings.Contains(got, `"tool_call_id"`) {
		t.Fatalf("tool structure lost from the summary: %s", got)
	}
	// Short fields come through whole.
	if !strings.Contains(got, "tail-result") {
		t.Fatalf("short value was altered: %s", got)
	}
}

// TestAuditBodySummaryCutsLongArrays — a long message list keeps its head and
// tail with an explicit count in between, rather than silently dropping the
// middle.
func TestAuditBodySummaryCutsLongArrays(t *testing.T) {
	msgs := make([]any, 0, 30)
	for i := 0; i < 30; i++ {
		msgs = append(msgs, map[string]any{"role": "user", "content": jStringify(i)})
	}
	body := jStringify(map[string]any{"model": "m", "messages": msgs})

	got := auditBodySummary(body, maxAuditReqBody)
	if !strings.Contains(got, "more items") {
		t.Fatalf("long array was not collapsed with a count: %s", got)
	}
	// Head and tail both survive.
	for _, want := range []string{`"content":"0"`, `"content":"29"`} {
		if !strings.Contains(got, want) {
			t.Fatalf("summary lost %s: %s", want, got)
		}
	}
	if strings.Contains(got, `"content":"15"`) {
		t.Fatalf("middle of a long array should be collapsed: %s", got)
	}
}

// TestAuditBodySummaryFallback — a body that is not JSON still gets a bounded,
// marked cut rather than being stored whole or dropped.
func TestAuditBodySummaryFallback(t *testing.T) {
	if got := auditBodySummary("", maxAuditReqBody); got != "" {
		t.Fatalf("empty body became %q", got)
	}
	raw := "upstream exploded: " + strings.Repeat("x", 5000)
	got := auditBodySummary(raw, maxAuditReqBody)
	if !strings.HasSuffix(got, "[truncated]") {
		t.Fatalf("non-JSON body missing the truncation marker: %.40q", got)
	}
	if len(got) > auditFieldPreview+len("\n…[truncated]") {
		t.Fatalf("non-JSON body was not cut to the preview length: %d bytes", len(got))
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

// TestPreviewTextRespectsRunes — a field preview must also land on a rune
// boundary, and must stay untouched when it already fits.
func TestPreviewTextRespectsRunes(t *testing.T) {
	short := "hello"
	if got := previewText(short); got != short {
		t.Fatalf("short field was rewritten: %q", got)
	}
	long := strings.Repeat("好", 100)
	got := previewText(long)
	head := strings.SplitN(got, "…[+", 2)[0]
	if !utf8.ValidString(head) {
		t.Fatalf("preview split a rune: %q", head)
	}
	if len(head) > auditFieldPreview {
		t.Fatalf("preview head is %d bytes, want <= %d", len(head), auditFieldPreview)
	}
	if !strings.Contains(got, "[+") {
		t.Fatalf("preview lacks the size marker: %q", got)
	}
}
