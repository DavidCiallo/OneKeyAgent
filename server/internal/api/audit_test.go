package api

import "testing"

func TestThroughput(t *testing.T) {
	cases := []struct {
		name         string
		outputTokens int64
		durationMs   int64
		want         float64
	}{
		{"typical", 100, 2000, 50},          // 100 tokens in 2s
		{"sub-second", 20, 500, 40},         // 20 tokens in 0.5s
		{"fractional", 1, 3000, 0.333333},   // rounded to 6 decimals
		{"no tokens", 0, 1500, 0},           // failed / empty attempt
		{"no duration", 50, 0, 0},           // defensive: avoids div-by-zero
		{"negative tokens", -5, 1000, 0},    // defensive
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := throughput(c.outputTokens, c.durationMs)
			if diff := got - c.want; diff > 1e-6 || diff < -1e-6 {
				t.Errorf("throughput(%d, %d) = %v, want %v", c.outputTokens, c.durationMs, got, c.want)
			}
		})
	}
}
