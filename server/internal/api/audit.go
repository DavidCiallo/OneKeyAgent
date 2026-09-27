package api

import (
	"fmt"
	"sort"
	"strings"

	"onekey/server/internal/httpx"
	"onekey/server/internal/service"
	"onekey/server/internal/store"
)

// ─────────────────────────── audit controller ───────────────────────────

// auditList — newest 10 successful + newest 10 failed relay attempts, without
// their bodies. Admin-only: rows carry per-account activity across the whole
// instance.
func (a *App) auditList(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	rows, err := store.AuditList(a.DB)
	if err != nil {
		return nil, err
	}
	list := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		list = append(list, map[string]any{
			"id": r.ID, "ts": r.Ts, "success": r.Success,
			"account_id": r.AccountID, "account_name": r.AccountName,
			"model_alias": r.ModelAlias, "provider_id": r.ProviderID, "provider_name": r.ProviderName,
			"api_type": r.ApiType, "endpoint": r.Endpoint, "status_code": r.StatusCode,
			"duration_ms": r.DurationMs, "ttft_ms": r.TtftMs, "input_tokens": r.InputTokens,
			"cached_input_tokens": r.CachedInputTokens, "output_tokens": r.OutputTokens,
			"cost": r.Cost, "stream": r.Stream, "err": r.Err,
			// The bodies stay on the row until one is opened: they are the
			// largest field by far, and a list that carries them all is what
			// made this endpoint slow.
			"has_detail": r.HasDetail,
			"tps":        throughput(r.OutputTokens, r.DurationMs, r.TtftMs),
		})
	}
	return map[string]any{"list": list, "keep": store.AuditKeep}, nil
}

// auditDetail — the stored request/response summary for one attempt, read when
// an admin expands that row.
func (a *App) auditDetail(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	id := c.Str("id")
	if id == "" {
		return nil, fmt.Errorf("miss params")
	}
	row, err := store.AuditDetail(a.DB, id)
	if err == store.ErrNotFound {
		return nil, fmt.Errorf("audit row not found")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id":            row.ID,
		"request_body":  row.RequestBody,
		"response_body": row.ResponseBody,
	}, nil
}

// throughput — output tokens per second of generation, derived here rather than
// stored so a later change to the formula applies to existing rows too.
//
// Only the wait before the first token is taken out: that is prefill and
// queueing, a property of the prompt rather than of the model's speed. Thinking
// is not taken out — it is output the provider bills, and the clock starts at
// the first token of any kind, so reasoning tokens are measured over the span
// that produced them. Starting the clock at the first *visible* token instead
// would divide the whole output by the visible tail alone and report a rate no
// model can reach.
//
// When there is no first-token measurement (non-streaming, or a stream that
// emitted nothing) the whole duration is generation time, which is the only
// reading available and a floor on the real speed. A wait longer than the
// request itself is inconsistent data rather than a real measurement, so it
// falls back the same way; a wait equal to it leaves nothing to divide by and
// reports no speed.
func throughput(outputTokens, durationMs, ttftMs int64) float64 {
	gen := durationMs
	if ttftMs > 0 && ttftMs <= durationMs {
		gen = durationMs - ttftMs
	}
	if outputTokens <= 0 || gen <= 0 {
		return 0
	}
	return store.Round6(float64(outputTokens) / (float64(gen) / 1000))
}

// tpsRange — how much history the chart covers and at what resolution. The
// granularities are the ones BucketLogUsage writes, and retention keeps 1m
// buckets for 7 days and 60m buckets for 90, so every range here is covered.
type tpsRange struct {
	Granularity string
	StepMs      int64
	Points      int
}

var tpsRanges = map[string]tpsRange{
	"1h":  {"1m", 60_000, 60},
	"12h": {"1m", 60_000, 720},
	"48h": {"60m", 3_600_000, 48},
}

const tpsDefaultRange = "1h"

// auditTps — per-provider throughput and first-token latency over a recent
// window, for the audit page's chart.
//
// Reads usage_bucket, not audit_log: the trail keeps ten rows per outcome, which
// is a sample of what just happened, not a history to chart. Every point is one
// bucket, and a provider with nothing in that window is left out rather than
// plotted as zero — no traffic and zero speed are different things.
func (a *App) auditTps(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	name := c.Str("range")
	rng, ok := tpsRanges[name]
	if !ok {
		name = tpsDefaultRange
		rng = tpsRanges[name]
	}
	alias := c.Str("model_alias")

	step := rng.StepMs
	// Buckets are written on step boundaries, so anchor the window the same way
	// or the first and last slots would never match a row.
	end := (store.Now() / step) * step
	start := end - int64(rng.Points-1)*step

	conds := []string{"delete_time IS NULL", "granularity = ?", "bucket_time >= ?", "bucket_time <= ?"}
	args := []any{rng.Granularity, start, end}
	if alias != "" {
		conds = append(conds, "model_alias = ?")
		args = append(args, alias)
	}

	rows, err := a.DB.Query(`SELECT provider_id, bucket_time,
			COALESCE(SUM(output_tokens),0), COALESCE(SUM(duration_ms),0),
			COALESCE(SUM(ttft_ms),0), COALESCE(SUM(ttft_count),0)
		FROM usage_bucket WHERE `+strings.Join(conds, " AND ")+`
		GROUP BY provider_id, bucket_time`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type cell struct{ output, duration, ttft, ttftCount int64 }
	cells := map[string]map[int64]*cell{}
	order := []string{}
	for rows.Next() {
		var pid string
		var at int64
		var cl cell
		if err := rows.Scan(&pid, &at, &cl.output, &cl.duration, &cl.ttft, &cl.ttftCount); err != nil {
			return nil, err
		}
		if cells[pid] == nil {
			cells[pid] = map[int64]*cell{}
			order = append(order, pid)
		}
		cells[pid][at] = &cl
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// A bucket stores only the provider id, and a provider deleted since would
	// otherwise be a bare id in the legend.
	names := map[string]string{}
	if all, err := store.ProviderAllIgnoreDelete(a.DB); err == nil {
		for _, p := range all {
			names[p.ID] = p.Name
		}
	}
	label := func(id string) string {
		if n := names[id]; n != "" {
			return n
		}
		return id
	}
	sort.Slice(order, func(i, j int) bool { return label(order[i]) < label(order[j]) })

	providers := make([]map[string]any, 0, len(order))
	for _, pid := range order {
		providers = append(providers, map[string]any{"id": pid, "name": label(pid)})
	}

	points := make([]map[string]any, 0, rng.Points)
	for i := 0; i < rng.Points; i++ {
		ts := start + int64(i)*step
		tps := map[string]any{}
		ttft := map[string]any{}
		for _, pid := range order {
			cl := cells[pid][ts]
			if cl == nil {
				continue
			}
			// Generation time is the denominator: a request that spent its whole
			// duration waiting for the first token reports no speed at all.
			if gen := cl.duration - cl.ttft; gen > 0 && cl.output > 0 {
				tps[pid] = store.Round6(float64(cl.output) / (float64(gen) / 1000))
			}
			// Averaged over the requests that actually reported a first token —
			// the non-streaming path cannot, and would drag the mean toward zero.
			if cl.ttftCount > 0 && cl.ttft > 0 {
				ttft[pid] = store.Round6(float64(cl.ttft) / float64(cl.ttftCount))
			}
		}
		points = append(points, map[string]any{"ts": ts, "tps": tps, "ttft": ttft})
	}

	return map[string]any{
		"range":       name,
		"granularity": rng.Granularity,
		"step_ms":     step,
		"start":       start,
		"end":         end,
		"providers":   providers,
		"points":      points,
	}, nil
}
