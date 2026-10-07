package store

import (
	"testing"
	"time"
)

// TestAlignDownDayStepLandsOnLocalMidnight — a 1d step must return the stats
// zone's midnight for every instant in that day, including the hours around a
// DST transition. This is the property the usage chart's "1d" bucket depends on:
// the 60m rows underneath are summed from that boundary forward, so if the
// boundary drifts by an hour the day's total is wrong at both ends.
func TestAlignDownDayStepLandsOnLocalMidnight(t *testing.T) {
	const dayMs = 86_400_000
	for _, name := range []string{"Asia/Shanghai", "UTC", "America/New_York", "Europe/London"} {
		loc, err := time.LoadLocation(name)
		if err != nil {
			t.Skipf("zone %s unavailable: %v", name, err)
		}
		SetStatsLocation(name)

		// A whole year at six-hour steps, which spans both DST transitions in the
		// zones that have them.
		start := time.Date(2024, 1, 1, 0, 0, 0, 0, loc).UnixMilli()
		for ts := start; ts < start+366*dayMs; ts += 6 * 3_600_000 {
			got := AlignDown(ts, dayMs)
			want := DayStart(ts)
			if got != want {
				d := time.UnixMilli(ts).In(loc)
				t.Fatalf("%s: AlignDown(%s, 1d) = %s, want midnight %s",
					name, d.Format(time.RFC3339), time.UnixMilli(got).In(loc).Format(time.RFC3339),
					time.UnixMilli(want).In(loc).Format(time.RFC3339))
			}
			// And the result really is local midnight.
			g := time.UnixMilli(got).In(loc)
			if g.Hour() != 0 || g.Minute() != 0 || g.Second() != 0 {
				t.Fatalf("%s: %s is not local midnight", name, g.Format(time.RFC3339))
			}
		}
	}
}

// TestAlignDownHourStepsFloorOnAbsoluteTime — the 1m and 60m rows are written on
// absolute hour boundaries, so display windows at or below an hour must floor
// on absolute time rather than on local midnight. Doing otherwise would put the
// window boundary an hour away from every row it is supposed to contain.
func TestAlignDownHourStepsFloorOnAbsoluteTime(t *testing.T) {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Skip("zone unavailable")
	}
	SetStatsLocation("Asia/Shanghai")

	// A timestamp that is deliberately not on an hour.
	ts := time.Date(2024, 6, 15, 13, 47, 33, 0, loc).UnixMilli()

	if got, want := AlignDown(ts, 3_600_000), ts-(ts%3_600_000); got != want {
		t.Fatalf("1h align = %d, want %d", got, want)
	}
	if got, want := AlignDown(ts, 600_000), ts-(ts%600_000); got != want {
		t.Fatalf("10m align = %d, want %d", got, want)
	}
	if got, want := AlignDown(ts, 60_000), ts-(ts%60_000); got != want {
		t.Fatalf("1m align = %d, want %d", got, want)
	}

	// Every hour of a local day maps into that same local day: summing 1h rows
	// from local midnight is therefore a complete day.
	dayStart := DayStart(ts)
	next := DayStart(dayStart + 86_400_000)
	if got := AlignDown(next-1, 3_600_000); got < dayStart || got >= next {
		t.Fatalf("last hour of the day aligned outside it: %d not in [%d,%d)", got, dayStart, next)
	}
}
