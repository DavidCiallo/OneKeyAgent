package ai

import (
	"encoding/json"
	"testing"

	"onekey/server/internal/store"
)

func TestNormalizeReasoningEffort(t *testing.T) {
	cases := map[string]string{
		"Max": "high", "MAX": "high", "max": "high", "maximal": "high",
		"ultra": "high", "high": "high", " high ": "high",
		"medium": "medium", "med": "medium", "low": "low",
		"minimal": "minimal", "banana": "", "": "", "none": "",
	}
	for in, want := range cases {
		if got := normalizeReasoningEffort(in); got != want {
			t.Errorf("normalize(%q) = %q, want %q", in, got, want)
		}
	}
	if got := normalizeReasoningEffort(42); got != "" {
		t.Errorf("numeric effort = %q, want dropped", got)
	}
}

func effortProvider(strip bool) *store.Provider {
	flag := int64(0)
	if !strip {
		flag = 1
	}
	apiType := "openai"
	return &store.Provider{Name: "p", ApiType: &apiType, BaseURL: "http://upstream/v1",
		Model: "m", SupportsReasoningEffort: &flag}
}

func sentEffort(t *testing.T, body map[string]any, p *store.Provider) (string, bool) {
	t.Helper()
	cfg := buildRequestConfig(p, body, false)
	var m map[string]any
	if err := json.Unmarshal([]byte(cfg.body), &m); err != nil {
		t.Fatalf("parse body: %v", err)
	}
	v, ok := m["reasoning_effort"]
	s, _ := v.(string)
	return s, ok
}

// TestBuildRequestConfigNormalizesEffort — the client's effort value is
// normalized, unknown values are dropped, and the provider toggle strips the
// parameter entirely. "Max" verbatim is what strict upstreams 400 on.
func TestBuildRequestConfigNormalizesEffort(t *testing.T) {
	if got, _ := sentEffort(t, map[string]any{"messages": []any{}, "reasoning_effort": "Max"}, effortProvider(false)); got != "high" {
		t.Fatalf(`effort = %q, want "high"`, got)
	}
	if got, ok := sentEffort(t, map[string]any{"messages": []any{}, "reasoning_effort": "banana"}, effortProvider(false)); ok && got != "" {
		t.Fatalf("unknown effort %q was relayed upstream", got)
	}
	// The provider's supports_reasoning_effort=0 strips a valid value too.
	if _, ok := sentEffort(t, map[string]any{"messages": []any{}, "reasoning_effort": "high"}, effortProvider(true)); ok {
		t.Fatalf("effort survived a provider that does not support it")
	}
}

// TestBuildRequestConfigDerivesEffortFromThinking — Anthropic-style thinking
// still maps to an effort level when the client sent no explicit value.
func TestBuildRequestConfigDerivesEffortFromThinking(t *testing.T) {
	body := map[string]any{"messages": []any{}, "thinking": map[string]any{
		"type": "enabled", "budget_tokens": float64(8192),
	}}
	if got, _ := sentEffort(t, body, effortProvider(false)); got != "medium" {
		t.Fatalf("derived effort = %q, want medium", got)
	}
}

// TestEffortFeedsProtocolConversions — "Max" must reach the Anthropic and
// Gemini conversions as a recognized level instead of falling through their
// case-sensitive switches.
func TestEffortFeedsProtocolConversions(t *testing.T) {
	body := map[string]any{"messages": []any{}, "reasoning_effort": "Max"}

	ant := toAnthropicBody(body)
	thinking := jMap(ant["thinking"])
	if jStrField(thinking, "type") != "enabled" || jsonNum(thinking["budget_tokens"]) != 16384 {
		t.Fatalf("anthropic thinking = %v, want enabled/16384", thinking)
	}

	gem := toGeminiBody(body, 0)
	gc := jMap(gem["generationConfig"])
	tc := jMap(gc["thinkingConfig"])
	if tc["includeThoughts"] != true || jsonNum(tc["thinkingBudget"]) != 16384 {
		t.Fatalf("gemini thinkingConfig = %v, want includeThoughts/16384", tc)
	}

	// An unrecognized value enables nothing.
	bad := map[string]any{"messages": []any{}, "reasoning_effort": "banana"}
	if th := jMap(toAnthropicBody(bad)["thinking"]); th != nil {
		t.Fatalf("anthropic thinking = %v, want absent for unknown effort", th)
	}
}
