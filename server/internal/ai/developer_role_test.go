package ai

import (
	"encoding/json"
	"testing"
)

// TestDeveloperRoleMappedToSystem — OpenAI's newer "developer" role means
// "system", but other providers' deserializers reject the variant outright
// ("unknown variant `developer`"). Every outbound path must rewrite it.
func TestDeveloperRoleMappedToSystem(t *testing.T) {
	body := map[string]any{
		"max_completion_tokens": 32000,
		"messages": []any{
			map[string]any{"role": "developer", "content": "behave"},
			map[string]any{"role": "user", "content": "hi"},
		},
	}

	// OpenAI passthrough: role rewritten, and max_completion_tokens becomes
	// max_tokens so the cap survives on providers that only know the old name.
	cfg := buildRequestConfig(effortProvider(false), body, false)
	var m map[string]any
	if err := json.Unmarshal([]byte(cfg.body), &m); err != nil {
		t.Fatalf("parse body: %v", err)
	}
	msgs := m["messages"].([]any)
	if got := msgs[0].(map[string]any)["role"]; got != "system" {
		t.Fatalf("passthrough role = %v, want system", got)
	}
	if _, exists := m["max_completion_tokens"]; exists {
		t.Fatalf("max_completion_tokens was relayed to a non-OpenAI upstream")
	}
	if mv, _ := m["max_tokens"].(float64); mv != 32000 {
		t.Fatalf("max_tokens = %v, want the 32000 cap carried over", m["max_tokens"])
	}

	// Anthropic provider: the developer message becomes the system block.
	ant := toAnthropicBody(body)
	if ant["system"] == nil {
		t.Fatalf("anthropic body has no system block: %v", ant["messages"])
	}
	for _, mm := range ant["messages"].([]any) {
		if jStrField(mm, "role") == "developer" {
			t.Fatalf("developer role leaked into the anthropic chat messages")
		}
	}

	// Gemini provider: the developer message lands in systemInstruction.
	gem := toGeminiBody(body, 0)
	if gem["systemInstruction"] == nil {
		t.Fatalf("gemini body has no systemInstruction")
	}
	for _, c := range gem["contents"].([]any) {
		if jStrField(c, "role") == "developer" || jStrField(c, "role") == "system" {
			t.Fatalf("system/developer content leaked into gemini contents: %v", c)
		}
	}
}
