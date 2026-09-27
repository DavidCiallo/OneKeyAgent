package ai

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

// A fast provider can hand its whole stream over in a single read, which is
// exactly the case a ceiling is wanted for. Pacing per read lets all of it
// through before any wait applies, because the first read is what starts the
// budget — so the budget has to be spent per frame, not per read.
func TestMeteredCopyPacesASingleBurst(t *testing.T) {
	const tokens = 200
	var sb strings.Builder
	for i := 0; i < tokens; i++ {
		sb.WriteString(`data: {"choices":[{"index":0,"delta":{"content":"x"}}]}` + "\n\n")
	}
	body := []byte(sb.String())

	// bytes.Reader returns the whole body from the first Read, which is the
	// shape a bursting upstream has on the wire.
	var out bytes.Buffer
	sc := &meteredScanner{}
	start := time.Now()
	meteredCopy(&out, bytes.NewReader(body), sc, &streamPacer{rate: 100})
	elapsed := time.Since(start)

	if out.String() != string(body) {
		t.Fatalf("the stream was altered: %d bytes in, %d out", len(body), out.Len())
	}
	if got := sc.outputTokensEstimate(); got != tokens {
		t.Fatalf("estimate = %d, want %d", got, tokens)
	}
	// 200 tokens at 100 t/s is two seconds of budget.
	if elapsed < 1900*time.Millisecond {
		t.Fatalf("%d tokens at 100 t/s took %v: the burst went out unpaced", tokens, elapsed)
	}
	if elapsed > 3*time.Second {
		t.Fatalf("took %v, want about 2s", elapsed)
	}
}

// The pacer is what a provider's max_tps turns into, so its arithmetic is worth
// pinning without sleeping through it. The origin is set by hand here: the
// first-token behaviour has its own test below.
func TestPacerDelay(t *testing.T) {
	origin := time.Unix(1_700_000_000, 0)
	cases := []struct {
		name   string
		rate   float64
		tokens int
		spent  time.Duration
		want   time.Duration
	}{
		{"no ceiling", 0, 100, time.Second, 0},
		{"a negative ceiling is no ceiling", -5, 100, time.Second, 0},
		{"nothing produced yet", 100, 0, time.Second, 0},
		{"a second of output at 100 t/s", 100, 100, 0, time.Second},
		{"half the budget already spent", 100, 100, 500 * time.Millisecond, 500 * time.Millisecond},
		{"exactly on budget is not held", 100, 100, time.Second, 0},
		{"ahead of budget is not held", 100, 100, 2 * time.Second, 0},
		{"half the ceiling waits twice as long", 50, 100, 0, 2 * time.Second},
		{"ten tokens at 100 t/s", 100, 10, 0, 100 * time.Millisecond},
		{"a ceiling above the real rate still paces", 1000, 100, 0, 100 * time.Millisecond},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := &streamPacer{rate: c.rate, origin: origin}
			if got := p.delay(c.tokens, origin.Add(c.spent)); got != c.want {
				t.Fatalf("delay = %v, want %v", got, c.want)
			}
		})
	}
}

// The first token defines TTFT, so holding it back would move the wait without
// the measurement seeing it: the budget starts there instead.
func TestPacerFirstTokenStartsTheBudgetWithoutWaiting(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	p := &streamPacer{rate: 100}

	if got := p.delay(1, now); got != 0 {
		t.Fatalf("the first token waited %v, want 0", got)
	}
	if !p.origin.Equal(now) {
		t.Fatalf("origin = %v, want %v", p.origin, now)
	}
	// The budget is counted from that first token, and the first token spends
	// budget like any other, so 101 tokens at 100 t/s are held to 1.01s. That is
	// what makes the rate come out at the ceiling rather than a little under it.
	if got := p.delay(101, now); got != 1010*time.Millisecond {
		t.Fatalf("the next chunk waited %v, want 1.01s", got)
	}
}

func TestNilPacerLeavesTheStreamAlone(t *testing.T) {
	var p *streamPacer
	if got := p.delay(1000, time.Now()); got != 0 {
		t.Fatalf("a nil pacer delayed the stream by %v", got)
	}
}

// What the pacer charges the budget for: billed output, which includes thinking
// and is not the content-only estimate the billing fallback uses. Mid-stream
// there is no usage to read, so it is inferred.
func TestOutputTokensEstimate(t *testing.T) {
	feed := func(frames ...string) *meteredScanner {
		sc := &meteredScanner{}
		for _, f := range frames {
			sc.feed([]byte(f))
		}
		return sc
	}
	content := func(s string) string {
		return `data: {"choices":[{"delta":{"content":"` + s + `"}}]}` + "\n"
	}
	thinking := func(s string) string {
		return `data: {"choices":[{"delta":{"reasoning_content":"` + s + `"}}]}` + "\n"
	}

	t.Run("latin text, four characters to the token", func(t *testing.T) {
		sc := feed(content("abcdefgh"))
		if got := sc.outputTokensEstimate(); got != 2 {
			t.Fatalf("estimate = %d, want 2", got)
		}
	})
	t.Run("one delta per token is the floor", func(t *testing.T) {
		// Two one-character deltas are two tokens, not half of one. This is what
		// stops a script where a character is a token spending its budget four
		// times too fast.
		sc := feed(content("to"), content("k"))
		if got := sc.outputTokensEstimate(); got != 2 {
			t.Fatalf("estimate = %d, want 2", got)
		}
	})
	t.Run("thinking is billed output", func(t *testing.T) {
		sc := feed(thinking("thinking!"))
		if got := sc.outputTokensEstimate(); got != 2 {
			t.Fatalf("estimate = %d, want 2", got)
		}
		if sc.EstimatedChars != 0 {
			t.Fatalf("EstimatedChars = %d, want 0: thinking is not content", sc.EstimatedChars)
		}
	})
	t.Run("an empty delta is not output", func(t *testing.T) {
		sc := feed(content(""), thinking(""))
		if got := sc.outputTokensEstimate(); got != 0 {
			t.Fatalf("estimate = %d, want 0", got)
		}
	})
	t.Run("usage alone is not output", func(t *testing.T) {
		sc := feed(`data: {"choices":[{"delta":{}}],"usage":{"completion_tokens":900}}` + "\n")
		if got := sc.outputTokensEstimate(); got != 0 {
			t.Fatalf("estimate = %d, want 0", got)
		}
	})
}
