// Package service — settings cache, auth tokens, billing, email.
package service

import (
	"database/sql"
	"fmt"
	"math/rand"
	"net/url"
	"strings"
	"sync"
	"time"

	"onekey/server/internal/cryptox"
	"onekey/server/internal/store"
)

// ─────────────────────────── Settings ───────────────────────────

// settingKeys: key → env fallback (settings.service.ts).
var settingKeys = [][2]string{
	{"nowpayments_api_key", "NOWPAYMENTS_API_KEY"},
	{"ipn_secret", "IPN_SECRET"},
	{"ipn_callback_url", "IPN_CALLBACK_URL"},
	{"resend_api_key", "RESEND_API_KEY"},
	{"email_from", "EMAIL_FROM"},
	{"allowed_register_domains", "ALLOWED_REGISTER_DOMAINS"},
	{"client_url", "CLIENT_URL"},
	{"enable_recharge", "ENABLE_RECHARGE"},
	{"daily_register_limit", "DAILY_REGISTER_LIMIT"},
	{"fallback_model_alias", "FALLBACK_MODEL_ALIAS"},
}

var settingDefaults = map[string]string{
	"enable_recharge":       "true",
	"daily_register_limit":  "5",
	"fallback_model_alias":  "",
}

type Settings struct {
	mu   sync.RWMutex
	data map[string]string
}

func NewSettings() *Settings {
	return &Settings{data: map[string]string{}}
}

func (s *Settings) LoadFromDb(db *sql.DB) error {
	rows, err := store.SettingsAll(db)
	if err != nil {
		return err
	}
	for k, v := range rows {
		s.mu.Lock()
		s.data[k] = v
		s.mu.Unlock()
	}
	for _, kv := range settingKeys {
		s.mu.Lock()
		if _, ok := s.data[kv[0]]; !ok {
			if v, ok := osLookupEnv(kv[1]); ok {
				s.data[kv[0]] = v
			}
		}
		s.mu.Unlock()
	}
	return nil
}

func (s *Settings) Get(key string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if v, ok := s.data[key]; ok {
		return v
	}
	return settingDefaults[key]
}

func (s *Settings) Set(key, value string) {
	s.mu.Lock()
	s.data[key] = value
	s.mu.Unlock()
}

func (s *Settings) GetAll() [][2]string {
	out := make([][2]string, 0, len(settingKeys))
	for _, kv := range settingKeys {
		out = append(out, [2]string{kv[0], s.Get(kv[0])})
	}
	return out
}

func (s *Settings) SetMany(db *sql.DB, entries [][2]string) error {
	for _, kv := range entries {
		known := false
		for _, k := range settingKeys {
			if k[0] == kv[0] {
				known = true
				break
			}
		}
		if !known {
			continue
		}
		if err := store.SettingsSet(db, kv[0], kv[1]); err != nil {
			return err
		}
		s.Set(kv[0], kv[1])
	}
	return nil
}

// ─────────────────────────── Auth tokens / login / register ───────────────────────────

const WeeklyLimit = 100.0 // $100 per week
var allMenus = []string{"profile", "model", "usage", "account"}

func GenLoginToken(identity string) string {
	exp := store.Now() + 1000*60*60*24*3 // 3 days
	return cryptox.AesEncrypt(fmt.Sprintf("%s|-|%d", identity, exp))
}

func GetIdentifyByVerify(token string) (string, bool) {
	dt, ok := cryptox.AesDecrypt(token)
	if !ok {
		return "", false
	}
	parts := strings.SplitN(dt, "|-|", 2)
	if len(parts) != 2 {
		return "", false
	}
	var exp int64
	if _, err := fmt.Sscanf(parts[1], "%d", &exp); err != nil {
		return "", false
	}
	if store.Now() > exp {
		return "", false
	}
	return parts[0], true
}

// Account is re-declared here to avoid an import cycle note; handlers use it.
type Roles = [][2]string // name, type

func Login(db *sql.DB, email, password string) (map[string]any, error) {
	hash := cryptox.HashGenerate(password)
	account, err := store.AccountFindByLogin(db, email, hash)
	if err == store.ErrNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	roles, err := store.RolesByAccount(db, account.ID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"token":    GenLoginToken(account.Email),
		"is_admin": account.IsAdmin,
		"roles":    RolesValue(account.IsAdmin, roles),
	}, nil
}

// RolesValue — admin sees all menus; users see their assigned roles.
func RolesValue(isAdmin int64, roles []*store.Role) []map[string]any {
	if isAdmin != 0 {
		out := make([]map[string]any, 0, len(allMenus))
		for _, m := range allMenus {
			out = append(out, map[string]any{"name": m, "type": "menu"})
		}
		return out
	}
	out := make([]map[string]any, 0, len(roles))
	for _, r := range roles {
		out = append(out, map[string]any{"name": r.Name, "type": r.Type})
	}
	return out
}

// RequireAdmin — resolve web token to an admin account or fail.
func RequireAdmin(db *sql.DB, auth string) (*store.Account, error) {
	if auth == "" {
		return nil, fmt.Errorf("Authorization failed")
	}
	email, ok := GetIdentifyByVerify(auth)
	if !ok {
		return nil, fmt.Errorf("Authorization failed")
	}
	account, err := store.AccountFindByEmail(db, email, false)
	if err == store.ErrNotFound {
		return nil, fmt.Errorf("Authorization failed")
	}
	if err != nil {
		return nil, err
	}
	if account.IsAdmin == 0 {
		return nil, fmt.Errorf("Permission denied")
	}
	return account, nil
}

// AccountByAuth — resolve a web token to its account.
func AccountByAuth(db *sql.DB, auth string) (*store.Account, error) {
	if auth == "" {
		return nil, fmt.Errorf("Authorization failed")
	}
	email, ok := GetIdentifyByVerify(auth)
	if !ok {
		return nil, fmt.Errorf("Authorization failed")
	}
	account, err := store.AccountFindByEmail(db, email, false)
	if err == store.ErrNotFound {
		return nil, fmt.Errorf("Account not found")
	}
	if err != nil {
		return nil, err
	}
	return account, nil
}

func checkAllowedDomain(s *Settings, email string) error {
	allowed := s.Get("allowed_register_domains")
	if allowed == "" {
		return nil
	}
	at := strings.LastIndex(email, "@")
	if at < 0 {
		return fmt.Errorf("Invalid email format")
	}
	domain := strings.ToLower(email[at+1:])
	for _, d := range strings.Split(allowed, ",") {
		if strings.ToLower(strings.TrimSpace(d)) == domain {
			return nil
		}
	}
	var domains []string
	for _, d := range strings.Split(allowed, ",") {
		domains = append(domains, strings.ToLower(strings.TrimSpace(d)))
	}
	return fmt.Errorf("Registration is limited to %s email addresses", strings.Join(domains, ", "))
}

// PreRegister — step 1: checks + verification email; no account created yet.
func PreRegister(s *Settings, db *sql.DB, name, email, password string) (bool, error) {
	if err := checkAllowedDomain(s, email); err != nil {
		return false, err
	}
	if _, err := store.AccountFindByEmail(db, email, true); err == nil {
		return false, nil // already exists
	} else if err != store.ErrNotFound {
		return false, err
	}
	payload := strings.Join([]string{name, email, password}, "|-|")
	token := cryptox.AesEncrypt(payload)
	verifyURL := fmt.Sprintf("%s/verify?token=%s", s.Get("client_url"), url.QueryEscape(token))
	sent := SendVerificationEmail(s, email, verifyURL)
	if !sent {
		fmt.Println("Failed to send verification email to:", email)
		return false, nil
	}
	return true, nil
}

// CompleteRegistration — step 2: decrypt emailed token, create account + bonus.
func CompleteRegistration(s *Settings, db *sql.DB, token string) (*store.Account, string, error) {
	decrypted, ok := cryptox.AesDecrypt(token)
	if !ok {
		return nil, "", fmt.Errorf("invalid token")
	}
	parts := strings.Split(decrypted, "|-|")
	if len(parts) < 3 {
		return nil, "", fmt.Errorf("invalid token")
	}
	name, email, plainPassword := parts[0], parts[1], parts[2]
	if _, err := store.AccountFindByEmail(db, email, true); err == nil {
		return nil, "", fmt.Errorf("invalid token")
	} else if err != store.ErrNotFound {
		return nil, "", err
	}
	limit := parseIntDefault(s.Get("daily_register_limit"), 0)
	if limit > 0 {
		count, err := store.CountAccountSince(db, store.LocalMidnight(store.Now()))
		if err != nil {
			return nil, "", err
		}
		if count >= int64(limit) {
			return nil, "", fmt.Errorf("Daily registration limit reached, please try again tomorrow")
		}
	}
	stored, err := store.GenericInsert(db, "account", map[string]any{
		"name": name, "email": email,
		"password": cryptox.HashGenerate(plainPassword),
		"api_key":  cryptox.GenerateApiKey(),
		"is_admin": 0, "balance": 0.0,
	})
	if err != nil {
		return nil, "", err
	}
	id := stored["id"].(string)
	if err := store.AssignPermissions(db, id, [][2]string{
		{"usage", "menu"}, {"profile", "menu"}, {"subscription", "menu"},
	}); err != nil {
		return nil, "", err
	}
	// Registration bonus: +1 via a redeemed card record (same bookkeeping as TS).
	now := store.Now()
	if _, err := store.GenericInsert(db, "gift_card", map[string]any{
		"code": fmt.Sprintf("register_%s_%d", id, now),
		"token_amount": 1.0, "status": "redeemed",
		"redeemed_by": id, "redeemed_at": now,
	}); err != nil {
		return nil, "", err
	}
	if err := store.AccountAddBalance(db, id, 1.0); err != nil {
		return nil, "", err
	}
	account, err := store.AccountFindOne(db, id)
	if err != nil {
		return nil, "", err
	}
	return account, account.ApiKey, nil
}

// ClaimDailyBonus — daily sign-in (claimDailyBonus).
func ClaimDailyBonus(s *Settings, db *sql.DB, accountID string) (float64, error) {
	now := store.Now()
	account, err := store.AccountFindOne(db, accountID)
	if err == store.ErrNotFound {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if account.LastDailyTime != nil && sameLocalDate(*account.LastDailyTime, now) {
		return 0, nil
	}
	if _, err := db.Exec("UPDATE account SET last_daily_time = ?, update_time = ? WHERE id = ?", now, now, accountID); err != nil {
		return 0, err
	}
	cards, err := store.CardRedeemedBy(db, accountID)
	if err != nil {
		return 0, err
	}
	manualTotal := 0.0
	for _, c := range cards {
		if strings.HasPrefix(c.Code, "daily_") || strings.HasPrefix(c.Code, "register_") {
			continue
		}
		manualTotal += c.TokenAmount
	}
	amount := 0.1
	if manualTotal > 0 && account.Balance > 0 {
		ratio := manualTotal / account.Balance
		if ratio > 0.15 {
			amount *= 0.25 + rand.Float64()*0.2
		} else {
			amount *= 0.85 + rand.Float64()*0.1
		}
		amount = float64(int64(amount*100+0.5)) / 100
	}
	if _, err := store.GenericInsert(db, "gift_card", map[string]any{
		"code": fmt.Sprintf("daily_%s_%d", accountID, now),
		"token_amount": amount, "status": "redeemed",
		"redeemed_by": accountID, "redeemed_at": now,
	}); err != nil {
		return 0, err
	}
	if err := store.AccountAddBalance(db, accountID, amount); err != nil {
		return 0, err
	}
	return amount, nil
}

func sameLocalDate(a, b int64) bool {
	da, dbb := time.UnixMilli(a).In(time.Local), time.UnixMilli(b).In(time.Local)
	y1, m1, d1 := da.Date()
	y2, m2, d2 := dbb.Date()
	return y1 == y2 && m1 == m2 && d1 == d2
}

func parseIntDefault(s string, def int) int {
	if s == "" {
		return def
	}
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return def
		}
		n = n*10 + int(c-'0')
	}
	return n
}
