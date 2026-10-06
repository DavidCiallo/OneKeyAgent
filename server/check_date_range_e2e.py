"""End-to-end check for the usage date range and the 1d granularity.

Verifies against a live server that:
  1. `until` actually bounds the query — usage written "tomorrow" is excluded
     from a range that ends today, and included once the range covers it.
  2. A 1d request returns one window per calendar day, each starting at the
     stats zone's midnight (not at 08:00, and not a rolling 24h).
  3. The four offered gap values (1, 10, 60, 1440) all answer.
  4. A single-day range (today-today) returns exactly one 1d window.

Seeds usage_bucket rows directly and signs in as an admin.

Usage: python server/check_date_range_e2e.py [base_url] [email] [password]
"""

import datetime
import hashlib
import json
import os
import sqlite3
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3300"
EMAIL = sys.argv[2] if len(sys.argv) > 2 else "e2e-admin@example.com"
PASSWORD = sys.argv[3] if len(sys.argv) > 3 else "e2epass123"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "data", "onekey.db")
ZONE_OFFSET_H = 8  # Asia/Shanghai, the default routing_timezone

failures = []


def check(label, ok, detail=""):
    print(("  PASS  " if ok else "  FAIL  ") + label + ((" — " + detail) if detail else ""))
    if not ok:
        failures.append(label)


def post(path, body, token=None):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json",
                 **({"Authorization": token} if token else {})},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        # A rejected request is a valid outcome for the negative check, so the
        # error envelope is returned rather than raised.
        try:
            return json.loads(e.read().decode())
        except Exception:
            return {"success": False, "message": f"HTTP {e.code}"}


def main():
    print(f"server: {BASE}")
    login = post("/api/auth/login", {"identify": {"email": EMAIL, "password": PASSWORD}})
    if not login.get("success"):
        raise SystemExit(f"login failed: {login}")
    token = login["data"]["token"]
    # The login payload carries no account object, so the id is read back from
    # the database that the server is actually using.
    con = sqlite3.connect(DB)
    row = con.execute("SELECT id FROM account WHERE email = ? AND delete_time IS NULL", (EMAIL,)).fetchone()
    con.close()
    if not row:
        raise SystemExit(f"no account row for {EMAIL} in {DB}")
    admin_id = row[0]
    print(f"admin:  {EMAIL} ({admin_id})")

    # The stats zone's "today" and midnight, computed the way the client does.
    tz = datetime.timezone(datetime.timedelta(hours=ZONE_OFFSET_H))
    now = datetime.datetime.now(tz)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow = today + datetime.timedelta(days=1)
    yesterday = today - datetime.timedelta(days=1)

    def ms(dt):
        return int(dt.timestamp() * 1000)

    def ymd(dt):
        return dt.strftime("%Y%m%d")

    # Clean any of our own prior rows, then seed distinctive totals:
    #   3 hours today  -> 300 requests
    #   2 hours tomorrow (outside a today-only range)
    #
    # The alias and provider must be ones the instance actually knows: the
    # response filters sessions whose model or provider no longer exists, so a
    # made-up marker alias would be aggregated and then silently dropped.
    con = sqlite3.connect(DB)
    alias_row = con.execute(
        "SELECT alias FROM model WHERE delete_time IS NULL LIMIT 1"
    ).fetchone()
    prov_row = con.execute(
        "SELECT id FROM provider WHERE delete_time IS NULL LIMIT 1"
    ).fetchone()
    if not alias_row or not prov_row:
        con.close()
        raise SystemExit("need at least one active model and provider to seed against")
    alias, prov = alias_row[0], prov_row[0]
    # Seed against a dedicated account so the numbers are exact: the admin may
    # already have real usage in these windows, which would make an absolute
    # assertion meaningless.
    subject = "e2e-range-subject"
    con.execute("DELETE FROM usage_bucket WHERE account_id = ?", (subject,))
    # A real account row is needed: the response resolves each bucket's account
    # to a name, and an unknown id would be reported as "--".
    now_ms = ms(now)
    if not con.execute("SELECT 1 FROM account WHERE id = ?", (subject,)).fetchone():
        con.execute(
            "INSERT INTO account (id,name,email,password,is_admin,balance,create_time,update_time,delete_time)"
            " VALUES (?,?,?,?,?,?,?,?,NULL)",
            (subject, "E2E Range Subject", "e2e-range-subject@example.com", "x", 0, 0, now_ms, now_ms),
        )
    print(f"seeding account={subject} alias={alias} provider={prov}")

    rows = []
    for i, (base_dt, hours, reqs) in enumerate([(today, 3, 100), (tomorrow, 2, 999)]):
        for h in range(hours):
            t = ms(base_dt + datetime.timedelta(hours=1 + h))
            # Prefixed so they cannot collide with the instance's own row ids.
            rows.append((f"e2erange-{i}-{h}", subject, alias, prov, t, "60m",
                         10, 0, 5, 0.001, reqs, 0, 0, 0, t, t, None))
    con.executemany(
        "INSERT INTO usage_bucket (id,account_id,model_alias,provider_id,bucket_time,granularity,"
        "input_tokens,cached_input_tokens,output_tokens,cost,request_count,duration_ms,ttft_ms,"
        "ttft_count,create_time,update_time,delete_time) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        rows,
    )
    con.commit()
    con.close()

    # Row counts as the API reports them: the 3 seeded hours today at 100 each,
    # and the 2 seeded hours tomorrow at 999 each.
    seeded_today = 300       # 3 hours x 100
    seeded_tomorrow = 1998   # 2 hours x 999 — excluded from a today-only range

    def reqs(since_ms, until_ms):
        """Total requests for the admin in a window."""
        res = post("/api/usage/sessions", {
            "gapMinutes": 1440, "since": since_ms, "until": until_ms,
            "account_ids": [subject],
        }, token)
        if not res.get("success"):
            raise SystemExit(f"usage query failed: {res}")
        return res["data"]["totals"]["totalRequests"]

    print("\n1. gap values all answer")
    for gap in (1, 10, 60, 1440):
        res = post("/api/usage/sessions", {
            "gapMinutes": gap, "since": ms(today), "until": ms(tomorrow),
            "account_ids": [subject],
        }, token)
        check(f"gapMinutes={gap} returns success", res.get("success") is True,
              str(res.get("message", ""))[:80])

    print("\n2. until bounds the query")
    res = post("/api/usage/sessions", {
        "gapMinutes": 1440, "since": ms(today), "until": ms(tomorrow),
        "account_ids": [subject],
    }, token)
    reqs = res["data"]["totals"]["totalRequests"]
    check(f"today-only range excludes tomorrow's rows (got {reqs})",
          reqs == seeded_today, f"want {seeded_today}")

    res2 = post("/api/usage/sessions", {
        "gapMinutes": 1440, "since": ms(today), "until": ms(tomorrow + datetime.timedelta(days=1)),
        "account_ids": [subject],
    }, token)
    reqs2 = res2["data"]["totals"]["totalRequests"]
    check(f"extending the range to tomorrow admits them (got {reqs2})",
          reqs2 == seeded_today + seeded_tomorrow,
          f"want {seeded_today + seeded_tomorrow}")

    print("\n3. 1d windows are calendar days on the stats clock")
    # Today through tomorrow inclusive: exactly two calendar days, each opening
    # at local midnight, with the rows split between them by their own day.
    res3 = post("/api/usage/sessions", {
        "gapMinutes": 1440, "since": ms(today),
        "until": ms(tomorrow + datetime.timedelta(days=1)),
        "account_ids": [subject],
    }, token)
    sessions = [s for g in res3["data"]["list"] for s in g["sessions"]]
    starts = sorted({s["startTime"] for s in sessions})
    expected = {ms(today), ms(tomorrow)}
    check(f"one window per calendar day ({len(starts)} windows)",
          set(starts) == expected,
          "starts=" + str([datetime.datetime.fromtimestamp(s / 1000, tz).strftime("%m-%d %H:%M") for s in starts]))

    # The rows must be attributed to the day they fall in, not lumped together.
    per_day = {}
    for s in sessions:
        per_day[datetime.datetime.fromtimestamp(s["startTime"] / 1000, tz).date()] = s["requestCount"]
    check(f"today's window holds exactly today's rows (got {per_day.get(today.date())})",
          per_day.get(today.date()) == seeded_today, f"want {seeded_today}")
    check(f"tomorrow's window holds exactly tomorrow's rows (got {per_day.get(tomorrow.date())})",
          per_day.get(tomorrow.date()) == seeded_tomorrow, f"want {seeded_tomorrow}")

    for s in starts:
        local = datetime.datetime.fromtimestamp(s / 1000, tz)
        check(f"window {local.strftime('%m-%d')} starts at local midnight",
              local.hour == 0 and local.minute == 0,
              local.strftime("%H:%M"))

    print("\n4. the window's end is the next midnight, not +24h")
    for g in res3["data"]["list"]:
        for s in g["sessions"]:
            start = datetime.datetime.fromtimestamp(s["startTime"] / 1000, tz)
            end = datetime.datetime.fromtimestamp(s["endTime"] / 1000, tz)
            ok = (end.date() - start.date()).days == 1 and end.hour == 0
            check(f"window {start.strftime('%m-%d')} ends at the next midnight",
                  ok, f"{start.strftime('%m-%d %H:%M')} -> {end.strftime('%m-%d %H:%M')}")

    print("\n5. a today-today range is exactly the one window")
    res5 = post("/api/usage/sessions", {
        "gapMinutes": 1440, "since": ms(today), "until": ms(tomorrow),
        "account_ids": [subject],
    }, token)
    s5 = [s for g in res5["data"]["list"] for s in g["sessions"]]
    check(f"today-today yields 1 window (got {len(s5)})", len(s5) == 1)

    print("\n6. rejected ranges are refused, not silently widened")
    bad = post("/api/usage/sessions", {
        "gapMinutes": 1440, "since": ms(tomorrow), "until": ms(today),
        "account_ids": [subject],
    }, token)
    check("until before since is an error", bad.get("success") is not True,
          str(bad.get("message", ""))[:60])

    # Clean up everything this check created. Set E2E_KEEP=1 to leave the rows
    # in place for inspection.
    if not os.environ.get("E2E_KEEP"):
        con = sqlite3.connect(DB)
        con.execute("DELETE FROM usage_bucket WHERE account_id = ?", (subject,))
        con.execute("DELETE FROM account WHERE id = ?", (subject,))
        con.commit()
        con.close()

    print()
    if failures:
        print(f"FAIL — {len(failures)} check(s) failed")
        for f in failures:
            print("  - " + f)
        raise SystemExit(1)
    print(f"PASS — date range and 1d granularity behave on {ymd(today)}")


if __name__ == "__main__":
    main()
