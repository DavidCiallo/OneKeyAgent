package api

import (
	"fmt"

	"onekey/server/internal/httpx"
	"onekey/server/internal/service"
	"onekey/server/internal/store"
)

// ─────────────────────────── model controller ───────────────────────────

func (a *App) modelList(c *httpx.Ctx) (any, error) {
	if c.Auth == "" || !validWebToken(c.Auth) {
		return nil, fmt.Errorf("Authorization failed")
	}
	page := c.Int("page")
	if page == 0 {
		page = 1
	}
	var alias *string
	if f := c.Obj("filter"); f != nil {
		if al, ok := f["alias"].(string); ok && al != "" {
			alias = &al
		}
	}
	list, total, err := store.ModelListPage(a.DB, page, alias)
	if err != nil {
		return nil, err
	}
	dtos := make([]map[string]any, 0, len(list))
	for _, m := range list {
		dtos = append(dtos, m.DTO())
	}
	return map[string]any{"list": dtos, "total": total}, nil
}

func validWebToken(token string) bool {
	_, ok := service.GetIdentifyByVerify(token)
	return ok
}

func (a *App) modelDetail(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	m, err := store.ModelFindOne(a.DB, c.Str("id"))
	if err == store.ErrNotFound {
		return nil, fmt.Errorf("model not found")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"model": m.DTO()}, nil
}

func (a *App) modelCreate(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	body := c.Obj("model")
	if body == nil {
		return nil, fmt.Errorf("miss params")
	}
	m, err := store.ModelRestoreOrInsert(a.DB, body)
	if err != nil {
		return nil, err
	}
	return map[string]any{"model": m.DTO()}, nil
}

func (a *App) modelUpdate(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	id := c.Str("id")
	body := c.Obj("model")
	if id == "" || body == nil {
		return nil, fmt.Errorf("miss params")
	}
	if err := store.GenericUpdateByID(a.DB, "model", id, body); err != nil {
		return nil, fmt.Errorf("update failed")
	}
	m, err := store.ModelFindOne(a.DB, id)
	if err == store.ErrNotFound {
		return nil, fmt.Errorf("update failed")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"model": m.DTO()}, nil
}

func (a *App) modelDelete(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	id := c.Str("id")
	if id == "" {
		return nil, fmt.Errorf("Id is required")
	}
	if err := store.GenericSoftDelete(a.DB, "model", id); err != nil {
		return nil, err
	}
	return map[string]any{}, nil
}

// ─────────────────────────── provider controller ───────────────────────────

func (a *App) providerList(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	page := c.Int("page")
	if page == 0 {
		page = 1
	}
	var alias *string
	var enabled *float64
	if f := c.Obj("filter"); f != nil {
		if al, ok := f["model_alias"].(string); ok && al != "" {
			alias = &al
		}
		if en, ok := f["enabled"].(float64); ok {
			enabled = &en
		}
	}
	var enabledInt *int64
	if enabled != nil {
		v := int64(*enabled)
		enabledInt = &v
	}
	list, total, err := store.ProviderListPage(a.DB, page, alias, enabledInt)
	if err != nil {
		return nil, err
	}
	dtos := make([]map[string]any, 0, len(list))
	for _, p := range list {
		dtos = append(dtos, p.DTO())
	}
	return map[string]any{"list": dtos, "total": total}, nil
}

func (a *App) providerDetail(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	p, err := store.ProviderFindOne(a.DB, c.Str("id"), false)
	if err == store.ErrNotFound {
		return nil, fmt.Errorf("provider not found")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"provider": p.DTO()}, nil
}

func (a *App) providerCreate(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	body := c.Obj("provider")
	if body == nil || body["model_alias"] == nil || body["base_url"] == nil || body["model"] == nil || body["priority"] == nil {
		return nil, fmt.Errorf("model_alias, base_url, model and priority are required")
	}
	if _, ok := body["enabled"]; !ok {
		body["enabled"] = 1
	}
	stored, err := store.GenericInsert(a.DB, "provider", body)
	if err != nil || stored == nil {
		return nil, fmt.Errorf("create failed")
	}
	p, err := store.ProviderFindOne(a.DB, stored["id"].(string), false)
	if err != nil {
		return nil, err
	}
	return map[string]any{"provider": p.DTO()}, nil
}

func (a *App) providerUpdate(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	id := c.Str("id")
	body := c.Obj("provider")
	if id == "" || body == nil {
		return nil, fmt.Errorf("id and provider are required")
	}
	if err := store.GenericUpdateByID(a.DB, "provider", id, body); err != nil {
		return nil, fmt.Errorf("update failed")
	}
	p, err := store.ProviderFindOne(a.DB, id, false)
	if err == store.ErrNotFound {
		return nil, fmt.Errorf("update failed")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"provider": p.DTO()}, nil
}

func (a *App) providerUpdatePriority(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	if err := store.ProviderUpdatePriority(a.DB, c.Str("id"), c.Int("delta")); err != nil {
		return nil, err
	}
	return map[string]any{}, nil
}

func (a *App) providerDelete(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	id := c.Str("id")
	if id == "" {
		return nil, fmt.Errorf("Delete wrong")
	}
	if err := store.GenericSoftDelete(a.DB, "provider", id); err != nil {
		return nil, err
	}
	return map[string]any{}, nil
}

func (a *App) providerModelAliases(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	aliases, err := store.ProviderModelAliases(a.DB)
	if err != nil {
		return nil, err
	}
	if aliases == nil {
		aliases = []string{}
	}
	return aliases, nil
}

func (a *App) providerBatchUpdate(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	body := c.Obj("body")
	if body == nil {
		return nil, fmt.Errorf("miss params")
	}
	ids := c.Arr("ids")
	if ids == nil {
		ids = toAnySlice(body["ids"])
	}
	update := map[string]any{}
	for _, k := range []string{"enabled", "proxy_url", "supports_thinking", "supports_reasoning_effort"} {
		if v, ok := body[k]; ok {
			update[k] = v
		}
	}
	for _, idv := range ids {
		id, _ := idv.(string)
		if id == "" {
			continue
		}
		if err := store.GenericUpdateByID(a.DB, "provider", id, update); err != nil {
			return nil, err
		}
	}
	return map[string]any{}, nil
}

func toAnySlice(v any) []any {
	if a, ok := v.([]any); ok {
		return a
	}
	return nil
}

// ─────────────────────────── role controller ───────────────────────────

func (a *App) roleList(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	page := c.Int("page")
	if page == 0 {
		page = 1
	}
	list, total, err := store.RoleListPage(a.DB, page)
	if err != nil {
		return nil, err
	}
	dtos := make([]map[string]any, 0, len(list))
	for _, r := range list {
		dtos = append(dtos, r.DTO())
	}
	return map[string]any{"list": dtos, "total": total}, nil
}

func (a *App) roleDetail(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	r, err := store.RoleFindOne(a.DB, c.Str("id"))
	if err == store.ErrNotFound {
		return nil, fmt.Errorf("role not found")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"role": r.DTO()}, nil
}

func (a *App) roleCreate(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	body := c.Obj("role")
	if body == nil {
		return nil, fmt.Errorf("miss params")
	}
	stored, err := store.GenericInsert(a.DB, "role", body)
	if err != nil || stored == nil {
		return nil, fmt.Errorf("create failed")
	}
	r, err := store.RoleFindOne(a.DB, stored["id"].(string))
	if err != nil {
		return nil, err
	}
	return map[string]any{"role": r.DTO()}, nil
}

func (a *App) roleUpdate(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	id := c.Str("id")
	body := c.Obj("role")
	if id == "" || body == nil {
		return nil, fmt.Errorf("miss params")
	}
	if err := store.GenericUpdateByID(a.DB, "role", id, body); err != nil {
		return nil, fmt.Errorf("update failed")
	}
	r, err := store.RoleFindOne(a.DB, id)
	if err == store.ErrNotFound {
		return nil, fmt.Errorf("update failed")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"role": r.DTO()}, nil
}

func (a *App) roleDelete(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	id := c.Str("id")
	if id == "" {
		return nil, fmt.Errorf("Delete wrong")
	}
	if err := store.GenericSoftDelete(a.DB, "role", id); err != nil {
		return nil, err
	}
	return map[string]any{}, nil
}

func (a *App) roleAssign(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	accountID := c.Str("account_id")
	roles := c.Obj("roles")
	if roles == nil {
		return nil, fmt.Errorf("miss params")
	}
	var perms [][2]string
	for _, p := range roles["permissions"].([]any) {
		if pm, ok := p.(map[string]any); ok {
			name, _ := pm["name"].(string)
			typ, _ := pm["type"].(string)
			perms = append(perms, [2]string{name, typ})
		}
	}
	if err := store.AssignPermissions(a.DB, accountID, perms); err != nil {
		return nil, err
	}
	return map[string]any{}, nil
}

func (a *App) roleAccountRoles(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	roles, err := store.RolesByAccount(a.DB, c.Str("account_id"))
	if err != nil {
		return nil, err
	}
	dtos := make([]map[string]any, 0, len(roles))
	for _, r := range roles {
		dtos = append(dtos, r.DTO())
	}
	return map[string]any{"roles": dtos}, nil
}

// ─────────────────────────── settings controller ───────────────────────────

func (a *App) settingsList(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	entries := []map[string]any{}
	for _, kv := range a.Settings.GetAll() {
		entries = append(entries, map[string]any{"key": kv[0], "value": kv[1]})
	}
	return map[string]any{"entries": entries}, nil
}

func (a *App) settingsSave(c *httpx.Ctx) (any, error) {
	email, ok := service.GetIdentifyByVerify(c.Auth)
	if !ok {
		return nil, fmt.Errorf("Authorization failed")
	}
	account, err := store.AccountFindByEmail(a.DB, email, false)
	if err == store.ErrNotFound || (err == nil && account.IsAdmin == 0) {
		return nil, fmt.Errorf("Admin only")
	}
	if err != nil {
		return nil, err
	}
	entries := c.Arr("entries")
	var pairs [][2]string
	for _, e := range entries {
		if em, ok := e.(map[string]any); ok {
			k, _ := em["key"].(string)
			v, _ := em["value"].(string)
			pairs = append(pairs, [2]string{k, v})
		}
	}
	if err := a.Settings.SetMany(a.DB, pairs); err != nil {
		return nil, err
	}
	return map[string]any{}, nil
}
