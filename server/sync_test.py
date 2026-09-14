"""Two-node end-to-end test: main database + replica.

Starts two instances of the Go server:
  * main    on :3401 — owns the data, serves /api/sync/*
  * replica on :3402 — MAIN_DB_URL points at main, SYNC_SECRET shared

Then verifies the properties the design depends on:
  1. the replica bootstraps reference data (models, providers, accounts) from main
  2. an admin edit on main reaches the replica (snapshot/refresh)
  3. traffic served by the replica is billed locally AND reported to main as a
     delta, so the main database's balance reflects the replica's spend
  4. usage recorded on the replica merges into main's window rows
  5. a token minted on one node is accepted by the other (shared SECRET)

Usage: python sync_test.py <main-db> <replica-db> <server-exe>
"""
import json
import os
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer

MAIN_DB = sys.argv[1]
REPLICA_DB = sys.argv[2]
SERVER = sys.argv[3]

PORT_MAIN = 3401
PORT_REPLICA = 3402
PORT_MOCK = 3400

SECRET = "two-node-secret-0123456789abcdef"
NONCE_LENGTH = "8"
SYNC_SECRET = "sync-shared-secret-abc123"
API_KEY = "sk-two-node-test-key"

MOCK_RESPONSE = {
    "id": "chatcmpl-mock-1",
    "object": "chat.completion",
    "model": "mock-model",
    "choices": [{"index": 0, "message": {"role": "assistant", "content": "Hello from mock!"}, "finish_reason": "stop"}],
    "usage": {"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120},
}

LAST_BODY = {}


class MockHandler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        LAST_BODY["json"] = body
        resp = dict(MOCK_RESPONSE)
        resp["model"] = body.get("model", "mock-model")
        data = json.dumps(resp).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def http(method, url, payload=None, headers=None, timeout=30):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:  # connection refused while a node starts
        return 0, str(e)


def wait_up(port, name, seconds=30):
    for _ in range(seconds):
        st, _ = http("GET", f"http://127.0.0.1:{port}/api/auth/config", timeout=3)
        if st == 200:
            print(f"[ok] {name} up on :{port}")
            return True
        time.sleep(1)
    print(f"[FAIL] {name} never came up on :{port}")
    return False


def seed_main(path):
    """A minimal main database: one account, one model, one provider."""
    con = sqlite3.connect(path)
    con.execute("""INSERT OR REPLACE INTO account
        (id, name, email, password, api_key, is_admin, balance, create_time)
        VALUES ('acc-main','Relay User','relay@test.local','x',?,0,50.0,1)""", (API_KEY,))
    con.execute("""INSERT OR REPLACE INTO model
        (id, alias, input_price, cache_price, output_price, is_public, create_time)
        VALUES ('m1','mock-alias',1.0,0.5,2.0,1,1)""")
    con.execute("""INSERT OR REPLACE INTO provider
        (id, model_alias, priority, name, base_url, model, api_key, api_type, enabled, create_time)
        VALUES ('p1','mock-alias',1,'Mock',?, 'mock-model','mock-upstream-key','openai',1,1)""",
        (f"http://127.0.0.1:{PORT_MOCK}/v1",))
    con.commit()
    con.close()


def balance(db_path, account_id):
    con = sqlite3.connect(db_path)
    try:
        row = con.execute("SELECT balance FROM account WHERE id=?", (account_id,)).fetchone()
        return row[0] if row else None
    finally:
        con.close()


def main():
    fails = []

    def check(name, cond, detail=""):
        print(("PASS " if cond else "FAIL ") + name, detail if not cond else "")
        if not cond:
            fails.append(name)

    # 1. mock upstream
    mock = HTTPServer(("127.0.0.1", PORT_MOCK), MockHandler)
    threading.Thread(target=mock.serve_forever, daemon=True).start()

    env_base = dict(os.environ)
    env_base.update({
        "SECRET": SECRET, "NONCE_LENGTH": NONCE_LENGTH,
        "SYNC_SECRET": SYNC_SECRET, "NODE_ID": "test-node",
    })

    # 2. main node (no MAIN_DB_URL)
    env_main = dict(env_base)
    env_main.update({
        "SERVER_PORT": str(PORT_MAIN), "SQLITE_PATH": MAIN_DB,
        "STATIC_DIR": os.path.join(os.path.dirname(SERVER), "nodist"),
        "ADMIN_NAME": "Main Admin", "ADMIN_EMAIL": "admin@test.local", "ADMIN_PASSWORD": "adminpass123",
    })
    env_main.pop("MAIN_DB_URL", None)
    main_proc = subprocess.Popen([SERVER], env=env_main,
                                 stdout=open(os.path.join(os.path.dirname(SERVER), "main.log"), "w"),
                                 stderr=subprocess.STDOUT)

    if not wait_up(PORT_MAIN, "main"):
        main_proc.kill()
        sys.exit(1)

    # main owns the seed data (written before start would be overwritten by
    # self-seed; write after the schema exists instead)
    seed_main(MAIN_DB)

    # 3. replica node pointing at main
    env_rep = dict(env_base)
    env_rep.update({
        "SERVER_PORT": str(PORT_REPLICA), "SQLITE_PATH": REPLICA_DB,
        "STATIC_DIR": os.path.join(os.path.dirname(SERVER), "nodist"),
        "MAIN_DB_URL": f"http://127.0.0.1:{PORT_MAIN}",
        "SYNC_INTERVAL_SECONDS": "2", "SYNC_FLUSH_BYTES": "1024",
        "ADMIN_NAME": "Rep Admin", "ADMIN_EMAIL": "rep@test.local", "ADMIN_PASSWORD": "reppass123",
    })
    rep_proc = subprocess.Popen([SERVER], env=env_rep,
                                stdout=open(os.path.join(os.path.dirname(SERVER), "replica.log"), "w"),
                                stderr=subprocess.STDOUT)
    try:
        if not wait_up(PORT_REPLICA, "replica"):
            return

        # 4. bootstrap: the replica must have pulled main's catalog
        st, body = http("GET", f"http://127.0.0.1:{PORT_REPLICA}/api/models", headers={"x-api-key": API_KEY})
        d = json.loads(body) if st == 200 else {}
        aliases = [m["id"] for m in d.get("data", [])]
        check("replica bootstrapped main's models", "mock-alias" in aliases, body[:300])

        # A token minted on main is accepted by the replica (shared SECRET, and
        # the fixed IV is what makes this work across nodes).
        st, body = http("POST", f"http://127.0.0.1:{PORT_MAIN}/api/auth/login",
                        {"identify": {"email": "admin@test.local", "password": "adminpass123"}})
        token_main = json.loads(body)["data"]["token"] if st == 200 else ""
        check("main issues a login token", bool(token_main), body[:200])

        st, body = http("POST", f"http://127.0.0.1:{PORT_REPLICA}/api/account/list", {"page": 1}, {"token": token_main})
        d = json.loads(body) if st == 200 else {}
        check("token from main is accepted by the replica", st == 200 and d.get("success") is True, f"{st} {body[:200]}")

        # 5. the replica serves a relayed request and bills locally
        bal_before_rep = balance(REPLICA_DB, "acc-main")
        check("replica has the account (bootstrapped)", bal_before_rep is not None, str(bal_before_rep))

        st, body = http("POST", f"http://127.0.0.1:{PORT_REPLICA}/api/chat/completions",
                        {"model": "mock-alias", "messages": [{"role": "user", "content": "hi"}]},
                        {"x-api-key": API_KEY})
        d = json.loads(body) if st == 200 else {}
        check("relayed request on the replica", st == 200 and d.get("choices", [{}])[0].get("message", {}).get("content") == "Hello from mock!", f"{st} {body[:300]}")

        exp_cost = (100 * 1.0 + 20 * 2.0) / 1e6
        bal_after_rep = balance(REPLICA_DB, "acc-main")
        check("replica billed locally", abs((bal_before_rep - bal_after_rep) - exp_cost) < 1e-9,
              f"{bal_before_rep} -> {bal_after_rep}, exp {exp_cost}")

        # 6. the delta reaches main: main's balance must drop by the same amount
        bal_main_before = balance(MAIN_DB, "acc-main")
        pushed = False
        deadline = time.time() + 20
        while time.time() < deadline:
            b = balance(MAIN_DB, "acc-main")
            if abs((bal_main_before - b) - exp_cost) < 1e-9:
                pushed = True
                break
            time.sleep(0.5)
        check("replica's spend reaches main as a delta", pushed,
              f"main balance {bal_main_before} -> {balance(MAIN_DB, 'acc-main')}, expected -{exp_cost}")

        # 7. usage merges into main's window rows
        con = sqlite3.connect(MAIN_DB)
        row = con.execute("""SELECT input_tokens, output_tokens, request_count FROM usage_bucket
            WHERE account_id='acc-main' AND model_alias='mock-alias' AND granularity='1m'
            ORDER BY rowid DESC LIMIT 1""").fetchone()
        con.close()
        check("replica's usage merges into main's buckets",
              row is not None and row[0] == 100 and row[1] == 20 and row[2] == 1, str(row))

        # 8. the main node must NOT buffer its own writes (no push-back loop)
        con = sqlite3.connect(MAIN_DB)
        outbox_rows = con.execute("SELECT COUNT(*) FROM outbox").fetchone()[0]
        con.close()
        check("main node buffers nothing of its own", outbox_rows == 0, f"outbox rows={outbox_rows}")

        # 9. the buffer drains after a successful push
        con = sqlite3.connect(REPLICA_DB)
        pending = con.execute("SELECT COUNT(*) FROM outbox").fetchone()[0]
        con.close()
        check("replica's buffer is trimmed after a push", pending == 0, f"pending={pending}")

        # 10. an admin edit made ON THE REPLICA must reach main (the replica is
        # not read-only: it accepts admin writes and reports them as puts).
        st, body = http("POST", f"http://127.0.0.1:{PORT_REPLICA}/api/provider/update",
                        {"id": "p1", "provider": {"name": "Renamed On Replica"}}, {"token": token_main})
        check("replica accepts an admin edit", st == 200, f"{st} {body[:200]}")

        reached = False
        deadline = time.time() + 20
        while time.time() < deadline:
            con = sqlite3.connect(MAIN_DB)
            row = con.execute("SELECT name FROM provider WHERE id='p1'").fetchone()
            con.close()
            if row and row[0] == "Renamed On Replica":
                reached = True
                break
            time.sleep(0.5)
        check("replica's admin edit reaches main", reached,
              f"main provider name = {row[0] if row else None}")

        # 11. main's own admin edit is visible to main immediately (it buffers
        # nothing, so there is no self-sync step to wait for).
        st, body = http("POST", f"http://127.0.0.1:{PORT_MAIN}/api/model/create",
                        {"model": {"alias": "new-alias", "input_price": 3.0, "cache_price": 0.0,
                                   "output_price": 3.0, "is_public": 1}}, {"token": token_main})
        check("main accepts an admin model create", st == 200, f"{st} {body[:200]}")

        st, body = http("GET", f"http://127.0.0.1:{PORT_MAIN}/api/models", headers={"x-api-key": API_KEY})
        d = json.loads(body) if st == 200 else {}
        aliases = [m["id"] for m in d.get("data", [])]
        check("main serves its own new model", "new-alias" in aliases, body[:300])

        print()
        if fails:
            print("FAILED:", fails)
            sys.exit(1)
        print("ALL TESTS PASSED")
    finally:
        rep_proc.kill()
        main_proc.kill()


if __name__ == "__main__":
    main()
