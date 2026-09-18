// Package sync — the replica side of the two-region deployment. It pulls a
// bootstrap snapshot from the main database at startup and then pushes batches
// of locally-buffered changes, on a size threshold or a time interval.
//
// The main database is the only writer of record for reference data (models,
// providers, roles, accounts); this node serves traffic locally and reports its
// balances and usage as deltas. See store/outbox.go for why those are additive.
package sync

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"onekey/server/internal/store"
)

// Config — resolved from the environment at startup.
type Config struct {
	MainURL   string // MAIN_DB_URL, e.g. https://main.example.com
	Secret    string // SYNC_SECRET, shared with the main node
	MaxRows   int    // SYNC_MAX_ROWS per push
	MaxBytes  int    // SYNC_MAX_BYTES per push
	Interval  time.Duration
	Threshold int64         // SYNC_FLUSH_BYTES: flush once the buffer exceeds this
	PullEvery time.Duration // SYNC_PULL_SECONDS: refresh reference data from main
}

// ConfigFromEnv — empty MainURL means this node is the main database and no
// syncing happens.
func ConfigFromEnv() Config {
	c := Config{
		MainURL:   strings.TrimRight(os.Getenv("MAIN_DB_URL"), "/"),
		Secret:    os.Getenv("SYNC_SECRET"),
		MaxRows:   500,
		MaxBytes:  2 << 20,
		Interval:  30 * time.Second,
		Threshold: 256 << 10,       // 256 KiB
		PullEvery: 5 * time.Minute, // refresh reference data
	}
	if v := os.Getenv("SYNC_MAX_ROWS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			c.MaxRows = n
		}
	}
	if v := os.Getenv("SYNC_INTERVAL_SECONDS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			c.Interval = time.Duration(n) * time.Second
		}
	}
	if v := os.Getenv("SYNC_FLUSH_BYTES"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			c.Threshold = n
		}
	}
	if v := os.Getenv("SYNC_PULL_SECONDS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			c.PullEvery = time.Duration(n) * time.Second
		}
	}
	return c
}

// Enabled — a replica needs both a main URL and a shared secret.
func (c Config) Enabled() bool { return c.MainURL != "" }

// Syncer pushes this node's buffered changes to the main database.
type Syncer struct {
	db      *sql.DB
	cfg     Config
	client  *http.Client
	trigger chan struct{}
}

func New(db *sql.DB, cfg Config) *Syncer {
	return &Syncer{
		db:      db,
		cfg:     cfg,
		client:  &http.Client{Timeout: 60 * time.Second},
		trigger: make(chan struct{}, 1),
	}
}

// Bootstrap pulls the snapshot and imports it locally. Runs before the HTTP
// server starts, so a fresh replica has the catalog and account balances in
// place before it accepts traffic. Idempotent: rows are upserted by id.
func (s *Syncer) Bootstrap() error {
	req, err := http.NewRequest(http.MethodGet, s.cfg.MainURL+"/api/sync/snapshot", nil)
	if err != nil {
		return err
	}
	req.Header.Set("token", s.cfg.Secret)
	if id := os.Getenv("NODE_ID"); id != "" {
		req.Header.Set("x-node-id", id)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("snapshot request: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 256<<20))
	if err != nil {
		return fmt.Errorf("snapshot read: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("snapshot http %d: %s", resp.StatusCode, truncate(string(body), 300))
	}

	var envelope struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return fmt.Errorf("snapshot decode: %w", err)
	}

	applied, err := store.ImportSnapshot(s.db, envelope.Data)
	if err != nil {
		return err
	}
	fmt.Printf("[Sync] bootstrapped from %s: %v\n", s.cfg.MainURL, applied)
	return nil
}

// Refresh pulls the main database's current reference data and re-applies it
// locally, so models, providers, roles and settings edited on the main database
// reach a replica that is already running.
//
// Bootstrap alone is not enough: it is a one-shot import that a node records as
// done and never repeats, so without this a replica keeps serving whatever
// catalog it was first deployed with. The import preserves additive columns
// (balances, usage counters) — see store.RefreshSnapshot.
func (s *Syncer) Refresh() error {
	req, err := http.NewRequest(http.MethodGet, s.cfg.MainURL+"/api/sync/snapshot", nil)
	if err != nil {
		return err
	}
	req.Header.Set("token", s.cfg.Secret)
	if id := os.Getenv("NODE_ID"); id != "" {
		req.Header.Set("x-node-id", id)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("refresh request: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 256<<20))
	if err != nil {
		return fmt.Errorf("refresh read: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("refresh http %d: %s", resp.StatusCode, truncate(string(body), 300))
	}

	var envelope struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return fmt.Errorf("refresh decode: %w", err)
	}

	applied, err := store.RefreshSnapshot(s.db, envelope.Data)
	if err != nil {
		return err
	}
	fmt.Printf("[Sync] refreshed reference data from %s: %v\n", s.cfg.MainURL, applied)
	return nil
}

// Start runs the push loop until the process exits: flush when the buffer grows
// past the threshold, otherwise on the interval. It also runs the pull loop that
// keeps this replica's reference data current with the main database.
func (s *Syncer) Start() {
	go func() {
		ticker := time.NewTicker(s.cfg.Interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
			case <-s.trigger:
			}
			if err := s.Flush(); err != nil {
				fmt.Println("[Sync] flush failed (will retry):", err)
			}
		}
	}()
	go func() {
		// Size-based flush, checked often; cheap (one aggregate query).
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			_, bytes, err := store.OutboxStats(s.db)
			if err != nil || bytes < s.cfg.Threshold {
				continue
			}
			if err := s.Flush(); err != nil {
				fmt.Println("[Sync] threshold flush failed (will retry):", err)
			}
		}
	}()
	if s.cfg.PullEvery > 0 {
		go func() {
			ticker := time.NewTicker(s.cfg.PullEvery)
			defer ticker.Stop()
			for range ticker.C {
				if err := s.Refresh(); err != nil {
					fmt.Println("[Sync] refresh failed (will retry):", err)
				}
			}
		}()
	}
}

// Flush pushes one batch and trims it from the buffer. A failed push leaves the
// buffer untouched, so the next attempt retries exactly the same changes.
func (s *Syncer) Flush() error {
	batch, err := store.OutboxBatch(s.db, s.cfg.MaxRows, s.cfg.MaxBytes)
	if err != nil {
		return err
	}
	if len(batch) == 0 {
		return nil
	}
	payload, err := json.Marshal(map[string]any{
		"node":    os.Getenv("NODE_ID"),
		"entries": batch,
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, s.cfg.MainURL+"/api/sync/push", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("token", s.cfg.Secret)
	if id := os.Getenv("NODE_ID"); id != "" {
		req.Header.Set("x-node-id", id)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("push http %d: %s", resp.StatusCode, truncate(string(body), 300))
	}

	var result struct {
		UpToSeq int64 `json:"up_to_seq"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return fmt.Errorf("push decode: %w", err)
	}
	if err := store.OutboxAck(s.db, result.UpToSeq); err != nil {
		return err
	}
	fmt.Printf("[Sync] pushed %d changes (up to seq %d)\n", len(batch), result.UpToSeq)
	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
