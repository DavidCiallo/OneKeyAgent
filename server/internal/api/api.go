// Package api — HTTP handlers + router, one handler per TS controller export.
package api

import (
	"database/sql"
	"net/http"
	"path/filepath"

	"onekey/server/internal/ai"
	"onekey/server/internal/httpx"
	"onekey/server/internal/service"
)

type App struct {
	DB       *sql.DB
	Settings *service.Settings
	AI       *ai.Server
	staticDir string
}

func NewApp(db *sql.DB, settings *service.Settings, staticDir string) *App {
	return &App{
		DB:        db,
		Settings:  settings,
		AI:        ai.NewServer(db, settings),
		staticDir: staticDir,
	}
}

// Routes — exact-path mux; any HTTP method is accepted (mounthttp behavior).
func (a *App) Routes() *http.ServeMux {
	mux := http.NewServeMux()
	type route struct {
		path    string
		handler http.HandlerFunc
	}
	routes := []route{
		// auth
		{"/api/auth/login", a.wrap(a.authLogin)},
		{"/api/auth/alive", a.wrap(a.authAlive)},
		{"/api/auth/register", a.wrap(a.authRegister)},
		{"/api/auth/config", a.wrap(a.authConfig)},
		{"/api/auth/verify", a.wrap(a.authVerify)},
		{"/api/auth/daily", a.wrap(a.authDaily)},
		// ai (raw routes)
		{"/api/chat/completions", a.wrap(a.aiChatCompletions)},
		{"/api/completions", a.wrap(a.aiCompletions)},
		{"/api/models", a.wrap(a.aiModels)},
		{"/api/v1/messages", a.wrap(a.aiV1Messages)},
		// account
		{"/api/account/list", a.wrap(a.accountList)},
		{"/api/account/detail", a.wrap(a.accountDetail)},
		{"/api/account/create", a.wrap(a.accountCreate)},
		{"/api/account/update", a.wrap(a.accountUpdate)},
		{"/api/account/delete", a.wrap(a.accountDelete)},
		{"/api/account/profile", a.wrap(a.accountProfile)},
		{"/api/account/regenerate", a.wrap(a.accountRegenerate)},
		{"/api/account/export", a.wrap(a.accountExport)},
		{"/api/account/import", a.wrap(a.accountImport)},
		// model
		{"/api/model/list", a.wrap(a.modelList)},
		{"/api/model/detail", a.wrap(a.modelDetail)},
		{"/api/model/create", a.wrap(a.modelCreate)},
		{"/api/model/update", a.wrap(a.modelUpdate)},
		{"/api/model/delete", a.wrap(a.modelDelete)},
		// provider
		{"/api/provider/list", a.wrap(a.providerList)},
		{"/api/provider/detail", a.wrap(a.providerDetail)},
		{"/api/provider/create", a.wrap(a.providerCreate)},
		{"/api/provider/update", a.wrap(a.providerUpdate)},
		{"/api/provider/updatepriority", a.wrap(a.providerUpdatePriority)},
		{"/api/provider/delete", a.wrap(a.providerDelete)},
		{"/api/provider/modelaliases", a.wrap(a.providerModelAliases)},
		{"/api/provider/batchupdate", a.wrap(a.providerBatchUpdate)},
		// role
		{"/api/role/list", a.wrap(a.roleList)},
		{"/api/role/detail", a.wrap(a.roleDetail)},
		{"/api/role/create", a.wrap(a.roleCreate)},
		{"/api/role/update", a.wrap(a.roleUpdate)},
		{"/api/role/delete", a.wrap(a.roleDelete)},
		{"/api/role/assign", a.wrap(a.roleAssign)},
		{"/api/role/account_roles", a.wrap(a.roleAccountRoles)},
		// settings
		{"/api/settings/list", a.wrap(a.settingsList)},
		{"/api/settings/save", a.wrap(a.settingsSave)},
		// usage
		{"/api/usage/list", a.wrap(a.usageList)},
		{"/api/usage/stats", a.wrap(a.usageStats)},
		{"/api/usage/sessions", a.wrap(a.usageSessions)},
		{"/api/usage/stats/batch", a.wrap(a.usageStatsBatch)},
		// audit
		{"/api/audit/list", a.wrap(a.auditList)},
		// subscription
		{"/api/subscription/records", a.wrap(a.subscriptionRecords)},
		{"/api/subscription/createtopup", a.wrap(a.subscriptionCreateTopup)},
		{"/api/subscription/ipnwebhook", a.wrap(a.subscriptionIPN)},
		{"/api/subscription/statement", a.wrap(a.subscriptionStatement)},
		// gift card
		{"/api/gift_card/create", a.wrap(a.giftCardCreate)},
		{"/api/gift_card/list", a.wrap(a.giftCardList)},
		{"/api/gift_card/redeem", a.wrap(a.giftCardRedeem)},
		{"/api/gift_card/cleanup", a.wrap(a.giftCardCleanup)},
	}
	for _, rt := range routes {
		mux.Handle(rt.path, rt.handler)
	}
	mux.HandleFunc("/", a.serveStatic)
	return mux
}

// wrap — shared plumb: OPTIONS short-circuit, ctx read, envelope/error
// mapping (mounthttp semantics).
func (a *App) wrap(h func(*httpx.Ctx) (any, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			httpx.Options(w)
			return
		}
		c := httpx.Read(w, r)
		data, err := h(c)
		if err != nil {
			httpx.Fail(w, err.Error())
			return
		}
		switch v := data.(type) {
		case rawReply:
			httpx.Raw(w, v.value)
		case streamReply:
			// handler already wrote the response
		default:
			httpx.OK(w, data)
		}
	}
}

type rawReply struct{ value any }

func raw(v any) any { return rawReply{value: v} }

type streamReply struct{}

// ─────────────────── static files (mountstatic) ───────────────────

func (a *App) serveStatic(w http.ResponseWriter, r *http.Request) {
	pathName := r.URL.Path
	if r.Method == http.MethodOptions {
		httpx.Options(w)
		return
	}
	if filepath.Ext(pathName) == ".mjs" {
		httpx.TextStatus(w, http.StatusForbidden, "Forbidden")
		return
	}
	if containsDotDot(pathName) {
		httpx.TextStatus(w, http.StatusForbidden, "Forbidden")
		return
	}
	target := joinPath(a.staticDir, pathName)
	if pathName == "/" {
		target = joinPath(a.staticDir, "/index.html")
	}
	if !isUnder(a.staticDir, target) {
		httpx.TextStatus(w, http.StatusForbidden, "Forbidden")
		return
	}
	if fileExists(target) {
		http.ServeFile(w, r, target)
		return
	}
	if !hasPrefix(pathName, "/api") {
		// SPA fallback
		http.ServeFile(w, r, joinPath(a.staticDir, "/index.html"))
		return
	}
	httpx.TextStatus(w, http.StatusNotFound, "Not Found")
}
