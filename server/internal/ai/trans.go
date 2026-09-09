// Package ai — the AI proxy core: OpenAI <-> Anthropic / Gemini protocol
// interchange, SSE stream transforms, upstream calls and billing.
package ai

import (
	"encoding/json"
	"fmt"
	"strings"

	"onekey/server/internal/cryptox"
)

// ─────────────────── tiny JSON helpers (Value-level, like the TS) ───────────────────

func jGet(v any, key string) any {
	if m, ok := v.(map[string]any); ok {
		return m[key]
	}
	return nil
}

func jMap(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return nil
}

func jArr(v any) []any {
	if a, ok := v.([]any); ok {
		return a
	}
	return nil
}

func jStr(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case nil:
		return ""
	default:
		b, _ := json.Marshal(x)
		return string(b)
	}
}

func jStrField(v any, key string) string { return jStr(jGet(v, key)) }

// stringify mirrors JS String()/JSON.stringify semantics for content fields:
// strings pass through, everything else is JSON-encoded.
func jStringify(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case nil:
		return "null"
	default:
		b, _ := json.Marshal(x)
		return string(b)
	}
}

func safeJSONParse(s string) map[string]any {
	var m map[string]any
	if err := json.Unmarshal([]byte(s), &m); err != nil || m == nil {
		return map[string]any{}
	}
	return m
}

func setKey(m map[string]any, key string, v any) map[string]any {
	if m == nil {
		m = map[string]any{}
	}
	m[key] = v
	return m
}

func jsonUnmarshal(s string, out *map[string]any) error {
	return json.Unmarshal([]byte(s), out)
}

func jsonMarshal(v any) ([]byte, error) { return json.Marshal(v) }

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(b)
}

// jGetPath walks a path of map keys / numeric array indices.
// Numeric-like segments index arrays; other segments index maps.
func jGetPath(v any, path ...string) any {
	cur := v
	for _, seg := range path {
		switch node := cur.(type) {
		case map[string]any:
			cur = node[seg]
		case []any:
			idx := 0
			ok := false
			for _, c := range seg {
				if c < '0' || c > '9' {
					ok = false
					break
				}
				idx, ok = idx*10+int(c-'0'), true
			}
			if !ok || idx >= len(node) {
				return nil
			}
			cur = node[idx]
		default:
			return nil
		}
		if cur == nil {
			return nil
		}
	}
	return cur
}

// ─────────────────── OpenAI → Anthropic body ───────────────────

func toAnthropicBody(body map[string]any) map[string]any {
	msgs := jArr(body["messages"])
	var system, chat []any
	for _, m := range msgs {
		if jStrField(m, "role") == "system" {
			system = append(system, m)
		} else {
			chat = append(chat, m)
		}
	}

	anthropicMessages := make([]any, len(chat))
	for i, m := range chat {
		if _, isArray := jGet(m, "content").([]any); isArray {
			anthropicMessages[i] = map[string]any{"role": jGet(m, "role"), "content": jGet(m, "content")}
			continue
		}
		content := []any{}
		if c := jGet(m, "content"); c != nil {
			text := jStringify(c)
			if text != "" {
				content = append(content, map[string]any{"type": "text", "text": text})
			}
		}
		for _, tc := range jArr(jGet(m, "tool_calls")) {
			f := jMap(jGet(tc, "function"))
			var input any = map[string]any{}
			if f != nil {
				if s, ok := f["arguments"].(string); ok {
					input = safeJSONParse(s)
				} else if f["arguments"] != nil {
					input = f["arguments"]
				}
			}
			name := ""
			if f != nil {
				name = jStr(f["name"])
			}
			content = append(content, map[string]any{
				"type": "tool_use", "id": jGet(tc, "id"), "name": name, "input": input,
			})
		}
		anthropicMessages[i] = map[string]any{"role": jGet(m, "role"), "content": content}
	}

	// "tool" role → user with tool_result blocks
	for i, m := range chat {
		if jStrField(m, "role") == "tool" {
			anthropicMessages[i] = map[string]any{
				"role": "user",
				"content": []any{map[string]any{
					"type":        "tool_result",
					"tool_use_id": jGet(m, "tool_call_id"),
					"content":     jStringify(jGet(m, "content")),
				}},
			}
		}
	}

	result := map[string]any{
		"model":    body["model"],
		"messages": anthropicMessages,
		"stream":   body["stream"],
	}
	if mt, ok := body["max_tokens"].(float64); ok && mt > 0 {
		result["max_tokens"] = mt
	} else {
		result["max_tokens"] = 4096
	}
	if len(system) > 0 {
		sys := make([]any, 0, len(system))
		for _, m := range system {
			sys = append(sys, map[string]any{"type": "text", "text": jStringify(jGet(m, "content"))})
		}
		result["system"] = sys
	}
	if thinking := jGet(body, "thinking"); thinking != nil {
		result["thinking"] = thinking
	} else if effort := jGet(body, "reasoning_effort"); effort != nil {
		var budget int64
		switch e := effort.(type) {
		case float64:
			budget = int64(e)
		case string:
			switch e {
			case "low":
				budget = 2048
			case "medium":
				budget = 8192
			case "high":
				budget = 16384
			case "max":
				budget = 32768
			}
		}
		if budget > 0 {
			result["thinking"] = map[string]any{"type": "enabled", "budget_tokens": budget}
		}
	}
	return result
}

// ─────────────────── Anthropic /v1/messages → OpenAI body ───────────────────

func antMessagesToOpenAI(body map[string]any) map[string]any {
	messages := []any{}

	if system := jGet(body, "system"); system != nil {
		switch s := system.(type) {
		case string:
			messages = append(messages, map[string]any{"role": "system", "content": s})
		case []any:
			var parts []string
			for _, b := range s {
				parts = append(parts, jStrField(b, "text"))
			}
			messages = append(messages, map[string]any{"role": "system", "content": strings.Join(parts, "\n")})
		}
	}

	for _, m := range jArr(body["messages"]) {
		role := "user"
		if jStrField(m, "role") == "assistant" {
			role = "assistant"
		}
		switch content := jGet(m, "content").(type) {
		case string:
			messages = append(messages, map[string]any{"role": role, "content": content})
		case []any:
			var textParts []string
			var toolCalls []any
			var functionResult *[2]string

			for _, block := range content {
				switch jStrField(block, "type") {
				case "text":
					textParts = append(textParts, jStrField(block, "text"))
				case "tool_use":
					args := ""
					switch in := jGet(block, "input").(type) {
					case string:
						args = in
					default:
						args = jStringify(in)
					}
					toolCalls = append(toolCalls, map[string]any{
						"id":   jGet(block, "id"),
						"type": "function",
						"function": map[string]any{
							"name":      jStrField(block, "name"),
							"arguments": args,
						},
					})
				case "tool_result":
					toolUseID := jStrField(block, "tool_use_id")
					var resultContent string
					switch rc := jGet(block, "content").(type) {
					case string:
						resultContent = rc
					case []any:
						var parts []string
						for _, b := range rc {
							if jStrField(b, "type") == "text" {
								parts = append(parts, jStrField(b, "text"))
							}
						}
						resultContent = strings.Join(parts, "\n")
					}
					functionResult = &[2]string{toolUseID, resultContent}
				}
			}

			text := strings.Join(textParts, "\n")
			if role == "assistant" && len(toolCalls) > 0 {
				messages = append(messages, map[string]any{
					"role": "assistant", "content": text, "tool_calls": toolCalls,
				})
			} else if role == "user" && functionResult != nil {
				messages = append(messages, map[string]any{
					"role": "tool", "tool_call_id": functionResult[0], "content": functionResult[1],
				})
			} else {
				messages = append(messages, map[string]any{"role": role, "content": text})
			}
		}
	}

	result := map[string]any{"model": body["model"], "messages": messages}
	for _, k := range []string{"max_tokens", "temperature", "stream"} {
		if v, ok := body[k]; ok {
			result[k] = v
		}
	}
	if tools, ok := body["tools"].([]any); ok {
		out := make([]any, 0, len(tools))
		for _, tool := range tools {
			params := jGet(tool, "input_schema")
			if params == nil {
				params = map[string]any{}
			}
			desc := jStrField(tool, "description")
			out = append(out, map[string]any{
				"type": "function",
				"function": map[string]any{
					"name":        jGet(tool, "name"),
					"description": desc,
					"parameters":  params,
				},
			})
		}
		result["tools"] = out
	}
	if tc := jGet(body, "tool_choice"); tc != nil {
		result["tool_choice"] = tc
	}
	return result
}

// ─────────────────── OpenAI response → Anthropic /v1/messages ───────────────────

func openAIToAntMessages(data map[string]any, model string) map[string]any {
	choices := jArr(data["choices"])
	choice := any(nil)
	if len(choices) > 0 {
		choice = choices[0]
	}
	msg := any(nil)
	if choice != nil {
		msg = jGet(choice, "message")
	}

	content := []any{}
	if msg != nil {
		if c := jGet(msg, "content"); c != nil {
			if s, ok := c.(string); ok && s != "" {
				content = append(content, map[string]any{"type": "text", "text": s})
			}
		}
		for _, tc := range jArr(jGet(msg, "tool_calls")) {
			f := jMap(jGet(tc, "function"))
			var input any = map[string]any{}
			if f != nil {
				if s, ok := f["arguments"].(string); ok {
					if parsed := safeJSONParse(s); parsed != nil {
						input = parsed
					}
				} else if f["arguments"] != nil {
					input = f["arguments"]
				}
			}
			name := ""
			if f != nil {
				name = jStr(f["name"])
			}
			content = append(content, map[string]any{
				"type": "tool_use", "id": jGet(tc, "id"), "name": name, "input": input,
			})
		}
	}

	stopReason := "end_turn"
	if choice != nil {
		switch jStrField(choice, "finish_reason") {
		case "stop":
			stopReason = "end_turn"
		case "tool_calls":
			stopReason = "tool_use"
		case "":
			stopReason = "end_turn"
		default:
			stopReason = jStrField(choice, "finish_reason")
		}
	}

	inputTokens, outputTokens := 0, 0
	if choice != nil {
		usage := jMap(jGet(data, "usage"))
		if usage != nil {
			inputTokens = int(jsonNum(jGet(usage, "prompt_tokens")))
			outputTokens = int(jsonNum(jGet(usage, "completion_tokens")))
		}
	}

	return map[string]any{
		"id": jGet(data, "id"), "type": "message", "role": "assistant",
		"content": content, "model": model,
		"stop_reason": stopReason, "stop_sequence": nil,
		"usage": map[string]any{"input_tokens": inputTokens, "output_tokens": outputTokens},
	}
}

// ─────────────────── Anthropic non-stream response → OpenAI ───────────────────

func anthropicToOpenAI(data map[string]any, model string) map[string]any {
	text := ""
	var toolBlocks []any
	for _, c := range jArr(data["content"]) {
		if jStrField(c, "type") == "text" && text == "" {
			text = jStrField(c, "text")
		}
		if jStrField(c, "type") == "tool_use" {
			toolBlocks = append(toolBlocks, c)
		}
	}

	message := map[string]any{"role": "assistant", "content": text}
	if len(toolBlocks) > 0 {
		tcs := make([]any, 0, len(toolBlocks))
		for i, block := range toolBlocks {
			input := jGet(block, "input")
			args := ""
			if s, ok := input.(string); ok {
				args = s
			} else {
				args = jStringify(input)
			}
			tcs = append(tcs, map[string]any{
				"id": jGet(block, "id"), "type": "function", "index": i,
				"function": map[string]any{"name": jStrField(block, "name"), "arguments": args},
			})
		}
		message["tool_calls"] = tcs
	}

	var finish string
	switch jStrField(data, "stop_reason") {
	case "end_turn":
		finish = "stop"
	case "tool_use":
		finish = "tool_calls"
	case "":
		finish = "stop"
	default:
		finish = jStrField(data, "stop_reason")
	}

	usage := jMap(data["usage"])
	in, out := 0, 0
	if usage != nil {
		in = int(jsonNum(usage["input_tokens"]))
		out = int(jsonNum(usage["output_tokens"]))
	}
	return map[string]any{
		"id": jGet(data, "id"), "model": model,
		"choices": []any{map[string]any{"index": 0, "message": message, "finish_reason": finish}},
		"usage": map[string]any{
			"prompt_tokens": in, "completion_tokens": out, "total_tokens": in + out,
		},
	}
}

func jsonNum(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case int64:
		return float64(x)
	case int:
		return float64(x)
	}
	return 0
}

// ─────────────────── Gemini helpers ───────────────────

func geminiTextFromParts(parts []any) string {
	var sb strings.Builder
	for _, p := range parts {
		if t, ok := jGet(p, "text").(string); ok && t != "" {
			sb.WriteString(t)
		}
	}
	return sb.String()
}

func geminiToolCalls(parts []any) []any {
	var calls []any
	for idx, p := range parts {
		if fc := jMap(jGet(p, "functionCall")); fc != nil {
			args := jGet(fc, "args")
			if args == nil {
				args = map[string]any{}
			}
			calls = append(calls, map[string]any{
				"id":   fmt.Sprintf("call_%d", idx),
				"type": "function",
				"function": map[string]any{
					"name":      jStr(fc["name"]),
					"arguments": jStringify(args),
				},
			})
		}
	}
	return calls
}

func geminiThoughtText(parts []any) string {
	var sb strings.Builder
	for _, p := range parts {
		if thought, ok := jGet(p, "thought").(bool); ok && thought {
			if t, ok := jGet(p, "text").(string); ok {
				sb.WriteString(t)
			}
		}
	}
	return sb.String()
}

type groundingCitation = map[string]any

func geminiGrounding(candidate map[string]any) []groundingCitation {
	meta := jMap(candidate["groundingMetadata"])
	if meta == nil {
		return nil
	}
	chunks := jArr(meta["groundingChunks"])
	var citations []groundingCitation
	for i, chunk := range chunks {
		web := jMap(jGet(chunk, "web"))
		if web == nil {
			continue
		}
		if uri, ok := web["uri"].(string); ok {
			citations = append(citations, groundingCitation{
				"index": i, "uri": uri, "title": jStr(web["title"]),
			})
		}
	}
	if len(citations) == 0 {
		for _, sup := range jArr(meta["groundingSupports"]) {
			seg := jMap(jGet(sup, "segment"))
			segText := ""
			if seg != nil {
				segText = jStr(seg["text"])
			}
			for _, idxv := range jArr(jGet(sup, "groundingChunkIndices")) {
				idx := int(jsonNum(idxv))
				if idx < 0 || idx >= len(chunks) {
					continue
				}
				web := jMap(jGet(chunks[idx], "web"))
				if web == nil {
					continue
				}
				if uri, ok := web["uri"].(string); ok {
					citations = append(citations, groundingCitation{
						"index": idx, "uri": uri, "title": jStr(web["title"]), "segment": segText,
					})
				}
			}
		}
	}
	return citations
}

// ─────────────────── OpenAI body → Gemini body ───────────────────

func toGeminiBody(body map[string]any, enableSearch int64) map[string]any {
	type roleParts struct {
		role  string
		parts []any
	}
	var parts []roleParts
	functionNameByID := map[string]string{}

	last := func() *roleParts {
		if len(parts) == 0 {
			return nil
		}
		return &parts[len(parts)-1]
	}

	for _, m := range jArr(body["messages"]) {
		role := jStrField(m, "role")
		if role == "system" {
			continue
		}
		if role == "assistant" {
			for _, tc := range jArr(jGet(m, "tool_calls")) {
				id := jStrField(tc, "id")
				f := jMap(jGet(tc, "function"))
				if id != "" && f != nil && jStr(f["name"]) != "" {
					functionNameByID[id] = jStr(f["name"])
				}
			}
		}
		if role == "tool" {
			toolCallID := jStrField(m, "tool_call_id")
			fnName := jStrField(m, "name")
			if fnName == "" {
				if n, ok := functionNameByID[toolCallID]; ok {
					fnName = n
				} else {
					fnName = "call_" + toolCallID
				}
			}
			resp := map[string]any{
				"name": fnName,
				"response": map[string]any{
					"content": jStringify(jGet(m, "content")),
				},
			}
			part := map[string]any{"functionResponse": resp}
			if l := last(); l != nil && l.role == "model" {
				parts = append(parts, roleParts{role: "user", parts: []any{part}})
			} else if l != nil {
				l.parts = append(l.parts, part)
			} else {
				parts = append(parts, roleParts{role: "user", parts: []any{part}})
			}
			continue
		}

		gemRole := "user"
		if role == "assistant" {
			gemRole = "model"
		}
		var contentParts []any
		if c := jGet(m, "content"); c != nil {
			text := jStringify(c)
			if text != "" {
				contentParts = append(contentParts, map[string]any{"text": text})
			}
		}
		if gemRole == "model" {
			for _, tc := range jArr(jGet(m, "tool_calls")) {
				f := jMap(jGet(tc, "function"))
				if f == nil {
					continue
				}
				args := any(map[string]any{})
				if s, ok := f["arguments"].(string); ok {
					args = safeJSONParse(s)
				} else if f["arguments"] != nil {
					args = f["arguments"]
				}
				contentParts = append(contentParts, map[string]any{
					"functionCall": map[string]any{"name": jStr(f["name"]), "args": args},
				})
			}
		}
		if len(contentParts) == 0 {
			continue
		}
		if l := last(); l != nil && l.role == gemRole {
			l.parts = append(l.parts, contentParts...)
		} else {
			parts = append(parts, roleParts{role: gemRole, parts: contentParts})
		}
	}

	contents := make([]any, 0, len(parts))
	for _, rp := range parts {
		contents = append(contents, map[string]any{"role": rp.role, "parts": rp.parts})
	}
	result := map[string]any{"contents": contents}

	var system []any
	for _, m := range jArr(body["messages"]) {
		if jStrField(m, "role") == "system" {
			system = append(system, m)
		}
	}
	if len(system) > 0 {
		sysParts := make([]any, 0, len(system))
		for _, m := range system {
			sysParts = append(sysParts, map[string]any{"text": jStringify(jGet(m, "content"))})
		}
		result["systemInstruction"] = map[string]any{"parts": sysParts}
	}

	if tools, ok := body["tools"].([]any); ok {
		var functions, otherTools []any
		for _, t := range tools {
			if jStrField(t, "type") == "function" && jMap(jGet(t, "function")) != nil {
				f := jMap(jGet(t, "function"))
				params := f["parameters"]
				if params == nil || jMap(params) == nil {
					if p := f["input_schema"]; jMap(p) != nil {
						params = p
					} else {
						params = map[string]any{}
					}
				}
				desc := ""
				if d, ok := f["description"].(string); ok {
					desc = d
				}
				functions = append(functions, map[string]any{
					"name": f["name"], "description": desc, "parameters": params,
				})
			} else {
				otherTools = append(otherTools, t)
			}
		}
		var toolsOut []any
		if len(functions) > 0 {
			toolsOut = append(toolsOut, map[string]any{"functionDeclarations": functions})
		}
		toolsOut = append(toolsOut, otherTools...)
		result["tools"] = toolsOut
	}

	if enableSearch > 0 {
		tools, _ := result["tools"].([]any)
		tools = append(tools, map[string]any{"googleSearch": map[string]any{}})
		result["tools"] = tools
	}

	genConfig := map[string]any{}
	if v, ok := body["temperature"]; ok && v != nil {
		genConfig["temperature"] = v
	}
	if v, ok := body["max_tokens"]; ok && v != nil {
		genConfig["maxOutputTokens"] = v
	}
	if v, ok := body["top_p"]; ok && v != nil {
		genConfig["topP"] = v
	}
	if stop, ok := body["stop"].([]any); ok && len(stop) > 0 {
		genConfig["stopSequences"] = stop
	}
	if len(genConfig) > 0 {
		result["generationConfig"] = genConfig
	}

	thinking := jMap(body["thinking"])
	var thinkingBudget float64
	if thinking != nil {
		if b, ok := thinking["budget_tokens"].(float64); ok {
			thinkingBudget = b
		} else if b, ok := thinking["thinkingBudget"].(float64); ok {
			thinkingBudget = b
		}
	}
	var effortBudget float64
	switch e := body["reasoning_effort"].(type) {
	case float64:
		effortBudget = e
	case string:
		switch e {
		case "low":
			effortBudget = 1024
		case "medium":
			effortBudget = 4096
		case "high":
			effortBudget = 8192
		case "max":
			effortBudget = 16384
		}
	}
	effortPresent := body["reasoning_effort"] != nil
	thinkingEnabled := effortPresent
	if thinking != nil && thinking["type"] == "enabled" {
		thinkingEnabled = true
	}
	budget := thinkingBudget
	if budget == 0 {
		budget = effortBudget
	}
	if thinkingEnabled {
		gc, _ := result["generationConfig"].(map[string]any)
		if gc == nil {
			gc = map[string]any{}
		}
		tc, _ := gc["thinkingConfig"].(map[string]any)
		if tc == nil {
			tc = map[string]any{}
		}
		tc["includeThoughts"] = true
		if budget > 0 {
			tc["thinkingBudget"] = budget
		}
		gc["thinkingConfig"] = tc
		result["generationConfig"] = gc
	}

	return result
}

// ─────────────────── Gemini non-stream response → OpenAI ───────────────────

func geminiToOpenAI(data map[string]any, model string) map[string]any {
	var candidate map[string]any
	if cands := jArr(data["candidates"]); len(cands) > 0 {
		candidate = jMap(cands[0])
	}
	parts := []any{}
	if candidate != nil {
		if content := jMap(candidate["content"]); content != nil {
			parts = jArr(content["parts"])
		}
	}

	text := geminiTextFromParts(parts)
	toolCalls := geminiToolCalls(parts)
	thinking := geminiThoughtText(parts)
	var grounding []groundingCitation
	if candidate != nil {
		grounding = geminiGrounding(candidate)
	}

	message := map[string]any{"role": "assistant"}
	if text == "" {
		message["content"] = nil
	} else {
		message["content"] = text
	}
	if len(toolCalls) > 0 {
		message["tool_calls"] = toolCalls
	}
	if thinking != "" {
		message["reasoning_content"] = thinking
	}
	if len(grounding) > 0 {
		message["metadata"] = map[string]any{"grounding": map[string]any{"citations": grounding}}
	}

	var finish string
	var finishRaw string
	if candidate != nil {
		finishRaw = jStrField(candidate, "finishReason")
	}
	switch finishRaw {
	case "STOP":
		finish = "stop"
	case "TOOL_CALL", "FUNCTION_CALL":
		finish = "tool_calls"
	case "":
		finish = "stop"
	default:
		finish = strings.ToLower(finishRaw)
	}

	prompt, completion, cached := 0.0, 0.0, 0.0
	if usage := jMap(data["usageMetadata"]); usage != nil {
		prompt = jsonNum(usage["promptTokenCount"])
		completion = jsonNum(usage["candidatesTokenCount"])
		cached = jsonNum(usage["cachedContentTokenCount"])
	}

	id := fmt.Sprintf("chatcmpl-%s", cryptox.UUIDv4())
	if v, ok := data["id"].(string); ok && v != "" {
		id = v
	}
	return map[string]any{
		"id": id, "model": model, "object": "chat.completion",
		"choices": []any{map[string]any{"index": 0, "message": message, "finish_reason": finish}},
		"usage": map[string]any{
			"prompt_tokens": prompt, "completion_tokens": completion, "total_tokens": prompt + completion,
			"prompt_tokens_details": map[string]any{"cached_tokens": cached},
		},
	}
}
