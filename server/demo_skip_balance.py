"""Three-way experiment: how should a refresh combine the main database's
balance with the replica's local state?

SYNC_ADDITIVE_MODE picks the merge strategy for additive columns (balance,
usage counters):

  skip      the pre-reconcile behaviour: leave the local value alone. Unpushed
            local spend survives, but the main database's own spend never
            arrives — the replica keeps serving against money already spent.
  copy      plain overwrite with the snapshot. UNSAFE: the snapshot is by
            construction older than the local value, so unpushed local
            deductions get refunded — free balance.
  reconcile (shipped) write snapshot + unpushed local deltas. Both properties
            at once: local spend stays charged AND main's spend arrives.

This script measures all three on the same scenario.

Timeline per run:
  1. main seeds the account with a known balance
  2. replica bootstraps -> same balance
  3. replica serves traffic, creating a LOCAL PENDING DEDUCTION
  4. main spends too (a DIFFERENT amount, so the cases are distinguishable)
  5. force a replica refresh from main
  6. compare against the mode's expected outcome

Usage: python demo_skip_balance.py <server-exe> <mode:skip|copy|reconcile>
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

SERVER = os.path.abspath(sys.argv[1])
MODE = sys.argv[2] if len(sys.argv) > 2 else "reconcile"
if MODE not in ("skip", "copy", "reconcile"):
    sys.exit("usage: python demo_skip_balance.py <server-exe> <mode:skip|copy|reconcile>")
WORKDIR = os.path.dirname(SERVER)

PORT_OFF = {"skip": 0, "copy": 100, "reconcile": 200}[MODE]
PORT_MAIN = 3701 + PORT_OFF
PORT_REPLICA = 3702 + PORT_OFF
PORT_MOCK = 3700 + PORT_OFF

BASE = os.path.join(WORKDIR, f"exp-{MODE}")
MAIN_DB = os.path.join(BASE, "main.db")
REPLICA_DB = os.path.join(BASE, "replica.db")

SECRET = "demo-secret-0123456789abcdef"
NONCE_LENGTH = "8"
SYNC_SECRET = "demo-sync-secret-abc123"
API_KEY = "sk-exp-key"

IN_TOKENS, OUT_TOKENS = 1000, 500
COST_PER_REQ = (IN_TOKENS * 4.0 + OUT_TOKENS * 2.0) / 1e6  # 0.005
START = 1.0


class MockHandler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        resp = {
            "id": "c", "object": "chat.completion",
            "model": body.get("model", "m"),
            "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"},
                         "finish_reason": "stop"}],
            "usage": {"prompt_tokens": IN_TOKENS, "completion_tokens": OUT_TOKENS,
                      "total_tokens": IN_TOKENS + OUT_TOKENS},
        }
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
    except Exception as e:
        return 0, str(e)


def wait_up(port, name, seconds=30):
    for _ in range(seconds):
        st, _ = http("GET", f"http://127.0.0.1:{port}/api/auth/config", timeout=3)
        if st == 200:
            return True
        time.sleep(1)
    print(f"[FAIL] {name} never came up")
    return False


def q(db, sql, args=()):
    con = sqlite3.connect(db, timeout=10)
    try:
        return con.execute(sql, args).fetchone()
    finally:
        con.close()


def bal(db):
    r = q(db, "SELECT balance FROM account WHERE id='acc-a'")
    return r[0] if r else None


def seed(path):
    con = sqlite3.connect(path)
    con.execute("""INSERT OR REPLACE INTO account
        (id,name,email,password,api_key,is_admin,balance,create_time)
        VALUES ('acc-a','U','u@t.local','x',?,0,?,1)""", (API_KEY, START))
    con.execute("""INSERT OR REPLACE INTO model
        (id,alias,input_price,cache_price,output_price,is_public,create_time)
        VALUES ('m1','mock-alias',4.0,0.0,2.0,1,1)""")
    con.execute("""INSERT OR REPLACE INTO provider
        (id,model_alias,priority,name,base_url,model,api_key,api_type,enabled,create_time)
        VALUES ('p1','mock-alias',1,'Mock',?,'mock-model','k','openai',1,1)""",
        (f"http://127.0.0.1:{PORT_MOCK}/v1",))
    con.commit()
    con.close()


def relay(port, n=1):
    served = 0
    for _ in range(n):
        st, _ = http("POST", f"http://127.0.0.1:{port}/api/chat/completions",
                     {"model": "mock-alias", "messages": [{"role": "user", "content": "hi"}]},
                     {"x-api-key": API_KEY})
        if st == 200:
            served += 1
    return served


def main():
    os.makedirs(BASE, exist_ok=True)
    for f in (MAIN_DB, REPLICA_DB):
        if os.path.exists(f):
            os.remove(f)
    for suf in ("-wal", "-shm"):
        for f in (MAIN_DB, REPLICA_DB):
            if os.path.exists(f + suf):
                os.remove(f + suf)

    label = {
        "skip": "SKIP balance (pre-reconcile: local value kept blind)",
        "copy": "COPY balance (UNSAFE overwrite — refunds unpushed spend)",
        "reconcile": "RECONCILE balance (shipped: snapshot + unpushed deltas)",
    }[MODE]
    print("=" * 78)
    print(f"MODE: {label}")
    print("=" * 78)

    mock = HTTPServer(("127.0.0.1", PORT_MOCK), MockHandler)
    threading.Thread(target=mock.serve_forever, daemon=True).start()

    env_base = dict(os.environ)
    env_base.update({"SECRET": SECRET, "NONCE_LENGTH": NONCE_LENGTH,
                     "SYNC_SECRET": SYNC_SECRET, "NODE_ID": "exp-node",
                     "SYNC_ADDITIVE_MODE": MODE})

    env_main = dict(env_base)
    env_main.update({
        "SERVER_PORT": str(PORT_MAIN), "SQLITE_PATH": MAIN_DB,
        "STATIC_DIR": os.path.join(WORKDIR, "nodist"),
        "ADMIN_NAME": "A", "ADMIN_EMAIL": "admin@test.local", "ADMIN_PASSWORD": "adminpass123",
    })
    env_main.pop("MAIN_DB_URL", None)
    main_proc = subprocess.Popen([SERVER], env=env_main, cwd=WORKDIR,
                                 stdout=open(os.path.join(BASE, "main.log"), "w"),
                                 stderr=subprocess.STDOUT)
    if not wait_up(PORT_MAIN, "main"):
        main_proc.kill()
        return
    seed(MAIN_DB)

    env_rep = dict(env_base)
    env_rep.update({
        "SERVER_PORT": str(PORT_REPLICA), "SQLITE_PATH": REPLICA_DB,
        "STATIC_DIR": os.path.join(WORKDIR, "nodist"),
        "MAIN_DB_URL": f"http://127.0.0.1:{PORT_MAIN}",
        "SYNC_INTERVAL_SECONDS": "3600",     # never auto-push: keep deltas PENDING
        "SYNC_FLUSH_BYTES": "999999999",
        "SYNC_PULL_SECONDS": "3600",         # never auto-pull
        "ADMIN_NAME": "B", "ADMIN_EMAIL": "rep@test.local", "ADMIN_PASSWORD": "reppass123",
    })
    rep_proc = subprocess.Popen([SERVER], env=env_rep, cwd=WORKDIR,
                                stdout=open(os.path.join(BASE, "replica.log"), "w"),
                                stderr=subprocess.STDOUT)
    try:
        if not wait_up(PORT_REPLICA, "replica"):
            return

        print(f"\n  start balance (both)              : {START}")
        print(f"  cost per request                  : {COST_PER_REQ}")

        # step 3: replica spends, creating a PENDING local deduction
        n = relay(PORT_REPLICA, 2)
        print(f"\n  [3] replica served {n} req -> local balance: {bal(REPLICA_DB)}")
        pending = q(REPLICA_DB, "SELECT COUNT(*) FROM outbox")[0]
        print(f"      replica outbox rows (UNPUSHED) : {pending}")

        # step 4: main spends a DIFFERENT amount, so the two cases are
        # distinguishable: if the snapshot wins, the replica's balance becomes
        # main's number and the local spend vanishes.
        m = relay(PORT_MAIN, 6)
        print(f"  [4] main served {m} req    -> main balance : {bal(MAIN_DB)}")

        # step 5: force the replica to refresh from main
        print("\n  [5] forcing replica refresh from main ...")
        # the pull loop is parked for an hour; drive Refresh via a fresh replica
        # process would lose local state, so instead hit the snapshot endpoint
        # through a short-lived helper process is overkill — use the fact that
        # /api/sync/status is read-only and instead restart the replica with the
        # same DB, which re-reads main's snapshot via Bootstrap? No: Bootstrap is
        # one-shot. So we call the export endpoint directly and re-apply through
        # a second replica start is not equivalent.
        #
        # Simplest faithful trigger: the replica's Refresh runs on its pull
        # ticker. We set SYNC_PULL_SECONDS=3600 only to keep the FIRST refresh
        # from racing; now we start a second short pull by restarting the replica
        # is wrong (one-shot bootstrap). Instead we rely on the ticker by
        # restarting with a 2s pull and the SAME db (Bootstrap is skipped because
        # bootstrapped=1, Refresh runs on tick).
        rep_proc.kill()
        time.sleep(1)
        env_rep2 = dict(env_rep)
        env_rep2["SYNC_PULL_SECONDS"] = "2"
        rep_proc = subprocess.Popen([SERVER], env=env_rep2, cwd=WORKDIR,
                                    stdout=open(os.path.join(BASE, "replica2.log"), "w"),
                                    stderr=subprocess.STDOUT)
        if not wait_up(PORT_REPLICA, "replica(restart)"):
            return
        time.sleep(5)  # let a couple of pull ticks land

        rep_after = bal(REPLICA_DB)
        main_after = bal(MAIN_DB)
        print(f"\n  [6] after refresh")
        print(f"      replica balance                 : {rep_after}")
        print(f"      main balance                    : {main_after}")

        local_spend = 2 * COST_PER_REQ
        expected = {
            "skip":      START - local_spend,       # local spend kept; main's spend invisible
            "copy":      main_after,                # snapshot wins; local spend refunded
            "reconcile": main_after - local_spend,  # both money truths at once
        }[MODE]
        print(f"\n  expected for mode {MODE:<9}   : {expected}")
        print(f"  measured                    : {rep_after}")

        print(f"\n  RESULT:")
        if abs(rep_after - expected) > 1e-9:
            print(f"    UNEXPECTED: replica={rep_after} main={main_after} expected={expected}")
        elif MODE == "skip":
            print("    local pending deduction SURVIVED (no free balance given away)")
            print(f"    but main's {START - main_after} of spend is INVISIBLE — over-serving by that much")
        elif MODE == "copy":
            print(f"    *** LOCAL SPEND ERASED: replica balance jumped to {rep_after}")
            print(f"        the 2 replica requests ({local_spend}) were refunded for free")
        else:
            print(f"    local pending deduction SURVIVED ({local_spend} still charged)")
            print(f"    main's {START - main_after} of spend ABSORBED (true balance = {main_after - local_spend})")
            print("    -> no refund, no over-serving")
    finally:
        rep_proc.kill()
        main_proc.kill()


if __name__ == "__main__":
    main()
