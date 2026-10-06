// OneKeyAgent server — Go implementation.
//
// Startup mirrors server/app/index.ts:
//   - load settings from DB (env fallback)
//   - seed the admin account from env
//   - start the payment monitor
//   - serve API + static frontend
package main

import (
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"onekey/server/internal/api"
	"onekey/server/internal/cryptox"
	"onekey/server/internal/monitor"
	"onekey/server/internal/service"
	"onekey/server/internal/store"
	"onekey/server/internal/sync"

	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()

	port := os.Getenv("SERVER_PORT")
	if port == "" {
		port = "3300"
	}

	dbPath := os.Getenv("SQLITE_PATH")
	if dbPath == "" {
		dbPath = filepath.Join("data", "onekey.db")
	}
	_ = os.MkdirAll(filepath.Dir(dbPath), 0o755)

	db, err := store.Open(dbPath)
	if err != nil {
		fmt.Println("Failed to open database:", err)
		os.Exit(1)
	}

	settings := service.NewSettings()
	if err := settings.LoadFromDb(db); err != nil {
		fmt.Println("Failed to load settings:", err)
		os.Exit(1)
	}

	// One clock for routing and for statistics. The stats path used to cut its
	// day boundary in the container's zone, which is UTC in the shipped compose
	// file — so a "today" or a 6h window started at 08:00 Beijing and every
	// range above an hour was silently offset. routing_timezone is the operator's
	// zone, so it is the one both now use.
	applyStatsTimezone(settings)

	cryptox.Init()

	// Node role: a node configured with MAIN_DB_URL is a replica. It serves
	// traffic locally, pulls a bootstrap snapshot from the main database, and
	// buffers its own changes for periodic push. The main node (no MAIN_DB_URL)
	// buffers nothing and serves the sync API.
	syncerCfg := sync.ConfigFromEnv()
	isReplica := syncerCfg.Enabled()
	var syncer *sync.Syncer
	if isReplica {
		store.SetOutboxEnabled(true)
		syncer = sync.New(db, syncerCfg)
		if err := syncer.Bootstrap(); err != nil {
			// Not fatal: the node still serves traffic from its local data, and
			// a later restart retries. Running on stale data beats not starting.
			fmt.Println("[Sync] bootstrap failed (continuing on local data):", err)
		} else {
			syncer.Start()
		}
	}

	seedAdmin(db, settings)
	// Only the main database polls NowPayments. A replica polled the same
	// invoice independently, confirmed it locally, and its credit reached the
	// main database as a delta on top of the main's own credit — one payment
	// paid out twice. The replica still serves the recharge UI; the invoice row
	// it creates travels to the main database as a put, and the main confirms
	// and credits it there.
	if !isReplica {
		monitor.Start(db, settings)
	}
	store.StartMaintenance(db)

	staticDir := resolveStaticDir()

	app := api.NewApp(db, settings, staticDir, syncer)
	fmt.Printf("\nServer is running at http://localhost:%s\n", port)
	if err := http.ListenAndServe(":"+port, app.Routes()); err != nil {
		fmt.Println("Server failed:", err)
		os.Exit(1)
	}
}

// applyStatsTimezone — point the store's calendar boundaries at the configured
// zone. An unusable value falls back to the container's local zone, which is
// what the process would have used anyway, so a typo degrades to the old
// behaviour rather than to an arbitrary one.
func applyStatsTimezone(settings *service.Settings) {
	name := strings.TrimSpace(settings.Get("routing_timezone"))
	loc := store.SetStatsLocation(name)
	if loc == time.Local && name != "" && name != time.Local.String() {
		fmt.Printf("[Init] routing_timezone %q is not a known zone; using the container local zone instead\n", name)
		return
	}
	fmt.Printf("[Init] statistics and routing clock: %s\n", loc)
}

// seedAdmin — create ADMIN_NAME/EMAIL/PASSWORD account when configured.
func seedAdmin(db *sql.DB, settings *service.Settings) {
	name, email, password := os.Getenv("ADMIN_NAME"), os.Getenv("ADMIN_EMAIL"), os.Getenv("ADMIN_PASSWORD")
	if name == "" || email == "" || password == "" {
		return
	}
	existing, err := store.AccountFindByEmail(db, email, true)
	if err == nil && existing != nil && existing.DeleteTime == nil {
		return
	}
	if err != nil && err != store.ErrNotFound {
		fmt.Println("[Init] admin lookup failed:", err)
		return
	}
	_, ierr := store.GenericInsert(db, "account", map[string]any{
		"name": name, "email": email,
		"password": cryptox.HashGenerate(password),
		"api_key":  cryptox.GenerateApiKey(),
		"is_admin": 1, "balance": 0.0,
	})
	if ierr != nil {
		fmt.Println("[Init] admin creation failed:", ierr)
	}
}

// resolveStaticDir — env STATIC_DIR, else ./dist, else ../dist (repo layout).
func resolveStaticDir() string {
	if d := os.Getenv("STATIC_DIR"); d != "" {
		return d
	}
	for _, cand := range []string{"dist", filepath.Join("..", "dist")} {
		if st, err := os.Stat(cand); err == nil && st.IsDir() {
			abs, _ := filepath.Abs(cand)
			return abs
		}
	}
	return "dist"
}
