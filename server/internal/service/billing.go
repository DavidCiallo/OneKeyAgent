package service

import (
	"database/sql"
	"fmt"

	"onekey/server/internal/store"
)

// ─────────────────────────── Billing ───────────────────────────

// UsageLog — one settled request (billing.go Rust equivalent).
type UsageLog struct {
	AccountID         string
	ModelAlias        string
	ProviderID        string
	InputTokens       int64
	CachedInputTokens int64
	OutputTokens      int64
	InputPrice        float64
	CachePrice        float64
	OutputPrice       float64
}

func (u *UsageLog) Cost() float64 {
	cached := u.CachedInputTokens
	effectiveCachePrice := u.CachePrice
	if effectiveCachePrice <= 0 {
		effectiveCachePrice = u.InputPrice
	}
	inputCost := (float64(cached)*effectiveCachePrice +
		float64(max(u.InputTokens-cached, 0))*u.InputPrice) / 1e6
	outputCost := float64(u.OutputTokens) * u.OutputPrice / 1e6
	return store.Round6(inputCost + outputCost)
}

// CalculateCost — ai.builder.ts calculateCost.
func CalculateCost(inputTokens, cachedInputTokens, outputTokens int64, inputPrice, cachePrice, outputPrice float64) float64 {
	effectiveCachePrice := cachePrice
	if effectiveCachePrice <= 0 {
		effectiveCachePrice = inputPrice
	}
	nonCached := inputTokens - cachedInputTokens
	if nonCached < 0 {
		nonCached = 0
	}
	return store.Round6((float64(cachedInputTokens)*effectiveCachePrice +
		float64(nonCached)*inputPrice + float64(outputTokens)*outputPrice) / 1e6)
}

// ExtractCachedTokens — supports multiple vendor usage formats.
func ExtractCachedTokens(usage map[string]any) int64 {
	if usage == nil {
		return 0
	}
	maxi := func(vals ...int64) int64 {
		m := vals[0]
		for _, v := range vals {
			if v > m {
				m = v
			}
		}
		return m
	}
	a := int64(0)
	if ptd, ok := usage["prompt_tokens_details"].(map[string]any); ok {
		a = jsonInt(ptd["cached_tokens"])
	}
	b := jsonInt(usage["prompt_cache_hit_tokens"])
	c := int64(0)
	if miss, ok := usage["prompt_cache_miss_tokens"]; ok && miss != nil {
		c = maxi(jsonInt(usage["prompt_tokens"])-jsonInt(miss), 0)
	}
	return maxi(a, b, c, 0)
}

// TokensOf — (input, output) from OpenAI or Anthropic style usage.
func TokensOf(usage map[string]any) (int64, int64) {
	if usage == nil {
		return 0, 0
	}
	in := jsonInt(usage["input_tokens"])
	if v := jsonInt(usage["prompt_tokens"]); v != 0 {
		in = v
	}
	out := jsonInt(usage["output_tokens"])
	if v := jsonInt(usage["completion_tokens"]); v != 0 {
		out = v
	}
	return in, out
}

func jsonInt(v any) int64 {
	switch x := v.(type) {
	case float64:
		return int64(x)
	case int64:
		return x
	case int:
		return int64(x)
	}
	return 0
}

// ModelPrices — alias pricing from the model table.
func ModelPrices(db *sql.DB, alias string) (input, cache, output float64, err error) {
	models, err := store.ModelAllActive(db)
	if err != nil {
		return 0, 0, 0, err
	}
	sortByAlias(models)
	for _, m := range models {
		if m.Alias == alias {
			return m.InputPrice, m.CachePrice, m.OutputPrice, nil
		}
	}
	return 0, 0, 0, nil
}

func sortByAlias(models []*store.Model) {
	for i := 1; i < len(models); i++ {
		for j := i; j > 0 && models[j].Alias < models[j-1].Alias; j-- {
			models[j], models[j-1] = models[j-1], models[j]
		}
	}
}

// WeeklySpending — sums `1d` granularity only. (The TS version summed all
// granularities for an account, triple-counting every dollar.)
func WeeklySpending(db *sql.DB, accountID string) (float64, error) {
	since := store.Now() - 7*86_400_000
	gran := "1d"
	total, err := store.BucketSumCost(db, accountID, &gran, since, false)
	if err != nil {
		return 0, err
	}
	return store.Round6(total), nil
}

// Preflight — gate before an upstream call. This is the piece the TS server
// was missing: cost was only settled after the response, so streaming
// requests could always overdraw.
func Preflight(db *sql.DB, accountID string) error {
	balance, err := store.AccountGetBalance(db, accountID)
	if err != nil {
		return err
	}
	if balance <= 0 {
		return fmt.Errorf("429 Insufficient balance")
	}
	weekly, err := WeeklySpending(db, accountID)
	if err != nil {
		return err
	}
	if weekly > WeeklyLimit {
		return fmt.Errorf("429 Weekly spending limit reached")
	}
	return nil
}

// Settle — final settlement: atomic deduct (floor 0) + usage bucket log.
// Never fails the request; billing problems are logged, not surfaced
// mid-stream.
func Settle(db *sql.DB, log UsageLog) {
	cost := log.Cost()
	if cost > 0 {
		if _, err := store.AccountDeductBalance(db, log.AccountID, cost); err != nil {
			fmt.Println("[Billing] deduct failed:", err)
		}
	}
	if err := store.BucketLogUsage(db, store.BucketLogInput{
		AccountID:         log.AccountID,
		ModelAlias:        log.ModelAlias,
		ProviderID:        log.ProviderID,
		InputTokens:       log.InputTokens,
		CachedInputTokens: log.CachedInputTokens,
		OutputTokens:      log.OutputTokens,
		Cost:              cost,
	}); err != nil {
		fmt.Println("[Billing] log usage failed:", err)
	}
}
