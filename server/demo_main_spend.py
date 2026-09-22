"""Demo: main-database spend is invisible to a replica too (the mirror case).

Scenario: a user's traffic is split across nodes. Some requests are served by
the MAIN database, some by the REPLICA. The replica never learns about main's
spending, because:

  * main does not buffer its own writes (OutboxOn() == false on main), and
  * the replica's only inbound channel, RefreshSnapshot, deliberately skips
    additive columns (balance, usage counters).

So the replica's balance stays high while the real (main) balance drains.
The question this demo answers: does the replica keep serving requests the
account can no longer afford?

Usage: python demo_main_spend.py <main-db> <replica-db> <server-exe>
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

MAIN_DB = os.path.abspath(sys.argv[1])
REPLICA_DB = os.path.abspath(sys.argv[2])
SERVER = os.path.abspath(sys.argv[3])
WORKDIR = os.path.dirname(SERVER)

PORT_MAIN = 3601
PORT_REPLICA = 3602
PORT_MOCK = 3600

SECRET = "demo-secret-0123456789abcdef"
NONCE_LENGTH = "8"
SYNC_SECRET = "demo-sync-secret-abc123"
API_KEY = "sk-demo-main-spend"

# Prices chosen so ONE request costs exactly 0.005:
#   1000 input @ 4.0/M  = 0.004
#    500 output @ 2.0/M = 0.001
IN_TOKENS = 1000
OUT_TOKENS = 500
COST_PER_REQ = (IN_TOKENS * 4.0 + OUT_TOKENS * 2.0) / 1e6


class MockHandler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        resp = {
            "id": "chatcmpl-demo", "object": "chat.completion",
            "model": body.get("model", "mock-model"),
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
    print(f"[FAIL] {name} never came up on :{port}")
    return False


def q(db_path, sql, args=()):
    con = sqlite3.connect(db_path, timeout=10)
    try:
        return con.execute(sql, args).fetchone()
    finally:
        con.close()


def balance(db_path):
    row = q(db_path, "SELECT balance FROM account WHERE id='acc-a'")
    return row[0] if row else None


def seed(path, starting_balance):
    con = sqlite3.connect(path)
    con.execute("""INSERT OR REPLACE INTO account
        (id,name,email,password,api_key,is_admin,balance,create_time)
        VALUES ('acc-a','Relay User','relay@test.local','x',?,0,?,1)""",
        (API_KEY, starting_balance))
    con.execute("""INSERT OR REPLACE INTO model
        (id,alias,input_price,cache_price,output_price,is_public,create_time)
        VALUES ('m1','mock-alias',4.0,0.0,2.0,1,1)""")
    con.execute("""INSERT OR REPLACE INTO provider
        (id,model_alias,priority,name,base_url,model,api_key,api_type,enabled,create_time)
        VALUES ('p1','mock-alias',1,'Mock',?,'mock-model','k','openai',1,1)""",
        (f"http://127.0.0.1:{PORT_MOCK}/v1",))
    con.commit()
    con.close()


def relay(port):
    return http("POST", f"http://127.0.0.1:{port}/api/chat/completions",
                {"model": "mock-alias", "messages": [{"role": "user", "content": "hi"}]},
                {"x-api-key": API_KEY})


def main():
    print("=" * 78)
    print("DEMO: main-database spend vs replica balance (main :%d / replica :%d)"
          % (PORT_MAIN, PORT_REPLICA))
    print("=" * 78)

    mock = HTTPServer(("127.0.0.1", PORT_MOCK), MockHandler)
    threading.Thread(target=mock.serve_forever, daemon=True).start()

    START = 0.02  # afford exactly 4 requests at 0.005 each

    env_base = dict(os.environ)
    env_base.update({"SECRET": SECRET, "NONCE_LENGTH": NONCE_LENGTH,
                     "SYNC_SECRET": SYNC_SECRET, "NODE_ID": "demo-node"})

    env_main = dict(env_base)
    env_main.update({
        "SERVER_PORT": str(PORT_MAIN), "SQLITE_PATH": MAIN_DB,
        "STATIC_DIR": os.path.join(WORKDIR, "nodist"),
        "ADMIN_NAME": "Main Admin", "ADMIN_EMAIL": "admin@test.local",
        "ADMIN_PASSWORD": "adminpass123",
    })
    env_main.pop("MAIN_DB_URL", None)
    main_proc = subprocess.Popen([SERVER], env=env_main, cwd=WORKDIR,
                                 stdout=open(os.path.join(WORKDIR, "demo2-main.log"), "w"),
                                 stderr=subprocess.STDOUT)
    if not wait_up(PORT_MAIN, "main"):
        main_proc.kill()
        sys.exit(1)
    seed(MAIN_DB, START)

    env_rep = dict(env_base)
    env_rep.update({
        "SERVER_PORT": str(PORT_REPLICA), "SQLITE_PATH": REPLICA_DB,
        "STATIC_DIR": os.path.join(WORKDIR, "nodist"),
        "MAIN_DB_URL": f"http://127.0.0.1:{PORT_MAIN}",
        "SYNC_INTERVAL_SECONDS": "2", "SYNC_FLUSH_BYTES": "999999999",
        "ADMIN_NAME": "Rep Admin", "ADMIN_EMAIL": "rep@test.local",
        "ADMIN_PASSWORD": "reppass123",
    })
    rep_proc = subprocess.Popen([SERVER], env=env_rep, cwd=WORKDIR,
                                stdout=open(os.path.join(WORKDIR, "demo2-replica.log"), "w"),
                                stderr=subprocess.STDOUT)
    try:
        if not wait_up(PORT_REPLICA, "replica"):
            return

        print(f"\n    starting balance on both nodes : {START}")
        print(f"    cost per request               : {COST_PER_REQ}")
        print(f"    => the account can afford {int(START / COST_PER_REQ)} requests\n")

        print("    replica balance after bootstrap: %s" % balance(REPLICA_DB))
        print("    main balance after bootstrap   : %s\n" % balance(MAIN_DB))

        # Spend everything on MAIN.
        print("[1] draining the balance on MAIN only")
        main_ok = 0
        for i in range(6):
            st, body = relay(PORT_MAIN)
            ok = st == 200
            if ok:
                main_ok += 1
            print(f"      main request {i+1}: HTTP {st}   main_balance={balance(MAIN_DB)}")
            if not ok:
                snippet = body[:120].replace("\n", " ")
                print(f"        -> refused: {snippet}")
                break
        print(f"    => main served {main_ok} requests, balance now {balance(MAIN_DB)}\n")

        print("[2] the replica's view of the same account")
        print(f"      replica balance              : {balance(REPLICA_DB)}")
        print(f"      true balance (main)          : {balance(MAIN_DB)}")
        drift = (balance(REPLICA_DB) or 0) - (balance(MAIN_DB) or 0)
        print(f"      replica overstates by        : {round(drift, 9)}\n")

        print("[3] can the replica still serve this now-broke account?")
        rep_ok = 0
        for i in range(6):
            st, body = relay(PORT_REPLICA)
            ok = st == 200
            if ok:
                rep_ok += 1
            print(f"      replica request {i+1}: HTTP {st}   replica_balance={balance(REPLICA_DB)}")
            if not ok:
                snippet = body[:120].replace("\n", " ")
                print(f"        -> refused: {snippet}")
                break
        print(f"    => replica served {rep_ok} requests\n")

        # Let the replica's deltas flow to main and see the combined result.
        print("[4] after the replica's deltas reach main")
        time.sleep(6)
        print(f"      replica balance              : {balance(REPLICA_DB)}")
        print(f"      main balance                 : {balance(MAIN_DB)}")
        ob = q(REPLICA_DB, "SELECT COUNT(*) FROM outbox")[0]
        print(f"      replica outbox rows pending  : {ob}")

        print("\n" + "=" * 78)
        print("SUMMARY")
        print("=" * 78)
        print(f"  start balance (both nodes) ......... {START}")
        print(f"  main served ........................ {main_ok} request(s)")
        print(f"  replica served (after main drained)  {rep_ok} request(s)")
        print(f"  main balance at end ................ {balance(MAIN_DB)}")
        print(f"  replica balance at end ............. {balance(REPLICA_DB)}")
        print(f"  total requests served .............. {main_ok + rep_ok}")
        print(f"  affordable at start ................ {int(START / COST_PER_REQ)}")
        if main_ok + rep_ok > int(START / COST_PER_REQ):
            over = (main_ok + rep_ok) - int(START / COST_PER_REQ)
            print(f"  => OVER-SERVED by {over} request(s) the account could not pay for")
        else:
            print("  => stayed within budget")
        print("=" * 78)
    finally:
        rep_proc.kill()
        main_proc.kill()


if __name__ == "__main__":
    main()
