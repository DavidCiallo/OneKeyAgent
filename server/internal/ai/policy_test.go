package ai

import (
	"strings"
	"testing"

	"onekey/server/internal/store"
)

func prov(id string, priority int64, maxContext, dailyQuota int64) *store.Provider {
	return &store.Provider{ID: id, Name: id, Priority: priority, MaxContext: maxContext, DailyQuota: dailyQuota}
}

func ids(list []*store.Provider) []string {
	out := make([]string, 0, len(list))
	for _, p := range list {
		out = append(out, p.ID)
	}
	return out
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// TestPolicyCooldownAfterConsecutiveFailures — an upstream that fails
// policyMaxFailures times in a row is skipped, and a success clears the streak.
func TestPolicyCooldownAfterConsecutiveFailures(t *testing.T) {
	p := newProviderPolicy()
	cands := []*store.Provider{prov("a", 1, 0, 0), prov("b", 2, 0, 0)}

	// Four failures is not enough.
	for i := 0; i < policyMaxFailures-1; i++ {
		if p.recordFailure("a") {
			t.Fatalf("provider parked after only %d failures", i+1)
		}
	}
	if got := ids(p.selectProviders(cands, 0, true, true)); !equal(got, []string{"a", "b"}) {
		t.Fatalf("after %d failures order = %v, want a first", policyMaxFailures-1, got)
	}

	// The fifth trips the cooldown.
	if !p.recordFailure("a") {
		t.Fatalf("provider not parked after %d consecutive failures", policyMaxFailures)
	}
	if got := ids(p.selectProviders(cands, 0, true, true)); !equal(got, []string{"b"}) {
		t.Fatalf("order = %v, want only b while a is parked", got)
	}

	// A success resets the streak, so the next failure starts from one.
	p.recordSuccess("a")
	if snap := p.Snapshot("a"); snap.Failures != 0 {
		t.Fatalf("failures = %d after success, want 0", snap.Failures)
	}
	if snap := p.Snapshot("a"); snap.CooldownUntil != 0 {
		t.Fatalf("provider still parked after a success: until=%d", snap.CooldownUntil)
	}
}

// TestPolicyCooldownExpires — once the window passes, the provider is eligible
// again without any manual reset.
func TestPolicyCooldownExpires(t *testing.T) {
	p := newProviderPolicy()
	for i := 0; i < policyMaxFailures; i++ {
		p.recordFailure("a")
	}
	if snap := p.Snapshot("a"); snap.CooldownUntil == 0 {
		t.Fatalf("provider was never parked")
	}

	// Rewind the deadline to simulate the window elapsing.
	p.mu.Lock()
	p.cooldownUntil["a"] = 1 // long past
	p.mu.Unlock()

	cands := []*store.Provider{prov("a", 1, 0, 0), prov("b", 2, 0, 0)}
	if got := ids(p.selectProviders(cands, 0, true, true)); !equal(got, []string{"a", "b"}) {
		t.Fatalf("order = %v, want the expired provider back in front", got)
	}
	if snap := p.Snapshot("a"); snap.CooldownUntil != 0 {
		t.Fatalf("expired cooldown still reported: %d", snap.CooldownUntil)
	}
}

// TestPolicyAllParkedFallsBack — when every candidate is filtered out the
// original order is used. Refusing to route would be worse than trying a
// cooled-down upstream.
func TestPolicyAllParkedFallsBack(t *testing.T) {
	p := newProviderPolicy()
	cands := []*store.Provider{prov("a", 1, 0, 0), prov("b", 2, 0, 0)}
	for i := 0; i < policyMaxFailures; i++ {
		p.recordFailure("a")
		p.recordFailure("b")
	}
	got := ids(p.selectProviders(cands, 0, true, true))
	if !equal(got, []string{"a", "b"}) {
		t.Fatalf("order = %v, want the full list as a fallback (never an empty selection)", got)
	}
}

// TestPolicyDailyQuota — a provider stops being selected once it has served its
// declared number of requests today, and the counter resets on a new day.
func TestPolicyDailyQuota(t *testing.T) {
	p := newProviderPolicy()
	cands := []*store.Provider{prov("a", 1, 0, 2), prov("b", 2, 0, 0)}

	// A quota of 2 means two requests, then it is spent.
	p.recordSuccess("a")
	if got := ids(p.selectProviders(cands, 0, true, true)); !equal(got, []string{"a", "b"}) {
		t.Fatalf("order = %v, want a still eligible after 1 of 2", got)
	}
	p.recordSuccess("a")
	if got := ids(p.selectProviders(cands, 0, true, true)); !equal(got, []string{"b"}) {
		t.Fatalf("order = %v, want only b once a served its full quota of 2", got)
	}
	if snap := p.Snapshot("a"); snap.TodayCount != 2 {
		t.Fatalf("today_count = %d, want 2", snap.TodayCount)
	}

	// A zero quota means unlimited.
	if got := ids(p.selectProviders([]*store.Provider{prov("b", 1, 0, 0)}, 0, true, true)); !equal(got, []string{"b"}) {
		t.Fatalf("unlimited provider was filtered: %v", got)
	}

	// Rolling the day re-opens the quota.
	p.mu.Lock()
	p.dailyKey = "1970-01-01"
	p.mu.Unlock()
	if got := ids(p.selectProviders(cands, 0, true, true)); !equal(got, []string{"a", "b"}) {
		t.Fatalf("order = %v, want the quota reset on a new day", got)
	}
	if snap := p.Snapshot("a"); snap.TodayCount != 0 {
		t.Fatalf("today_count = %d right after the day rolled, want 0", snap.TodayCount)
	}
}

// TestPolicyContextFilter — a request larger than an upstream's declared window
// skips it; an undeclared window (0) accepts everything.
func TestPolicyContextFilter(t *testing.T) {
	p := newProviderPolicy()
	small := prov("small", 1, 8000, 0)
	big := prov("big", 2, 200000, 0)
	undeclared := prov("undeclared", 3, 0, 0)
	cands := []*store.Provider{small, big, undeclared}

	if got := ids(p.selectProviders(cands, 4000, true, true)); !equal(got, []string{"small", "big", "undeclared"}) {
		t.Fatalf("small request order = %v, want all three", got)
	}
	if got := ids(p.selectProviders(cands, 50000, true, true)); !equal(got, []string{"big", "undeclared"}) {
		t.Fatalf("large request order = %v, want the small window skipped", got)
	}
	// If only the too-small provider exists, it is still used: better to try
	// than to fail the request outright.
	if got := ids(p.selectProviders([]*store.Provider{small}, 50000, true, true)); !equal(got, []string{"small"}) {
		t.Fatalf("only-candidate order = %v, want the fallback to keep it", got)
	}
}

// TestPolicyFiltersCanBeDisabled — the cooldown and quota switches let a caller
// route without those filters while still applying the context check.
func TestPolicyFiltersCanBeDisabled(t *testing.T) {
	p := newProviderPolicy()
	cands := []*store.Provider{prov("a", 1, 0, 1)}
	p.recordSuccess("a") // quota of 1 is now spent

	if got := ids(p.selectProviders(cands, 0, true, true)); !equal(got, []string{"a"}) {
		t.Fatalf("order = %v, want the fallback to keep the only candidate", got)
	}
	// With the quota check off, the provider is eligible.
	if ok, _ := p.eligible("a", 1, true, false); !ok {
		t.Fatalf("provider rejected even with the quota filter disabled")
	}
	// With the health check off, a parked provider is eligible.
	for i := 0; i < policyMaxFailures; i++ {
		p.recordFailure("a")
	}
	if ok, _ := p.eligible("a", 0, false, true); !ok {
		t.Fatalf("provider rejected even with the cooldown filter disabled")
	}
}

// TestEstimateTokens — the estimate is deliberately rough, but it must scale
// the right way: ASCII at ~4 chars/token, CJK at ~1-2 chars/token.
func TestEstimateTokens(t *testing.T) {
	if got := estimateTokens(""); got != 0 {
		t.Fatalf("empty body = %d tokens, want 0", got)
	}

	ascii := strings.Repeat("a", 400)
	got := estimateTokens(ascii)
	if got < 80 || got > 120 {
		t.Fatalf("400 ASCII chars = %d tokens, want ~100 (4 chars/token)", got)
	}

	// 400 CJK characters: roughly one token each, so clearly more than the
	// ASCII estimate — that ratio is the whole point of the split.
	cjk := strings.Repeat("好", 400)
	cjkTokens := estimateTokens(cjk)
	if cjkTokens <= got {
		t.Fatalf("CJK estimate %d is not above the ASCII estimate %d — wide scripts must cost more per character",
			cjkTokens, got)
	}
	if cjkTokens < 200 || cjkTokens > 500 {
		t.Fatalf("400 CJK chars = %d tokens, want roughly 200-500", cjkTokens)
	}

	// Mixed content lands between the two.
	mixed := strings.Repeat("ab", 200) + strings.Repeat("好", 200)
	mixedTokens := estimateTokens(mixed)
	if mixedTokens <= got || mixedTokens >= cjkTokens+200 {
		t.Fatalf("mixed estimate %d not between ascii %d and cjk %d", mixedTokens, got, cjkTokens)
	}
}

// TestRequestTokenEstimateReadsMessageText — the estimate must be driven by the
// conversation, not by JSON scaffolding, so a long prompt counts and a short
// one with many keys does not.
func TestRequestTokenEstimateReadsMessageText(t *testing.T) {
	long := map[string]any{
		"model": "m",
		"messages": []any{
			map[string]any{"role": "user", "content": strings.Repeat("x", 4000)},
		},
	}
	short := map[string]any{
		"model": "m",
		"messages": []any{
			map[string]any{"role": "user", "content": "hi"},
		},
	}
	longEst := requestTokenEstimate(long)
	shortEst := requestTokenEstimate(short)
	if longEst <= shortEst*10 {
		t.Fatalf("long prompt estimated %d vs short %d — the message text is not driving the estimate",
			longEst, shortEst)
	}
	if longEst < 800 || longEst > 1200 {
		t.Fatalf("4000 characters estimated %d tokens, want ~1000", longEst)
	}

	// Nested content (tool calls / arrays of parts) is counted too.
	nested := map[string]any{
		"messages": []any{
			map[string]any{"role": "assistant", "content": []any{
				map[string]any{"type": "text", "text": strings.Repeat("y", 2000)},
			}},
		},
	}
	if got := requestTokenEstimate(nested); got < 400 {
		t.Fatalf("nested content estimated %d tokens, want the inner text counted", got)
	}

	// Tool schemas count: they can be large and travel with every request.
	withTools := map[string]any{
		"messages": []any{map[string]any{"role": "user", "content": "hi"}},
		"tools": []any{map[string]any{
			"type": "function",
			"function": map[string]any{
				"name": "f", "description": strings.Repeat("z", 2000),
			},
		}},
	}
	if got := requestTokenEstimate(withTools); got < 400 {
		t.Fatalf("tool schemas estimated %d tokens, want them counted", got)
	}
}
