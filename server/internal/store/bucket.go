package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"onekey/server/internal/cryptox"
)

// ─────────────────────────── Usage buckets ───────────────────────────

const bucketCols = "id,account_id,model_alias,provider_id,bucket_time,granularity,input_tokens,cached_input_tokens,output_tokens,cost,request_count,duration_ms,ttft_ms,ttft_count,create_time,update_time,delete_time"

type UsageBucket struct {
	ID                string  `json:"id"`
	AccountID         string  `json:"account_id"`
	ModelAlias        string  `json:"model_alias"`
	ProviderID        string  `json:"provider_id"`
	BucketTime        int64   `json:"bucket_time"`
	Granularity       string  `json:"granularity"`
	InputTokens       int64   `json:"input_tokens"`
	CachedInputTokens int64   `json:"cached_input_tokens"`
	OutputTokens      int64   `json:"output_tokens"`
	Cost              float64 `json:"cost"`
	RequestCount      int64   `json:"request_count"`
	// DurationMs / TtftMs — summed so the window can report throughput and
	// first-token latency. Both are 0 on buckets written before they existed.
	DurationMs int64 `json:"duration_ms"`
	TtftMs     int64 `json:"ttft_ms"`
	// TtftCount — requests that reported a first token, the denominator for an
	// average ttft_ms.
	TtftCount  int64  `json:"ttft_count"`
	CreateTime int64  `json:"create_time"`
	UpdateTime *int64 `json:"update_time"`
	DeleteTime *int64 `json:"delete_time"`
}

func scanBucket(row interface{ Scan(...any) error }) (*UsageBucket, error) {
	b := &UsageBucket{}
	err := row.Scan(&b.ID, &b.AccountID, &b.ModelAlias, &b.ProviderID, &b.BucketTime, &b.Granularity,
		&b.InputTokens, &b.CachedInputTokens, &b.OutputTokens, &b.Cost, &b.RequestCount,
		&b.DurationMs, &b.TtftMs, &b.TtftCount,
		&b.CreateTime, &b.UpdateTime, &b.DeleteTime)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return b, nil
}

// BucketLogInput — one settled request to accumulate into 1m/60m/1d buckets.
type BucketLogInput struct {
	AccountID         string
	ModelAlias        string
	ProviderID        string
	InputTokens       int64
	CachedInputTokens int64
	OutputTokens      int64
	Cost              float64
	// DurationMs / TtftMs — wall time and time to the first token of any kind
	// (thinking included) for this
	// request. Summed into the window so it can report throughput; TtftMs is 0
	// on the non-streaming path, where there is no first token to time.
	DurationMs int64
	TtftMs     int64
}

// BucketLogUsage — accumulate one settled request into the 1m/60m/1d windows.
//
// Each window is a single INSERT ... ON CONFLICT DO UPDATE, so the counters are
// merged by the database rather than read-modify-written by the caller. That is
// what makes concurrent settles safe against the duplicate-row window the old
// SELECT-then-INSERT had: two requests racing on the same window now contend on
// the unique index instead of both inserting.
//
// Port of ai.session.ts logUsage, minus its per-request TTL sweep (see
// PurgeExpiredBuckets).
func BucketLogUsage(db *sql.DB, u BucketLogInput) error {
	// Usage and its buffer record commit together — see the note in account.go
	// on why money writes must never skip the buffer.
	buffer := OutboxOn() && syncDeltaTables["usage_bucket"]
	if buffer {
		// The sequence cache and the buffered entry must be consistent with the
		// single transaction below.
		outboxSeqMu.Lock()
		defer outboxSeqMu.Unlock()
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := Now()
	b1m := (now / 60_000) * 60_000
	b60m := (now / 3_600_000) * 3_600_000

	// A first token is only visible on the streaming path, so a request that
	// reported none is not part of the ttft_ms average.
	ttftCount := int64(0)
	if u.TtftMs > 0 {
		ttftCount = 1
	}

	// Only 1m and 60m are written. There used to be a 1d bucket, but it
	// collapsed a whole day into one row at write time, which made "6h
	// granularity" impossible to answer honestly: the query side could only
	// spread the daily total back over the day as a flat line, and it did so
	// from a boundary fixed at insert time. Long ranges now aggregate 60m rows
	// instead, so any day/week boundary the operator asks for is computed from
	// data that still has an hour's resolution.
	for _, gt := range [][2]any{{b1m, "1m"}, {b60m, "60m"}} {
		bucketTime := gt[0].(int64)
		gran := gt[1].(string)
		if _, err := tx.Exec(
			`INSERT INTO usage_bucket (id, account_id, model_alias, provider_id, bucket_time, granularity,
				input_tokens, cached_input_tokens, output_tokens, cost, request_count,
				duration_ms, ttft_ms, ttft_count, create_time, update_time, delete_time)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, NULL)
			 ON CONFLICT(account_id, model_alias, provider_id, granularity, bucket_time) DO UPDATE SET
				input_tokens = input_tokens + excluded.input_tokens,
				cached_input_tokens = cached_input_tokens + excluded.cached_input_tokens,
				output_tokens = output_tokens + excluded.output_tokens,
				cost = cost + excluded.cost,
				request_count = request_count + 1,
				duration_ms = duration_ms + excluded.duration_ms,
				ttft_ms = ttft_ms + excluded.ttft_ms,
				ttft_count = ttft_count + excluded.ttft_count,
				update_time = excluded.update_time`,
			cryptox.Nanoid(6), u.AccountID, u.ModelAlias, u.ProviderID, bucketTime, gran,
			u.InputTokens, u.CachedInputTokens, u.OutputTokens, Round6(u.Cost),
			u.DurationMs, u.TtftMs, ttftCount, now, now,
		); err != nil {
			return err
		}
		// Buffer the same increment for the main database, in this transaction
		// so usage and its sync record commit together.
		if buffer {
			if err := mergeOutboxEntryTx(tx, "usage_bucket",
				BucketDeltaRowID(u.AccountID, u.ModelAlias, u.ProviderID, gran, bucketTime), "delta",
				map[string]any{
					"account_id": u.AccountID, "model_alias": u.ModelAlias, "provider_id": u.ProviderID,
					"granularity": gran, "bucket_time": bucketTime,
					"input_tokens": u.InputTokens, "cached_input_tokens": u.CachedInputTokens,
					"output_tokens": u.OutputTokens, "cost": Round6(u.Cost), "request_count": int64(1),
					"duration_ms": u.DurationMs, "ttft_ms": u.TtftMs, "ttft_count": ttftCount,
				}, true); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

// bucketTTLs — retention per granularity. 60m keeps 400 days so the year view
// and the weekly spending gate (which now sums 60m) are both covered; there is
// no 1d bucket to fall back on for long ranges any more.
var bucketTTLs = [][2]any{{"1m", int64(7 * 86_400_000)}, {"60m", int64(400 * 86_400_000)}}

// PurgeExpiredBuckets drops buckets past their granularity's retention.
//
// This used to run inside BucketLogUsage, which put three full indexed DELETEs
// on every relayed request even though the result changes at most once per
// bucket. Callers run it on a ticker instead.
func PurgeExpiredBuckets(db *sql.DB) error {
	now := Now()
	for _, t := range bucketTTLs {
		gran := t[0].(string)
		cutoff := now - t[1].(int64)
		if _, err := db.Exec("DELETE FROM usage_bucket WHERE granularity = ? AND bucket_time < ?", gran, cutoff); err != nil {
			return err
		}
	}
	return nil
}

// StartMaintenance runs the housekeeping that must not sit on the request path
// (currently the bucket TTL sweep) until the process exits.
func StartMaintenance(db *sql.DB) {
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for {
			if err := PurgeExpiredBuckets(db); err != nil {
				fmt.Println("[Maintenance] purge buckets failed:", err)
			}
			<-ticker.C
		}
	}()
}

// BucketSumCost — weekly spend / profile weekly usage.
// byCreateTime=true filters create_time >= since (JSONL `sum` semantics);
// false filters bucket_time >= since.
func BucketSumCost(db *sql.DB, accountID string, granularity *string, since int64, byCreateTime bool) (float64, error) {
	conds := []string{"account_id = ?"}
	args := []any{accountID}
	if granularity != nil {
		conds = append(conds, "granularity = ?")
		args = append(args, *granularity)
	}
	col := "bucket_time"
	if byCreateTime {
		col = "create_time"
	}
	conds = append(conds, col+" >= ?")
	args = append(args, since)
	var total float64
	err := db.QueryRow(
		"SELECT COALESCE(SUM(cost), 0) FROM usage_bucket WHERE "+strings.Join(conds, " AND "), args...,
	).Scan(&total)
	return total, err
}

// BucketFilter — findEach equivalent for stats/sessions aggregation.
type BucketFilter struct {
	Granularity    *string
	BucketTimeGte  *int64
	AccountID      *string
	ModelAlias     *string
	CreateTimeGte  *int64
}

func BucketEach(db *sql.DB, f BucketFilter, fn func(*UsageBucket) bool) (int, error) {
	conds := []string{"delete_time IS NULL"}
	args := []any{}
	if f.Granularity != nil {
		conds = append(conds, "granularity = ?")
		args = append(args, *f.Granularity)
	}
	if f.BucketTimeGte != nil {
		conds = append(conds, "bucket_time >= ?")
		args = append(args, *f.BucketTimeGte)
	}
	if f.AccountID != nil {
		conds = append(conds, "account_id = ?")
		args = append(args, *f.AccountID)
	}
	if f.ModelAlias != nil {
		conds = append(conds, "model_alias = ?")
		args = append(args, *f.ModelAlias)
	}
	if f.CreateTimeGte != nil {
		conds = append(conds, "create_time >= ?")
		args = append(args, *f.CreateTimeGte)
	}
	rows, err := db.Query("SELECT "+bucketCols+" FROM usage_bucket WHERE "+strings.Join(conds, " AND "), args...)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		b, err := scanBucket(rows)
		if err != nil {
			return n, err
		}
		if !fn(b) {
			return n, nil
		}
		n++
	}
	return n, rows.Err()
}

// BucketFindPage — paginated 60m rows for the usage table (40/page).
func BucketFindPage(db *sql.DB, page int64, accountID, modelAlias *string, since int64) ([]*UsageBucket, int64, error) {
	conds := []string{"delete_time IS NULL", "granularity = '60m'", "create_time >= ?"}
	args := []any{since}
	if accountID != nil {
		conds = append(conds, "account_id = ?")
		args = append(args, *accountID)
	}
	if modelAlias != nil {
		conds = append(conds, "model_alias = ?")
		args = append(args, *modelAlias)
	}
	where := strings.Join(conds, " AND ")
	offset := (page - 1) * 40
	if offset < 0 {
		offset = 0
	}
	rows, err := db.Query("SELECT "+bucketCols+" FROM usage_bucket WHERE "+where+" ORDER BY rowid DESC LIMIT 40 OFFSET ?", append(args, offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var list []*UsageBucket
	for rows.Next() {
		b, err := scanBucket(rows)
		if err != nil {
			return nil, 0, err
		}
		list = append(list, b)
	}
	var total int64
	if err := db.QueryRow("SELECT COUNT(*) FROM usage_bucket WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	return list, total, nil
}

// ─────────────────────────── the statistics clock ───────────────────────────

// statsLoc is the zone every calendar boundary in the stats path is cut in:
// the day bucket written by BucketLogUsage, the "today" range, the 1m/60m
// window anchors and the display slots. It is a package-level value rather than
// a parameter because the alternative is threading a *time.Location through
// every bucket, session and chart call for a setting that changes at most once
// per process.
//
// Defaults to the container's local zone (time.Local) so a process that never
// configures one behaves exactly as before; main sets it from routing_timezone.
var (
	statsLocMu sync.RWMutex
	statsLoc   = time.Local
	statsName  = ""
)

// SetStatsLocation — point the statistics clock at an IANA zone. An empty or
// unknown name restores the container's local zone. Returns the zone actually
// in effect so the caller can log a typo instead of silently keeping the old
// boundaries.
//
// Changing this mid-flight is safe for new writes but does not rewrite history:
// 1m/60m buckets are aligned to absolute time and are unaffected, while the
// day boundary is recomputed on the next write. Existing 1m rows keep the
// absolute alignment they were written with, so a zone change only shifts how
// they are grouped into days, never where each row sits.
func SetStatsLocation(name string) *time.Location {
	name = strings.TrimSpace(name)
	if name == "" {
		statsLocMu.Lock()
		statsLoc, statsName = time.Local, ""
		statsLocMu.Unlock()
		return time.Local
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		statsLocMu.Lock()
		statsLoc, statsName = time.Local, ""
		statsLocMu.Unlock()
		return time.Local
	}
	statsLocMu.Lock()
	statsLoc, statsName = loc, name
	statsLocMu.Unlock()
	return loc
}

// StatsLocation — the zone the stats path is currently cut in.
func StatsLocation() *time.Location {
	statsLocMu.RLock()
	defer statsLocMu.RUnlock()
	return statsLoc
}

// DayStart — midnight of the stats-clock day containing ts.
func DayStart(ts int64) int64 {
	loc := StatsLocation()
	d := time.UnixMilli(ts).In(loc)
	return time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, loc).UnixMilli()
}

// LocalMidnight — deprecated alias of DayStart, kept because the name is used
// by the register-count and daily-bonus paths that predate the stats clock.
func LocalMidnight(ts int64) int64 { return DayStart(ts) }

// AlignDown — the stats-clock-aligned boundary at or below ts for a step.
//
// The alignment is anchored at the day boundary, not at the Unix epoch: a 6h
// step then lands on 00:00/06:00/12:00/18:00 local, which is what an operator
// reading a usage chart expects, instead of drifting with the UTC offset.
// Steps of an hour or less are simply floored, since an hour divides evenly
// into every local day (including DST days) and flooring keeps 1m/60m rows
// aligned to absolute time.
func AlignDown(ts, stepMs int64) int64 {
	if stepMs <= 0 {
		return ts
	}
	if stepMs <= 3_600_000 {
		return (ts / stepMs) * stepMs
	}
	day := DayStart(ts)
	return day + ((ts-day)/stepMs)*stepMs
}

// TenMinuteSlot — 10-minute display slot alignment on the stats clock.
func TenMinuteSlot(ts int64) int64 { return AlignDown(ts, 10*60*1000) }
