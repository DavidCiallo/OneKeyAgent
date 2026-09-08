package service

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sync"
	"time"
)

func osLookupEnv(k string) (string, bool) { v, ok := os.LookupEnv(k); return v, ok }

// ─────────────────────────── Email (Resend) ───────────────────────────

const resendAPIURL = "https://api.resend.com/emails"

func SendEmail(s *Settings, to, subject, html string) bool {
	apiKey := s.Get("resend_api_key")
	if apiKey == "" {
		fmt.Println("RESEND_API_KEY is not configured")
		return false
	}
	from := s.Get("email_from")
	if from == "" {
		from = "noreply@ehex.cc"
	}
	body, _ := json.Marshal(map[string]string{"from": from, "to": to, "subject": subject, "html": html})
	req, err := http.NewRequest("POST", resendAPIURL, bytes.NewReader(body))
	if err != nil {
		return false
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		fmt.Println("Failed to send email:", err)
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		text, _ := io.ReadAll(resp.Body)
		fmt.Printf("Resend API error: %d %s\n", resp.StatusCode, text)
		return false
	}
	return true
}

func SendVerificationEmail(s *Settings, to, verifyURL string) bool {
	subject, html := buildVerificationEmail(verifyURL)
	return SendEmail(s, to, subject, html)
}

func buildVerificationEmail(verifyURL string) (string, string) {
	subject := "Verify your email address"
	html := fmt.Sprintf(`
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
            <h2 style="color: #1a1a1a; margin-bottom: 16px;">Verify Your Email</h2>
            <p style="color: #555; line-height: 1.6; margin-bottom: 24px;">
                Thank you for registering. Please click the button below to verify your email address.
            </p>
            <a href="%s"
               style="display: inline-block; background-color: #0066FF; color: #fff; text-decoration: none;
                      padding: 12px 32px; border-radius: 8px; font-weight: 600;">
                Verify Email
            </a>
            <p style="color: #999; font-size: 13px; margin-top: 32px;">
                If you did not create an account, you can safely ignore this email.
                This link expires in 3 days.
            </p>
        </div>
    `, verifyURL)
	return subject, html
}

// ─────────────────────────── Rate limiting (in-memory) ───────────────────────────

type rateLimiter struct {
	mu      sync.Mutex
	counts  map[string]*rateEntry
	window  time.Duration
	max     int
}

type rateEntry struct {
	count       int
	windowStart int64
}

func newRateLimiter(window time.Duration, max int) *rateLimiter {
	rl := &rateLimiter{counts: map[string]*rateEntry{}, window: window, max: max}
	go func() {
		for range time.Tick(2 * time.Minute) {
			now := time.Now().UnixMilli()
			rl.mu.Lock()
			for k, e := range rl.counts {
				if now-e.windowStart > rl.window.Milliseconds() {
					delete(rl.counts, k)
				}
			}
			rl.mu.Unlock()
		}
	}()
	return rl
}

func (rl *rateLimiter) Allow(key string) bool {
	now := time.Now().UnixMilli()
	rl.mu.Lock()
	defer rl.mu.Unlock()
	e, ok := rl.counts[key]
	if !ok || now-e.windowStart > rl.window.Milliseconds() {
		rl.counts[key] = &rateEntry{count: 1, windowStart: now}
		return true
	}
	if e.count >= rl.max {
		return false
	}
	e.count++
	return true
}

var (
	TopupLimiter  = newRateLimiter(60*time.Second, 6)
	RedeemLimiter = newRateLimiter(60*time.Second, 5)
)

// ─────────────────────────── NowPayments ───────────────────────────

const nowpaymentsAPI = "https://api.nowpayments.io/v1"

func NowPaymentsInvoice(s *Settings, priceDollars float64, accountID, payCurrency string) (invoiceURL, paymentID, invoiceID string, err error) {
	apiKey := s.Get("nowpayments_api_key")
	if apiKey == "" {
		return "", "", "", fmt.Errorf("NOWPAYMENTS_API_KEY not configured")
	}
	body := map[string]any{
		"price_amount":      priceDollars,
		"price_currency":    payCurrency,
		"pay_currency":      payCurrency,
		"order_id":          accountID,
		"order_description": "ehex token topup",
		"ipn_callback_url":  s.Get("ipn_callback_url") + "/api/subscription/ipnwebhook",
		"is_fixed_rate":     false,
	}
	payload, _ := json.Marshal(body)
	req, err := http.NewRequest("POST", nowpaymentsAPI+"/invoice", bytes.NewReader(payload))
	if err != nil {
		return "", "", "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", apiKey)
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return "", "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		text, _ := io.ReadAll(resp.Body)
		return "", "", "", fmt.Errorf("NowPayments create invoice failed (%d): %s", resp.StatusCode, text)
	}
	var out struct {
		ID         string `json:"id"`
		InvoiceURL string `json:"invoice_url"`
		PaymentID  string `json:"payment_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", "", "", err
	}
	pid := out.PaymentID
	if pid == "" {
		pid = out.ID
	}
	return out.InvoiceURL, pid, out.ID, nil
}

// NowPaymentsStatus — normalized payment status: confirmed / expired / pending.
func NowPaymentsStatus(s *Settings, paymentID string) (string, float64, error) {
	apiKey := s.Get("nowpayments_api_key")
	if apiKey == "" {
		return "", 0, fmt.Errorf("NOWPAYMENTS_API_KEY not configured")
	}
	req, err := http.NewRequest("GET", nowpaymentsAPI+"/payment/"+paymentID, nil)
	if err != nil {
		return "", 0, err
	}
	req.Header.Set("x-api-key", apiKey)
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		text, _ := io.ReadAll(resp.Body)
		return "", 0, fmt.Errorf("NowPayments check payment failed (%d): %s", resp.StatusCode, text)
	}
	var out struct {
		PaymentStatus string `json:"payment_status"`
		ActuallyPaid  string `json:"actually_paid"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", 0, err
	}
	status := "pending"
	switch out.PaymentStatus {
	case "finished", "confirmed":
		status = "confirmed"
	case "failed", "expired", "refunded":
		status = "expired"
	}
	paid := 0.0
	if out.ActuallyPaid != "" {
		fmt.Sscanf(out.ActuallyPaid, "%f", &paid)
	}
	return status, paid, nil
}

// VerifyNowPaymentsSignature — HMAC-SHA512 hex of the raw body.
func VerifyNowPaymentsSignature(rawBody, signature, secret string) bool {
	mac := hmac.New(sha512.New, []byte(secret))
	mac.Write([]byte(rawBody))
	return hex.EncodeToString(mac.Sum(nil)) == signature
}
