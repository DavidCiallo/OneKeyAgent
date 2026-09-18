package ai

import (
	"encoding/json"
	"strings"
	"testing"
)

// antToolMessages — the OpenAI messages a converted Anthropic body produces,
// as JSON for easy assertions.
func antToolMessages(t *testing.T, body map[string]any) []map[string]any {
	t.Helper()
	out := antMessagesToOpenAI(body)
	raw, err := json.Marshal(out["messages"])
	if err != nil {
		t.Fatalf("marshal messages: %v", err)
	}
	var msgs []map[string]any
	if err := json.Unmarshal(raw, &msgs); err != nil {
		t.Fatalf("unmarshal messages: %v", err)
	}
	return msgs
}

// TestAntParallelToolCallConvertsFully — one assistant turn calling two tools
// in parallel must reach the OpenAI upstream as one assistant message with two
// tool_calls followed by TWO tool messages. The converter used to keep only
// the last tool_result of a user message, so every OpenAI-compatible upstream
// (DeepSeek included) rejected the request with "insufficient tool messages
// following tool_calls message".
func TestAntParallelToolCallConvertsFully(t *testing.T) {
	body := map[string]any{
		"model": "deepseek-chat", "max_tokens": 64,
		"messages": []any{
			map[string]any{"role": "user", "content": "check the weather"},
			map[string]any{"role": "assistant", "content": []any{
				map[string]any{"type": "text", "text": "calling tools"},
				map[string]any{"type": "tool_use", "id": "t1", "name": "weather", "input": map[string]any{"city": "BJ"}},
				map[string]any{"type": "tool_use", "id": "t2", "name": "time", "input": map[string]any{"tz": "utc"}},
			}},
			map[string]any{"role": "user", "content": []any{
				map[string]any{"type": "tool_result", "tool_use_id": "t1", "content": "sunny"},
				map[string]any{"type": "tool_result", "tool_use_id": "t2", "content": []any{
					map[string]any{"type": "text", "text": "10:00"},
				}},
			}},
		},
	}

	msgs := antToolMessages(t, body)
	want := []struct{ role, toolCallID string }{
		{"user", ""}, {"assistant", ""}, {"tool", "t1"}, {"tool", "t2"},
	}
	if len(msgs) != len(want) {
		t.Fatalf("got %d messages, want %d: %+v", len(msgs), len(want), msgs)
	}
	for i, w := range want {
		if msgs[i]["role"] != w.role {
			t.Fatalf("message %d role = %v, want %s", i, msgs[i]["role"], w.role)
		}
		if w.toolCallID != "" && msgs[i]["tool_call_id"] != w.toolCallID {
			t.Fatalf("message %d tool_call_id = %v, want %s", i, msgs[i]["tool_call_id"], w.toolCallID)
		}
	}
	// Results survive with their content, including block-form content.
	if msgs[2]["content"] != "sunny" {
		t.Fatalf("t1 result = %v, want sunny", msgs[2]["content"])
	}
	if msgs[3]["content"] != "10:00" {
		t.Fatalf("t2 result = %v, want 10:00", msgs[3]["content"])
	}
	// The assistant message carries both tool calls with their arguments.
	acs, err := json.Marshal(msgs[1]["tool_calls"])
	if err != nil {
		t.Fatalf("marshal tool_calls: %v", err)
	}
	if strings.Count(string(acs), `"id":"t`) != 2 || !strings.Contains(string(acs), `city`) {
		t.Fatalf("assistant tool_calls = %s", acs)
	}
}

// TestAntToolResultKeepsUserText — a user turn may carry text next to the
// results; the text follows the tool messages so those still sit directly
// after the assistant tool_calls, and it is no longer dropped.
func TestAntToolResultKeepsUserText(t *testing.T) {
	msgs := antToolMessages(t, map[string]any{
		"model": "m",
		"messages": []any{
			map[string]any{"role": "assistant", "content": []any{
				map[string]any{"type": "tool_use", "id": "t1", "name": "f", "input": map[string]any{}},
			}},
			map[string]any{"role": "user", "content": []any{
				map[string]any{"type": "tool_result", "tool_use_id": "t1", "content": "done"},
				map[string]any{"type": "text", "text": "also note this"},
			}},
		},
	})
	if len(msgs) != 3 {
		t.Fatalf("got %d messages, want 3: %+v", len(msgs), msgs)
	}
	if msgs[1]["role"] != "tool" || msgs[2]["role"] != "user" {
		t.Fatalf("order = %v/%v, want tool then user", msgs[1]["role"], msgs[2]["role"])
	}
	if msgs[2]["content"] != "also note this" {
		t.Fatalf("user text = %v, want it preserved", msgs[2]["content"])
	}
}

// TestAntAssistantToolCallsWithoutContent — a tool-calling assistant message
// with no content field still lands in the conversation; dropping it would
// strand the following tool results.
func TestAntAssistantToolCallsWithoutContent(t *testing.T) {
	msgs := antToolMessages(t, map[string]any{
		"model": "m",
		"messages": []any{
			map[string]any{"role": "assistant", "tool_calls": []any{
				map[string]any{"id": "t9", "type": "function", "function": map[string]any{"name": "f", "arguments": "{}"}},
			}},
			map[string]any{"role": "tool", "tool_call_id": "t9", "content": "ok"},
		},
	})
	if len(msgs) != 2 || msgs[0]["role"] != "assistant" {
		t.Fatalf("got %+v, want the assistant message preserved", msgs)
	}
}

// TestOpenAIToAntMessagesRoundTripsToolUse — the response back to the client
// presents the calls as tool_use blocks with parsed input, so the agent can
// actually run them and come back.
func TestOpenAIToAntMessagesRoundTripsToolUse(t *testing.T) {
	resp := map[string]any{
		"id": "chatcmpl-1",
		"choices": []any{map[string]any{
			"finish_reason": "tool_calls",
			"message": map[string]any{
				"role": "assistant", "content": "",
				"tool_calls": []any{map[string]any{
					"id": "t1", "type": "function",
					"function": map[string]any{"name": "weather", "arguments": `{"city":"BJ"}`},
				}},
			},
		}},
		"usage": map[string]any{"prompt_tokens": 3, "completion_tokens": 4},
	}
	out := openAIToAntMessages(resp, "deepseek-v4.1-flash")
	if out["stop_reason"] != "tool_use" {
		t.Fatalf("stop_reason = %v, want tool_use", out["stop_reason"])
	}
	blocks, err := json.Marshal(out["content"])
	if err != nil {
		t.Fatalf("marshal content: %v", err)
	}
	if !strings.Contains(string(blocks), `"tool_use"`) || !strings.Contains(string(blocks), `"city":"BJ"`) {
		t.Fatalf("content blocks = %s", blocks)
	}
}

// TestOpenAIToAnthropicMergesParallelToolResults — an OpenAI client's run of
// tool messages becomes ONE Anthropic user message of tool_result blocks;
// consecutive user roles would be rejected by the Anthropic API.
func TestOpenAIToAnthropicMergesParallelToolResults(t *testing.T) {
	out := toAnthropicBody(map[string]any{
		"model": "claude-x",
		"messages": []any{
			map[string]any{"role": "user", "content": "check"},
			map[string]any{"role": "assistant", "content": nil, "tool_calls": []any{
				map[string]any{"id": "t1", "type": "function", "function": map[string]any{"name": "weather", "arguments": "{}"}},
				map[string]any{"id": "t2", "type": "function", "function": map[string]any{"name": "time", "arguments": "{}"}},
			}},
			map[string]any{"role": "tool", "tool_call_id": "t1", "content": "sunny"},
			map[string]any{"role": "tool", "tool_call_id": "t2", "content": "10:00"},
		},
	})
	raw, err := json.Marshal(out["messages"])
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var msgs []struct {
		Role    string `json:"role"`
		Content []struct {
			Type      string `json:"type"`
			ToolUseID string `json:"tool_use_id"`
		} `json:"content"`
	}
	if err := json.Unmarshal(raw, &msgs); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(msgs) != 3 {
		t.Fatalf("got %d messages, want 3 (user, assistant, one merged user): %s", len(msgs), raw)
	}
	last := msgs[len(msgs)-1]
	if last.Role != "user" || len(last.Content) != 2 {
		t.Fatalf("final message = %+v, want one user message with two tool_result blocks", last)
	}
	if last.Content[0].ToolUseID != "t1" || last.Content[1].ToolUseID != "t2" {
		t.Fatalf("tool results out of order: %+v", last.Content)
	}
	// The assistant turn carries both calls as tool_use blocks.
	assistant := msgs[1]
	uses := 0
	for _, b := range assistant.Content {
		if b.Type == "tool_use" {
			uses++
		}
	}
	if uses != 2 {
		t.Fatalf("assistant blocks = %+v, want two tool_use blocks", assistant.Content)
	}
}
