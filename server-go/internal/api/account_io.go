package api

import (
	"fmt"

	"onekey/server/internal/httpx"
	"onekey/server/internal/service"
	"onekey/server/internal/store"
)

// exportTables mirrors account.controller.ts exportData.
var exportTables = []string{
	"account", "model", "provider", "role", "account_role",
	"gift_card", "settings", "session_reasoning",
}

var importOrder = []struct {
	table  string
	dataKey string
}{
	{"role", "roles"},
	{"account", "accounts"},
	{"account_role", "account_roles"},
	{"model", "models"},
	{"provider", "providers"},
	{"usage_bucket", "usage_buckets"},
	{"transaction", "transactions"},
	{"gift_card", "gift_cards"},
	{"settings", "settings"},
	{"session_reasoning", "session_reasonings"},
}

func (a *App) accountExport(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	data := map[string]any{}
	for _, table := range exportTables {
		rows, err := store.AllRowsIgnoreDelete(a.DB, table)
		if err != nil {
			return nil, err
		}
		if rows == nil {
			rows = []map[string]any{}
		}
		data[exportKey(table)] = rows
	}
	// usage buckets + transactions also exported
	buckets, err := store.AllRowsIgnoreDelete(a.DB, "usage_bucket")
	if err != nil {
		return nil, err
	}
	if buckets == nil {
		buckets = []map[string]any{}
	}
	data["usage_buckets"] = buckets
	txs, err := store.AllRowsIgnoreDelete(a.DB, "transaction")
	if err != nil {
		return nil, err
	}
	if txs == nil {
		txs = []map[string]any{}
	}
	data["transactions"] = txs

	return map[string]any{
		"version":      1,
		"exported_at":  store.Now(),
		"data":         data,
	}, nil
}

func exportKey(table string) string {
	switch table {
	case "account":
		return "accounts"
	case "model":
		return "models"
	case "provider":
		return "providers"
	case "role":
		return "roles"
	case "account_role":
		return "account_roles"
	case "gift_card":
		return "gift_cards"
	case "settings":
		return "settings"
	case "session_reasoning":
		return "session_reasonings"
	case "usage_bucket":
		return "usage_buckets"
	case "transaction":
		return "transactions"
	}
	return table
}

func (a *App) accountImport(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	payload := c.Obj("data")
	if payload == nil {
		return nil, fmt.Errorf("miss params")
	}
	data := payload["data"]
	dm, _ := data.(map[string]any)
	imported := map[string]any{}

	// Truncate ALL tables first (same as TS).
	for _, t := range importOrder {
		if err := store.Truncate(a.DB, t.table); err != nil {
			return nil, err
		}
	}
	for _, t := range importOrder {
		if dm == nil {
			continue
		}
		items, _ := dm[t.dataKey].([]any)
		if len(items) == 0 {
			continue
		}
		rows := make([]map[string]any, 0, len(items))
		for _, item := range items {
			if m, ok := item.(map[string]any); ok {
				if dt, has := m["delete_time"]; has && dt != nil {
					continue // alive rows only, same as TS importTable
				}
				rows = append(rows, m)
			}
		}
		count, err := store.BatchInsertRows(a.DB, t.table, rows)
		if err != nil {
			return nil, err
		}
		imported[t.dataKey] = count
	}
	return map[string]any{"imported": imported}, nil
}
