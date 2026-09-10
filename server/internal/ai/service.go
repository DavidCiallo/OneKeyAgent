package ai

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"onekey/server/internal/cryptox"
	"onekey/server/internal/service"
	"onekey/server/internal/store"
)

const reasoningTTL = 24 * 3600 * 1000 // ms

type reasonEntry struct {
	content string
	ts      int64
}

// Server carries shared AI-proxy state (DB, settings, http clients, cache).
type Server struct {
	DB       *sql.DB
	Settings *service.Settings

	clientsMu sync.Mutex
	clients   map[string]*http.Client

	reasoningMu sync.Mutex
	reasoning   map[string]reasonEntry
}

func NewServer(db *sql.DB, settings *service.Settings) *Server {
	return &Server{
		DB:        db,
		Settings:  settings,
		clients:   map[string]*http.Client{},
		reasoning: map[string]reasonEntry{},
	}
}

// HTTPClient — per-proxy client cache. No total timeout: dial + response
// header deadlines stand in for the TS socket timeout, long streams run free.
func (s *Server) HTTPClient(proxyURL string) *http.Client {
	s.clientsMu.Lock()
	defer s.clientsMu.Unlock()
	if c, ok := s.clients[proxyURL]; ok {
		return c
	}
	transport := &http.Transport{
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   15 * time.Second,
		ResponseHeaderTimeout: 300 * time.Second,
	}
	if proxyURL != "" {
		if u, err := url.Parse(proxyURL); err == nil {
			transport.Proxy = http.ProxyURL(u)
		}
	}
	c := &http.Client{Transport: transport}
	s.clients[proxyURL] = c
	return c
}

func (s *Server) reasoningCacheGet(key string) (string, bool) {
	now := store.Now()
	s.reasoningMu.Lock()
	defer s.reasoningMu.Unlock()
	e, ok := s.reasoning[key]
	if !ok {
		return "", false
	}
	if now-e.ts > reasoningTTL {
		delete(s.reasoning, key)
		return "", false
	}
	return e.content, true
}

func (s *Server) reasoningCacheSet(key, content string) {
	s.reasoningMu.Lock()
	defer s.reasoningMu.Unlock()
	s.reasoning[key] = reasonEntry{content: content, ts: store.Now()}
	if len(s.reasoning) > 1000 {
		var oldestKey string
		var oldest int64 = 1 << 62
		for k, e := range s.reasoning {
			if e.ts < oldest {
				oldest = e.ts
				oldestKey = k
			}
		}
		delete(s.reasoning, oldestKey)
	}
}

// ─────────────────── request audit (latest 100 success / 100 failure) ───────────────────

// maxAuditErr bounds the stored error text so a verbose upstream body can't
// bloat the table.
const maxAuditErr = 500

type auditRecord struct {
	AccountID    string
	AccountName  string
	ModelAlias   string
	ProviderID   string
	ProviderName string
	ApiType      string
	Endpoint     string
	Success      bool
	StatusCode   int
	DurationMs   int64
	InputTokens  int64
	CachedInput  int64
	OutputTokens int64
	Cost         float64
	Stream       bool
	Err          string
}

// audit persists one attempt. Best-effort by design: a broken audit trail must
// never fail the relayed request, so errors are only logged.
func (s *Server) audit(r auditRecord) {
	if len(r.Err) > maxAuditErr {
		r.Err = r.Err[:maxAuditErr]
	}
	rec := store.AuditLog{
		AccountID: r.AccountID, AccountName: r.AccountName, ModelAlias: r.ModelAlias,
		ProviderID: r.ProviderID, ProviderName: r.ProviderName, ApiType: r.ApiType,
		Endpoint: r.Endpoint, StatusCode: int64(r.StatusCode), DurationMs: r.DurationMs,
		InputTokens: r.InputTokens, CachedInputTokens: r.CachedInput, OutputTokens: r.OutputTokens,
		Cost: r.Cost, Err: r.Err,
	}
	if r.Success {
		rec.Success = 1
	}
	if r.Stream {
		rec.Stream = 1
	}
	if err := store.AuditInsert(s.DB, rec); err != nil {
		fmt.Println("[Audit] insert failed:", err)
	}
}

// accountName — display name for the audit row; empty when the account is gone.
func (s *Server) accountName(accountID string) string {
	acc, err := store.AccountFindOne(s.DB, accountID)
	if err != nil || acc == nil {
		return ""
	}
	return acc.Name
}

func elapsedMs(start time.Time) int64 {
	d := time.Since(start).Milliseconds()
	if d < 0 {
		return 0
	}
	return d
}

// ─────────────────── model access ───────────────────

func (s *Server) allModels() ([]*store.Model, error) {
	models, err := store.ModelAllActive(s.DB)
	if err != nil {
		return nil, err
	}
	sort.Slice(models, func(i, j int) bool { return models[i].Alias < models[j].Alias })
	return models, nil
}

// allowedAliases — nil means unrestricted (admin / no account).
func (s *Server) allowedAliases(accountID string) ([]string, error) {
	account, err := store.AccountFindOne(s.DB, accountID)
	if err == store.ErrNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if account.IsAdmin != 0 {
		return nil, nil
	}
	models, err := s.allModels()
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var allowed []string
	for _, m := range models {
		if m.IsPublic != 0 && !seen[m.Alias] {
			seen[m.Alias] = true
			allowed = append(allowed, m.Alias)
		}
	}
	roles, err := store.RolesByAccount(s.DB, accountID)
	if err != nil {
		return nil, err
	}
	for _, r := range roles {
		if r.Type == "model" && !seen[r.Name] {
			seen[r.Name] = true
			allowed = append(allowed, r.Name)
		}
	}
	sort.Strings(allowed)
	return allowed, nil
}

func (s *Server) requireModelAccess(accountID, alias string) error {
	allowed, err := s.allowedAliases(accountID)
	if err != nil {
		return err
	}
	if allowed == nil {
		return nil
	}
	for _, a := range allowed {
		if a == alias {
			return nil
		}
	}
	return fmt.Errorf("Model %q is not authorized for this account", alias)
}

func (s *Server) providersForAlias(requested, fallbackAlias string) ([]*store.Provider, error) {
	providers, err := store.ProviderGetByAlias(s.DB, requested)
	if err != nil {
		return nil, err
	}
	if len(providers) == 0 {
		return nil, fmt.Errorf("No providers found for alias: %s", requested)
	}
	if fallbackAlias != "" && fallbackAlias != requested {
		fb, err := store.ProviderGetByAlias(s.DB, fallbackAlias)
		if err == nil {
			providers = append(providers, fb...)
		}
	}
	return providers, nil
}

// ─────────────────── request building (ai.builder.ts) ───────────────────

type upstreamReq struct {
	url     string
	headers [][2]string
	body    string
}

func buildRequestConfig(p *store.Provider, body map[string]any, stream bool) upstreamReq {
	apiType := ""
	if p.ApiType != nil {
		apiType = *p.ApiType
	}
	isAnthropic := apiType == "anthropic"
	isGemini := apiType == "gemini"

	path := "/chat/completions"
	if isAnthropic {
		path = "/messages"
	} else if isGemini {
		action := "generateContent"
		if stream {
			action = "streamGenerateContent"
		}
		modelName := "gemini-2.5-flash"
		if m, ok := body["model"].(string); ok && m != "" {
			modelName = m
		}
		enc := url.PathEscape(modelName)
		if stream {
			path = fmt.Sprintf("/models/%s:%s?alt=sse", enc, action)
		} else {
			path = fmt.Sprintf("/models/%s:%s", enc, action)
		}
	}

	target := p.BaseURL + path

	var postBody string
	if isAnthropic {
		postBody = mustJSON(toAnthropicBody(body))
	} else if isGemini {
		enableSearch := int64(0)
		if p.EnableSearch != nil {
			enableSearch = *p.EnableSearch
		}
		postBody = mustJSON(toGeminiBody(body, enableSearch))
	} else {
		clean := map[string]any{}
		for k, v := range body {
			clean[k] = v
		}
		thinking := jMap(body["thinking"])
		_, hasEffort := body["reasoning_effort"]
		if thinking != nil && thinking["type"] == "enabled" && !hasEffort {
			effort := "high"
			if b, ok := thinking["budget_tokens"].(float64); ok {
				switch {
				case b >= 16384:
					effort = "high"
				case b >= 8192:
					effort = "medium"
				default:
					effort = "low"
				}
			}
			clean["reasoning_effort"] = effort
		}
		delete(clean, "thinking")
		postBody = mustJSON(clean)
	}

	headers := [][2]string{{"Content-Type", "application/json"}}
	apiKey := ""
	if p.ApiKey != nil {
		apiKey = *p.ApiKey
	}
	if isAnthropic {
		headers = append(headers, [2]string{"x-api-key", apiKey}, [2]string{"anthropic-version", "2023-06-01"})
	} else if isGemini {
		headers = append(headers, [2]string{"x-goog-api-key", apiKey})
	} else {
		auth := ""
		if apiKey != "" {
			if p.AuthType != nil && *p.AuthType == "custom" {
				auth = apiKey
			} else {
				auth = "Bearer " + apiKey
			}
		}
		headers = append(headers, [2]string{"Authorization", auth})
	}

	return upstreamReq{url: target, headers: headers, body: postBody}
}

// ─────────────────── upstream calls ───────────────────

// upstreamErr — captured failure detail for audit logging.
type upstreamErr struct {
	status int
	msg    string
}

// tryProvider — non-stream call; converts to OpenAI format.
func (s *Server) tryProvider(p *store.Provider, body map[string]any) (map[string]any, *upstreamErr) {
	cfg := buildRequestConfig(p, body, false)
	req, err := http.NewRequest("POST", cfg.url, strings.NewReader(cfg.body))
	if err != nil {
		return nil, &upstreamErr{msg: "build request: " + err.Error()}
	}
	for _, h := range cfg.headers {
		req.Header.Set(h[0], h[1])
	}
	resp, err := s.HTTPClient(p.ProxyStr()).Do(req)
	if err != nil {
		fmt.Printf("[AI] upstream request failed (%s -> %s): %v\n", p.Name, cfg.url, err)
		return nil, &upstreamErr{msg: err.Error()}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 300))
		msg := strings.TrimSpace(string(snippet))
		fmt.Printf("[AI] upstream %s returned %d (%s): %s\n", p.Name, resp.StatusCode, cfg.url, msg)
		return nil, &upstreamErr{status: resp.StatusCode, msg: fmt.Sprintf("upstream http %d: %s", resp.StatusCode, msg)}
	}
	var parsed map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil || parsed == nil {
		return nil, &upstreamErr{status: resp.StatusCode, msg: "invalid upstream JSON: " + errString(err)}
	}
	switch p.ApiTypeStr() {
	case "anthropic":
		return anthropicToOpenAI(parsed, p.Model), nil
	case "gemini":
		return geminiToOpenAI(parsed, p.Model), nil
	default:
		return parsed, nil
	}
}

func errString(err error) string {
	if err == nil {
		return "empty body"
	}
	return err.Error()
}

// tryProviderStream — streaming call; returns the raw upstream body.
func (s *Server) tryProviderStream(p *store.Provider, body map[string]any) (io.ReadCloser, *upstreamErr) {
	cfg := buildRequestConfig(p, body, true)
	req, err := http.NewRequest("POST", cfg.url, strings.NewReader(cfg.body))
	if err != nil {
		return nil, &upstreamErr{msg: "build request: " + err.Error()}
	}
	for _, h := range cfg.headers {
		req.Header.Set(h[0], h[1])
	}
	resp, err := s.HTTPClient(p.ProxyStr()).Do(req)
	if err != nil {
		fmt.Printf("[AI] upstream request failed (%s -> %s): %v\n", p.Name, cfg.url, err)
		return nil, &upstreamErr{msg: err.Error()}
	}
	if resp.StatusCode != http.StatusOK {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 300))
		msg := strings.TrimSpace(string(snippet))
		fmt.Printf("[AI] upstream %s returned %d (%s): %s\n", p.Name, resp.StatusCode, cfg.url, msg)
		resp.Body.Close()
		return nil, &upstreamErr{status: resp.StatusCode, msg: fmt.Sprintf("upstream http %d: %s", resp.StatusCode, msg)}
	}
	return resp.Body, nil
}

// ─────────────────── reasoning replay ───────────────────

func sessionKey(accountID string, body map[string]any) string {
	first := any("")
	if msgs := jArr(body["messages"]); msgs != nil {
		for _, m := range msgs {
			if jStrField(m, "role") == "user" {
				first = jGet(m, "content")
				break
			}
		}
	}
	encoded := cryptox.Base64UrlEncode(jStringify(first))
	if len(encoded) > 16 {
		encoded = encoded[:16]
	}
	return accountID + "::" + encoded
}

// mergeExtraJSON — provider-level shallow body overrides (OpenRouter-style
// params). Invalid JSON or non-objects are silently ignored, like the TS.
func mergeExtraJSON(body map[string]any, extra string) {
	if extra == "" {
		return
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(extra), &m); err != nil || m == nil {
		return
	}
	for k, v := range m {
		body[k] = v
	}
}

func thinkingEnabled(body map[string]any) bool {
	if _, ok := body["reasoning_effort"]; ok && body["reasoning_effort"] != nil {
		return true
	}
	if thinking := jMap(body["thinking"]); thinking != nil && thinking["type"] == "enabled" {
		return true
	}
	return false
}

func injectReplayReasoning(s *Server, body map[string]any, key string) {
	msgs := jArr(body["messages"])
	for _, m := range msgs {
		msg := jMap(m)
		if msg == nil || jStrField(msg, "role") != "assistant" {
			continue
		}
		if msg["reasoning_content"] != nil {
			continue
		}
		rc := ""
		for _, tcv := range jArr(msg["tool_calls"]) {
			tc := jMap(tcv)
			if tc == nil {
				continue
			}
			id, _ := tc["id"].(string)
			if id == "" {
				continue
			}
			if cached, ok := s.reasoningCacheGet(key + "::" + id); ok {
				rc = cached
				break
			}
		}
		msg["reasoning_content"] = rc
	}
}

func findLastToolCallID(body map[string]any) string {
	msgs := jArr(body["messages"])
	for i := len(msgs) - 1; i >= 0; i-- {
		msg := jMap(msgs[i])
		if msg == nil || jStrField(msg, "role") != "assistant" {
			continue
		}
		for _, tcv := range jArr(msg["tool_calls"]) {
			tc := jMap(tcv)
			if tc == nil {
				continue
			}
			if id, ok := tc["id"].(string); ok && id != "" {
				return id
			}
		}
	}
	return ""
}

// auditReject — a request that failed before any upstream call (bad alias,
// unauthorized model, preflight gate). Recorded so the audit view shows the
// full failure picture, not just upstream errors.
func (s *Server) auditReject(accountID, alias, endpoint string, stream bool, status int, err error) {
	s.audit(auditRecord{
		AccountID: accountID, AccountName: s.accountName(accountID), ModelAlias: alias,
		Endpoint: endpoint, StatusCode: status, Stream: stream, Err: err.Error(),
	})
}

// ─────────────────── entry points ───────────────────

// ChatCompletions — non-streaming; converted OpenAI response.
func (s *Server) ChatCompletions(body map[string]any, accountID string) (map[string]any, error) {
	return s.ChatCompletionsAt(body, accountID, "/api/chat/completions")
}

// ChatCompletionsAt is ChatCompletions with an explicit endpoint label for audit.
func (s *Server) ChatCompletionsAt(body map[string]any, accountID, endpoint string) (map[string]any, error) {
	alias, _ := body["model"].(string)
	if err := s.requireModelAccess(accountID, alias); err != nil {
		s.auditReject(accountID, alias, endpoint, false, 403, err)
		return nil, err
	}
	fallback := s.Settings.Get("fallback_model_alias")
	providers, err := s.providersForAlias(alias, fallback)
	if err != nil {
		s.auditReject(accountID, alias, endpoint, false, 404, err)
		return nil, err
	}
	skey := sessionKey(accountID, body)
	acctName := s.accountName(accountID)

	for _, provider := range providers {
		requestBody := map[string]any{}
		for k, v := range body {
			requestBody[k] = v
		}
		requestBody["stream"] = false
		requestBody["model"] = provider.Model
		// Shallow-merge provider-level extra_json overrides (OpenRouter-style params etc.)
		mergeExtraJSON(requestBody, provider.ExtraJSONStr())

		replay := provider.ReplayReasoning != nil && *provider.ReplayReasoning == 1
		if replay && thinkingEnabled(requestBody) {
			injectReplayReasoning(s, requestBody, skey)
		}

		started := time.Now()
		rdata, uerr := s.tryProvider(provider, requestBody)
		if uerr != nil {
			s.audit(auditRecord{
				AccountID: accountID, AccountName: acctName, ModelAlias: alias,
				ProviderID: provider.ID, ProviderName: provider.Name, ApiType: provider.ApiTypeStr(),
				Endpoint: endpoint, StatusCode: uerr.status, DurationMs: elapsedMs(started),
				Err: uerr.msg,
			})
			time.Sleep(500 * time.Millisecond)
			continue
		}

		inputPrice, cachePrice, outputPrice, err := service.ModelPrices(s.DB, alias)
		if err != nil {
			return nil, err
		}
		usage := jMap(rdata["usage"])
		rawInput, rawOutput := service.TokensOf(usage)
		cachedInput := service.ExtractCachedTokens(usage)
		cost := service.CalculateCost(rawInput, cachedInput, rawOutput, inputPrice, cachePrice, outputPrice)

		// Same gates as TS deductBalance — applied before the response is sent.
		weekly, err := service.WeeklySpending(s.DB, accountID)
		if err != nil {
			return nil, err
		}
		if weekly+cost > service.WeeklyLimit {
			s.audit(auditRecord{
				AccountID: accountID, AccountName: acctName, ModelAlias: alias,
				ProviderID: provider.ID, ProviderName: provider.Name, ApiType: provider.ApiTypeStr(),
				Endpoint: endpoint, StatusCode: 429, DurationMs: elapsedMs(started),
				InputTokens: rawInput, CachedInput: cachedInput, OutputTokens: rawOutput, Cost: cost,
				Err: "429 Weekly spending limit reached",
			})
			return nil, fmt.Errorf("429 Weekly spending limit reached")
		}
		balance, err := store.AccountGetBalance(s.DB, accountID)
		if err != nil {
			return nil, err
		}
		if balance < cost {
			s.audit(auditRecord{
				AccountID: accountID, AccountName: acctName, ModelAlias: alias,
				ProviderID: provider.ID, ProviderName: provider.Name, ApiType: provider.ApiTypeStr(),
				Endpoint: endpoint, StatusCode: 429, DurationMs: elapsedMs(started),
				InputTokens: rawInput, CachedInput: cachedInput, OutputTokens: rawOutput, Cost: cost,
				Err: "429 Insufficient balance",
			})
			return nil, fmt.Errorf("429 Insufficient balance")
		}

		service.Settle(s.DB, service.UsageLog{
			AccountID: accountID, ModelAlias: alias, ProviderID: provider.ID,
			InputTokens: rawInput, CachedInputTokens: cachedInput, OutputTokens: rawOutput,
			InputPrice: inputPrice, CachePrice: cachePrice, OutputPrice: outputPrice,
		})

		rdata["model"] = alias
		s.audit(auditRecord{
			AccountID: accountID, AccountName: acctName, ModelAlias: alias,
			ProviderID: provider.ID, ProviderName: provider.Name, ApiType: provider.ApiTypeStr(),
			Endpoint: endpoint, Success: true, StatusCode: 200, DurationMs: elapsedMs(started),
			InputTokens: rawInput, CachedInput: cachedInput, OutputTokens: rawOutput, Cost: cost,
		})
		return rdata, nil
	}
	return nil, fmt.Errorf("All providers failed")
}

// StreamPipeline carries everything the streaming handler needs once a
// provider succeeded.
type StreamPipeline struct {
	Reader io.Reader // OpenAI-format SSE, metered + settled as it drains
}

// StartStream preflights, picks the first working provider (failover with
// 500ms gaps like the TS loop) and returns the metered OpenAI SSE stream.
func (s *Server) StartStream(body map[string]any, accountID string) (*StreamPipeline, error) {
	return s.StartStreamAt(body, accountID, "/api/chat/completions")
}

// StartStreamAt is StartStream with an explicit endpoint label for audit.
func (s *Server) StartStreamAt(body map[string]any, accountID, endpoint string) (*StreamPipeline, error) {
	// Preflight: reject overdrawn accounts before any upstream call — the fix
	// for the TS behavior where streams always completed and billed after.
	if err := service.Preflight(s.DB, accountID); err != nil {
		alias, _ := body["model"].(string)
		s.auditReject(accountID, alias, endpoint, true, 429, err)
		return nil, err
	}
	alias, _ := body["model"].(string)
	if err := s.requireModelAccess(accountID, alias); err != nil {
		s.auditReject(accountID, alias, endpoint, true, 403, err)
		return nil, err
	}
	fallback := s.Settings.Get("fallback_model_alias")
	providers, err := s.providersForAlias(alias, fallback)
	if err != nil {
		s.auditReject(accountID, alias, endpoint, true, 404, err)
		return nil, err
	}
	skey := sessionKey(accountID, body)
	tcID := findLastToolCallID(body)
	acctName := s.accountName(accountID)

	for _, provider := range providers {
		requestBody := map[string]any{}
		for k, v := range body {
			requestBody[k] = v
		}
		requestBody["stream"] = true
		requestBody["model"] = provider.Model
		// Shallow-merge provider-level extra_json overrides (OpenRouter-style params etc.)
		mergeExtraJSON(requestBody, provider.ExtraJSONStr())

		replay := provider.ReplayReasoning != nil && *provider.ReplayReasoning == 1
		doCapture := replay && thinkingEnabled(requestBody)
		if doCapture {
			injectReplayReasoning(s, requestBody, skey)
		}

		started := time.Now()
		raw, uerr := s.tryProviderStream(provider, requestBody)
		if uerr != nil {
			s.audit(auditRecord{
				AccountID: accountID, AccountName: acctName, ModelAlias: alias,
				ProviderID: provider.ID, ProviderName: provider.Name, ApiType: provider.ApiTypeStr(),
				Endpoint: endpoint, StatusCode: uerr.status, DurationMs: elapsedMs(started),
				Stream: true, Err: uerr.msg,
			})
			time.Sleep(500 * time.Millisecond)
			continue
		}

		// Convert upstream protocol to OpenAI SSE first (like the TS pipeline).
		var converted io.Reader
		switch provider.ApiTypeStr() {
		case "anthropic":
			converted = AntStreamToOpenAI(raw)
		case "gemini":
			converted = GeminiStreamToOpenAI(raw, provider.Model)
		default:
			converted = raw
		}

		var capture *syncPoint
		if doCapture && tcID != "" {
			capture = &syncPoint{}
		}

		pr, pw := io.Pipe()
		go func() {
			sc := &meteredScanner{Reasoning: capture}
			meteredCopy(pw, converted, sc)
			// settle: reasoning cache + atomic deduct + bucket log
			if capture != nil && tcID != "" {
				capture.mu.Lock()
				content := capture.buf.String()
				capture.mu.Unlock()
				if content != "" {
					s.reasoningCacheSet(skey+"::"+tcID, content)
				}
			}
			inputPrice, cachePrice, outputPrice, perr := service.ModelPrices(s.DB, alias)
			if perr != nil {
				fmt.Println("[Billing] get prices failed:", perr)
				pw.Close()
				return
			}
			rawInput, rawOutput := service.TokensOf(sc.Usage)
			if rawOutput == 0 {
				est := (sc.EstimatedChars + 3) / 4
				if est < 1 {
					est = 1
				}
				rawOutput = int64(est)
			}
			cachedInput := service.ExtractCachedTokens(sc.Usage)
			cost := service.CalculateCost(rawInput, cachedInput, rawOutput, inputPrice, cachePrice, outputPrice)
			service.Settle(s.DB, service.UsageLog{
				AccountID: accountID, ModelAlias: alias, ProviderID: provider.ID,
				InputTokens: rawInput, CachedInputTokens: cachedInput, OutputTokens: rawOutput,
				InputPrice: inputPrice, CachePrice: cachePrice, OutputPrice: outputPrice,
			})
			s.audit(auditRecord{
				AccountID: accountID, AccountName: acctName, ModelAlias: alias,
				ProviderID: provider.ID, ProviderName: provider.Name, ApiType: provider.ApiTypeStr(),
				Endpoint: endpoint, Success: true, StatusCode: 200, DurationMs: elapsedMs(started),
				InputTokens: rawInput, CachedInput: cachedInput, OutputTokens: rawOutput, Cost: cost,
				Stream: true,
			})
			pw.Close()
		}()

		return &StreamPipeline{Reader: pr}, nil
	}
	return nil, fmt.Errorf("All providers failed")
}

// meteredCopy forwards bytes untouched, scanning SSE inline for usage and
// reasoning content (port of the TS passthrough with inline cost parsing).
func meteredCopy(dst io.Writer, src io.Reader, sc *meteredScanner) {
	buf := make([]byte, 32*1024)
	for {
		n, err := src.Read(buf)
		if n > 0 {
			chunk := make([]byte, n)
			copy(chunk, buf[:n])
			sc.feed(chunk)
			if _, werr := dst.Write(chunk); werr != nil {
				return // client went away; settle still runs via caller
			}
		}
		if err != nil {
			return
		}
	}
}

// ListModels — ModelsResponse shape.
func (s *Server) ListModels(accountID string) (map[string]any, error) {
	models, err := s.allModels()
	if err != nil {
		return nil, err
	}
	var allowed []string
	if accountID != "" {
		allowed, err = s.allowedAliases(accountID)
		if err != nil {
			return nil, err
		}
	}
	seen := map[string]bool{}
	data := []any{}
	for _, m := range models {
		if m.Alias == "" || seen[m.Alias] {
			continue
		}
		if allowed != nil && !containsStr(allowed, m.Alias) {
			continue
		}
		seen[m.Alias] = true
		data = append(data, map[string]any{
			"id": m.Alias, "object": "model", "created": m.CreateTime, "owned_by": "onekey",
			"input_price": m.InputPrice, "cache_price": m.CachePrice, "output_price": m.OutputPrice,
		})
	}
	return map[string]any{"success": true, "object": "list", "data": data}, nil
}

func containsStr(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// AntMessages — POST /v1/messages non-streaming.
func (s *Server) AntMessages(body map[string]any, accountID string) (map[string]any, error) {
	openaiBody := antMessagesToOpenAI(body)
	result, err := s.ChatCompletionsAt(openaiBody, accountID, "/api/v1/messages")
	if err != nil {
		return nil, err
	}
	model, _ := body["model"].(string)
	return openAIToAntMessages(result, model), nil
}

// AntMessagesStream — POST /v1/messages streaming; returns Anthropic SSE.
func (s *Server) AntMessagesStream(body map[string]any, accountID string) (io.Reader, error) {
	openaiBody := antMessagesToOpenAI(body)
	pipeline, err := s.StartStreamAt(openaiBody, accountID, "/api/v1/messages")
	if err != nil {
		return nil, err
	}
	return OpenAIToAntStream(pipeline.Reader), nil
}

// serveSSE — flush-per-write SSE serving.
func ServeSSE(w http.ResponseWriter, r io.Reader) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, token, Authorization, x-api-key")
	flusher, _ := w.(http.Flusher)
	buf := make([]byte, 32*1024)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
		if err != nil {
			return
		}
	}
}
