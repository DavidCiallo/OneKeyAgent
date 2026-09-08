package store

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	"onekey/server/internal/cryptox"
)

// ─────────────────────────── Usage buckets ───────────────────────────

const bucketCols = "id,account_id,model_alias,provider_id,bucket_time,granularity,input_tokens,cached_input_tokens,output_tokens,cost,request_count,create_time,update_time,delete_time"

type UsageBucket struct {
	ID               string  `json:"id"`
	AccountID        string  `json:"account_id"`
	ModelAlias       string  `json:"model_alias"`
	ProviderID       string  `json:"provider_id"`
	BucketTime       int64   `json:"bucket_time"`
	Granularity      string  `json:"granularity"`
	InputTokens      int64   `json:"input_tokens"`
	CachedInputTokens int64  `json:"cached_input_tokens"`
	OutputTokens     int64   `json:"output_tokens"`
	Cost             float64 `json:"cost"`
	RequestCount     int64   `json:"request_count"`
	CreateTime       int64   `json:"create_time"`
	UpdateTime       *int64  `json:"update_time"`
	DeleteTime       *int64  `json:"delete_time"`
}

func scanBucket(row interface{ Scan(...any) error }) (*UsageBucket, error) {
	b := &UsageBucket{}
	err := row.Scan(&b.ID, &b.AccountID, &b.ModelAlias, &b.ProviderID, &b.BucketTime, &b.Granularity,
		&b.InputTokens, &b.CachedInputTokens, &b.OutputTokens, &b.Cost, &b.RequestCount,
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
}

// BucketLogUsage — upsert into the three granularity windows then purge
// expired rows. Runs in one transaction so concurrent settles never create
// duplicate rows for the same window. Port of ai.session.ts logUsage.
func BucketLogUsage(db *sql.DB, u BucketLogInput) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := Now()
	b1m := (now / 60_000) * 60_000
	b60m := (now / 3_600_000) * 3_600_000
	b1d := LocalMidnight(now)

	for _, gt := range [][2]any{{b1m, "1m"}, {b60m, "60m"}, {b1d, "1d"}} {
		bucketTime := gt[0].(int64)
		gran := gt[1].(string)

		var (
			id                 string
			it, cit, ot, rc    int64
			cost               float64
			existingBucketTime int64
		)
		err := tx.QueryRow(
			`SELECT id, input_tokens, cached_input_tokens, output_tokens, cost, request_count, bucket_time
			 FROM usage_bucket
			 WHERE account_id = ? AND model_alias = ? AND provider_id = ? AND granularity = ?
			 ORDER BY create_time DESC, rowid DESC LIMIT 1`,
			u.AccountID, u.ModelAlias, u.ProviderID, gran,
		).Scan(&id, &it, &cit, &ot, &cost, &rc, &existingBucketTime)

		if err == nil && existingBucketTime == bucketTime {
			if _, err := tx.Exec(
				`UPDATE usage_bucket SET input_tokens = ?, cached_input_tokens = ?, output_tokens = ?,
				 cost = ?, request_count = ?, update_time = ? WHERE id = ?`,
				it+u.InputTokens, cit+u.CachedInputTokens, ot+u.OutputTokens,
				Round6(float64(cost)+u.Cost), rc+1, now, id,
			); err != nil {
				return err
			}
			continue
		}
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if _, err := tx.Exec(
			`INSERT INTO usage_bucket (id, account_id, model_alias, provider_id, bucket_time, granularity,
				input_tokens, cached_input_tokens, output_tokens, cost, request_count, create_time, update_time, delete_time)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
			cryptox.Nanoid(6), u.AccountID, u.ModelAlias, u.ProviderID, bucketTime, gran,
			u.InputTokens, u.CachedInputTokens, u.OutputTokens, Round6(u.Cost), 1, now, now,
		); err != nil {
			return err
		}
	}

	// TTL purge — full indexed DELETE (TS deleted one oldest row per request).
	ttls := [][2]any{{"1m", int64(7 * 86_400_000)}, {"60m", int64(90 * 86_400_000)}, {"1d", int64(730 * 86_400_000)}}
	for _, t := range ttls {
		gran := t[0].(string)
		cutoff := now - t[1].(int64)
		if _, err := tx.Exec("DELETE FROM usage_bucket WHERE granularity = ? AND bucket_time < ?", gran, cutoff); err != nil {
			return err
		}
	}
	return tx.Commit()
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

// LocalMidnight — local-timezone midnight (JS new Date(y,m,d).getTime()).
func LocalMidnight(ts int64) int64 {
	d := time.UnixMilli(ts).In(time.Local)
	return time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, time.Local).UnixMilli()
}

// TenMinuteSlot — local 10-minute display slot alignment.
func TenMinuteSlot(ts int64) int64 {
	day := LocalMidnight(ts)
	return day + ((ts-day)/(10*60*1000))*(10*60*1000)
}
