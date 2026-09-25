"""Provider page smoke check — the card grid's data contract, end to end.

Seeds a DB with several failover chains, then exercises what the page does:
  1. /api/provider/modelaliases returns live aliases, sorted, no ghosts
  2. the first alias is a real chain (the page lands on it by default)
  3. /api/provider/list filtered by that alias returns only that chain
  4. every field the card renders is present in the row payload

Run: python server/check_provider_page.py
"""

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 3311
BASE = f"http://127.0.0.1:{PORT}"

PASS, FAIL = [], []
TOKEN = {"value": ""}


def check(name, ok, detail=""):
    (PASS if ok else FAIL).append(name)
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))


def post(path, body):
    headers = {"Content-Type": "application/json"}
    # The gateway reads auth from the token header (not the body field).
    if TOKEN["value"]:
        headers["token"] = TOKEN["value"]
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        # The gateway answers failures as JSON too; surface them as data so a
        # rejected call reads as a failed check rather than a crash.
        raw = e.read().decode(errors="replace")
        try:
            return json.loads(raw)
        except Exception:
            return {"success": False, "message": f"HTTP {e.code}: {raw[:200]}"}


def main():
    tmp = tempfile.mkdtemp(prefix="provider-page-")
    db_path = os.path.join(tmp, "onekey.db")

    env = dict(os.environ)
    env["SQLITE_PATH"] = db_path
    env["SERVER_PORT"] = str(PORT)
    env["SECRET"] = "MySecretPassphrase1234567890abcABCEFGefg"
    env["NONCE_LENGTH"] = "8"
    env["ADMIN_NAME"] = "Administrator"
    env["ADMIN_EMAIL"] = "admin@example.com"
    env["ADMIN_PASSWORD"] = "demo123@"
    env["STATIC_DIR"] = os.path.join(HERE, "..", "dist")
    # The server calls godotenv.Load(), which loads the repo .env from the
    # working directory and would otherwise point this run at the real
    # database. Run from the temp dir and point GOTENV at a file that does not
    # exist, so only the values above apply.
    env["GODOTENV_CONFIG_PATH"] = os.path.join(tmp, "absent.env")

    # Build a server binary so the run does not depend on `go run` plumbing.
    exe = os.path.join(tmp, "onekey-server.exe")
    build = subprocess.run(
        ["go", "build", "-o", exe, "./cmd/server"],
        cwd=HERE, capture_output=True, text=True,
    )
    if build.returncode != 0:
        print(build.stderr)
        return 1

    log_path = os.path.join(tmp, "server.log")
    log = open(log_path, "w")
    # cwd = tmp keeps any relative path the server derives out of the repo.
    proc = subprocess.Popen([exe], env=env, cwd=tmp, stdout=log, stderr=subprocess.STDOUT, text=True)

    try:
        # Wait for the port to accept connections. Probing the API instead
        # would trip over non-2xx statuses, which are a normal answer here.
        for _ in range(60):
            with socket.socket() as s:
                s.settimeout(1)
                if s.connect_ex(("127.0.0.1", PORT)) == 0:
                    break
            time.sleep(0.5)
        else:
            log.flush()
            print("server never came up; log follows:")
            print(open(log_path).read())
            return 1

        login = post("/api/auth/login", {"identify": {"email": "admin@example.com", "password": "demo123@"}})
        if not login.get("success"):
            print("login failed:", login)
            return 1
        tok = login["data"]["token"]
        TOKEN["value"] = tok

        # The token travels in a header now; keep call sites unchanged.
        def auth(body):
            return dict(body)

        # Seed three chains; one provider is deleted afterwards.
        def add(alias, priority, name, model="m-1", **kw):
            row = {
                "model_alias": alias, "priority": priority, "name": name,
                "base_url": f"https://{name}.example.com/v1", "model": model,
                "api_key": "sk-abcdefghijklmnopqrstuvwxyz0123456789",
                "auth_type": "bearer", "api_type": "openai",
                "supports_thinking": 1, "supports_reasoning_effort": 0,
                "replay_reasoning": 1, "enable_search": 0, "enabled": 1,
            }
            row.update(kw)
            res = post("/api/provider/create", auth({"provider": row}))
            assert res.get("success"), res
            return res["data"]["provider"]["id"]

        add("gpt-4o", 1, "primary")
        add("gpt-4o", 2, "backup")
        add("gpt-4o", 3, "tertiary")
        add("claude-sonnet", 1, "anthropic-direct", model="claude-sonnet-4")
        add("claude-sonnet", 2, "anthropic-proxy", model="claude-sonnet-4", enabled=0)
        ghost_id = add("aaa-legacy", 1, "retired")

        raw = post("/api/provider/delete", auth({"id": ghost_id}))
        check("deleted provider removed", raw.get("success"), str(raw.get("message")))

        print("\n1. alias picker")
        aliases = post("/api/provider/modelaliases", auth({}))
        got = aliases.get("data")
        check("aliases succeed", aliases.get("success"))
        check("ghost alias excluded", "aaa-legacy" not in (got or []), f"got {got}")
        check("aliases sorted", got == sorted(got or []), f"got {got}")
        check("expected chains present", set(got or []) == {"gpt-4o", "claude-sonnet"}, f"got {got}")

        # The page defaults to the first alias — it must be a real chain.
        default_alias = (got or [None])[0]
        print(f"\n2. default landing alias = {default_alias!r}")
        check("first alias is a live chain", default_alias in ("gpt-4o", "claude-sonnet"))

        print("\n3. filtered list")
        listing = post("/api/provider/list", auth({"page": 1, "filter": {"model_alias": default_alias}}))
        check("list succeed", listing.get("success"))
        rows = listing["data"]["list"]
        check("only that alias returned",
              all(r["model_alias"] == default_alias for r in rows),
              f"{[r['model_alias'] for r in rows]}")
        check("chain ordered by priority",
              [r["priority"] for r in rows] == sorted(r["priority"] for r in rows),
              f"{[r['priority'] for r in rows]}")

        print("\n4. card field contract")
        required = ["id", "model_alias", "priority", "name", "base_url", "model",
                    "api_key", "auth_type", "api_type", "proxy_url",
                    "supports_thinking", "supports_reasoning_effort",
                    "replay_reasoning", "enable_search", "enabled"]
        row = rows[0]
        missing = [f for f in required if f not in row]
        check("all card fields present", not missing, f"missing {missing}")
        check("api_key non-empty (masked in UI)", bool(row.get("api_key")))
        check("priority within 1..5", 1 <= row["priority"] <= 5, str(row["priority"]))
        check("capability flags are 0/1",
              all(row[f] in (0, 1) for f in ("supports_thinking", "supports_reasoning_effort",
                                             "replay_reasoning", "enable_search", "enabled")))

        # The "new provider is pre-filled with the viewed chain" contract:
        # creating with the alias the page is on must land in that chain.
        print("\n5. create pre-filled into the viewed chain")
        created = post("/api/provider/create", auth({"provider": {
            "model_alias": default_alias, "priority": 5, "name": "added-from-page",
            "base_url": "https://added.example.com/v1", "model": "m-1",
            "auth_type": "bearer", "api_type": "openai", "enabled": 1,
        }}))
        check("create succeed", created.get("success"))
        after = post("/api/provider/list", auth({"page": 1, "filter": {"model_alias": default_alias}}))
        names = [r["name"] for r in after["data"]["list"]]
        check("new provider in the viewed chain", "added-from-page" in names, f"{names}")

        print("\n6. static assets served for the card page")
        with urllib.request.urlopen(BASE + "/", timeout=15) as r:
            html = r.read().decode()
        check("index.html served", "<div id=\"root\">" in html or "root" in html)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()

    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        print("failed:", FAIL)
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
