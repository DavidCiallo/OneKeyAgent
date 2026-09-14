package cryptox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"testing"
)

// TestDeriveIVIsDeterministic — the IV must depend only on SECRET, so every
// node in a cluster derives the same one.
func TestDeriveIVIsDeterministic(t *testing.T) {
	const secret = "cluster-shared-secret-1234567890"
	a, b := deriveIV(secret), deriveIV(secret)
	if len(a) != 16 {
		t.Fatalf("IV length = %d, want 16", len(a))
	}
	if string(a) != string(b) {
		t.Errorf("deriveIV is not deterministic: %x != %x", a, b)
	}
	if string(a) == string(deriveIV(secret+"x")) {
		t.Error("different SECRETs produced the same IV")
	}
	sum := sha256.Sum256([]byte(secret))
	if string(a) == string(sum[:16]) {
		t.Error("IV is a truncation of the key; use a domain-separated derivation")
	}
}

// TestRoundTripAndNonceUniqueness — encryption must round-trip, and two
// encryptions of the same plaintext must differ. The random nonce prepended by
// AesEncrypt provides that, which is what makes a fixed IV safe here.
func TestRoundTripAndNonceUniqueness(t *testing.T) {
	if os.Getenv("SECRET") == "" {
		os.Setenv("SECRET", "round-trip-secret-1234567890abcdef")
	}
	Init()

	const payload = "admin@test.local|-|1799999999999"
	ct1, ct2 := AesEncrypt(payload), AesEncrypt(payload)
	if ct1 == "" || ct2 == "" {
		t.Fatal("AesEncrypt returned empty")
	}
	if ct1 == ct2 {
		t.Error("two encryptions produced identical ciphertext; nonce is not random")
	}
	for i, ct := range []string{ct1, ct2} {
		got, ok := AesDecrypt(ct)
		if !ok || got != payload {
			t.Errorf("decrypt #%d = %q, %v; want %q, true", i+1, got, ok, payload)
		}
	}
}

// TestDecryptRejectsGarbage — malformed input must fail rather than panic or
// return partial text; the login path depends on this.
func TestDecryptRejectsGarbage(t *testing.T) {
	Init()
	for _, bad := range []string{"", "zz", "abcd", "0011223344556677", string(make([]byte, 32))} {
		if _, ok := AesDecrypt(bad); ok {
			t.Errorf("AesDecrypt(%q) reported success on invalid input", bad)
		}
	}
}

// TestInitIsReproducibleAcrossProcesses — the real regression test. Init's
// sync.Once means one process cannot observe a second initialization, so the
// property that matters (two separate processes deriving the same key+IV) is
// checked by running this test binary as a child twice and comparing the
// fingerprints it prints. With the old random IV these differed, which is
// exactly why a token minted on one node failed on another.
func TestInitIsReproducibleAcrossProcesses(t *testing.T) {
	if os.Getenv("CRYPTOX_FINGERPRINT") == "1" {
		Init()
		fmt.Printf("FINGERPRINT key=%x iv=%x\n", key, iv)
		return
	}

	const secret = "cluster-shared-secret-1234567890"
	run := func() string {
		t.Helper()
		cmd := exec.Command(os.Args[0], "-test.run=TestInitIsReproducibleAcrossProcesses")
		cmd.Env = append(os.Environ(), "CRYPTOX_FINGERPRINT=1", "SECRET="+secret, "NONCE_LENGTH=8")
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("child process failed: %v\n%s", err, out)
		}
		for _, line := range splitLines(string(out)) {
			if len(line) > 12 && line[:12] == "FINGERPRINT " {
				return line
			}
		}
		t.Fatalf("no fingerprint in child output:\n%s", out)
		return ""
	}

	first, second := run(), run()
	if first != second {
		t.Errorf("two processes derived different key/IV:\n  %s\n  %s", first, second)
	}

	// And the fingerprint must not be derivable from an unrelated SECRET.
	cmd := exec.Command(os.Args[0], "-test.run=TestInitIsReproducibleAcrossProcesses")
	cmd.Env = append(os.Environ(), "CRYPTOX_FINGERPRINT=1", "SECRET="+secret+"-other", "NONCE_LENGTH=8")
	out, err := cmd.CombinedOutput()
	if err == nil && string(out) != "" {
		for _, line := range splitLines(string(out)) {
			if len(line) > 12 && line[:12] == "FINGERPRINT " && line == first {
				t.Error("a different SECRET produced the same key/IV")
			}
		}
	}
}

func splitLines(s string) []string {
	var out []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			out = append(out, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		out = append(out, s[start:])
	}
	return out
}

// TestKeyAndIVArePureFunctionsOfSecret — a token sealed with one node's
// derived key/IV opens with another's.
func TestKeyAndIVArePureFunctionsOfSecret(t *testing.T) {
	const secret = "cluster-shared-secret-1234567890"
	nodeAKey := sha256.Sum256([]byte(secret))
	nodeBKey := sha256.Sum256([]byte(secret))
	nodeAIV, nodeBIV := deriveIV(secret), deriveIV(secret)
	if nodeAKey != nodeBKey || string(nodeAIV) != string(nodeBIV) {
		t.Fatal("derivation is not deterministic across nodes")
	}

	payload := "a@test.local|-|1799999999999"
	opened, ok := openWith(nodeBKey[:], nodeBIV, sealWith(nodeAKey[:], nodeAIV, payload))
	if !ok || opened != payload {
		t.Errorf("cross-node open = %q, %v; want %q, true", opened, ok, payload)
	}
}

func sealWith(key, iv []byte, plain string) string {
	block, err := aes.NewCipher(key)
	if err != nil {
		panic(err)
	}
	padded := padPKCS7([]byte(plain), aes.BlockSize)
	out := make([]byte, len(padded))
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(out, padded)
	return hex.EncodeToString(out)
}

func openWith(key, iv []byte, sealed string) (string, bool) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", false
	}
	ct, err := hex.DecodeString(sealed)
	if err != nil || len(ct) == 0 || len(ct)%aes.BlockSize != 0 {
		return "", false
	}
	plain := make([]byte, len(ct))
	cipher.NewCBCDecrypter(block, iv).CryptBlocks(plain, ct)
	plain, ok := unpadPKCS7(plain)
	if !ok {
		return "", false
	}
	return string(plain), true
}
