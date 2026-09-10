package api

import (
	"onekey/server/internal/httpx"
	"onekey/server/internal/service"
	"onekey/server/internal/store"
)

// ─────────────────────────── audit controller ───────────────────────────

// auditList — newest 100 successful + newest 100 failed relay attempts.
// Admin-only: rows carry per-account activity across the whole instance.
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
		})
	}
	return map[string]any{"list": list, "keep": store.AuditKeep}, nil
}
