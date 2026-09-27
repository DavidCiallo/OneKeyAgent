package api

import "testing"

func TestThroughput(t *testing.T) {
	cases := []struct {
		name         string
		outputTokens int64
		durationMs   int64
		ttftMs       int64
		want         float64
	}{
		{"typical", 100, 2000, 0, 50},        // 100 tokens in 2s
		{"sub-second", 20, 500, 0, 40},       // 20 tokens in 0.5s
		{"fractional", 1, 3000, 0, 0.333333}, // rounded to 6 decimals
		{"no tokens", 0, 1500, 0, 0},         // failed / empty attempt
		{"no duration", 50, 0, 0, 0},         // defensive: avoids div-by-zero
		{"negative tokens", -5, 1000, 0, 0},  // defensive
		// First-token wait is excluded: 100 tokens in the 1s left after a 1s
		// think, not 100 over the whole 2s.
		{"slow first token", 100, 2000, 1000, 100},
		// Nothing left once the wait is taken out: report nothing rather than
		// dividing by zero.
		{"all wait", 100, 1000, 1000, 0},
		// A measurement larger than the request means the clocks disagree; fall
		// back to the whole duration instead of inventing time.
		{"ttft beyond duration", 100, 2000, 5000, 50},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := throughput(c.outputTokens, c.durationMs, c.ttftMs)
			if diff := got - c.want; diff > 1e-6 || diff < -1e-6 {
				t.Errorf("throughput(%d, %d, %d) = %v, want %v",
					c.outputTokens, c.durationMs, c.ttftMs, got, c.want)
			}
		})
	}
}
