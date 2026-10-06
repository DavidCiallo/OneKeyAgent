package store

import (
	"testing"
	"time"
)

// The bug these cover: with the container on UTC, every calendar boundary in the
// statistics path was cut in UTC, so a Beijing operator's "today" began at 08:00
// and a 6h window landed at 02:00/08:00/14:00/20:00 instead of the local
// midnight-anchored quarter.

// withStatsZone points the stats clock at a zone for one test and restores the
// container zone afterwards.
func withStatsZone(t *testing.T, name string) {
	t.Helper()
	before := StatsLocation()
	t.Cleanup(func() { SetStatsLocation(before.String()) })
	SetStatsLocation(name)
}

// TestDayStartFollowsStatsZone — the day boundary is the configured zone's
// midnight, not the container's.
func TestDayStartFollowsStatsZone(t *testing.T) {
	withStatsZone(t, "Asia/Shanghai")

	// 2024-03-01 00:30 Beijing == 2024-02-29 16:30 UTC. The UTC day containing
	// this instant is 2024-02-29; the Beijing day is 2024-03-01.
	ts := time.Date(2024, 3, 1, 0, 30, 0, 0, time.FixedZone("CST", 8*3600)).UnixMilli()
	got := DayStart(ts)
	want := time.Date(2024, 3, 1, 0, 0, 0, 0, time.FixedZone("CST", 8*3600)).UnixMilli()
	if got != want {
		t.Fatalf("DayStart = %s, want %s",
			time.UnixMilli(got).UTC(), time.UnixMilli(want).UTC())
	}

	// The same instant read in UTC must give the UTC day, proving the boundary
	// is driven by the configured zone rather than a fixed offset.
	SetStatsLocation("UTC")
	if got := DayStart(ts); got != time.Date(2024, 2, 29, 0, 0, 0, 0, time.UTC).UnixMilli() {
		t.Fatalf("UTC DayStart = %s, want 2024-02-29T00:00Z", time.UnixMilli(got).UTC())
	}
}

// TestAlignDownAnchorsLongStepsAtLocalMidnight — a 6h step must land on the
// local 00:00/06:00/12:00/18:00 grid. Anchoring at the Unix epoch instead would
// place it at 02:00/08:00/14:00/20:00 in Beijing, which is the shift that was
// reported on the 6h granularity.
func TestAlignDownAnchorsLongStepsAtLocalMidnight(t *testing.T) {
	withStatsZone(t, "Asia/Shanghai")
	cst := time.FixedZone("CST", 8*3600)
	step := int64(6 * 3600 * 1000)

	cases := []struct {
		at   time.Time
		want time.Time
	}{
		// Just past local midnight stays on that midnight, not the previous 18:00.
		{time.Date(2024, 3, 1, 0, 30, 0, 0, cst), time.Date(2024, 3, 1, 0, 0, 0, 0, cst)},
		{time.Date(2024, 3, 1, 5, 59, 0, 0, cst), time.Date(2024, 3, 1, 0, 0, 0, 0, cst)},
		{time.Date(2024, 3, 1, 6, 0, 0, 0, cst), time.Date(2024, 3, 1, 6, 0, 0, 0, cst)},
		{time.Date(2024, 3, 1, 8, 0, 0, 0, cst), time.Date(2024, 3, 1, 6, 0, 0, 0, cst)},
		{time.Date(2024, 3, 1, 23, 59, 0, 0, cst), time.Date(2024, 3, 1, 18, 0, 0, 0, cst)},
	}
	for _, c := range cases {
		got := AlignDown(c.at.UnixMilli(), step)
		if got != c.want.UnixMilli() {
			t.Fatalf("AlignDown(%s, 6h) = %s, want %s",
				c.at.Format("15:04"), time.UnixMilli(got).In(cst).Format("01-02 15:04"),
				c.want.Format("01-02 15:04"))
		}
	}
}

// TestAlignDownFloorsShortSteps — an hour and below are floored on absolute
// time, which is how the 1m and 60m buckets are written. Deriving those from the
// local midnight instead would break on DST days, where the local day is not a
// whole multiple of an hour.
func TestAlignDownFloorsShortSteps(t *testing.T) {
	withStatsZone(t, "America/New_York")
	ts := time.Date(2024, 3, 10, 7, 37, 12, 0, time.UTC).UnixMilli() // 02:37 EST, before the jump
	if got := AlignDown(ts, 3_600_000); got != (ts/3_600_000)*3_600_000 {
		t.Fatalf("hour step not floored: got %s", time.UnixMilli(got).UTC())
	}
	if got := AlignDown(ts, 60_000); got != (ts/60_000)*60_000 {
		t.Fatalf("minute step not floored: got %s", time.UnixMilli(got).UTC())
	}
}

// TestSetStatsLocationRejectsUnknownZone — a typo must not silently move the
// boundaries to an arbitrary zone; it falls back to the container's local one.
func TestSetStatsLocationRejectsUnknownZone(t *testing.T) {
	before := StatsLocation()
	t.Cleanup(func() { SetStatsLocation(before.String()) })

	SetStatsLocation("Asia/Shanghai")
	if got := SetStatsLocation("Not/AZone"); got != time.Local {
		t.Fatalf("unknown zone resolved to %s, want the container local zone", got)
	}
	if got := StatsLocation(); got != time.Local {
		t.Fatalf("StatsLocation = %s after a bad name, want local", got)
	}
	// Empty string is the documented "use the container zone" value.
	if got := SetStatsLocation(""); got != time.Local {
		t.Fatalf("empty zone resolved to %s, want local", got)
	}
}

// TestOpenDropsRetiredDailyBuckets — a database carrying 1d rows from an older
// build must lose them on open, since the stats path aggregates 60m now and a
// surviving daily row would double-count its own hours.
func TestOpenDropsRetiredDailyBuckets(t *testing.T) {
	path := t.TempDir() + "/legacy1d.db"
	db, err := Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	now := Now()
	if _, err := db.Exec(`INSERT INTO usage_bucket
		(id,account_id,model_alias,provider_id,bucket_time,granularity,input_tokens,cached_input_tokens,output_tokens,cost,request_count,create_time,update_time,delete_time)
		VALUES ('legacy','acc','alias','prov',?,'1d',100,0,50,0.5,1,?,?,NULL)`, DayStart(now), now, now); err != nil {
		t.Fatalf("seed: %v", err)
	}
	db.Close()

	db2, err := Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer db2.Close()
	var n int64
	if err := db2.QueryRow("SELECT COUNT(*) FROM usage_bucket WHERE granularity = '1d'").Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Fatalf("%d daily buckets survived Open, want 0", n)
	}
}
