package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"onekey/server/internal/httpx"
	"onekey/server/internal/service"
)

//  usage proxy (replica  main)
//
// A replica serves its own local usage_bucket: that is only this node's traffic,
// because the main database never pushes usage counters back down (they are
// additive - see store.RefreshSnapshot, which deliberately skips them). So an
// admin panel attached to a replica would show a slice of the world, not the
// whole one.
//
// For the global views an admin is asking for, we therefore forward the query to
// the main database's /api/usage/* endpoint instead of answering locally. This
// keeps the sync model untouched: nothing new travels replicamain, and the main
// database stays the single reader-visible authority for aggregate usage.
//
// The forwarding branches are inert on the main node: it has no Syncer (see the
// App doc comment), so proxyUsage returns handled=false immediately and every
// handler keeps its original local behavior. That is also what makes a proxy loop
// impossible: a main database never forwards.

// usageProxyTimeout bounds the round trip to the main database. Same order as the
// syncer's own HTTP client, generous enough for a week-long session aggregation.
const usageProxyTimeout = 30 * time.Second

// proxyUsage forwards the current request to the main database's usage endpoint
// when this node is a replica and the caller is an admin (i.e. the query is for
// data the local node cannot see in full).
//
// Returns handled=true with the raw reply when the main database answered; the
// caller must return that value verbatim. When handled=false the caller should
// fall through to its normal local implementation.
func (a *App) proxyUsage(c *httpx.Ctx) (any, bool, error) {
	if !a.shouldProxyUsage(c) {
		return nil, false, nil
	}
	data, err := a.forwardUsage(c)
	if err != nil {
		return nil, false, err
	}
	return raw(data), true, nil
}

// shouldProxyUsage decides whether a usage query has to be answered by the main
// database.
//
// The three conditions are deliberately narrow:
//
//   - a.Syncer != nil       only a replica forwards; the main node has no Syncer.
//   - MAIN_DB_URL != ""     only when there is somewhere to forward to.
//   - the caller is admin   a regular account only ever reads its own usage,
//     which the replica does have locally, so it is served locally.
func (a *App) shouldProxyUsage(c *httpx.Ctx) bool {
	if a.Syncer == nil || a.Syncer.MainURL() == "" {
		return false
	}
	if c.Auth == "" {
		return false
	}
	account, err := service.AccountByAuth(a.DB, c.Auth)
	if err != nil || account == nil {
		return false
	}
	return account.IsAdmin != 0
}

// forwardUsage replays the current request against the main database and returns
// the parsed { success, data } envelope's data. The path is taken from the
// request itself so every /api/usage/* route (list, stats, stats/batch,
// sessions) shares this one implementation.
func (a *App) forwardUsage(c *httpx.Ctx) (any, error) {
	base := a.Syncer.MainURL()
	target := base + c.R.URL.Path
	if q := c.R.URL.RawQuery; q != "" {
		target += "?" + q
	}

	body := c.RawBody
	req, err := http.NewRequestWithContext(c.R.Context(), http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("usage proxy: %w", err)
	}
	// The main database authenticates the forwarded query as the same account,
	// so an admin keeps the same view they would have on the main panel.
	req.Header.Set("token", c.Auth)
	if ct := c.R.Header.Get("Content-Type"); ct != "" {
		req.Header.Set("Content-Type", ct)
	} else {
		req.Header.Set("Content-Type", "application/json")
	}

	client := a.Syncer.HTTPClient()
	if client == nil {
		client = &http.Client{Timeout: usageProxyTimeout}
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("usage proxy: %s unreachable: %w", base, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return nil, fmt.Errorf("usage proxy: read response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("usage proxy: main database http %d: %s", resp.StatusCode, truncateForError(respBody, 300))
	}

	var envelope struct {
		Success bool   `json:"success"`
		Data    any    `json:"data"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(respBody, &envelope); err != nil {
		return nil, fmt.Errorf("usage proxy: decode response: %w", err)
	}
	if !envelope.Success {
		return nil, fmt.Errorf("usage proxy: main database rejected request: %s", envelope.Message)
	}
	return envelope.Data, nil
}

func truncateForError(b []byte, n int) string {
	s := string(b)
	if len(s) > n {
		return s[:n]
	}
	return s
}
