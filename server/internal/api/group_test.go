package api

import (
	"testing"

	"onekey/server/internal/httpx"
)

// TestStringArrDropsNonStrings — the filter lists arrive as decoded JSON, so a
// malformed entry must be skipped rather than become an empty-string id that
// silently matches nothing (or, worse, is treated as "no filter").
func TestStringArrDropsNonStrings(t *testing.T) {
	got := stringArr([]any{"a", 1, nil, "b", "", true, map[string]any{}})
	if len(got) != 2 || got[0] != "a" || got[1] != "b" {
		t.Fatalf("stringArr = %v, want [a b]", got)
	}
	if out := stringArr(nil); len(out) != 0 {
		t.Fatalf("stringArr(nil) = %v, want empty", out)
	}
}

// TestEmptySessionsShape — a filter that matches nothing must still return the
// full response shape, otherwise the client renders a blank page instead of an
// empty chart.
func TestEmptySessionsShape(t *testing.T) {
	empty := emptySessions()
	for _, key := range []string{"list", "recentSessions", "totals"} {
		if _, ok := empty[key]; !ok {
			t.Fatalf("emptySessions is missing %q", key)
		}
	}
	totals, ok := empty["totals"].(map[string]any)
	if !ok {
		t.Fatalf("totals has the wrong type: %T", empty["totals"])
	}
	for _, key := range []string{
		"totalTokens", "totalInputTokens", "totalCachedInputTokens",
		"totalOutputTokens", "totalCost", "totalRequests",
	} {
		if _, ok := totals[key]; !ok {
			t.Fatalf("totals is missing %q", key)
		}
	}
}

// TestGroupFilterPresence — an explicit empty group_ids is a filter that
// selects nothing; an absent one is no filter at all. The handler distinguishes
// them, so the distinction is asserted here rather than left implicit.
func TestGroupFilterPresence(t *testing.T) {
	absent := &httpx.Ctx{M: map[string]any{}}
	if ids := stringArr(absent.Arr("group_ids")); len(ids) != 0 {
		t.Fatalf("absent group_ids produced %v", ids)
	}

	present := &httpx.Ctx{M: map[string]any{"group_ids": []any{}}}
	if ids := stringArr(present.Arr("group_ids")); len(ids) != 0 {
		t.Fatalf("empty group_ids produced %v", ids)
	}
	if _, ok := present.M["group_ids"]; !ok {
		t.Fatal("the key should still be present")
	}

	withValues := &httpx.Ctx{M: map[string]any{"group_ids": []any{"g1", "g2"}}}
	if ids := stringArr(withValues.Arr("group_ids")); len(ids) != 2 {
		t.Fatalf("group_ids = %v, want 2 entries", ids)
	}
}
