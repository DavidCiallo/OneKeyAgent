package store

import (
	"database/sql"
	"sync"
	"testing"

	_ "modernc.org/sqlite"
)

// TestBucketLogUsageAccumulates — repeated settles for the same window merge
// into one row per granularity instead of inserting new rows.
func TestBucketLogUsageAccumulates(t *testing.T) {
	db, err := Open(t.TempDir() + "/bucket.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	in := BucketLogInput{
		AccountID: "acc", ModelAlias: "alias", ProviderID: "prov",
		InputTokens: 100, CachedInputTokens: 10, OutputTokens: 20, Cost: 0.001,
	}
	for i := 0; i < 5; i++ {
		if err := BucketLogUsage(db, in); err != nil {
			t.Fatalf("log %d: %v", i, err)
		}
	}

	rows, err := db.Query(`SELECT granularity, input_tokens, cached_input_tokens, output_tokens, cost, request_count
		FROM usage_bucket WHERE account_id='acc' ORDER BY granularity`)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer rows.Close()

	seen := 0
	for rows.Next() {
		var gran string
		var it, cit, ot, rc int64
		var cost float64
		if err := rows.Scan(&gran, &it, &cit, &ot, &cost, &rc); err != nil {
			t.Fatalf("scan: %v", err)
		}
		seen++
		if it != 500 || cit != 50 || ot != 100 || rc != 5 {
			t.Fatalf("%s: got in=%d cached=%d out=%d count=%d, want 500/50/100/5", gran, it, cit, ot, rc)
		}
		if diff := cost - Round6(0.005); diff > 1e-9 || diff < -1e-9 {
			t.Fatalf("%s: cost = %v, want 0.005", gran, cost)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}
	if seen != 3 {
		t.Fatalf("got %d granularity rows, want 3 (1m/60m/1d)", seen)
	}
}

// TestBucketLogUsageConcurrent — the upsert path must not produce duplicate rows
// when settles for the same window run in parallel. This is the race the old
// SELECT-then-INSERT implementation could lose.
func TestBucketLogUsageConcurrent(t *testing.T) {
	db, err := Open(t.TempDir() + "/bucketc.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	const workers = 8
	const perWorker = 10
	var wg sync.WaitGroup
	errs := make(chan error, workers)
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < perWorker; i++ {
				if err := BucketLogUsage(db, BucketLogInput{
					AccountID: "acc", ModelAlias: "alias", ProviderID: "prov",
					InputTokens: 1, OutputTokens: 1, Cost: 0.000001,
				}); err != nil {
					errs <- err
					return
				}
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("concurrent log: %v", err)
	}

	var dupes int64
	if err := db.QueryRow(`SELECT COUNT(*) FROM (
			SELECT 1 FROM usage_bucket GROUP BY account_id, model_alias, provider_id, granularity, bucket_time HAVING COUNT(*) > 1
		)`).Scan(&dupes); err != nil {
		t.Fatalf("dupe check: %v", err)
	}
	if dupes != 0 {
		t.Fatalf("%d windows hold duplicate rows after concurrent settles", dupes)
	}

	var rc int64
	if err := db.QueryRow(`SELECT request_count FROM usage_bucket
		WHERE account_id='acc' AND granularity='1m'`).Scan(&rc); err != nil {
		t.Fatalf("count read: %v", err)
	}
	if rc != workers*perWorker {
		t.Fatalf("request_count = %d, want %d (lost updates)", rc, workers*perWorker)
	}
}

// TestPurgeExpiredBuckets — retention drops only rows older than the
// granularity's TTL and leaves fresh ones alone.
func TestPurgeExpiredBuckets(t *testing.T) {
	db, err := Open(t.TempDir() + "/bucketttl.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	now := Now()
	insert := func(id, gran string, bucketTime int64) {
		t.Helper()
		if _, err := db.Exec(`INSERT INTO usage_bucket
			(id,account_id,model_alias,provider_id,bucket_time,granularity,input_tokens,cached_input_tokens,output_tokens,cost,request_count,create_time,update_time,delete_time)
			VALUES (?,?,?,?,?,?,0,0,0,0,1,?,?,NULL)`, id, "acc", "alias", "prov", bucketTime, gran, now, now); err != nil {
			t.Fatalf("insert %s: %v", id, err)
		}
	}
	insert("old-1m", "1m", now-8*86_400_000)     // past the 7d 1m TTL
	insert("new-1m", "1m", now-1*3_600_000)      // fresh
	insert("old-60m", "60m", now-100*86_400_000) // past the 90d 60m TTL
	insert("new-60m", "60m", now-86_400_000)     // fresh
	insert("old-1d", "1d", now-800*86_400_000)   // past the 730d 1d TTL
	insert("new-1d", "1d", now-86_400_000)       // fresh

	if err := PurgeExpiredBuckets(db); err != nil {
		t.Fatalf("purge: %v", err)
	}

	for _, tc := range []struct {
		id   string
		want bool // still present?
	}{
		{"old-1m", false}, {"new-1m", true},
		{"old-60m", false}, {"new-60m", true},
		{"old-1d", false}, {"new-1d", true},
	} {
		var n int64
		if err := db.QueryRow("SELECT COUNT(*) FROM usage_bucket WHERE id = ?", tc.id).Scan(&n); err != nil {
			t.Fatalf("count %s: %v", tc.id, err)
		}
		if (n > 0) != tc.want {
			t.Fatalf("%s present = %v, want %v", tc.id, n > 0, tc.want)
		}
	}
}

// TestDedupeBucketRowsMergesLegacyDuplicates — a database written before the
// unique index existed may hold two rows for one window; Open must fold them
// (summing the counters) so the index can be created.
func TestDedupeBucketRowsMergesLegacyDuplicates(t *testing.T) {
	path := t.TempDir() + "/legacy.db"
	raw, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatalf("raw open: %v", err)
	}
	// Mirror the pre-index layout: the same table, no unique index.
	if _, err := raw.Exec(`CREATE TABLE usage_bucket (
			id TEXT PRIMARY KEY,
			account_id TEXT NOT NULL DEFAULT '',
			model_alias TEXT NOT NULL DEFAULT '',
			provider_id TEXT NOT NULL DEFAULT '',
			bucket_time INTEGER NOT NULL DEFAULT 0,
			granularity TEXT NOT NULL DEFAULT '1m',
			input_tokens INTEGER NOT NULL DEFAULT 0,
			cached_input_tokens INTEGER NOT NULL DEFAULT 0,
			output_tokens INTEGER NOT NULL DEFAULT 0,
			cost REAL NOT NULL DEFAULT 0,
			request_count INTEGER NOT NULL DEFAULT 0,
			create_time INTEGER NOT NULL DEFAULT 0,
			update_time INTEGER,
			delete_time INTEGER
		)`); err != nil {
		t.Fatalf("create: %v", err)
	}
	// Two rows for the same (account, alias, provider, granularity, window).
	if _, err := raw.Exec(`INSERT INTO usage_bucket
			(id,account_id,model_alias,provider_id,bucket_time,granularity,input_tokens,cached_input_tokens,output_tokens,cost,request_count,create_time,update_time,delete_time)
			VALUES ('keep','acc','alias','prov',60000,'1m',100,10,20,0.5,1,1,1,NULL)`); err != nil {
		t.Fatalf("insert keep: %v", err)
	}
	if _, err := raw.Exec(`INSERT INTO usage_bucket
			(id,account_id,model_alias,provider_id,bucket_time,granularity,input_tokens,cached_input_tokens,output_tokens,cost,request_count,create_time,update_time,delete_time)
			VALUES ('drop','acc','alias','prov',60000,'1m',300,30,40,1.5,2,2,2,NULL)`); err != nil {
		t.Fatalf("insert drop: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("raw close: %v", err)
	}

	// Open runs schema create -> reconcile -> dedupe -> indexes.
	db, err := Open(path)
	if err != nil {
		t.Fatalf("open legacy: %v", err)
	}
	defer db.Close()

	var rows int64
	if err := db.QueryRow("SELECT COUNT(*) FROM usage_bucket WHERE account_id='acc'").Scan(&rows); err != nil {
		t.Fatalf("count: %v", err)
	}
	if rows != 1 {
		t.Fatalf("got %d rows after dedupe, want 1", rows)
	}
	var it, cit, ot, rc int64
	var cost float64
	if err := db.QueryRow(`SELECT input_tokens, cached_input_tokens, output_tokens, cost, request_count
		FROM usage_bucket WHERE account_id='acc'`).Scan(&it, &cit, &ot, &cost, &rc); err != nil {
		t.Fatalf("read merged row: %v", err)
	}
	if it != 400 || cit != 40 || ot != 60 || rc != 3 {
		t.Fatalf("merged row = in:%d cached:%d out:%d count:%d, want 400/40/60/3", it, cit, ot, rc)
	}
	if diff := cost - 2.0; diff > 1e-9 || diff < -1e-9 {
		t.Fatalf("merged cost = %v, want 2.0", cost)
	}

	// The unique index must now exist, so a duplicate insert is rejected.
	if _, err := db.Exec(`INSERT INTO usage_bucket
			(id,account_id,model_alias,provider_id,bucket_time,granularity,input_tokens,cached_input_tokens,output_tokens,cost,request_count,create_time,update_time,delete_time)
			VALUES ('dup','acc','alias','prov',60000,'1m',1,0,0,0,1,1,1,NULL)`); err == nil {
		t.Fatal("inserting a second row for the same window succeeded; the unique index is missing")
	}
}
