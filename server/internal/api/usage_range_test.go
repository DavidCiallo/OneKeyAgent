package api

import (
	"testing"
	"time"

	"onekey/server/internal/store"
)

// TestSelectGranularityFollowsTheRequestedStep — the source resolution is chosen
// by the step the caller asked for, not only by how long the range is.
//
// This is the regression behind an empty chart: a single-day range asking for 1d
// windows was answered from the 1m rows, and since the day folding only ever sees
// rows of the granularity that was read, a 1d window built from 1m rows is not a
// day at all. A one-day range at a 1d step must read the 60m rows.
func TestSelectGranularityFollowsTheRequestedStep(t *testing.T) {
	now := store.Now()
	day := int64(86_400_000)

	cases := []struct {
		name    string
		gap     int
		since   int64
		want    string
		because string
	}{
		{"1d step over one day", 1440, now - day/2, "60m",
			"a day must be folded from hour rows, not read as 1m"},
		{"1d step over a month", 1440, now - 30*day, "60m",
			"the 1m rows do not reach back a month"},
		{"1h step over one day", 60, now - day/2, "1m",
			"an hour still needs minute rows to show a trend"},
		{"1h step over a month", 60, now - 30*day, "60m",
			"1m retention is a week, so a month reads 60m"},
		{"10m step over one day", 10, now - day/2, "1m",
			"10m can only come from 1m"},
		{"1m step over one day", 1, now - day/2, "1m",
			"the finest step always reads 1m"},
		{"1m step over a month", 1, now - 30*day, "1m",
			"the step wins even when the range is long"},
	}

	for _, tc := range cases {
		got := selectGranularity(tc.gap, tc.since)
		if got != tc.want {
			t.Errorf("%s: selectGranularity(%d, ...) = %q, want %q (%s)",
				tc.name, tc.gap, got, tc.want, tc.because)
		}
	}
}

// TestWindowEndOfAdvancesLocalDays — a day-or-longer window ends at the next
// local midnight, which is not always start+24h: a local day is 23 or 25 hours
// across a DST transition. The client sizes its bars from this range, so a fixed
// gap would draw a day that does not match the data.
func TestWindowEndOfAdvancesLocalDays(t *testing.T) {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skip("zone unavailable")
	}
	store.SetStatsLocation("America/New_York")
	defer store.SetStatsLocation("UTC")

	day := int64(86_400_000)
	for _, d := range []time.Time{
		time.Date(2024, 3, 9, 0, 0, 0, 0, loc),  // before spring forward
		time.Date(2024, 3, 10, 0, 0, 0, 0, loc), // 23-hour day
		time.Date(2024, 11, 2, 0, 0, 0, 0, loc), // before fall back
		time.Date(2024, 11, 3, 0, 0, 0, 0, loc), // 25-hour day
	} {
		start := d.UnixMilli()
		end := windowEndOf(start, day)
		got := time.UnixMilli(end).In(loc)
		if got.Hour() != 0 || got.Minute() != 0 {
			t.Errorf("%s: window ends at %s, not local midnight",
				d.Format("2006-01-02"), got.Format("2006-01-02 15:04"))
		}
		// And exactly one calendar day later.
		want := d.AddDate(0, 0, 1)
		if got.Day() != want.Day() || got.Month() != want.Month() {
			t.Errorf("%s: window ends on %s, want %s",
				d.Format("2006-01-02"), got.Format("2006-01-02"), want.Format("2006-01-02"))
		}
		// The DST days genuinely are not 24h, which is the whole point.
		span := end - start
		if d.Day() == 10 && d.Month() == 3 && span != 23*3_600_000 {
			t.Errorf("spring-forward day spanned %dh, want 23h", span/3_600_000)
		}
		if d.Day() == 3 && d.Month() == 11 && span != 25*3_600_000 {
			t.Errorf("fall-back day spanned %dh, want 25h", span/3_600_000)
		}
	}

	// Sub-day steps stay a plain offset: those rows are on absolute boundaries.
	if got := windowEndOf(0, 3_600_000); got != 3_600_000 {
		t.Errorf("1h window end = %d, want 3600000", got)
	}
}
