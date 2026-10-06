"""Cross-check the client's statistics-clock math against the server's.

The chart labels and the "Today" preset are computed in the browser with
Intl.DateTimeFormat, while the buckets they describe were cut in Go with
time.LoadLocation. The two must agree exactly, or every tick drifts away from
the row it represents — which is the same class of bug as the original 08:00
offset, only harder to see.

Run: python server/check_stats_timezone.py
"""

import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(HERE, "..")
ROOT = os.path.abspath(os.path.join(HERE, ".."))

ZONES = ["Asia/Shanghai", "UTC", "America/New_York", "Europe/London", "Asia/Kolkata"]

GO_PROBE = r"""
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"time"
)

func dayStart(ts int64, loc *time.Location) int64 {
	d := time.UnixMilli(ts).In(loc)
	return time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, loc).UnixMilli()
}

func alignDown(ts, step int64, loc *time.Location) int64 {
	if step <= 3_600_000 {
		return (ts / step) * step
	}
	day := dayStart(ts, loc)
	return day + ((ts - day) / step) * step
}

func main() {
	loc, _ := time.LoadLocation("%(zone)s")
	// Anchors chosen to straddle DST transitions and month ends.
	stamps := []int64{
		1709251200000, // 2024-03-01T00:00Z
		1709294400000, // 2024-03-01T12:00Z
		1710057600000, // 2024-03-10T08:00Z, US DST spring forward
		1710072000000, // 2024-03-10T12:00Z
		1730610000000, // 2024-11-03T01:00Z, US DST fall back
		1719792000000, // 2024-07-01T00:00Z
	}
	steps := []int64{60000, 3600000, 6 * 3600000, 12 * 3600000, 86400000}
	out := map[string]any{}
	for _, s := range stamps {
		out[fmt.Sprint(s)] = []int64{dayStart(s, loc), alignDown(s, 6*3600000, loc)}
		_ = steps
	}
	b, _ := json.Marshal(out)
	fmt.Fprintln(os.Stdout, string(b))
}
"""

JS_PROBE = r"""
const zone = process.argv[2];
function partsIn(ts, zone) {
    const fmt = new Intl.DateTimeFormat("en-GB", {
        timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    const out = {};
    for (const p of fmt.formatToParts(new Date(ts))) if (p.type !== "literal") out[p.type] = p.value;
    return out;
}
function zoneOffsetMs(ts, zone) {
    const p = partsIn(ts, zone);
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day),
        Number(p.hour), Number(p.minute)) - ts;
}
function statsDayStart(ts, zone) {
    const p = partsIn(ts, zone);
    const target = { year: Number(p.year), month: Number(p.month), day: Number(p.day) };
    let start = Date.UTC(target.year, target.month - 1, target.day) - zoneOffsetMs(ts, zone);
    for (let i = 0; i < 3; i++) {
        const q = partsIn(start, zone);
        if (Number(q.year) === target.year && Number(q.month) === target.month &&
            Number(q.day) === target.day && q.hour === "00" && q.minute === "00") {
            return start;
        }
        start = Date.UTC(target.year, target.month - 1, target.day) - zoneOffsetMs(start, zone);
    }
    return start;
}
function statsAlignDown(ts, stepMs, zone) {
    if (stepMs <= 3600000) return Math.floor(ts / stepMs) * stepMs;
    const day = statsDayStart(ts, zone);
    return day + Math.floor((ts - day) / stepMs) * stepMs;
}
const stamps = [1709251200000, 1709294400000, 1710057600000, 1710072000000, 1730610000000, 1719792000000];
const out = {};
for (const s of stamps) out[String(s)] = [statsDayStart(s, zone), statsAlignDown(s, 6 * 3600000, zone)];
console.log(JSON.stringify(out));
"""


def run_go(zone):
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "main.go")
        with open(path, "w", encoding="utf-8") as f:
            f.write(GO_PROBE % {"zone": zone})
        # The probe needs encoding/json; keep it a standalone module-free run.
        proc = subprocess.run(["go", "run", path], capture_output=True, text=True, cwd=SERVER)
        if proc.returncode != 0:
            raise SystemExit("go probe failed:\n" + proc.stderr)
        return json.loads(proc.stdout.strip())


def run_js(zone):
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "probe.mjs")
        with open(path, "w", encoding="utf-8") as f:
            f.write(JS_PROBE)
        proc = subprocess.run(["node", path, zone], capture_output=True, text=True, cwd=ROOT)
        if proc.returncode != 0:
            raise SystemExit("node probe failed:\n" + proc.stderr)
        return json.loads(proc.stdout.strip())


def main():
    failures = 0
    for zone in ZONES:
        go_out = run_go(zone)
        js_out = run_js(zone)
        for stamp, pair in go_out.items():
            js_pair = js_out.get(stamp)
            if js_pair != pair:
                failures += 1
                print(f"MISMATCH {zone} ts={stamp}: go={pair} js={js_pair}")
        print(f"  {zone}: {len(go_out)} anchors compared")

    if failures:
        print(f"\n{failures} mismatches — the client would label slots at the wrong hour")
        return 1
    print("\nclient and server agree on every anchor")
    return 0


if __name__ == "__main__":
    sys.exit(main())
