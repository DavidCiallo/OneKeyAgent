"""Check provider active windows (peak/off-peak routing) against a live server.

Seeds two providers on one alias — one off-peak-only, one always on — and drives
real /v1/chat/completions requests through the gateway while moving the routing
clock by pointing ROUTING_TIMEZONE at zones that are currently inside and
outside the window. Then asserts the provider list reports in_window and that a
window which would empty the chain falls back instead of failing.

Run: python server/check_active_window.py [port] [--tz ZONE]
"""

import json
import os
import sys
import threading
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from zoneinfo import ZoneInfo

PORT = sys.argv[1] if len(sys.argv) > 1 else "3311"
BASE = f"http://127.0.0.1:{PORT}"
ADMIN = {"email": "admin@gmail.com", "password": "demo123@"}
ALIAS = "active-window-check"
STUB_PORT = 8899
STUB = f"http://127.0.0.1:{STUB_PORT}"

# Which provider's key the stub last saw. Each provider is created with a
# distinct api_key, and the relay forwards it, so this is how we tell which
# upstream actually served a request.
CALLS = []

PASS, FAIL = [], []


def check(name, ok, detail=""):
    (PASS if ok else FAIL).append(name)
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))


class Upstream(BaseHTTPRequestHandler):
    """Stub upstream. Records which provider key reached it."""

    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(n)
        auth = self.headers.get("Authorization") or ""
        CALLS.append(auth.replace("Bearer ", "").strip())
        payload = json.dumps({
            "id": "cmpl-1", "object": "chat.completion", "model": "m",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7},
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def api(path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["token"] = token
    req = urllib.request.Request(BASE + path, data=json.dumps(body or {}).encode(), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"success": False, "message": f"HTTP {e.code}: {e.read()[:200]}"}
    except Exception as e:
        return {"success": False, "message": str(e)}


# Windows does not ship the IANA database, so zoneinfo needs the tzdata package.
# Fall back to fixed offsets for the zones a check is likely to use.
TZ_OFFSETS = {"UTC": 0, "Asia/Shanghai": 8, "Asia/Tokyo": 9, "Asia/Singapore": 8,
              "Europe/London": 1, "Europe/Berlin": 2, "America/New_York": -4,
              "America/Los_Angeles": -7}


def minute_of_day(tz_name):
    """Current minute past midnight on the server's routing clock."""
    try:
        t = datetime.now(ZoneInfo(tz_name))
    except Exception:
        if tz_name not in TZ_OFFSETS:
            raise SystemExit(
                f"cannot resolve {tz_name!r}: install tzdata (pip install tzdata) "
                f"or add it to TZ_OFFSETS")
        t = datetime.now(timezone.utc) + timedelta(hours=TZ_OFFSETS[tz_name])
    return t.hour * 60 + t.minute


def providers(token):
    res = api("/api/provider/list", {"page": 1, "filter": {"model_alias": ALIAS}}, token)
    return {p["name"]: p for p in (res.get("data", {}) or {}).get("list", [])}


def cleanup(token):
    for p in api("/api/provider/list", {"page": 1, "filter": {"model_alias": ALIAS}}, token) \
            .get("data", {}).get("list", []):
        api("/api/provider/delete", {"id": p["id"]}, token)


def chat(key, text):
    body = {"model": ALIAS, "messages": [{"role": "user", "content": text}]}
    req = urllib.request.Request(
        BASE + "/api/chat/completions", data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode("utf-8", "replace")
        try:
            return json.loads(raw)
        except ValueError:
            # A non-JSON body means the request never reached the relay.
            return {"error": f"non-JSON response: {raw[:200]}"}
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}", "body": e.read().decode("utf-8", "replace")[:300]}
    except Exception as e:
        return {"error": str(e)}


def main():
    upstream = HTTPServer(("127.0.0.1", STUB_PORT), Upstream)
    threading.Thread(target=upstream.serve_forever, daemon=True).start()

    login = api("/api/auth/login", {"identify": ADMIN})
    if not login.get("success"):
        print(f"login failed: {login}")
        return 1
    token = login["data"]["token"]

    cleanup(token)

    # Windows are interpreted on the server's routing clock, so the check has to
    # read the same zone — computing them in UTC would silently test nothing.
    tz = "Asia/Shanghai"
    for e in api("/api/settings/list", {}, token).get("data", {}).get("entries", []):
        if e.get("key") == "routing_timezone" and e.get("value"):
            tz = e["value"]
    print(f"  routing clock: {tz}")
    now_min = minute_of_day(tz)

    # "night" covers the current UTC minute, "day" is the window opposite it, and
    # "never" excludes everything except its own start minute.
    def window_covering(m):
        return ((m - 10) % 1440, (m + 10) % 1440)

    nf, nt = window_covering(now_min)
    # A window that cannot contain now: shift by 12h.
    df, dt = (now_min + 700) % 1440, (now_min + 740) % 1440
    # A window containing nothing at all except one impossible instant.
    xf = (now_min + 600) % 1440
    xt = (xf + 1) % 1440

    for name, prio, frm, to, base in [
        ("night", 1, nf, nt, STUB),
        ("day", 2, df, dt, STUB),
        ("always", 3, 0, 0, STUB),
    ]:
        res = api("/api/provider/create", {"provider": {
            "model_alias": ALIAS, "priority": prio, "name": name,
            "base_url": base, "model": "m", "api_key": f"key-{name}", "auth_type": "bearer",
            "api_type": "openai", "enabled": 1,
            "active_from": frm, "active_to": to,
        }}, token)
        if not res.get("success"):
            print(f"  could not create {name}: {res.get('message')}")
            cleanup(token)
            return 1

    # ── in_window is reported per provider ────────────────────────────────────
    listed = providers(token)
    check("list reports the window fields",
          listed["night"].get("active_from") == nf and listed["night"].get("active_to") == nt,
          f"from={listed['night'].get('active_from')} to={listed['night'].get('active_to')}")
    check("a covering window reports in_window",
          listed["night"].get("in_window") is True, str(listed["night"].get("in_window")))
    check("a non-covering window reports not in_window",
          listed["day"].get("in_window") is False, str(listed["day"].get("in_window")))
    check("no window reports in_window",
          listed["always"].get("in_window") is True, str(listed["always"].get("in_window")))

    # The admin account is not returned by account/list, so look it up by id.
    # ADMIN_ID can be overridden for a different database.
    admin_id = os.environ.get("ADMIN_ID", "tZx6BS")
    key = (api("/api/account/detail", {"id": admin_id}, token)
           .get("data", {}).get("account", {}) or {}).get("api_key") or ""
    if not key:
        print(f"  no api_key for admin id {admin_id}; set ADMIN_ID to override")
        cleanup(token)
        return 1

    # ── routing actually follows the window ───────────────────────────────────
    # Only "night" (priority 1) and "always" (priority 3) cover now; "day" does
    # not. Every attempt at priority 1 must land on night, and never on day.
    CALLS.clear()
    for _ in range(6):
        out = chat(key, "which-provider")
        if isinstance(out, dict) and out.get("error"):
            check("request reached an upstream", False, json.dumps(out)[:200])
            break
    served = set(CALLS)
    check("the in-window provider served every request",
          served and served <= {"key-night", "key-always"}, f"served={sorted(served)}")
    check("the out-of-window provider never served one",
          "key-day" not in served, f"served={sorted(served)}")
    check("the in-window provider was preferred over the always-on one",
          "key-night" in served, f"served={sorted(served)}")

    # ── a chain emptied by windows still answers ──────────────────────────────
    for name in ("night", "always"):
        p = providers(token)[name]
        api("/api/provider/update", {"id": p["id"], "provider": {
            "active_from": xf, "active_to": xt}}, token)
    listed = providers(token)
    check("every provider now reports outside its window",
          listed and all(not p.get("in_window") for p in listed.values()),
          str({k: v.get("in_window") for k, v in listed.items()}))

    CALLS.clear()
    out = chat(key, "still-answers")
    check("a request still succeeds when every window excludes now",
          not (isinstance(out, dict) and out.get("error")), json.dumps(out)[:200])
    check("the fallback really called an upstream", len(CALLS) > 0, f"CALLS={CALLS}")

    cleanup(token)
    upstream.shutdown()
    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        print("failed: " + ", ".join(FAIL))
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
