package ai

import (
	"testing"
	"time"
)

// TestScannerStampsFirstToken — time to first token has to be the first *token*,
// and it must be stamped once. The opening chunk of an OpenAI stream carries
// only the role, and treating that as the first token would report a fast model
// for every provider.
func TestScannerStampsFirstToken(t *testing.T) {
	var sc meteredScanner

	sc.feed([]byte("data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\n"))
	if sc.FirstTokenAt != 0 {
		t.Fatalf("a role-only chunk stamped a first token: %d", sc.FirstTokenAt)
	}

	sc.feed([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"\"}}]}\n\n"))
	if sc.FirstTokenAt != 0 {
		t.Fatalf("an empty content delta stamped a first token: %d", sc.FirstTokenAt)
	}

	sc.feed([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n"))
	first := sc.FirstTokenAt
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
	if sc.FirstTokenAt != first {
		t.Fatalf("the stamp moved: %d then %d", first, sc.FirstTokenAt)
	}
	if sc.EstimatedChars != 5 {
		t.Fatalf("EstimatedChars = %d, want 5", sc.EstimatedChars)
	}
}

// TestScannerStampsThinking — a thinking model streams its thinking first, and
// the provider bills it inside completion_tokens. Starting the clock at the
// first visible token instead would divide the whole output by the visible tail
// alone and report a rate no model can reach.
func TestScannerStampsThinking(t *testing.T) {
	var sc meteredScanner

	sc.feed([]byte("data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"let me\"}}]}\n\n"))
	if sc.FirstTokenAt == 0 {
		t.Fatal("a reasoning delta did not start the clock")
	}
	// Thinking is not visible content, so it must not inflate the content
	// estimate the usage check is based on.
	if sc.EstimatedChars != 0 {
		t.Fatalf("EstimatedChars = %d, want 0 — thinking is not content", sc.EstimatedChars)
	}

	// An empty reasoning delta carries no token.
	var empty meteredScanner
	empty.feed([]byte("data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"\"}}]}\n\n"))
	if empty.FirstTokenAt != 0 {
		t.Fatalf("an empty reasoning delta stamped a first token: %d", empty.FirstTokenAt)
	}

	// And the clock still belongs to the thinking when content follows.
	before := sc.FirstTokenAt
	time.Sleep(3 * time.Millisecond)
	sc.feed([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"answer\"}}]}\n\n"))
	if sc.FirstTokenAt != before {
		t.Fatalf("the content delta moved the stamp: %d then %d", before, sc.FirstTokenAt)
	}
	if sc.EstimatedChars != 6 {
		t.Fatalf("EstimatedChars = %d, want 6", sc.EstimatedChars)
	}
}

// TestScannerStampsThinkingWhenNotCapturing — the stamp must not depend on the
// reasoning capture being switched on, which is a per-provider replay setting.
func TestScannerStampsThinkingWhenNotCapturing(t *testing.T) {
	sc := &meteredScanner{Reasoning: nil}
	sc.feed([]byte("data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"hmm\"}}]}\n\n"))
	if sc.FirstTokenAt == 0 {
		t.Fatal("thinking did not start the clock without capture enabled")
	}
}

// TestScannerStampsLegacyTextField — the completions dialect streams content
// under choices.0.text; it is the same first token.
func TestScannerStampsLegacyTextField(t *testing.T) {
	var sc meteredScanner
	sc.feed([]byte("data: {\"choices\":[{\"text\":\"hi\"}]}\n\n"))
	if sc.FirstTokenAt == 0 {
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
