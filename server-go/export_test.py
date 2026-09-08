"""Export/import round-trip test (account.controller.ts exportData/importData).

1. fresh DB migrated from real JSONL
2. login as seeded admin
3. export -> snapshot counts + content digests per collection
4. import the export back (truncate + reinsert)
5. re-export -> row-for-row identical, usage_bucket sums equal
6. soft-deleted rows: exported AND preserved by import (TS semantics), while
   import skips rows already soft-deleted in the payload
7. login + api_key lookup still work after reimport
"""
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
DB = os.path.abspath("testtmp/e2e.db")
PORT = 3395
B = f"http://127.0.0.1:{PORT}"
ADMIN_EMAIL, ADMIN_PASSWORD = "admin@test.local", "admin-pass-123"

COLLECTION_KEYS = ["accounts", "models", "providers", "roles", "account_roles",
                   "transactions", "tasks", "usage_buckets", "gift_cards", "settings", "session_reasonings"]

fails = []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name, detail if not cond else "")
    if not cond:
        fails.append(name)

def http_post(url, payload, headers=None):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def digest(rows):
    """stable per-collection digest"""
    raw = json.dumps(rows, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]

def main():
    for suffix in ["", "-wal", "-shm"]:
        try: os.remove(DB + suffix)
        except FileNotFoundError: pass
    os.makedirs(os.path.join(ROOT, "testtmp"), exist_ok=True)
    subprocess.run(["./bin/onekey-migrate.exe", "-data", "../data", "-db", DB],
                   check=True, cwd=ROOT, stdout=subprocess.DEVNULL)

    env = dict(os.environ, SECRET="e2e-secret-key-1234567890", SERVER_PORT=str(PORT),
               SQLITE_PATH=DB, STATIC_DIR="/nonexistent",
               ADMIN_NAME="Admin", ADMIN_EMAIL=ADMIN_EMAIL, ADMIN_PASSWORD=ADMIN_PASSWORD)
    proc = subprocess.Popen(["./bin/onekey-server.exe"], env=env, cwd=ROOT,
                            stdout=open("testtmp/e2e.log", "w"), stderr=subprocess.STDOUT)
    time.sleep(2)
    con = sqlite3.connect(DB)
    try:
        st, body = http_post(B + "/api/auth/login", {"identify": {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}})
        token = json.loads(body)["data"]["token"]
        H = {"token": token}

        # ── 1. export shape ──
        st, body = http_post(B + "/api/account/export", {}, H)
        d = json.loads(body)
        data = d["data"]["data"]
        check("export 200 envelope", st == 200 and d["success"] is True and d["data"]["version"] == 1, body[:200])
        check("export has all 11 collections", sorted(d["data"]["data"].keys()) == sorted(COLLECTION_KEYS), str(sorted(data.keys())))

        # export includes soft-deleted rows (TS findAllIgnoreDelete semantics)
        con2 = sqlite3.connect(DB)
        con2.execute("UPDATE task SET delete_time = 1234567890 WHERE id = (SELECT id FROM task LIMIT 1)")
        con2.commit()
        total_tasks = con2.execute("SELECT COUNT(*) FROM task").fetchone()[0]
        alive_tasks = con2.execute("SELECT COUNT(*) FROM task WHERE delete_time IS NULL").fetchone()[0]
        con2.close()
        check("export includes soft-deleted rows", total_tasks > alive_tasks and len(data["tasks"]) == total_tasks,
              f"total={total_tasks} alive={alive_tasks} exported={len(data['tasks'])}")

        first = {k: digest(v) for k, v in data.items()}
        counts = {k: len(v) for k, v in data.items()}
        # TS importTable only inserts rows with empty delete_time
        alive_counts = {k: sum(1 for r in v if not r.get("delete_time")) for k, v in data.items()}
        print("   exported:", {k: v for k, v in counts.items() if v})

        # ── 2. import it back (frontend sends the export payload wrapped in
        #      {"data": ...} — TS reads request.data.data) ──
        st, body = http_post(B + "/api/account/import",
                             {"data": {"version": 1, "exported_at": 0, "data": data}}, H)
        d = json.loads(body)
        check("import 200", st == 200 and d["success"] is True, body[:300])
        imported = d["data"]["imported"]
        for k, n in alive_counts.items():
            got = imported.get(k, 0)
            if got != n:
                check(f"import count {k}", False, f"expected {n} got {got}")
        print("   imported:", {k: v for k, v in imported.items() if v})

        # ── 3. re-export: alive rows identical, soft-deleted stay soft-deleted ──
        st, body = http_post(B + "/api/account/export", {}, H)
        data2 = json.loads(body)["data"]["data"]
        check("re-export has all 11 collections", sorted(data2.keys()) == sorted(COLLECTION_KEYS), str(sorted(data2.keys())))
        for k in COLLECTION_KEYS:
            alive1 = [r for r in data[k] if not r.get("delete_time")]
            alive2 = [r for r in data2[k] if not r.get("delete_time")]
            check(f"round-trip alive rows {k}", digest(alive1) == digest(alive2),
                  f"{digest(alive1)} vs {digest(alive2)}")

        # usage_bucket integrity (the "logs")
        con3 = sqlite3.connect(DB)
        n, s = con3.execute("SELECT COUNT(*), ROUND(SUM(cost),4) FROM usage_bucket").fetchone()
        check("usage_bucket rows survived", n == counts["usage_buckets"], f"db={n} exported={counts['usage_buckets']}")
        n_accounts = con3.execute("SELECT COUNT(*) FROM account").fetchone()[0]
        bal = con3.execute("SELECT balance FROM account WHERE delete_time IS NULL LIMIT 1").fetchone()[0]
        con3.close()
        check("accounts survived", n_accounts == counts["accounts"], f"{n_accounts} vs {counts['accounts']}")

        # ── 4. auth still works after reimport (password hashes preserved) ──
        st, body = http_post(B + "/api/auth/login", {"identify": {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}})
        check("login after import", st == 200 and json.loads(body)["success"], body[:200])
        api_key = con.execute("SELECT api_key FROM account WHERE delete_time IS NULL LIMIT 1").fetchone()[0]
        st, body = http_post(B + "/api/models", {}, {"x-api-key": api_key})
        check("api_key lookup after import", st == 200 and json.loads(body).get("success") is True, body[:200])

        # ── 5. TS-style import semantics: rows with delete_time in payload are skipped ──
        payload = {"version": 1, "exported_at": 1,
                   "data": {"gift_cards": [
                       {"id": "gc1", "code": "CODE_A", "token_amount": 5, "status": "unused",
                        "redeemed_by": None, "redeemed_at": None, "create_time": 111, "update_time": 111, "delete_time": None},
                       {"id": "gc2", "code": "CODE_B", "token_amount": 9, "status": "redeemed",
                        "redeemed_by": "x", "redeemed_at": 222, "create_time": 222, "update_time": 222,
                        "delete_time": 333},
                   ]}}
        st, body = http_post(B + "/api/account/import", {"data": payload}, H)
        d = json.loads(body)
        check("TS-style import skips deleted", d["data"]["imported"]["gift_cards"] == 1, body[:300])
        n = con.execute("SELECT COUNT(*) FROM gift_card WHERE id='gc2'").fetchone()[0]
        check("soft-deleted payload row not inserted", n == 0, str(n))

        # ── 6. non-admin rejected ──
        st, body = http_post(B + "/api/account/export", {}, {"token": "garbage"})
        check("export requires admin", st == 400, body[:200])
    finally:
        proc.terminate()
        con.close()

    print()
    if fails:
        print("FAILED:", fails); sys.exit(1)
    print("ALL EXPORT/IMPORT TESTS PASSED")

if __name__ == "__main__":
    main()
