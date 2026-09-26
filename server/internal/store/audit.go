package store

import (
	"database/sql"
	"errors"
	"sort"

	"onekey/server/internal/cryptox"
)

// Audit retention: newest N successful and newest N failed requests. Small on
// purpose — the trail is a debugging aid for what just happened, not a history,
// and every failed row can carry a prompt.
const AuditKeep = 10

// auditBodyKey — how much of a stored request body counts as "the same
// request" for dedupe: the first 1000 characters.
const auditBodyKey = 1000

const auditCols = "id,ts,success,account_id,account_name,model_alias,provider_id,provider_name,api_type,endpoint,status_code,duration_ms,input_tokens,cached_input_tokens,output_tokens,cost,stream,err,request_body,response_body,create_time,update_time,delete_time"

// auditListCols — everything auditCols has except the two bodies, plus
// has_detail. The bodies are by far the largest part of a row and the page only
// shows them for the one row an admin expands, so the list does not carry them;
// has_detail is computed in SQL so the UI still knows which rows can expand.
// COALESCE guards rows written before the body columns had a default.
const auditListCols = "id,ts,success,account_id,account_name,model_alias,provider_id,provider_name," +
	"api_type,endpoint,status_code,duration_ms,input_tokens,cached_input_tokens,output_tokens," +
	"cost,stream,err," +
	"(COALESCE(request_body,'') <> '' OR COALESCE(response_body,'') <> '') AS has_detail," +
	"create_time,update_time,delete_time"

// AuditLog — one relayed upstream attempt (success or failure).
type AuditLog struct {
	ID                string  `json:"id"`
	Ts                int64   `json:"ts"`
	Success           int64   `json:"success"`
	AccountID         string  `json:"account_id"`
	AccountName       string  `json:"account_name"`
	ModelAlias        string  `json:"model_alias"`
	ProviderID        string  `json:"provider_id"`
	ProviderName      string  `json:"provider_name"`
	ApiType           string  `json:"api_type"`
	Endpoint          string  `json:"endpoint"`
	StatusCode        int64   `json:"status_code"`
	DurationMs        int64   `json:"duration_ms"`
	InputTokens       int64   `json:"input_tokens"`
	CachedInputTokens int64   `json:"cached_input_tokens"`
	OutputTokens      int64   `json:"output_tokens"`
	Cost              float64 `json:"cost"`
	Stream            int64   `json:"stream"`
	Err               string  `json:"err"`
	RequestBody       string  `json:"request_body"`
	ResponseBody      string  `json:"response_body"`
	// HasDetail is list-only: whether this row still holds a body worth
	// fetching. AuditList leaves RequestBody/ResponseBody empty.
	HasDetail  bool   `json:"has_detail"`
	CreateTime int64  `json:"create_time"`
	UpdateTime *int64 `json:"update_time"`
	DeleteTime *int64 `json:"delete_time"`
}

func scanAudit(row interface{ Scan(...any) error }) (*AuditLog, error) {
	a := &AuditLog{}
	// The body columns are scanned as nullable strings: rows written before the
	// columns existed (or by a build without the default) hold NULL, and one
	// NULL must not take down the whole audit list.
	var reqBody, respBody sql.NullString
	err := row.Scan(&a.ID, &a.Ts, &a.Success, &a.AccountID, &a.AccountName, &a.ModelAlias, &a.ProviderID,
		&a.ProviderName, &a.ApiType, &a.Endpoint, &a.StatusCode, &a.DurationMs, &a.InputTokens,
		&a.CachedInputTokens, &a.OutputTokens, &a.Cost, &a.Stream, &a.Err,
		&reqBody, &respBody,
		&a.CreateTime, &a.UpdateTime, &a.DeleteTime)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	a.RequestBody, a.ResponseBody = reqBody.String, respBody.String
	a.HasDetail = a.RequestBody != "" || a.ResponseBody != ""
	return a, nil
}

// scanAuditList reads a row selected with auditListCols. The has_detail flag is
// scanned as an integer rather than a bool so it does not depend on how the
// driver reports a computed expression.
func scanAuditList(row interface{ Scan(...any) error }) (*AuditLog, error) {
	a := &AuditLog{}
	var hasDetail int64
	err := row.Scan(&a.ID, &a.Ts, &a.Success, &a.AccountID, &a.AccountName, &a.ModelAlias, &a.ProviderID,
		&a.ProviderName, &a.ApiType, &a.Endpoint, &a.StatusCode, &a.DurationMs, &a.InputTokens,
		&a.CachedInputTokens, &a.OutputTokens, &a.Cost, &a.Stream, &a.Err,
		&hasDetail,
		&a.CreateTime, &a.UpdateTime, &a.DeleteTime)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	a.HasDetail = hasDetail != 0
	return a, nil
}

// AuditInsert records one attempt and applies retention. Errors are returned
// so callers can log them; the audit trail must never break a relayed request.
//
// A failed attempt that carries a request body is only recorded when no recent
// failure still holds the same body: retries of one broken request would
// otherwise flood the trail with identical rows, so the first occurrence stands
// in for all of them.
func AuditInsert(db *sql.DB, a AuditLog) error {
	if a.ID == "" {
		a.ID = cryptox.Nanoid(8)
	}
	if a.Ts == 0 {
		a.Ts = Now()
	}
	a.CreateTime = Now()
	detailed := a.Success == 0 && (a.RequestBody != "" || a.ResponseBody != "")
	if detailed && auditDuplicateBody(db, a.RequestBody, a.Err) {
		return nil
	}
	_, err := db.Exec(`INSERT INTO audit_log (`+auditCols+`)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		a.ID, a.Ts, a.Success, a.AccountID, a.AccountName, a.ModelAlias, a.ProviderID,
		a.ProviderName, a.ApiType, a.Endpoint, a.StatusCode, a.DurationMs, a.InputTokens,
		a.CachedInputTokens, a.OutputTokens, a.Cost, a.Stream, a.Err,
		a.RequestBody, a.ResponseBody,
		a.CreateTime, nil, nil)
	if err != nil {
		return err
	}
	if err := auditTrim(db, a.Success); err != nil {
		return err
	}
	return nil
}

// auditDuplicateBody — whether a retained failed attempt already holds this
// request body. Only rows that still carry bodies count: once a body has been
// aged out the failure is old enough that a repeat is worth its own row.
func auditDuplicateBody(db *sql.DB, requestBody, errText string) bool {
	if requestBody == "" {
		return false
	}
	var id string
	err := db.QueryRow(`SELECT id FROM audit_log
		WHERE success = 0 AND request_body <> ''
		  AND substr(request_body, 1, ?) = substr(?, 1, ?)
		  AND err = ?
		LIMIT 1`, auditBodyKey, requestBody, auditBodyKey, errText).Scan(&id)
	return err == nil
}

// auditTrim deletes rows of one outcome beyond the newest AuditKeep.
func auditTrim(db *sql.DB, success int64) error {
	_, err := db.Exec(`DELETE FROM audit_log WHERE success = ? AND id NOT IN (
		SELECT id FROM audit_log WHERE success = ? ORDER BY ts DESC, rowid DESC LIMIT ?)`,
		success, success, AuditKeep)
	return err
}

// AuditList — the newest AuditKeep attempts per outcome, newest first, without
// their bodies.
//
// Bounded per outcome on purpose. Reading the whole table ordered by ts cannot
// use an index — the only one is (success, ts) — so it scanned everything and
// sorted it through a temp B-tree to hand back rows the page would show 10 at a
// time. Asking for one outcome at a time lets SQLite walk that index backwards
// and stop after AuditKeep rows.
func AuditList(db *sql.DB) ([]*AuditLog, error) {
	out := make([]*AuditLog, 0, 2*AuditKeep)
	for _, success := range []int64{1, 0} {
		rows, err := db.Query(`SELECT `+auditListCols+` FROM audit_log
			WHERE success = ? AND delete_time IS NULL
			ORDER BY ts DESC, rowid DESC LIMIT ?`, success, AuditKeep)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			a, err := scanAuditList(rows)
			if err != nil {
				rows.Close()
				return nil, err
			}
			out = append(out, a)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
	}
	// Each half is already newest-first; stable keeps that order for equal ts.
	sort.SliceStable(out, func(i, j int) bool { return out[i].Ts > out[j].Ts })
	return out, nil
}

// AuditDetail — one attempt's stored request/response summary, read by primary
// key when an admin expands a row. Kept out of AuditList so the bodies travel
// only when they are actually looked at.
func AuditDetail(db *sql.DB, id string) (*AuditLog, error) {
	return scanAudit(db.QueryRow(`SELECT `+auditCols+` FROM audit_log WHERE id = ?`, id))
}
