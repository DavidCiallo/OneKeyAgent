package api

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"onekey/server/internal/cryptox"
	"onekey/server/internal/httpx"
	"onekey/server/internal/service"
	"onekey/server/internal/store"
)

func resolveAccount(a *App, c *httpx.Ctx) (*store.Account, error) {
	account, err := service.AccountByAuth(a.DB, c.Auth)
	if err != nil {
		return nil, fmt.Errorf("Unauthorized")
	}
	return account, nil
}

// ─────────────────────────── subscription controller ───────────────────────────

func (a *App) subscriptionRecords(c *httpx.Ctx) (any, error) {
	account, err := resolveAccount(a, c)
	if err != nil {
		return nil, err
	}
	txs, err := store.TxByAccount(a.DB, account.ID)
	if err != nil {
		return nil, err
	}
	list := make([]map[string]any, 0, len(txs))
	for _, t := range txs {
		list = append(list, t.DTO())
	}
	return map[string]any{"list": list}, nil
}

func (a *App) subscriptionCreateTopup(c *httpx.Ctx) (any, error) {
	account, err := resolveAccount(a, c)
	if err != nil {
		return nil, err
	}
	if !service.TopupLimiter.Allow("createtopup:" + account.ID) {
		return nil, fmt.Errorf("Too many requests, please try again later")
	}
	tokenAmount := c.Float("token_amount")
	if tokenAmount <= 0 {
		return nil, fmt.Errorf("token_amount must be positive")
	}
	payCurrency := c.Str("pay_currency")
	if payCurrency == "" {
		payCurrency = "USDTERC20"
	}
	invoiceURL, paymentID, invoiceID, err := service.NowPaymentsInvoice(a.Settings, tokenAmount, account.ID, payCurrency)
	if err != nil {
		return nil, err
	}
	if _, err := store.GenericInsert(a.DB, "transaction", map[string]any{
		"account_id": account.ID, "txid": invoiceID, "amount": tokenAmount,
		"confirmations": 0, "status": "pending", "type": "topup",
	}); err != nil {
		return nil, err
	}
	return map[string]any{
		"invoice_url": invoiceURL, "payment_id": paymentID,
		"token_amount": tokenAmount, "price_dollars": tokenAmount,
	}, nil
}

func (a *App) subscriptionIPN(c *httpx.Ctx) (any, error) {
	rawBody := string(c.RawBody)
	signature := c.R.Header.Get("x-nowpayments-sig")
	if signature == "" {
		signature = c.R.Header.Get("x-nowpayments-signature")
	}
	secret := a.Settings.Get("ipn_secret")
	fail := func(msg string) (any, error) {
		fmt.Println("[IPN]", msg)
		return map[string]any{"success": false, "message": msg}, nil
	}
	if len(secret) > 6 {
		if signature == "" || rawBody == "" {
			return fail("missing signature")
		}
		if !service.VerifyNowPaymentsSignature(rawBody, signature, secret) {
			return fail("invalid signature")
		}
	} else {
		return fail("invalid secret")
	}

	body := c.M
	paymentID := fmt.Sprintf("%v", body["payment_id"])
	invoiceID := fmt.Sprintf("%v", body["invoice_id"])
	paymentStatus := fmt.Sprintf("%v", body["payment_status"])
	orderID := fmt.Sprintf("%v", body["order_id"])
	fmt.Printf("[IPN] Webhook received: payment=%s status=%s order=%s\n", paymentID, paymentStatus, orderID)

	if paymentID == "" || paymentID == "<nil>" {
		return fail("missing payment_id")
	}

	pending, err := store.TxPending(a.DB)
	if err != nil {
		return fail(fmt.Sprintf("%v", err))
	}
	var record *store.Transaction
	for _, r := range pending {
		if r.Txid == invoiceID {
			record = r
			break
		}
	}
	if record == nil {
		fmt.Printf("[IPN] No pending record found for payment %s\n", paymentID)
		return map[string]any{"success": true, "message": "no pending record"}, nil
	}

	switch paymentStatus {
	case "finished", "confirmed":
		if err := store.TxUpdateByTxid(a.DB, record.Txid, map[string]any{
			"payment_id": paymentID, "status": "confirmed", "confirmations": 1,
		}); err != nil {
			return fail(fmt.Sprintf("%v", err))
		}
		if err := store.AccountAddBalance(a.DB, record.AccountID, record.Amount); err != nil {
			return fail(fmt.Sprintf("%v", err))
		}
		fmt.Printf("[IPN] Account %s topped up %v tokens\n", record.AccountID, record.Amount)
	case "failed", "expired", "refunded":
		_ = store.TxUpdateByTxid(a.DB, record.Txid, map[string]any{"status": "expired"})
	}
	return map[string]any{"success": true, "message": "ok"}, nil
}

// statement — unified balance history (records + cards + daily usage).
func (a *App) subscriptionStatement(c *httpx.Ctx) (any, error) {
	account, err := resolveAccount(a, c)
	if err != nil {
		return nil, err
	}
	txs, err := store.TxByAccount(a.DB, account.ID)
	if err != nil {
		return nil, err
	}
	cards, err := store.CardRedeemedBy(a.DB, account.ID)
	if err != nil {
		return nil, err
	}
	since := store.Now() - 90*dayMs
	gran := "60m"
	aid := account.ID

	type usageEntry struct {
		tokens       float64
		maxTimestamp int64
	}
	dailyModelUsage := map[string]*usageEntry{}
	_, err = store.BucketEach(a.DB, store.BucketFilter{
		Granularity:   &gran,
		AccountID:     &aid,
		CreateTimeGte: &since,
	}, func(b *store.UsageBucket) bool {
		day := time.UnixMilli(b.BucketTime).UTC().Format("2006-01-02")
		model := b.ModelAlias
		if model == "" {
			model = "Unknown"
		}
		key := day + "|" + model
		entry, ok := dailyModelUsage[key]
		if !ok {
			entry = &usageEntry{}
			dailyModelUsage[key] = entry
		}
		entry.tokens += b.Cost
		if b.CreateTime > entry.maxTimestamp {
			entry.maxTimestamp = b.CreateTime
		}
		return true
	})
	if err != nil {
		return nil, err
	}

	type item struct {
		ID          string  `json:"id"`
		Type        string  `json:"type"`
		Amount      float64 `json:"amount"`
		Description string  `json:"description"`
		Remark      string  `json:"remark"`
		CreateTime  int64   `json:"create_time"`
	}
	items := []item{}

	for _, tx := range txs {
		remark := "#" + tx.Txid
		if tx.Txid == "" {
			idPart := tx.ID
			if len(idPart) > 8 {
				idPart = idPart[:8]
			}
			remark = "#" + idPart
		}
		items = append(items, item{
			ID: tx.ID, Type: "topup", Amount: tx.Amount, Description: "Topup",
			Remark: remark, CreateTime: tx.CreateTime,
		})
	}
	for _, card := range cards {
		ts := card.RedeemedAt
		if ts == nil {
			t := card.CreateTime
			ts = &t
		}
		remark := fmt.Sprintf("#%s", fmt.Sprintf("%d", *ts)[maxInt(0, len(fmt.Sprintf("%d", *ts))-10):])
		switch {
		case strings.HasPrefix(card.Code, "daily_"):
			items = append(items, item{ID: card.ID, Type: "bonus", Amount: card.TokenAmount, Description: "Daily Bonus", Remark: remark, CreateTime: *ts})
		case strings.HasPrefix(card.Code, "register_"):
			items = append(items, item{ID: card.ID, Type: "bonus", Amount: card.TokenAmount, Description: "Registration Bonus", Remark: remark, CreateTime: *ts})
		default:
			code := card.Code
			if len(code) > 20 {
				code = code[:20]
			}
			items = append(items, item{ID: card.ID, Type: "gift_card", Amount: card.TokenAmount, Description: "Gift Card Redeemed", Remark: "#" + code, CreateTime: *ts})
		}
	}
	for key, entry := range dailyModelUsage {
		model := strings.SplitN(key, "|", 2)[1]
		items = append(items, item{
			ID: "usage_" + key, Type: "usage", Amount: store.Round6(entry.tokens),
			Description: "AI Usage", Remark: model, CreateTime: entry.maxTimestamp,
		})
	}

	sort.Slice(items, func(i, j int) bool { return items[i].CreateTime > items[j].CreateTime })

	page := int(c.Int("page"))
	if page == 0 {
		page = 1
	}
	const pageSize = 20
	offset := (page - 1) * pageSize
	if offset > len(items) {
		offset = len(items)
	}
	end := offset + pageSize
	if end > len(items) {
		end = len(items)
	}
	return map[string]any{"list": items[offset:end], "total": len(items)}, nil
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// ─────────────────────────── gift card controller ───────────────────────────

func (a *App) giftCardCreate(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	// nanoid(32) → letters only → upper → 16 chars, padded with X
	code := lettersUpper(cryptox.Nanoid(32), 16)
	for len(code) < 16 {
		code += "X"
	}
	if _, err := store.GenericInsert(a.DB, "gift_card", map[string]any{
		"code": code, "token_amount": c.Float("token_amount"), "status": "unused",
		"redeemed_by": nil, "redeemed_at": nil,
	}); err != nil {
		return nil, err
	}
	card, err := store.CardFindByCode(a.DB, code)
	if err != nil {
		return nil, err
	}
	return map[string]any{"card": card.DTO()}, nil
}

func lettersUpper(s string, n int) string {
	var b strings.Builder
	for _, r := range s {
		if (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') {
			b.WriteRune(r)
		}
	}
	out := strings.ToUpper(b.String())
	if len(out) > n {
		out = out[:n]
	}
	return out
}

func (a *App) giftCardList(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	cards, err := store.CardAllActive(a.DB)
	if err != nil {
		return nil, err
	}
	list := []map[string]any{}
	for _, card := range cards {
		if card.TokenAmount > 1 {
			list = append(list, card.DTO())
		}
	}
	return map[string]any{"list": list}, nil
}

func (a *App) giftCardRedeem(c *httpx.Ctx) (any, error) {
	account, err := resolveAccount(a, c)
	if err != nil {
		return nil, err
	}
	if !service.RedeemLimiter.Allow("redeem:" + account.ID) {
		return nil, fmt.Errorf("Too many attempts, please try again later")
	}
	code := c.Str("code")
	card, err := store.CardFindByCode(a.DB, code)
	if err == store.ErrNotFound || card == nil || card.Status != "unused" {
		return nil, fmt.Errorf("Invalid or already redeemed gift card code")
	}
	if err != nil {
		return nil, err
	}
	// atomic claim (fixes the TS double-redeem race)
	ok, err := store.CardMarkRedeemed(a.DB, card.ID, account.ID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, fmt.Errorf("Invalid or already redeemed gift card code")
	}
	if err := store.AccountAddBalance(a.DB, account.ID, card.TokenAmount); err != nil {
		return nil, err
	}
	return map[string]any{"token_amount": card.TokenAmount}, nil
}

func (a *App) giftCardCleanup(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	deleted, err := store.CardCleanupExpired(a.DB, store.Now()-30*24*60*60*1000)
	if err != nil {
		return nil, err
	}
	return map[string]any{"deleted_count": deleted}, nil
}
