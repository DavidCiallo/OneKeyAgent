package api

import (
	"fmt"
	"strings"

	"onekey/server/internal/cryptox"
	"onekey/server/internal/httpx"
	"onekey/server/internal/service"
	"onekey/server/internal/store"
)

// ─────────────────────────── auth controller ───────────────────────────

func (a *App) authLogin(c *httpx.Ctx) (any, error) {
	identify := c.Obj("identify")
	if identify == nil {
		return nil, fmt.Errorf("Authorized failed")
	}
	email, _ := identify["email"].(string)
	password, _ := identify["password"].(string)
	result, err := service.Login(a.DB, email, password)
	if err != nil {
		return nil, err
	}
	if result == nil {
		return nil, fmt.Errorf("Invalid email or password")
	}
	return result, nil
}

func (a *App) authAlive(c *httpx.Ctx) (any, error) {
	email, ok := service.GetIdentifyByVerify(c.Auth)
	if !ok {
		return nil, fmt.Errorf("Unauthorized")
	}
	account, err := store.AccountFindByEmail(a.DB, email, false)
	if err == store.ErrNotFound {
		return map[string]any{"is_admin": 0, "roles": []any{}}, nil
	}
	if err != nil {
		return nil, err
	}
	roles, err := store.RolesByAccount(a.DB, account.ID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"is_admin": account.IsAdmin,
		"roles":    service.RolesValue(account.IsAdmin, roles),
	}, nil
}

func (a *App) authConfig(c *httpx.Ctx) (any, error) {
	domains := a.Settings.Get("allowed_register_domains")
	var allowed []string
	if domains != "" {
		for _, d := range strings.Split(domains, ",") {
			if t := strings.TrimSpace(d); t != "" {
				allowed = append(allowed, t)
			}
		}
	}
	enableRecharge := a.Settings.Get("enable_recharge") != "false"
	return map[string]any{
		"allowed_domains": allowed,
		"enable_recharge": enableRecharge,
	}, nil
}

func (a *App) authRegister(c *httpx.Ctx) (any, error) {
	identify := c.Obj("identify")
	if identify == nil {
		return nil, fmt.Errorf("Register data is missing")
	}
	name, _ := identify["name"].(string)
	email, _ := identify["email"].(string)
	password, _ := identify["password"].(string)
	if name == "" || email == "" || password == "" {
		return nil, fmt.Errorf("Name, email and password are required")
	}
	ok, err := service.PreRegister(a.Settings, a.DB, name, email, password)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, fmt.Errorf("Registration failed, email may already exist")
	}
	return map[string]any{"token": "", "needs_verification": true}, nil
}

func (a *App) authVerify(c *httpx.Ctx) (any, error) {
	token := c.Str("token")
	if token == "" {
		return nil, fmt.Errorf("Verification token is required")
	}
	account, _, err := service.CompleteRegistration(a.Settings, a.DB, token)
	if err != nil {
		return nil, err
	}
	if account == nil {
		return nil, fmt.Errorf("Invalid or expired verification link, or email already registered")
	}
	return map[string]any{}, nil
}

func (a *App) authDaily(c *httpx.Ctx) (any, error) {
	email, ok := service.GetIdentifyByVerify(c.Auth)
	if !ok {
		return nil, fmt.Errorf("Authorization failed")
	}
	account, err := store.AccountFindByEmail(a.DB, email, false)
	if err == store.ErrNotFound {
		return nil, fmt.Errorf("Account not found")
	}
	if err != nil {
		return nil, err
	}
	amount, err := service.ClaimDailyBonus(a.Settings, a.DB, account.ID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"amount": amount}, nil
}

// ─────────────────────────── account controller ───────────────────────────

func (a *App) accountList(c *httpx.Ctx) (any, error) {
	page := c.Int("page")
	if page == 0 {
		page = 1
	}
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	var nameFilter, emailFilter *string
	if f := c.Obj("filter"); f != nil {
		if n, ok := f["name"].(string); ok && n != "" {
			nameFilter = &n
		}
		if e, ok := f["email"].(string); ok && e != "" {
			emailFilter = &e
		}
	}
	list, total, err := store.AccountListPage(a.DB, page, nameFilter, emailFilter)
	if err != nil {
		return nil, err
	}
	dtos := make([]map[string]any, 0, len(list))
	for _, item := range list {
		dtos = append(dtos, item.DTO())
	}
	return map[string]any{"list": dtos, "total": total}, nil
}

func (a *App) accountDetail(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	id := c.Str("id")
	data, err := store.AccountFindOne(a.DB, id)
	if err == store.ErrNotFound {
		return nil, fmt.Errorf("account not found")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"account": data.DTO()}, nil
}

func (a *App) accountCreate(c *httpx.Ctx) (any, error) {
	account := c.Obj("account")
	if account == nil {
		return nil, fmt.Errorf("miss params")
	}
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	name, _ := account["name"].(string)
	email, _ := account["email"].(string)
	password, _ := account["password"].(string)
	isAdmin := 0.0
	if v, ok := account["is_admin"].(float64); ok {
		isAdmin = v
	}
	stored, err := store.GenericInsert(a.DB, "account", map[string]any{
		"name": name, "email": email,
		"password": cryptox.HashGenerate(password),
		"api_key":  cryptox.GenerateApiKey(),
		"is_admin": isAdmin, "balance": 0.0,
	})
	if err != nil {
		return nil, fmt.Errorf("create failed")
	}
	created, err := store.AccountFindOne(a.DB, stored["id"].(string))
	if err != nil {
		return nil, err
	}
	return map[string]any{"account": created.DTO()}, nil
}

func (a *App) accountUpdate(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	id := c.Str("id")
	account := c.Obj("account")
	if email, ok := account["email"].(string); ok && email != "" {
		existing, err := store.AccountFindByEmail(a.DB, email, true)
		if err == nil && existing.ID != id {
			return nil, fmt.Errorf("email already exists")
		}
		if err != nil && err != store.ErrNotFound {
			return nil, err
		}
	}
	if err := store.GenericUpdateByID(a.DB, "account", id, account); err != nil {
		return nil, fmt.Errorf("update failed")
	}
	data, err := store.AccountFindOne(a.DB, id)
	if err == store.ErrNotFound {
		return nil, fmt.Errorf("update failed")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"account": data.DTO()}, nil
}

func (a *App) accountDelete(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	id := c.Str("id")
	if id == "" {
		return nil, fmt.Errorf("Delete wrong")
	}
	if err := store.GenericSoftDelete(a.DB, "account", id); err != nil {
		return nil, err
	}
	return map[string]any{}, nil
}

func (a *App) accountProfile(c *httpx.Ctx) (any, error) {
	email, ok := service.GetIdentifyByVerify(c.Auth)
	if !ok {
		return nil, fmt.Errorf("Unauthorized")
	}
	account, err := store.AccountFindByEmail(a.DB, email, false)
	if err == store.ErrNotFound {
		return nil, fmt.Errorf("Account not found")
	}
	if err != nil {
		return nil, err
	}
	since := store.Now() - 7*86_400_000
	gran := "1m"
	weeklyUsage, err := store.BucketSumCost(a.DB, account.ID, &gran, since, true)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"account":     account.DTO(),
		"weeklyUsage": store.Round6(weeklyUsage),
		"balance":     account.Balance,
	}, nil
}

func (a *App) accountRegenerate(c *httpx.Ctx) (any, error) {
	email, ok := service.GetIdentifyByVerify(c.Auth)
	if !ok {
		return nil, fmt.Errorf("Unauthorized")
	}
	account, err := store.AccountFindByEmail(a.DB, email, false)
	if err == store.ErrNotFound {
		return nil, fmt.Errorf("Account not found")
	}
	if err != nil {
		return nil, err
	}
	newKey := cryptox.GenerateApiKey()
	if err := store.GenericUpdateByID(a.DB, "account", account.ID, map[string]any{"api_key": newKey}); err != nil {
		return nil, err
	}
	return map[string]any{"api_key": newKey}, nil
}
