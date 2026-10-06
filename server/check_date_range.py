"""Cross-check the client's yyyymmdd date helpers against the server's Go clock.

For a set of zones and dates it compares:
  - statsDateStart(date)         vs the zone's local midnight of that date
  - statsDateEndExclusive(date)  vs the zone's local midnight of the next date

The point is DST. A local day is 23 or 25 hours on a transition, so anything
that adds a fixed 86_400_000 ms is wrong on exactly those days — the range would
either miss the last hour or swallow an hour of the next day.

The Go side is computed by a throwaway program; the TS side by compiling
client/methods/timezone.ts and calling the real functions.

Run: python server/check_date_range.py
"""

import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

ZONES = ["Asia/Shanghai", "UTC", "America/New_York", "Europe/London", "Asia/Kolkata"]

# Both 2024 DST transitions in the US and EU, plus leap day and year rollover.
DATES = [
    "20240101", "20240229", "20240309", "20240310", "20240311",
    "20240615", "20241026", "20241027", "20241103", "20241104",
    "20241231", "20250101",
]

GO_PROBE = '''package main

import (
\t"encoding/json"
\t"fmt"
\t"os"
\t"strconv"
\t"time"
)

func main() {
\tloc, err := time.LoadLocation(os.Args[1])
\tif err != nil {
\t\tpanic(err)
\t}
\tout := map[string][2]int64{}
\tfor _, ds := range os.Args[2:] {
\t\ty, _ := strconv.Atoi(ds[0:4])
\t\tm, _ := strconv.Atoi(ds[4:6])
\t\td, _ := strconv.Atoi(ds[6:8])
\t\tstart := time.Date(y, time.Month(m), d, 0, 0, 0, 0, loc)
\t\tend := time.Date(y, time.Month(m), d+1, 0, 0, 0, 0, loc)
\t\tout[ds] = [2]int64{start.UnixMilli(), end.UnixMilli()}
\t}
\tb, _ := json.Marshal(out)
\tfmt.Print(string(b))
}
'''

NODE_PROBE = '''global.window = { __APP_CONFIG__: { timezone: process.argv[2] } };
const t = require(process.argv[3]);
const dates = JSON.parse(process.argv[4]);
const out = {};
for (const d of dates) out[d] = [t.statsDateStart(d), t.statsDateEndExclusive(d)];
console.log(JSON.stringify(out));
'''


def run(cmd, **kw):
    res = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if res.returncode != 0:
        sys.stderr.write(res.stdout + "\n" + res.stderr + "\n")
        raise SystemExit("command failed: " + " ".join(cmd))
    return res.stdout


def build_ts():
    """Compile the helper module once into a temp dir; return its path."""
    outdir = os.path.join(ROOT, ".probe-date-range")
    shutil.rmtree(outdir, ignore_errors=True)
    os.makedirs(outdir, exist_ok=True)
    # The repo's package.json sets "type": "module", which would make the
    # CommonJS emit below load as ESM and fail on `exports`. A nested
    # package.json marks just this temp dir as CommonJS.
    with open(os.path.join(outdir, "package.json"), "w", encoding="utf-8") as f:
        json.dump({"type": "commonjs"}, f)
    run(
        [
            "node", "node_modules/typescript/bin/tsc",
            "--outDir", outdir,
            "--module", "commonjs",
            "--target", "es2020",
            "--moduleResolution", "node",
            "--skipLibCheck",
            "--noEmit", "false",
            # env.d.ts carries the window.__APP_CONFIG__ declaration the helper
            # reads; without it the standalone compile fails on that type.
            "client/methods/timezone.ts", "client/env.d.ts",
        ],
        cwd=ROOT,
    )
    # tsc strips the common directory when it can, so the emitted file may sit
    # directly under outdir rather than under a methods/ folder.
    for candidate in (
        os.path.join(outdir, "methods", "timezone.js"),
        os.path.join(outdir, "timezone.js"),
    ):
        if os.path.exists(candidate):
            return candidate
    raise SystemExit(f"tsc produced no timezone.js under {outdir}")


def main():
    compiled = build_ts()
    probe_go = os.path.join(ROOT, "probe_date_range.go")
    probe_js = os.path.join(ROOT, ".probe_date_range.cjs")
    with open(probe_go, "w", encoding="utf-8") as f:
        f.write(GO_PROBE)
    with open(probe_js, "w", encoding="utf-8") as f:
        f.write(NODE_PROBE)

    failures = []
    try:
        for zone in ZONES:
            go_out = json.loads(
                run(["go", "run", probe_go, zone] + DATES, cwd=ROOT)
            )
            js_out = json.loads(
                run(["node", probe_js, zone, compiled, json.dumps(DATES)], cwd=ROOT)
            )
            for d in DATES:
                gs, ge = go_out[d]
                jss, jse = js_out[d]
                if (gs, ge) != (jss, jse):
                    failures.append((zone, d, (gs, ge), (jss, jse)))
    finally:
        for p in (probe_go, probe_js):
            if os.path.exists(p):
                os.remove(p)
        shutil.rmtree(os.path.join(ROOT, ".probe-date-range"), ignore_errors=True)

    if failures:
        for zone, d, g, j in failures:
            print(f"MISMATCH {zone} {d}: go={g} js={j}")
        raise SystemExit(f"\nFAIL — {len(failures)} mismatched boundaries")

    print(f"PASS — {len(ZONES)} zones x {len(DATES)} dates agree with the Go clock")


if __name__ == "__main__":
    main()
