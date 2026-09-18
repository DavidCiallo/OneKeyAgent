package store

import (
	"database/sql"
	"errors"

	"onekey/server/internal/cryptox"
)

// Audit retention: newest N successful and newest N failed requests.
const AuditKeep = 100

const auditCols = "id,ts,success,account_id,account_name,model_alias,provider_id,provider_name,api_type,endpoint,status_code,duration_ms,input_tokens,cached_input_tokens,output_tokens,cost,stream,err,create_time,update_time,delete_time"

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
	CreateTime        int64   `json:"create_time"`
	UpdateTime        *int64  `json:"update_time"`
	DeleteTime        *int64  `json:"delete_time"`
}

func scanAudit(row interface{ Scan(...any) error }) (*AuditLog, error) {
	a := &AuditLog{}
	err := row.Scan(&a.ID, &a.Ts, &a.Success, &a.AccountID, &a.AccountName, &a.ModelAlias, &a.ProviderID,
		&a.ProviderName, &a.ApiType, &a.Endpoint, &a.StatusCode, &a.DurationMs, &a.InputTokens,
		&a.CachedInputTokens, &a.OutputTokens, &a.Cost, &a.Stream, &a.Err,
		&a.CreateTime, &a.UpdateTime, &a.DeleteTime)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return a, nil
}

// AuditInsert records one attempt and trims the table back to the newest
// AuditKeep rows per outcome. Errors are returned so callers can log them;
// the audit trail must never break a relayed request.
func AuditInsert(db *sql.DB, a AuditLog) error {
	if a.ID == "" {
		a.ID = cryptox.Nanoid(8)
	}
	if a.Ts == 0 {
		a.Ts = Now()
	}
	a.CreateTime = Now()
	_, err := db.Exec(`INSERT INTO audit_log (`+auditCols+`)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		a.ID, a.Ts, a.Success, a.AccountID, a.AccountName, a.ModelAlias, a.ProviderID,
		a.ProviderName, a.ApiType, a.Endpoint, a.StatusCode, a.DurationMs, a.InputTokens,
		a.CachedInputTokens, a.OutputTokens, a.Cost, a.Stream, a.Err,
		a.CreateTime, nil, nil)
	if err != nil {
		return err
	}
	return auditTrim(db, a.Success)
}

// auditTrim deletes rows of one outcome beyond the newest AuditKeep.
func auditTrim(db *sql.DB, success int64) error {
	_, err := db.Exec(`DELETE FROM audit_log WHERE success = ? AND id NOT IN (
		SELECT id FROM audit_log WHERE success = ? ORDER BY ts DESC, rowid DESC LIMIT ?)`,
		success, success, AuditKeep)
	return err
}

// AuditList — newest-first, at most 2*AuditKeep rows by construction.
func AuditList(db *sql.DB) ([]*AuditLog, error) {
	rows, err := db.Query(`SELECT ` + auditCols + ` FROM audit_log WHERE delete_time IS NULL ORDER BY ts DESC, rowid DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]*AuditLog, 0, 16)
	for rows.Next() {
		a, err := scanAudit(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
