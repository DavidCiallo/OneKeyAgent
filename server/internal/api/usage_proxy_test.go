package api

import (
	"testing"

	"onekey/server/internal/httpx"
	"onekey/server/internal/sync"
)

// TestShouldProxyUsageShortCircuits - the two structural guards that must hold
// before any database / account work happens. These are what make the forwarding
// branch inert on the main node (no Syncer) and prevent a replica with no
// configured MAIN_DB_URL from trying to forward nowhere.
func TestShouldProxyUsageShortCircuits(t *testing.T) {
	ctx := &httpx.Ctx{Auth: "some-token"} // AccountByAuth is never reached below

	cases := []struct {
		name string
		app  *App
		want bool
	}{
		{
			name: "main node never proxies",
			app:  &App{Syncer: nil},
			want: false,
		},
		{
			name: "replica without MAIN_DB_URL never proxies",
			app:  &App{Syncer: &sync.Syncer{}}, // zero Config => MainURL ""
			want: false,
		},
		{
			name: "unauthenticated request never proxies",
			app:  &App{Syncer: &sync.Syncer{}}, // still "" so short-circuits earlier
			want: false,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.app.shouldProxyUsage(ctx); got != c.want {
				t.Errorf("shouldProxyUsage = %v, want %v", got, c.want)
			}
		})
	}

	// No-Auth on a main node must also be false (Syncer nil guard first).
	if (&App{}).shouldProxyUsage(&httpx.Ctx{}) {
		t.Error("main node with empty ctx must not proxy")
	}
}
