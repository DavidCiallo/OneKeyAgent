package ai

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"

	"onekey/server/internal/cryptox"
)

// ─────────────────── shared helpers ───────────────────

// lineSplitter assembles SSE lines across chunk boundaries.
type lineSplitter struct {
	buf []byte
}

func (l *lineSplitter) feed(chunk []byte, emit func(line string)) {
	l.buf = append(l.buf, chunk...)
	for {
		idx := bytes.IndexByte(l.buf, '\n')
		if idx < 0 {
			return
		}
		line := string(l.buf[:idx])
		l.buf = l.buf[idx+1:]
		emit(line)
	}
}

// pumpedReader runs pump in a goroutine, emitting transformed output.
func pumpedReader(pump func(emit func(string) error) error) io.Reader {
	pr, pw := io.Pipe()
	go func() {
		err := pump(func(s string) error {
			_, werr := pw.Write([]byte(s))
			return werr
		})
		if err != nil {
			_ = pw.CloseWithError(err)
		} else {
			_ = pw.Close()
		}
	}()
	return pr
}

func nowSecs() int64 { return time.Now().Unix() }

func openaiChunkJSON(id, model string, delta map[string]any, finishReason string, usage map[string]any) string {
	chunk := map[string]any{
		"id":      id,
		"object":  "chat.completion.chunk",
		"created": nowSecs(),
		"model":   model,
		"choices": []any{map[string]any{
			"index":         0,
			"delta":         delta,
			"finish_reason": finishReason, // "" → null via omitempty-free marshal below
		}},
	}
	// finish_reason "" means null in the TS port
	if finishReason == "" {
		chunk["choices"] = []any{map[string]any{"index": 0, "delta": delta, "finish_reason": nil}}
	}
	if usage != nil {
		chunk["usage"] = usage
	}
	b, _ := jsonMarshal(chunk)
	return string(b)
}

func emitSSE(emit func(string) error, event, payload string) error {
	if event != "" {
		return emit(fmt.Sprintf("event: %s\ndata: %s\n\n", event, payload))
	}
	return emit(fmt.Sprintf("data: %s\n\n", payload))
}

// ─────────────────── Anthropic SSE → OpenAI SSE ───────────────────

// AntStreamToOpenAI converts an upstream Anthropic SSE body into OpenAI
// chat.completion.chunk SSE. Content blocks accumulate and flush on
// content_block_stop (port of antStreamToOpenAI).
func AntStreamToOpenAI(src io.Reader) io.Reader {
	return pumpedReader(func(emit func(string) error) error {
		reader := bufio.NewReaderSize(src, 64*1024)
		var (
			currentEvent string
			pendingData  string
			textAcc      string
			toolCalls    = map[int64]*antToolAcc{}
			toolOrder    []int64
			hasText      bool
			hasTools     bool
			finished     bool
			model        string
		)
		process := func(data string) error {
			var evt map[string]any
			if err := jsonUnmarshal(data, &evt); err != nil {
				return nil // skip malformed events
			}
			eventType := jStrField(evt, "type")
			if eventType == "" {
				eventType = currentEvent
			}
			switch eventType {
			case "message_start":
				if msg := jMap(evt["message"]); msg != nil {
					model = jStr(msg["model"])
				}
			case "content_block_start":
				block := jMap(evt["content_block"])
				if block == nil {
					return nil
				}
				idx := int64(jsonNum(evt["index"]))
				switch jStrField(block, "type") {
				case "text":
					hasText = true
					textAcc = jStr(block["text"])
				case "tool_use":
					hasTools = true
					seq := int64(len(toolCalls))
					if _, exists := toolCalls[idx]; exists {
						seq = int64(len(toolCalls)) - 1
					}
					toolCalls[idx] = &antToolAcc{
						id: jStr(block["id"]), name: jStr(block["name"]),
						args: jStringify(block["input"]), seq: seq,
					}
					toolOrder = append(toolOrder, idx)
				}
			case "content_block_delta":
				delta := jMap(evt["delta"])
				if delta == nil {
					return nil
				}
				switch jStrField(delta, "type") {
				case "text_delta":
					textAcc += jStr(delta["text"])
				case "input_json_delta":
					idx := int64(jsonNum(evt["index"]))
					if tc, ok := toolCalls[idx]; ok {
						tc.args += jStr(delta["partial_json"])
					}
				}
			case "content_block_stop":
				deltaMap := map[string]any{}
				if hasText && textAcc != "" {
					deltaMap["role"] = "assistant"
					deltaMap["content"] = textAcc
				}
				if hasTools && len(toolCalls) > 0 {
					list := make([]any, 0, len(toolOrder))
					// sort by block index for stable ordering
					idxs := append([]int64(nil), toolOrder...)
					for i := 1; i < len(idxs); i++ {
						for j := i; j > 0 && idxs[j] < idxs[j-1]; j-- {
							idxs[j], idxs[j-1] = idxs[j-1], idxs[j]
						}
					}
					bySeq := make([]*antToolAcc, len(toolCalls))
					for _, tc := range toolCalls {
						bySeq[tc.seq] = tc
					}
					for _, tc := range bySeq {
						if tc == nil {
							continue
						}
						list = append(list, map[string]any{
							"id": tc.id, "type": "function", "index": tc.seq,
							"function": map[string]any{"name": tc.name, "arguments": tc.args},
						})
					}
					deltaMap["tool_calls"] = list
				}
				chunk := openaiChunkJSON(cryptox.UUIDv4(), model, deltaMap, "", nil)
				return emitSSE(emit, "", chunk)
			case "message_delta":
				if !finished {
					finished = true
					raw := jStr(jGetPath(evt, "delta", "stop_reason"))
					stopReason := raw
					switch raw {
					case "end_turn":
						stopReason = "stop"
					case "tool_use":
						stopReason = "tool_calls"
					case "":
						stopReason = "stop"
					}
					var usage map[string]any
					if u := jMap(evt["usage"]); u != nil {
						in := jsonNum(u["input_tokens"])
						out := jsonNum(u["output_tokens"])
						usage = map[string]any{
							"prompt_tokens": in, "completion_tokens": out, "total_tokens": in + out,
						}
					}
					chunk := openaiChunkJSON(cryptox.UUIDv4(), model, map[string]any{}, stopReason, usage)
					return emitSSE(emit, "", chunk)
				}
			case "message_stop":
				return emitSSE(emit, "", "[DONE]")
			}
			return nil
		}

		for {
			line, err := reader.ReadString('\n')
			if line != "" {
				trimmed := strings.TrimRight(line, "\r\n")
				if strings.HasPrefix(trimmed, "event: ") {
					currentEvent = strings.TrimSpace(strings.TrimPrefix(trimmed, "event: "))
					pendingData = ""
				} else if strings.HasPrefix(trimmed, "data: ") {
					pendingData = strings.TrimPrefix(trimmed, "data: ")
				}
				if trimmed == "" && pendingData != "" {
					if perr := process(pendingData); perr != nil {
						return perr
					}
					pendingData = ""
					currentEvent = ""
				}
			}
			if err != nil {
				break
			}
		}

		if !finished {
			chunk := openaiChunkJSON(cryptox.UUIDv4(), model, map[string]any{}, "stop", nil)
			if err := emitSSE(emit, "", chunk); err != nil {
				return err
			}
			return emitSSE(emit, "", "[DONE]")
		}
		return nil
	})
}

type antToolAcc struct {
	id, name, args string
	seq            int64
}

// ─────────────────── OpenAI SSE → Anthropic SSE ───────────────────

// OpenAIToAntStream converts an internal OpenAI SSE stream into an Anthropic
// /v1/messages SSE stream (port of openAIToAntStream).
func OpenAIToAntStream(src io.Reader) io.Reader {
	return pumpedReader(func(emit func(string) error) error {
		reader := bufio.NewReaderSize(src, 64*1024)
		var (
			textBlockStarted bool
			toolBlockIndices = map[int64]int64{}
			nextBlock        = int64(1)
			finished         bool
			msgStartEmitted  bool
		)

		for {
			line, err := reader.ReadString('\n')
			if line != "" {
				trimmed := strings.TrimRight(line, "\r\n")
				if payload, ok := strings.CutPrefix(trimmed, "data: "); ok {
					if payload == "[DONE]" {
						goto next
					}
					var chunk map[string]any
					if jerr := jsonUnmarshal(payload, &chunk); jerr != nil {
						goto next
					}

					if !msgStartEmitted {
						msgStart := map[string]any{
							"type": "message_start",
							"message": map[string]any{
								"id": cryptox.UUIDv4(), "type": "message", "role": "assistant",
								"content": []any{}, "model": jStr(chunk["model"]),
								"stop_reason": nil, "stop_sequence": nil,
								"usage": map[string]any{"input_tokens": 0, "output_tokens": 0},
							},
						}
						if merr := emitJSONEvent(emit, "message_start", msgStart); merr != nil {
							return merr
						}
						msgStartEmitted = true
					}

					for _, choicev := range jArr(chunk["choices"]) {
						choice := jMap(choicev)
						if choice == nil {
							continue
						}
						delta := jMap(choice["delta"])
						if delta == nil {
							delta = map[string]any{}
						}
						if content, ok := delta["content"].(string); ok && content != "" {
							if !textBlockStarted {
								evt := map[string]any{
									"type": "content_block_start", "index": 0,
									"content_block": map[string]any{"type": "text", "text": content},
								}
								if e := emitJSONEvent(emit, "content_block_start", evt); e != nil {
									return e
								}
								textBlockStarted = true
							} else {
								evt := map[string]any{
									"type": "content_block_delta", "index": 0,
									"delta": map[string]any{"type": "text_delta", "text": content},
								}
								if e := emitJSONEvent(emit, "content_block_delta", evt); e != nil {
									return e
								}
							}
						}
						for _, tcv := range jArr(delta["tool_calls"]) {
							tc := jMap(tcv)
							if tc == nil {
								continue
							}
							openaiIdx := int64(jsonNum(tc["index"]))
							f := jMap(tc["function"])
							if antIdx, exists := toolBlockIndices[openaiIdx]; exists {
								if f != nil {
									if args, ok := f["arguments"].(string); ok && args != "" {
										evt := map[string]any{
											"type": "content_block_delta", "index": antIdx,
											"delta": map[string]any{"type": "input_json_delta", "partial_json": args},
										}
										if e := emitJSONEvent(emit, "content_block_delta", evt); e != nil {
											return e
										}
									}
								}
							} else {
								antIdx := nextBlock
								nextBlock++
								toolBlockIndices[openaiIdx] = antIdx
								name, args := "", ""
								if f != nil {
									name, _ = f["name"].(string)
									args, _ = f["arguments"].(string)
								}
								id := ""
								if tc["id"] != nil {
									id, _ = tc["id"].(string)
								}
								evt := map[string]any{
									"type": "content_block_start", "index": antIdx,
									"content_block": map[string]any{
										"type": "tool_use", "id": id, "name": name, "input": args,
									},
								}
								if e := emitJSONEvent(emit, "content_block_start", evt); e != nil {
									return e
								}
							}
						}

						finish := ""
						if fr := jGet(choice, "finish_reason"); fr != nil {
							finish, _ = fr.(string)
						}
						if finish != "" && !finished {
							finished = true
							antStop := finish
							switch finish {
							case "stop":
								antStop = "end_turn"
							case "tool_calls":
								antStop = "tool_use"
							}
							if textBlockStarted {
								evt := map[string]any{"type": "content_block_stop", "index": 0}
								if e := emitJSONEvent(emit, "content_block_stop", evt); e != nil {
									return e
								}
							}
							// close tool blocks ordered by index
							var antIdxs []int64
							for _, v := range toolBlockIndices {
								antIdxs = append(antIdxs, v)
							}
							for i := 1; i < len(antIdxs); i++ {
								for j := i; j > 0 && antIdxs[j] < antIdxs[j-1]; j-- {
									antIdxs[j], antIdxs[j-1] = antIdxs[j-1], antIdxs[j]
								}
							}
							for _, idx := range antIdxs {
								evt := map[string]any{"type": "content_block_stop", "index": idx}
								if e := emitJSONEvent(emit, "content_block_stop", evt); e != nil {
									return e
								}
							}
							usage := jMap(chunk["usage"])
							in, out := 0, 0
							if usage != nil {
								in = int(jsonNum(usage["prompt_tokens"]))
								out = int(jsonNum(usage["completion_tokens"]))
							}
							stopEvt := map[string]any{
								"type": "message_delta",
								"delta": map[string]any{"stop_reason": antStop, "stop_sequence": nil},
								"usage": map[string]any{"input_tokens": in, "output_tokens": out},
							}
							if e := emitJSONEvent(emit, "message_delta", stopEvt); e != nil {
								return e
							}
						}
					}
				}
			}
		next:
			if err != nil {
				break
			}
		}

		if !finished {
			if textBlockStarted {
				evt := map[string]any{"type": "content_block_stop", "index": 0}
				if err := emitJSONEvent(emit, "content_block_stop", evt); err != nil {
					return err
				}
			}
			var antIdxs []int64
			for _, v := range toolBlockIndices {
				antIdxs = append(antIdxs, v)
			}
			for _, idx := range antIdxs {
				evt := map[string]any{"type": "content_block_stop", "index": idx}
				if err := emitJSONEvent(emit, "content_block_stop", evt); err != nil {
					return err
				}
			}
			stopEvt := map[string]any{
				"type": "message_delta",
				"delta": map[string]any{"stop_reason": "end_turn", "stop_sequence": nil},
				"usage": map[string]any{"input_tokens": 0, "output_tokens": 0},
			}
			if err := emitJSONEvent(emit, "message_delta", stopEvt); err != nil {
				return err
			}
		}
		return emit("event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n")
	})
}

func emitJSONEvent(emit func(string) error, event string, data any) error {
	b, err := jsonMarshal(data)
	if err != nil {
		return err
	}
	return emitSSE(emit, event, string(b))
}

// ─────────────────── Gemini SSE → OpenAI SSE ───────────────────

// GeminiStreamToOpenAI diffs consecutive Gemini candidate snapshots into
// OpenAI delta chunks (port of geminiStreamToOpenAI).
func GeminiStreamToOpenAI(src io.Reader, model string) io.Reader {
	return pumpedReader(func(emit func(string) error) error {
		reader := bufio.NewReaderSize(src, 64*1024)
		var (
			prevText     string
			prevThought  string
			prevToolSigs = map[string]bool{}
			sentRole     bool
			finished     bool
			finalUsage   map[string]any
		)

		emitFinish := func(reason string) error {
			if finished {
				return nil
			}
			finished = true
			chunk := openaiChunkJSON(cryptox.UUIDv4(), model, map[string]any{}, reason, nil)
			if err := emitSSE(emit, "", chunk); err != nil {
				return err
			}
			if finalUsage != nil {
				p := jsonNum(finalUsage["promptTokenCount"])
				o := jsonNum(finalUsage["candidatesTokenCount"])
				c := jsonNum(finalUsage["cachedContentTokenCount"])
				usageChunk := map[string]any{
					"id": cryptox.UUIDv4(), "object": "chat.completion.chunk",
					"created": nowSecs(), "model": model,
					"choices": []any{},
					"usage": map[string]any{
						"prompt_tokens": p, "completion_tokens": o, "total_tokens": p + o,
						"prompt_tokens_details": map[string]any{"cached_tokens": c},
					},
				}
				if err := emitSSE(emit, "", mustJSON(usageChunk)); err != nil {
					return err
				}
			}
			return emitSSE(emit, "", "[DONE]")
		}

		for {
			line, err := reader.ReadString('\n')
			if line != "" {
				trimmed := strings.TrimSpace(strings.TrimRight(line, "\r\n"))
				payload, ok := strings.CutPrefix(trimmed, "data:")
				if !ok {
					goto next
				}
				payload = strings.TrimSpace(payload)
				if payload == "" || payload == "[DONE]" {
					goto next
				}
				{
					var data map[string]any
					if jerr := jsonUnmarshal(payload, &data); jerr != nil {
						goto next
					}
					if u := jMap(data["usageMetadata"]); u != nil {
						finalUsage = u
					}
					var cand map[string]any
					if cands := jArr(data["candidates"]); len(cands) > 0 {
						cand = jMap(cands[0])
					}
					if cand == nil {
						goto next
					}
					parts := []any{}
					if content := jMap(cand["content"]); content != nil {
						parts = jArr(content["parts"])
					}

					var text, thought strings.Builder
					var toolCalls []any
					for idx, p := range parts {
						isThought := false
						if t, ok := jGet(p, "thought").(bool); ok && t {
							isThought = true
						}
						t, hasText := jGet(p, "text").(string)
						if hasText && t != "" {
							if isThought {
								thought.WriteString(t)
							} else {
								text.WriteString(t)
							}
						}
						if fc := jMap(jGet(p, "functionCall")); fc != nil {
							args := fc["args"]
							if args == nil {
								args = map[string]any{}
							}
							toolCalls = append(toolCalls, map[string]any{
								"index": idx, "id": fmt.Sprintf("call_%d", idx), "type": "function",
								"function": map[string]any{
									"name": jStr(fc["name"]), "arguments": jStringify(args),
								},
							})
						}
					}

					delta := map[string]any{}
					if !sentRole {
						delta["role"] = "assistant"
						sentRole = true
					}
					tv, thv := text.String(), thought.String()
					if runeLen(tv) > runeLen(prevText) {
						delta["content"] = string([]rune(tv)[runeLen(prevText):])
					} else if runeLen(tv) < runeLen(prevText) {
						delta["content"] = tv
					}
					prevText = tv
					if runeLen(thv) > runeLen(prevThought) {
						delta["reasoning_content"] = string([]rune(thv)[runeLen(prevThought):])
					} else if runeLen(thv) < runeLen(prevThought) {
						delta["reasoning_content"] = thv
					}
					prevThought = thv

					if len(toolCalls) > 0 {
						var newCalls []any
						var currentSigs []string
						for _, c := range toolCalls {
							f := jMap(jGet(c, "function"))
							sig := fmt.Sprintf("%s:%d", jStr(f["name"]), runeLen(jStr(f["arguments"])))
							currentSigs = append(currentSigs, sig)
							if !prevToolSigs[sig] {
								prevToolSigs[sig] = true
								newCalls = append(newCalls, c)
							}
						}
						if len(newCalls) > 0 {
							delta["tool_calls"] = newCalls
						}
						// retain only signatures still present
						kept := map[string]bool{}
						for _, s := range currentSigs {
							kept[s] = true
						}
						for sig := range prevToolSigs {
							if !kept[sig] {
								delete(prevToolSigs, sig)
							}
						}
					}

					if gm := jMap(cand["groundingMetadata"]); gm != nil {
						if citations := geminiGrounding(cand); len(citations) > 0 {
							delta["metadata"] = map[string]any{"grounding": map[string]any{"citations": citations}}
						}
					}

					hasContent := delta["content"] != nil || delta["reasoning_content"] != nil || delta["tool_calls"] != nil
					if hasContent {
						chunk := openaiChunkJSON(cryptox.UUIDv4(), model, delta, "", nil)
						if err := emitSSE(emit, "", chunk); err != nil {
							return err
						}
					}

					if fr := jStrField(cand, "finishReason"); fr != "" {
						reason := fr
						switch fr {
						case "STOP":
							reason = "stop"
						case "TOOL_CALL", "FUNCTION_CALL":
							reason = "tool_calls"
						default:
							reason = strings.ToLower(fr)
						}
						if err := emitFinish(reason); err != nil {
							return err
						}
					}
				}
			}
		next:
			if err != nil {
				break
			}
		}
		return emitFinish("stop")
	})
}

func deltaHasRole(delta map[string]any) bool { return delta["role"] != nil }

func runeLen(s string) int { return len([]rune(s)) }

// meteredScanner — inline scan state for the passthrough (usage + content
// estimate + optional reasoning capture).
type meteredScanner struct {
	splitter       lineSplitter
	Usage          map[string]any
	EstimatedChars int
	Reasoning      *syncPoint
}

type syncPoint struct {
	mu  sync.Mutex
	buf strings.Builder
}

func (m *meteredScanner) feed(chunk []byte) {
	var lines []string
	m.splitter.feed(chunk, func(line string) { lines = append(lines, line) })
	for _, line := range lines {
		payload, ok := strings.CutPrefix(line, "data: ")
		if !ok || payload == "[DONE]" {
			continue
		}
		var d map[string]any
		if jsonUnmarshal(payload, &d) != nil {
			continue
		}
		if u := jMap(d["usage"]); u != nil {
			m.Usage = u
		}
		if content := jGetPath(d, "choices", "0", "delta", "content"); content != nil {
			if s, ok := content.(string); ok {
				m.EstimatedChars += runeLen(s)
			}
		}
		if content := jGetPath(d, "choices", "0", "text"); content != nil {
			if s, ok := content.(string); ok {
				m.EstimatedChars += runeLen(s)
			}
		}
		if m.Reasoning != nil {
			if rc := jGetPath(d, "choices", "0", "delta", "reasoning_content"); rc != nil {
				if s, ok := rc.(string); ok {
					m.Reasoning.mu.Lock()
					m.Reasoning.buf.WriteString(s)
					m.Reasoning.mu.Unlock()
				}
			}
		}
	}
}
