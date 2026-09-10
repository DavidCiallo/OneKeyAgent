package store

import (
	"database/sql"
	"errors"
	"fmt"
	"math/rand"
	"strings"

	"onekey/server/internal/cryptox"
)

// ─────────────────────────── Model ───────────────────────────

const modelCols = "id,alias,input_price,cache_price,output_price,is_public,create_time,update_time,delete_time"

type Model struct {
	ID          string  `json:"id"`
	Alias       string  `json:"alias"`
	InputPrice  float64 `json:"input_price"`
	CachePrice  float64 `json:"cache_price"`
	OutputPrice float64 `json:"output_price"`
	IsPublic    int64   `json:"is_public"`
	CreateTime  int64   `json:"create_time"`
	UpdateTime  *int64  `json:"update_time"`
	DeleteTime  *int64  `json:"delete_time"`
}

func scanModel(row interface{ Scan(...any) error }) (*Model, error) {
	m := &Model{}
	err := row.Scan(&m.ID, &m.Alias, &m.InputPrice, &m.CachePrice, &m.OutputPrice, &m.IsPublic, &m.CreateTime, &m.UpdateTime, &m.DeleteTime)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return m, nil
}

func (m *Model) DTO() map[string]any {
	return map[string]any{
		"id": m.ID, "alias": m.Alias, "input_price": m.InputPrice, "cache_price": m.CachePrice,
		"output_price": m.OutputPrice, "is_public": m.IsPublic, "create_time": m.CreateTime,
		"update_time": m.UpdateTime, "delete_time": m.DeleteTime,
	}
}

func ModelAllActive(db *sql.DB) ([]*Model, error) {
	rows, err := db.Query("SELECT " + modelCols + " FROM model WHERE delete_time IS NULL")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Model
	for rows.Next() {
		m, err := scanModel(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func ModelFindOne(db *sql.DB, id string) (*Model, error) {
	return scanModel(db.QueryRow("SELECT "+modelCols+" FROM model WHERE id = ? AND delete_time IS NULL", id))
}

// ModelFindByAliasIgnoreDelete — findIgnoreDelete({ alias }), latest row.
func ModelFindByAliasIgnoreDelete(db *sql.DB, alias string) (*Model, error) {
	return scanModel(db.QueryRow("SELECT "+modelCols+" FROM model WHERE alias = ? ORDER BY rowid DESC LIMIT 1", alias))
}

func ModelListPage(db *sql.DB, page int64, alias *string) ([]*Model, int64, error) {
	cond := "delete_time IS NULL"
	args := []any{}
	if alias != nil && *alias != "" {
		cond = "delete_time IS NULL AND alias = ?"
		args = append(args, *alias)
	}
	all, err := ModelWhere(db, cond, args)
	if err != nil {
		return nil, 0, err
	}
	total := int64(len(all))
	start := (page - 1) * 10
	if start < 0 {
		start = 0
	}
	if start > total {
		start = total
	}
	end := start + 10
	if end > total {
		end = total
	}
	return all[start:end], total, nil
}

func ModelWhere(db *sql.DB, cond string, args []any) ([]*Model, error) {
	rows, err := db.Query("SELECT "+modelCols+" FROM model WHERE "+cond, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Model
	for rows.Next() {
		m, err := scanModel(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	// TS: list.sort((a, b) => a.alias.localeCompare(b.alias))
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].Alias < out[j-1].Alias; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out, rows.Err()
}

// ─────────────────────────── Provider ───────────────────────────

const providerCols = "id,model_alias,priority,name,base_url,model,api_key,auth_type,api_type,proxy_url,supports_thinking,supports_reasoning_effort,replay_reasoning,enable_search,extra_json,enabled,create_time,update_time,delete_time"

type Provider struct {
	ID                     string  `json:"id"`
	ModelAlias             string  `json:"model_alias"`
	Priority               int64   `json:"priority"`
	Name                   string  `json:"name"`
	BaseURL                string  `json:"base_url"`
	Model                  string  `json:"model"`
	ApiKey                 *string `json:"api_key"`
	AuthType               *string `json:"auth_type"`
	ApiType                *string `json:"api_type"`
	ProxyURL               *string `json:"proxy_url"`
	SupportsThinking       *int64  `json:"supports_thinking"`
	SupportsReasoningEffort *int64 `json:"supports_reasoning_effort"`
	ReplayReasoning        *int64  `json:"replay_reasoning"`
	EnableSearch           *int64  `json:"enable_search"`
	ExtraJSON              *string `json:"extra_json"`
	Enabled                int64   `json:"enabled"`
	CreateTime             int64   `json:"create_time"`
	UpdateTime             *int64  `json:"update_time"`
	DeleteTime             *int64  `json:"delete_time"`
}

func scanProvider(row interface{ Scan(...any) error }) (*Provider, error) {
	p := &Provider{}
	err := row.Scan(&p.ID, &p.ModelAlias, &p.Priority, &p.Name, &p.BaseURL, &p.Model,
		&p.ApiKey, &p.AuthType, &p.ApiType, &p.ProxyURL,
		&p.SupportsThinking, &p.SupportsReasoningEffort, &p.ReplayReasoning, &p.EnableSearch,
		&p.ExtraJSON, &p.Enabled, &p.CreateTime, &p.UpdateTime, &p.DeleteTime)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return p, nil
}

func (p *Provider) DTO() map[string]any {
	return map[string]any{
		"id": p.ID, "model_alias": p.ModelAlias, "priority": p.Priority, "name": p.Name,
		"base_url": p.BaseURL, "model": p.Model, "api_key": p.ApiKey, "auth_type": p.AuthType,
		"api_type": p.ApiType, "proxy_url": p.ProxyURL, "supports_thinking": p.SupportsThinking,
		"supports_reasoning_effort": p.SupportsReasoningEffort, "replay_reasoning": p.ReplayReasoning,
		"enable_search": p.EnableSearch, "extra_json": p.ExtraJSON, "enabled": p.Enabled, "create_time": p.CreateTime,
		"update_time": p.UpdateTime, "delete_time": p.DeleteTime,
	}
}

func ProviderFindOne(db *sql.DB, id string, ignoreDelete bool) (*Provider, error) {
	q := "SELECT " + providerCols + " FROM provider WHERE id = ?"
	if !ignoreDelete {
		q += " AND delete_time IS NULL"
	}
	return scanProvider(db.QueryRow(q, id))
}

func ProviderAllIgnoreDelete(db *sql.DB) ([]*Provider, error) {
	rows, err := db.Query("SELECT " + providerCols + " FROM provider")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Provider
	for rows.Next() {
		p, err := scanProvider(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func ProviderListPage(db *sql.DB, page int64, alias *string, enabled *int64) ([]*Provider, int64, error) {
	conds := []string{"1=1"}
	args := []any{}
	if alias != nil {
		conds = append(conds, "model_alias = ?")
		args = append(args, *alias)
	}
	if enabled != nil {
		conds = append(conds, "enabled = ?")
		args = append(args, *enabled)
	}
	all, err := ProviderWhere(db, strings.Join(conds, " AND "), args)
	if err != nil {
		return nil, 0, err
	}
	total := int64(len(all))
	start := (page - 1) * 10
	if start < 0 {
		start = 0
	}
	if start > total {
		start = total
	}
	end := start + 10
	if end > total {
		end = total
	}
	return all[start:end], total, nil
}

// ProviderWhere — rows matching cond, ordered by model_alias ASC then priority
// ASC, so providers sharing an alias come back in failover order (lower
// priority value is tried first) while the admin list stays grouped by alias.
func ProviderWhere(db *sql.DB, cond string, args []any) ([]*Provider, error) {
	rows, err := db.Query("SELECT "+providerCols+" FROM provider WHERE "+cond, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Provider
	for rows.Next() {
		p, err := scanProvider(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && providerLess(out[j], out[j-1]); j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out, rows.Err()
}

// providerLess — model_alias ASC, then priority ASC.
func providerLess(a, b *Provider) bool {
	if a.ModelAlias != b.ModelAlias {
		return a.ModelAlias < b.ModelAlias
	}
	return a.Priority < b.Priority
}

// ProviderGetByAlias — enabled providers for an alias, priority ASC with a
// random tiebreak inside equal-priority groups (mirrors the TS sort).
func ProviderGetByAlias(db *sql.DB, alias string) ([]*Provider, error) {
	list, err := ProviderWhere(db, "model_alias = ? AND enabled = 1 AND delete_time IS NULL", []any{alias})
	if err != nil {
		return nil, err
	}
	// Group shuffle: equal priorities are adjacent thanks to providerLess, so
	// peers at the same priority rotate instead of the first row always winning.
	for i := 0; i < len(list); {
		j := i + 1
		for j < len(list) && list[j].Priority == list[i].Priority {
			j++
		}
		g := list[i:j]
		rand.Shuffle(len(g), func(a, b int) { g[a], g[b] = g[b], g[a] })
		i = j
	}
	return list, nil
}

func ProviderModelAliases(db *sql.DB) ([]string, error) {
	all, err := ProviderAllIgnoreDelete(db)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var out []string
	for _, p := range all {
		if p.ModelAlias == "" || seen[p.ModelAlias] {
			continue
		}
		seen[p.ModelAlias] = true
		out = append(out, p.ModelAlias)
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j] < out[j-1]; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out, nil
}

func ProviderUpdatePriority(db *sql.DB, id string, delta int64) error {
	p, err := ProviderFindOne(db, id, false)
	if errors.Is(err, ErrNotFound) {
		return fmt.Errorf("Provider not found")
	}
	if err != nil {
		return err
	}
	np := p.Priority + delta
	if np < 1 {
		np = 1
	}
	_, err = db.Exec("UPDATE provider SET priority = ?, update_time = ? WHERE id = ?", np, Now(), id)
	return err
}

// ─────────────────────────── Role / AccountRole ───────────────────────────

const roleCols = "id,name,type,create_time,update_time,delete_time"

type Role struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	CreateTime int64 `json:"create_time"`
	UpdateTime *int64 `json:"update_time"`
	DeleteTime *int64 `json:"delete_time"`
}

func scanRole(row interface{ Scan(...any) error }) (*Role, error) {
	r := &Role{}
	err := row.Scan(&r.ID, &r.Name, &r.Type, &r.CreateTime, &r.UpdateTime, &r.DeleteTime)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return r, nil
}

func (r *Role) DTO() map[string]any {
	return map[string]any{
		"id": r.ID, "name": r.Name, "type": r.Type, "create_time": r.CreateTime,
		"update_time": r.UpdateTime, "delete_time": r.DeleteTime,
	}
}

func RoleListPage(db *sql.DB, page int64) ([]*Role, int64, error) {
	offset := (page - 1) * 10
	if offset < 0 {
		offset = 0
	}
	rows, err := db.Query("SELECT "+roleCols+" FROM role WHERE delete_time IS NULL ORDER BY rowid DESC LIMIT 10 OFFSET ?", offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var list []*Role
	for rows.Next() {
		r, err := scanRole(rows)
		if err != nil {
			return nil, 0, err
		}
		list = append(list, r)
	}
	var total int64
	if err := db.QueryRow("SELECT COUNT(*) FROM role WHERE delete_time IS NULL").Scan(&total); err != nil {
		return nil, 0, err
	}
	return list, total, nil
}

func RoleFindOne(db *sql.DB, id string) (*Role, error) {
	return scanRole(db.QueryRow("SELECT "+roleCols+" FROM role WHERE id = ? AND delete_time IS NULL", id))
}

func RoleFindOrCreate(db *sql.DB, name, typ string) (string, error) {
	r, err := scanRole(db.QueryRow(
		"SELECT "+roleCols+" FROM role WHERE name = ? AND type = ? ORDER BY rowid DESC LIMIT 1", name, typ))
	if errors.Is(err, ErrNotFound) {
		stored, ierr := GenericInsert(db, "role", map[string]any{"name": name, "type": typ})
		if ierr != nil {
			return "", ierr
		}
		return stored["id"].(string), nil
	}
	if err != nil {
		return "", err
	}
	return r.ID, nil
}

func RolesByAccount(db *sql.DB, accountID string) ([]*Role, error) {
	rows, err := db.Query(
		"SELECT r.id, r.name, r.type, r.create_time, r.update_time, r.delete_time FROM role r "+
			"INNER JOIN account_role ar ON ar.role_id = r.id "+
			"WHERE ar.account_id = ? AND ar.delete_time IS NULL AND r.delete_time IS NULL", accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Role
	for rows.Next() {
		r := &Role{}
		if err := rows.Scan(&r.ID, &r.Name, &r.Type, &r.CreateTime, &r.UpdateTime, &r.DeleteTime); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// AssignPermissions — replace the account's role assignments.
func AssignPermissions(db *sql.DB, accountID string, perms [][2]string) error {
	if _, err := db.Exec("DELETE FROM account_role WHERE account_id = ?", accountID); err != nil {
		return err
	}
	for _, p := range perms {
		roleID, err := RoleFindOrCreate(db, p[0], p[1])
		if err != nil {
			return err
		}
		if _, err := GenericInsert(db, "account_role", map[string]any{
			"account_id": accountID, "role_id": roleID,
		}); err != nil {
			return err
		}
	}
	return nil
}

// ─────────────────────────── Settings ───────────────────────────

func SettingsAll(db *sql.DB) (map[string]string, error) {
	rows, err := db.Query("SELECT key, value FROM settings")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

func SettingsSet(db *sql.DB, key, value string) error {
	exists := false
	_ = db.QueryRow("SELECT 1 FROM settings WHERE key = ?", key).Scan(&exists)
	if exists {
		_, err := db.Exec("UPDATE settings SET value = ?, update_time = ? WHERE key = ?", value, Now(), key)
		return err
	}
	_, err := db.Exec(
		"INSERT INTO settings (id, key, value, create_time, update_time, delete_time) VALUES (?, ?, ?, ?, ?, NULL)",
		cryptox.Nanoid(6), key, value, Now(), Now())
	return err
}

// ProxyStr / ApiTypeStr — nil-safe accessors used by the AI proxy.
func (p *Provider) ProxyStr() string {
	if p.ProxyURL == nil {
		return ""
	}
	return *p.ProxyURL
}

func (p *Provider) ApiTypeStr() string {
	if p.ApiType == nil {
		return ""
	}
	return *p.ApiType
}

func (p *Provider) AuthTypeStr() string {
	if p.AuthType == nil {
		return ""
	}
	return *p.AuthType
}

func (p *Provider) ApiKeyStr() string {
	if p.ApiKey == nil {
		return ""
	}
	return *p.ApiKey
}

// ExtraJSONStr — nil-safe accessor.
func (p *Provider) ExtraJSONStr() string {
	if p.ExtraJSON == nil {
		return ""
	}
	return *p.ExtraJSON
}

// ModelRestoreOrInsert — create, or revive a soft-deleted row with the same
// alias (model.service.ts create).
func ModelRestoreOrInsert(db *sql.DB, data map[string]any) (*Model, error) {
	alias, _ := data["alias"].(string)
	if alias != "" {
		existing, err := ModelFindByAliasIgnoreDelete(db, alias)
		if err == nil && existing != nil && existing.DeleteTime != nil {
			data["id"] = existing.ID
			if err := GenericUpdateByID(db, "model", existing.ID, data); err != nil {
				return nil, err
			}
			return ModelFindOne(db, existing.ID)
		}
		if err != nil && err != ErrNotFound {
			return nil, err
		}
	}
	stored, err := GenericInsert(db, "model", data)
	if err != nil {
		return nil, err
	}
	id, _ := stored["id"].(string)
	return ModelFindOne(db, id)
}
