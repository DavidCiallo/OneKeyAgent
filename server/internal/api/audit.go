package api

import (
	"fmt"

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
			"duration_ms": r.DurationMs, "input_tokens": r.InputTokens,
			"cached_input_tokens": r.CachedInputTokens, "output_tokens": r.OutputTokens,
			"cost": r.Cost, "stream": r.Stream, "err": r.Err,
			// The bodies stay on the row until one is opened: they are the
			// largest field by far, and a list that carries them all is what
			// made this endpoint slow.
			"has_detail": r.HasDetail,
			"tps":        throughput(r.OutputTokens, r.DurationMs),
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

// throughput — output tokens per second, derived here rather than stored so a
// later change to the formula applies to existing rows too. Measured across the
// whole upstream call, so for streams it includes time to first token.
func throughput(outputTokens, durationMs int64) float64 {
	if outputTokens <= 0 || durationMs <= 0 {
		return 0
	}
	return store.Round6(float64(outputTokens) / (float64(durationMs) / 1000))
}
