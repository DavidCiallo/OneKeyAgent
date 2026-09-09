// Package cryptox is a drop-in port of server/methods/crypto.ts.
//
// Key = sha256(SECRET); the AES-256-CBC IV is generated once per process
// (tokens do not survive a restart — same as the TS server).
// Ciphertext layout: AES-CBC(nonceHexSuffix + reversed(plaintext)), hex encoded.
package cryptox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"
	"sync"
	"time"
)

var (
	initOnce sync.Once
	key      []byte
	iv       []byte
	nonceLen int
)

// Init derives the key/IV from the environment. Called lazily.
func Init() {
	initOnce.Do(func() {
		secret := os.Getenv("SECRET")
		if secret == "" {
			secret = base36(time.Now().UnixMilli()) // Date.now().toString(36)
		}
		if len(secret) < 16 {
			fmt.Println("Missing SECRET in environment variables or too weak")
		}
		nonceLen = 4
		if v := os.Getenv("NONCE_LENGTH"); v != "" {
			if n, err := parseInt(v); err == nil && n >= 0 {
				nonceLen = n
			}
		}
		if nonceLen < 6 {
			fmt.Println("Missing SECRET or NONCE_LENGTH in environment variables or too weak")
		}
		sum := sha256.Sum256([]byte(secret))
		key = sum[:]
		iv = make([]byte, 16)
		_, _ = rand.Read(iv)
	})
}

func parseInt(s string) (int, error) {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, fmt.Errorf("bad int")
		}
		n = n*10 + int(c-'0')
	}
	return n, nil
}

// base36 — JS Number.prototype.toString(36) for the SECRET fallback.
func base36(n int64) string {
	const alpha = "0123456789abcdefghijklmnopqrstuvwxyz"
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	out := []byte{}
	for n > 0 {
		out = append([]byte{alpha[n%36]}, out...)
		n /= 36
	}
	if neg {
		return "-" + string(out)
	}
	return string(out)
}

// reverse mirrors JS split("").reverse().join("") at the rune level
// (payloads are BMP text: name|email|password, identity|expiry).
func reverse(s string) string {
	r := []rune(s)
	for i, j := 0, len(r)-1; i < j; i, j = i+1, j-1 {
		r[i], r[j] = r[j], r[i]
	}
	return string(r)
}

func AesEncrypt(original string) string {
	Init()
	// nonce = last noncelen hex chars of 128 random bytes, hex-encoded
	raw := make([]byte, 128)
	_, _ = rand.Read(raw)
	hexAll := hex.EncodeToString(raw)
	nonce := hexAll[len(hexAll)-nonceLen:]
	data := nonce + reverse(original)
	block, err := aes.NewCipher(key)
	if err != nil {
		return ""
	}
	padded := padPKCS7([]byte(data), aes.BlockSize)
	out := make([]byte, len(padded))
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(out, padded)
	return hex.EncodeToString(out)
}

func AesDecrypt(encrypted string) (string, bool) {
	Init()
	cipherText, err := hex.DecodeString(encrypted)
	if err != nil || len(cipherText) == 0 || len(cipherText)%aes.BlockSize != 0 {
		return "", false
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", false
	}
	plain := make([]byte, len(cipherText))
	cipher.NewCBCDecrypter(block, iv).CryptBlocks(plain, cipherText)
	plain, ok := unpadPKCS7(plain)
	if !ok {
		return "", false
	}
	text := string(plain)
	if len(text) < nonceLen {
		return "", false
	}
	return reverse(text[nonceLen:]), true
}

func padPKCS7(data []byte, blockSize int) []byte {
	pad := blockSize - len(data)%blockSize
	out := make([]byte, len(data)+pad)
	copy(out, data)
	for i := len(data); i < len(out); i++ {
		out[i] = byte(pad)
	}
	return out
}

func unpadPKCS7(data []byte) ([]byte, bool) {
	if len(data) == 0 {
		return nil, false
	}
	pad := int(data[len(data)-1])
	if pad == 0 || pad > len(data) {
		return nil, false
	}
	for _, b := range data[len(data)-pad:] {
		if int(b) != pad {
			return nil, false
		}
	}
	return data[:len(data)-pad], true
}

// HashGenerate — sha256 hex (password hashing).
func HashGenerate(data string) string {
	sum := sha256.Sum256([]byte(data))
	return hex.EncodeToString(sum[:])
}

// GenerateApiKey — "sk-" + UUID v4.
func GenerateApiKey() string {
	return "sk-" + UUIDv4()
}

const nanoidAlphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict"

// Nanoid — same alphabet/length semantics as the nanoid package.
func Nanoid(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	out := make([]rune, n)
	for i, c := range b {
		out[i] = rune(nanoidAlphabet[int(c)%len(nanoidAlphabet)])
	}
	return string(out)
}

// UUIDv4 — crypto.randomUUID() equivalent.
func UUIDv4() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// Base64UrlEncode — no padding (session key for reasoning replay).
func Base64UrlEncode(s string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(s))
}
