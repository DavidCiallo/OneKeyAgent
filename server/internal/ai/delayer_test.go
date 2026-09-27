package ai

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

// A fast provider can hand its whole stream over in a single read, which is
// exactly the case a per-block wait is for: a read-sized wait would leave the
// whole burst out before any of it applied. The first block goes out at once and
// the rest follow one delay apart.
func TestMeteredCopyDelaysASingleBurst(t *testing.T) {
	const blocks = 200
	const delay = 10 * time.Millisecond

	var sb strings.Builder
	for i := 0; i < blocks; i++ {
		sb.WriteString(`data: {"choices":[{"index":0,"delta":{"content":"x"}}]}` + "\n\n")
	}
	body := []byte(sb.String())

	// bytes.Reader returns the whole body from the first Read, which is the
	// shape a bursting upstream has on the wire.
	var out bytes.Buffer
	sc := &meteredScanner{}
	d := &streamDelayer{delay: delay}
	start := time.Now()
	meteredCopy(&out, bytes.NewReader(body), sc, d)
	elapsed := time.Since(start)

	if out.String() != string(body) {
		t.Fatalf("the stream was altered: %d bytes in, %d out", len(body), out.Len())
	}
	if d.frames != blocks {
		t.Fatalf("held back %d blocks, want %d", d.frames, blocks)
	}
	// One block is immediate, so the budget is (blocks-1) waits.
	want := time.Duration(blocks-1) * delay
	if d.slept < want*90/100 {
		t.Fatalf("held back only %v of the %v budget", d.slept, want)
	}
	if elapsed < want*90/100 {
		t.Fatalf("%d blocks %v apart took %v: the burst went out undelayed", blocks, delay, elapsed)
	}
	if elapsed > want+2*time.Second {
		t.Fatalf("took %v, want about %v", elapsed, want)
	}
}

// Control frames carry no output, so a wait must not stretch a stream that has
// nothing to show for it: role, finish_reason, usage and [DONE] are bookkeeping
// and the caller sees no speed from them.
func TestMeteredCopyDelaysOnlyOutputFrames(t *testing.T) {
	body := []byte(
		`data: {"choices":[{"index":0,"delta":{"role":"assistant"}}]}` + "\n\n" +
			`data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":9}}` + "\n\n" +
			"data: [DONE]\n\n")

	var out bytes.Buffer
	sc := &meteredScanner{}
	d := &streamDelayer{delay: 50 * time.Millisecond}
	start := time.Now()
	meteredCopy(&out, bytes.NewReader(body), sc, d)
	elapsed := time.Since(start)

	if out.String() != string(body) {
		t.Fatalf("the stream was altered: %d bytes in, %d out", len(body), out.Len())
	}
	if d.frames != 0 {
		t.Fatalf("counted %d output blocks, want 0", d.frames)
	}
	if elapsed >= 50*time.Millisecond {
		t.Fatalf("a stream with no output waited %v", elapsed)
	}
}

// A thinking model's thinking is billed output and is the first thing on the
// wire, so it is held back by the same rule as the text after it. Slowing only
// the visible tail would leave the thinking — usually the bulk of the response —
// at full speed.
func TestMeteredCopyDelaysReasoningToo(t *testing.T) {
	const blocks = 5
	const delay = 20 * time.Millisecond

	var sb strings.Builder
	for i := 0; i < blocks; i++ {
		sb.WriteString(`data: {"choices":[{"index":0,"delta":{"reasoning_content":"hmm"}}]}` + "\n\n")
	}
	body := []byte(sb.String())

	var out bytes.Buffer
	sc := &meteredScanner{}
	d := &streamDelayer{delay: delay}
	meteredCopy(&out, bytes.NewReader(body), sc, d)

	if d.frames != blocks {
		t.Fatalf("held back %d blocks, want %d: thinking is output", d.frames, blocks)
	}
	if want := time.Duration(blocks-1) * delay; d.slept < want*90/100 {
		t.Fatalf("thinking waited only %v of %v", d.slept, want)
	}
}

// With no setting the common path is untouched: one feed and one write per read,
// with no frame splitting to pay for.
func TestMeteredCopyWithoutADelayForwardsAtOnce(t *testing.T) {
	var sb strings.Builder
	for i := 0; i < 200; i++ {
		sb.WriteString(`data: {"choices":[{"index":0,"delta":{"content":"x"}}]}` + "\n\n")
	}
	body := []byte(sb.String())

	var out bytes.Buffer
	sc := &meteredScanner{}
	d := &streamDelayer{}
	start := time.Now()
	meteredCopy(&out, bytes.NewReader(body), sc, d)
	elapsed := time.Since(start)

	if out.String() != string(body) {
		t.Fatalf("the stream was altered: %d bytes in, %d out", len(body), out.Len())
	}
	if d.frames != 0 {
		t.Fatalf("counted %d blocks with no delay set", d.frames)
	}
	if elapsed > 200*time.Millisecond {
		t.Fatalf("an undelayed stream took %v", elapsed)
	}
}

// The delayer's arithmetic, without sleeping through it. next is set by hand
// here; the first-block behaviour has its own test below.
func TestDelayerWait(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	cases := []struct {
		name  string
		delay time.Duration
		next  time.Time
		want  time.Duration
	}{
		{"no delay", 0, now, 0},
		{"a negative delay is no delay", -time.Millisecond, now, 0},
		{"the next block is due in a second", time.Second, now.Add(time.Second), time.Second},
		{"the next block is due now", time.Second, now, 0},
		{"the next block is overdue", time.Second, now.Add(-time.Second), 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			d := &streamDelayer{delay: c.delay, next: c.next}
			if got := d.wait(now); got != c.want {
				t.Fatalf("wait = %v, want %v", got, c.want)
			}
		})
	}
}

// The first output block defines TTFT, so holding it back would move the wait
// without the measurement seeing it: the wait starts after it, not before it.
func TestDelayerFirstBlockIsImmediate(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	const delay = 100 * time.Millisecond
	d := &streamDelayer{delay: delay}

	if got := d.wait(now); got != 0 {
		t.Fatalf("the first block waited %v, want 0", got)
	}
	if !d.next.IsZero() {
		t.Fatalf("a next block was scheduled before anything was sent: %v", d.next)
	}
	d.sent(now)
	if !d.next.Equal(now.Add(delay)) {
		t.Fatalf("next = %v, want %v", d.next, now.Add(delay))
	}
	if got := d.wait(now); got != delay {
		t.Fatalf("the next block waited %v, want %v", got, delay)
	}
	if d.frames != 1 {
		t.Fatalf("frames = %d, want 1", d.frames)
	}
}

// The schedule restarts from the frame that was actually sent, so a client that
// stalls does not build up a backlog that later comes out in a burst.
func TestDelayerReschedulesFromTheSend(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	const delay = 50 * time.Millisecond
	d := &streamDelayer{delay: delay}

	d.sent(now)
	// The block only made it out 200ms late; the next one is due a delay after
	// that send, not four delays after the one before it.
	late := now.Add(200 * time.Millisecond)
	d.sent(late)
	if !d.next.Equal(late.Add(delay)) {
		t.Fatalf("next = %v, want %v", d.next, late.Add(delay))
	}
}

func TestNilDelayerLeavesTheStreamAlone(t *testing.T) {
	var d *streamDelayer
	if got := d.wait(time.Now()); got != 0 {
		t.Fatalf("a nil delayer delayed the stream by %v", got)
	}
	if d.active() {
		t.Fatal("a nil delayer reported itself active")
	}
	d.sent(time.Now()) // must not panic
}

// The delayer keys off the scanner's output count, so the count has to move for
// thinking exactly as it does for content.
func TestScannerCountsReasoningAsOutput(t *testing.T) {
	sc := &meteredScanner{}
	sc.feed([]byte(`data: {"choices":[{"delta":{"content":"abc"}}]}` + "\n"))
	if sc.OutputDeltas != 1 {
		t.Fatalf("OutputDeltas = %d, want 1 after a content delta", sc.OutputDeltas)
	}
	sc.feed([]byte(`data: {"choices":[{"delta":{"reasoning_content":"hmm"}}]}` + "\n"))
	if sc.OutputDeltas != 2 {
		t.Fatalf("OutputDeltas = %d, want 2 after a reasoning delta", sc.OutputDeltas)
	}
	sc.feed([]byte(`data: {"choices":[{"delta":{"role":"assistant"}}]}` + "\n"))
	if sc.OutputDeltas != 2 {
		t.Fatalf("OutputDeltas = %d, want 2: a role frame is not output", sc.OutputDeltas)
	}
}
