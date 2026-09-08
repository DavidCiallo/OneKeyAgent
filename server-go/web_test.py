"""Web admin flow: fresh DB + seeded admin -> login -> token -> alive ->
profile -> account list -> settings save -> daily bonus."""
import json
import os
import sqlite3
import subprocess
import sys
import time
import urllib.request

DB = os.path.abspath("testtmp/web.db")
PORT = 3397
B = f"http://127.0.0.1:{PORT}"
ADMIN_EMAIL = "admin@test.local"
ADMIN_PASSWORD = "admin-pass-123"

def http_post(url, payload, headers=None):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def http_get(url, headers=None):
    req = urllib.request.Request(url)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

fails = []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name, detail if not cond else "")
    if not cond:
        fails.append(name)

def main():
    for suffix in ["", "-wal", "-shm"]:
        try: os.remove(DB + suffix)
        except FileNotFoundError: pass
    env = dict(os.environ,
               SECRET="web-test-secret-1234567890",
               SERVER_PORT=str(PORT), SQLITE_PATH=DB, STATIC_DIR="/nonexistent",
               ADMIN_NAME="Admin", ADMIN_EMAIL=ADMIN_EMAIL, ADMIN_PASSWORD=ADMIN_PASSWORD)
    proc = subprocess.Popen(["./bin/onekey-server.exe"], env=env,
                            stdout=open("testtmp/web.log", "w"), stderr=subprocess.STDOUT)
    time.sleep(2)
    try:
        # admin seeded on startup
        st, body = http_post(B + "/api/auth/login", {"identify": {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}})
        d = json.loads(body)
        check("login", st == 200 and d["success"] and d["data"]["token"], body[:200])
        token = d["data"]["token"]
        check("login roles admin", d["data"]["is_admin"] == 1 and len(d["data"]["roles"]) == 4, str(d["data"]))

        st, body = http_post(B + "/api/auth/alive", {}, {"token": token})
        d = json.loads(body)
        check("alive", st == 200 and d["data"]["is_admin"] == 1, body[:200])

        st, body = http_post(B + "/api/account/profile", {}, {"token": token})
        d = json.loads(body)
        check("profile", st == 200 and d["data"]["account"]["email"] == ADMIN_EMAIL and d["data"]["balance"] == 0, body[:200])

        st, body = http_post(B + "/api/account/list", {"page": 1}, {"token": token})
        d = json.loads(body)
        check("account list", st == 200 and d["data"]["total"] == 1 and "password" not in d["data"]["list"][0], body[:200])

        st, body = http_post(B + "/api/settings/list", {}, {"token": token})
        d = json.loads(body)
        keys = [e["key"] for e in d["data"]["entries"]]
        check("settings list", st == 200 and "fallback_model_alias" in keys, body[:200])
        check("tg settings removed", "tg_bot_api_base_url" not in keys and "tg_user_id" not in keys, str(keys))

        st, body = http_post(B + "/api/settings/save",
                             {"entries": [{"key": "fallback_model_alias", "value": "gpt-fallback"}]},
                             {"token": token})
        check("settings save", st == 200 and json.loads(body)["success"], body[:200])
        st, body = http_post(B + "/api/settings/list", {}, {"token": token})
        vals = {e["key"]: e["value"] for e in json.loads(body)["data"]["entries"]}
        check("settings persisted", vals.get("fallback_model_alias") == "gpt-fallback", str(vals))

        # daily bonus
        st, body = http_post(B + "/api/auth/daily", {}, {"token": token})
        d = json.loads(body)
        check("daily bonus", st == 200 and d["data"]["amount"] == 0.1, body[:200])
        st, body = http_post(B + "/api/auth/daily", {}, {"token": token})
        d = json.loads(body)
        check("daily bonus once/day", st == 200 and d["data"]["amount"] == 0, body[:200])

        # non-admin rejection
        st, body = http_post(B + "/api/account/list", {"page": 1}, {"token": "garbage-token"})
        check("bad token 400", st == 400 and json.loads(body)["message"] == "Authorization failed", body[:200])

        # register flow (no resend key -> email fails -> needsVerification false)
        st, body = http_post(B + "/api/auth/register", {"identify": {"name": "u", "email": "u@x.com", "password": "p123456"}})
        d = json.loads(body)
        check("register without mailer fails gracefully", st == 400, body[:200])
    finally:
        proc.terminate()

    print()
    if fails:
        print("FAILED:", fails); sys.exit(1)
    print("ALL WEB TESTS PASSED")

if __name__ == "__main__":
    main()
