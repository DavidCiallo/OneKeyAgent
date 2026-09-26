package ai

import (
	"strings"
	"sync"
	"time"

	"onekey/server/internal/store"
)

// Provider selection policy: in-memory, per-process filters applied on top of
// the priority order — failure cooldown, daily quota, context size.
//
// They are preferences, not gates: when every candidate is filtered out the
// original order is used, since trying a parked upstream beats failing outright.
type providerPolicy struct {
	mu sync.Mutex

	failures      map[string]int
	cooldownUntil map[string]int64
	dailyCount    map[string]int
	// dailyKey is the local calendar day the counters belong to.
	dailyKey string

	maxFailures  int
	cooldownMs   int64
	retryDelayMs int64
}

func newProviderPolicy() *providerPolicy {
	return &providerPolicy{
		failures:      map[string]int{},
		cooldownUntil: map[string]int64{},
		dailyCount:    map[string]int{},
		maxFailures:   policyMaxFailures,
		cooldownMs:    policyCooldownMs,
		retryDelayMs:  policyRetryDelayMs,
	}
}

// Five consecutive failures park an upstream for five minutes.
const (
	policyMaxFailures  = 5
	policyCooldownMs   = 300 * 1000
	policyRetryDelayMs = 500
)

// dayKey — the local calendar day.
func dayKey(now time.Time) string {
	return now.Format("2006-01-02")
}

// rollDayLocked resets the daily counters when the calendar day changes.
// Callers must hold p.mu.
func (p *providerPolicy) rollDayLocked(now time.Time) {
	k := dayKey(now)
	if p.dailyKey != k {
		p.dailyKey = k
		p.dailyCount = map[string]int{}
	}
}

// eligible reports whether a provider passes the cooldown and quota filters.
func (p *providerPolicy) eligible(providerID string, dailyQuota int64, cooldownOK bool, quotaOK bool) (bool, string) {
	now := time.Now()
	p.mu.Lock()
	defer p.mu.Unlock()
	p.rollDayLocked(now)

	if cooldownOK {
		if until, ok := p.cooldownUntil[providerID]; ok {
			if now.UnixMilli() < until {
				return false, "cooling down"
			}
			delete(p.cooldownUntil, providerID)
		}
	}
	if quotaOK && dailyQuota > 0 && int64(p.dailyCount[providerID]) >= dailyQuota {
		return false, "daily quota reached"
	}
	return true, ""
}

// recordSuccess clears the failure streak and counts one request.
func (p *providerPolicy) recordSuccess(providerID string) {
	now := time.Now()
	p.mu.Lock()
	defer p.mu.Unlock()
	p.rollDayLocked(now)
	p.failures[providerID] = 0
	delete(p.cooldownUntil, providerID)
	p.dailyCount[providerID]++
}

// recordFailure counts a consecutive failure and parks the provider at the
// threshold. Returns true when this failure tripped the cooldown.
func (p *providerPolicy) recordFailure(providerID string) bool {
	now := time.Now()
	p.mu.Lock()
	defer p.mu.Unlock()
	p.rollDayLocked(now)

	p.failures[providerID]++
	if p.maxFailures <= 0 || p.failures[providerID] < p.maxFailures {
		return false
	}
	p.cooldownUntil[providerID] = now.UnixMilli() + p.cooldownMs
	return true
}

type policySnapshot struct {
	Failures      int   `json:"failures"`
	CooldownUntil int64 `json:"cooldown_until"`
	TodayCount    int   `json:"today_count"`
}

// Snapshot reports one provider's policy state for the admin UI.
func (p *providerPolicy) Snapshot(providerID string) policySnapshot {
	now := time.Now()
	p.mu.Lock()
	defer p.mu.Unlock()
	out := policySnapshot{Failures: p.failures[providerID]}
	if until, ok := p.cooldownUntil[providerID]; ok && now.UnixMilli() < until {
		out.CooldownUntil = until
	}
	if p.dailyKey == dayKey(now) {
		out.TodayCount = p.dailyCount[providerID]
	}
	return out
}

// PolicySnapshot — the Server-level accessor used by the admin API.
func (s *Server) PolicySnapshot(providerID string) policySnapshot {
	return s.policy.Snapshot(providerID)
}

// ─────────────────────────── context size ───────────────────────────

// estimateTokens — rough token count, weighted and divided by 4: ASCII lands at
// len/4, CJK at about one token per character. The only consumer is a context
// window check, so an exact per-vendor tokenizer is not worth the dependency.
func estimateTokens(body string) int {
	if body == "" {
		return 0
	}
	units := 0
	for _, r := range body {
		if isWideRune(r) {
			// Weight 4 so the /4 below yields ~1 token per CJK character.
			units += 4
		} else {
			units++
		}
	}
	return units / 4
}

// isWideRune — scripts that tokenize near one token per character: CJK, kana,
// Hangul and their punctuation blocks.
func isWideRune(r rune) bool {
	switch {
	case r >= 0x1100 && r <= 0x11FF: // Hangul Jamo
		return true
	case r >= 0x2E80 && r <= 0x303F: // CJK radicals, Kangxi, CJK punctuation
		return true
	case r >= 0x3040 && r <= 0x30FF: // Hiragana, Katakana
		return true
	case r >= 0x3130 && r <= 0x318F: // Hangul compatibility Jamo
		return true
	case r >= 0x3400 && r <= 0x4DBF: // CJK extension A
		return true
	case r >= 0x4E00 && r <= 0x9FFF: // CJK unified ideographs
		return true
	case r >= 0xA000 && r <= 0xA4CF: // Yi
		return true
	case r >= 0xAC00 && r <= 0xD7AF: // Hangul syllables
		return true
	case r >= 0xF900 && r <= 0xFAFF: // CJK compatibility ideographs
		return true
	case r >= 0x20000 && r <= 0x2FA1F: // CJK extensions B-F
		return true
	}
	return false
}

// fitsContext — whether a declared window can take this request. 0 means no
// limit.
func fitsContext(declaredTokens int64, requestTokens int) bool {
	if declaredTokens <= 0 {
		return true
	}
	return int64(requestTokens) <= declaredTokens
}

// ─────────────────────────── selection ───────────────────────────

// selectProviders filters a priority-ordered candidate list. When every
// candidate is filtered out the original list is returned, since trying a
// parked upstream beats failing the request.
func (p *providerPolicy) selectProviders(
	providers []*store.Provider,
	requestedTokens int,
	cooldownOK bool,
	quotaOK bool,
) []*store.Provider {
	if len(providers) == 0 {
		return providers
	}

	kept := make([]*store.Provider, 0, len(providers))
	for _, pr := range providers {
		if !fitsContext(pr.MaxContext, requestedTokens) {
			continue
		}
		if ok, _ := p.eligible(pr.ID, pr.DailyQuota, cooldownOK, quotaOK); !ok {
			continue
		}
		kept = append(kept, pr)
	}

	// All filtered: fall back to the original order.
	if len(kept) == 0 {
		return providers
	}
	return kept
}

// ─────────────────────────── request size ───────────────────────────

// requestTokenEstimate — tokens implied by a request body. Reads the message
// texts and tool schemas rather than the JSON envelope, so field names and
// escaping do not inflate the count.
func requestTokenEstimate(body map[string]any) int {
	var sb strings.Builder
	appendMessageText(&sb, body["messages"])
	appendMessageText(&sb, body["contents"]) // gemini-shaped
	if s, ok := body["system"].(string); ok {
		sb.WriteString(s)
	}
	if t, ok := body["tools"]; ok {
		sb.WriteString(jStringify(t))
	}
	return estimateTokens(sb.String())
}

// appendMessageText writes out every string in a message list, which covers
// content, tool call arguments and tool results.
func appendMessageText(sb *strings.Builder, v any) {
	switch t := v.(type) {
	case string:
		sb.WriteString(t)
	case []any:
		for _, e := range t {
			appendMessageText(sb, e)
		}
	case map[string]any:
		for _, e := range t {
			appendMessageText(sb, e)
		}
	}
}
