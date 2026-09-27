package ai

import (
	"testing"
	"time"
)

// TestScannerStampsFirstContentOnly — time to first token has to be the first
// *content*, and it must be stamped once. The opening chunk of an OpenAI stream
// carries only the role, and treating that as the first token would report a
// fast model for every provider.
func TestScannerStampsFirstContentOnly(t *testing.T) {
	var sc meteredScanner

	sc.feed([]byte("data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\n"))
	if sc.FirstContentAt != 0 {
		t.Fatalf("a role-only chunk stamped a first token: %d", sc.FirstContentAt)
	}

	sc.feed([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"\"}}]}\n\n"))
	if sc.FirstContentAt != 0 {
		t.Fatalf("an empty content delta stamped a first token: %d", sc.FirstContentAt)
	}

	sc.feed([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n"))
	first := sc.FirstContentAt
	if first == 0 {
		t.Fatal("the first content delta was not stamped")
	}
	if sc.EstimatedChars != 3 {
		t.Fatalf("EstimatedChars = %d, want 3", sc.EstimatedChars)
	}

	// A later delta must not move the stamp, or the measurement would drift
	// toward the end of the response.
	time.Sleep(3 * time.Millisecond)
	sc.feed([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n"))
	if sc.FirstContentAt != first {
		t.Fatalf("the stamp moved: %d then %d", first, sc.FirstContentAt)
	}
	if sc.EstimatedChars != 5 {
		t.Fatalf("EstimatedChars = %d, want 5", sc.EstimatedChars)
	}
}

// TestScannerStampsLegacyTextField — the completions dialect streams content
// under choices.0.text; it is the same first token.
func TestScannerStampsLegacyTextField(t *testing.T) {
	var sc meteredScanner
	sc.feed([]byte("data: {\"choices\":[{\"text\":\"hi\"}]}\n\n"))
	if sc.FirstContentAt == 0 {
		t.Fatal("a legacy text delta was not stamped")
	}
	if sc.EstimatedChars != 2 {
		t.Fatalf("EstimatedChars = %d, want 2", sc.EstimatedChars)
	}
}

// TestTtftIsClampedIntoTheRequest — the stamp is a wall clock reading, so it is
// only meaningful inside the request it belongs to.
func TestTtftIsClampedIntoTheRequest(t *testing.T) {
	start := time.Now()
	base := start.UnixMilli()

	cases := []struct {
		name     string
		firstAt  int64
		duration int64
		want     int64
	}{
		{"not measured", 0, 1000, 0},
		{"measured", base + 300, 1000, 300},
		{"instant", base, 1000, 0},
		// A stamp before the request began is a clock disagreement, not a
		// negative wait.
		{"before start", base - 50, 1000, 0},
		// Past the end of the request: clamp to the duration rather than report
		// more wait than the request took.
		{"past the end", base + 5000, 1000, 1000},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := ttftMs(start, c.firstAt, c.duration); got != c.want {
				t.Errorf("ttftMs(%d, %d) = %d, want %d", c.firstAt, c.duration, got, c.want)
			}
		})
	}
}
