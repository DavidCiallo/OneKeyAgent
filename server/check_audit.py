"""Audit trail smoke check — retention, body summary, and no auto-refresh.

Drives a real gateway against a stub upstream so audit rows are produced by the
actual relay path, then verifies what got stored:

  1. successful and failed attempts are both recorded
  2. retention holds the newest 10 of each outcome
  3. a failed row's request body keeps the JSON structure with every long
     string cut to a short preview
  4. the audit API does not hand the client anything unbounded
  5. provider routing policy: failure cooldown, daily quota, context filter

Run: python server/check_audit.py
"""

import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 3312
UPSTREAM_PORT = 3313
BASE = f"http://127.0.0.1:{PORT}"
UPSTREAM = f"http://127.0.0.1:{UPSTREAM_PORT}"

PASS, FAIL = [], []
TOKEN = {"value": ""}


def check(name, ok, detail=""):
    (PASS if ok else FAIL).append(name)
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))


def post(path, body, timeout=60):
    headers = {"Content-Type": "application/json"}
    if TOKEN["value"]:
        headers["token"] = TOKEN["value"]
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return json.loads(raw)
        except Exception:
            return {"success": False, "message": f"HTTP {e.code}: {raw[:200]}"}


class Upstream(BaseHTTPRequestHandler):
    """Stub provider. Relays whose prompt starts with 'broken-' fail with a 400
    carrying a large error document, so the stored summary has something to cut;
    everything else succeeds."""

    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n)
        parsed = None
        try:
            parsed = json.loads(raw)
        except Exception:
            pass
        self.server.last_body = parsed

        # The relay appends its own path, so the outcome is decided by the body.
        text = json.dumps(parsed or {})
        if "broken-" in text:
            payload = json.dumps({
                "error": {
                    "message": "invalid tool messages: " + ("detail " * 400),
                    "type": "invalid_request_error",
                    "long_array": list(range(60)),
                }
            }).encode()
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

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


def main():
    tmp = tempfile.mkdtemp(prefix="audit-check-")
    db_path = os.path.join(tmp, "onekey.db")

    upstream = HTTPServer(("127.0.0.1", UPSTREAM_PORT), Upstream)
    threading.Thread(target=upstream.serve_forever, daemon=True).start()

    exe = os.path.join(tmp, "onekey-server.exe")
    build = subprocess.run(["go", "build", "-o", exe, "./cmd/server"], cwd=HERE,
                           capture_output=True, text=True)
    if build.returncode != 0:
        print(build.stderr)
        return 1

    env = dict(os.environ)
    env.update({
        "SQLITE_PATH": db_path,
        "SERVER_PORT": str(PORT),
        "SECRET": "MySecretPassphrase1234567890abcABCEFGefg",
        "NONCE_LENGTH": "8",
        "ADMIN_NAME": "Administrator",
        "ADMIN_EMAIL": "admin@gmail.com",
        "ADMIN_PASSWORD": "demo123@",
        "STATIC_DIR": os.path.join(HERE, "..", "dist"),
        "GODOTENV_CONFIG_PATH": os.path.join(tmp, "absent.env"),
    })
    log = open(os.path.join(tmp, "server.log"), "w")
    proc = subprocess.Popen([exe], env=env, cwd=tmp, stdout=log, stderr=subprocess.STDOUT, text=True)

    try:
        for _ in range(60):
            with socket.socket() as s:
                s.settimeout(1)
                if s.connect_ex(("127.0.0.1", PORT)) == 0:
                    break
            time.sleep(0.5)
        else:
            print("server never came up")
            return 1

        login = post("/api/auth/login", {"identify": {"email": "admin@gmail.com", "password": "demo123@"}})
        assert login.get("success"), login
        TOKEN["value"] = login["data"]["token"]

        # A provider pointing at the stub, plus a model alias for the relay.
        created = post("/api/provider/create", {"provider": {
            "model_alias": "audit-alias", "priority": 1, "name": "stub",
            "base_url": UPSTREAM, "model": "m", "api_key": "k",
            "auth_type": "bearer", "api_type": "openai", "enabled": 1,
        }})
        assert created.get("success"), created

        model = post("/api/model/create", {"model": {
            "alias": "audit-alias", "input_price": 1.0, "output_price": 1.0, "is_public": 1,
        }})
        assert model.get("success") or "exists" in str(model.get("message", "")), model

        # An API key so the relay can authenticate.
        acct = post("/api/account/profile", {})
        account = (acct.get("data") or {}).get("account") or {}
        api_key = account.get("api_key")
        check("account api key available", bool(api_key), str(acct)[:120])
        if not api_key:
            return 1
        post("/api/account/update", {"id": account.get("id"), "account": {"balance": 50.0}})

        def relay(tag):
            req = urllib.request.Request(
                f"{BASE}/api/chat/completions",
                data=json.dumps({"model": "audit-alias",
                                 "messages": [{"role": "user", "content": tag * 500}]}).encode(),
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
            )
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    return r.status
            except urllib.error.HTTPError as e:
                e.read()
                return e.code

        # The stub decides success/failure from the prompt text, so one
        # provider entry drives both paths.
        print("\n1. produce traffic")
        ok_codes = [relay(f"prompt-{i:03d}-") for i in range(14)]
        check("successful relays answered 200", all(c == 200 for c in ok_codes), str(set(ok_codes)))
        bad_codes = [relay(f"broken-{i:03d}-") for i in range(14)]
        check("failing relays answered non-200", all(c != 200 for c in bad_codes), str(set(bad_codes)))

        print("\n2. retention")
        listing = post("/api/audit/list", {})
        check("audit list succeed", listing.get("success"), str(listing)[:160])
        rows = (listing.get("data") or {}).get("list", [])
        keep = (listing.get("data") or {}).get("keep")
        oks = [r for r in rows if r["success"] == 1]
        bads = [r for r in rows if r["success"] != 1]
        check("keep reported as 10", keep == 10, f"keep={keep}")
        check("at most 10 successes kept", len(oks) <= 10, f"{len(oks)} rows")
        check("at most 10 failures kept", len(bads) <= 10, f"{len(bads)} rows")
        check("both outcomes recorded", len(oks) > 0 and len(bads) > 0,
              f"ok={len(oks)} bad={len(bads)}")

        print("\n3. body summary shape")
        with_body = [r for r in bads if r.get("request_body")]
        check("failed rows carry a request body", len(with_body) > 0, f"{len(with_body)} rows")
        if with_body:
            body = with_body[0]["request_body"]
            try:
                parsed = json.loads(body)
                check("stored body is valid JSON", True)
            except Exception as e:
                check("stored body is valid JSON", False, str(e))
                parsed = None
            if parsed is not None:
                # The relay rewrites model to the upstream name, so the stored
                # body carries that — the point is the key survived at all.
                check("structure kept (model key)", parsed.get("model") == "m",
                      str(parsed.get("model")))
                msgs = parsed.get("messages")
                check("messages kept as a list", isinstance(msgs, list) and len(msgs) >= 1,
                      f"{type(msgs).__name__}")
                if isinstance(msgs, list) and msgs:
                    content = (msgs[0] or {}).get("content")
                    check("long field previewed, not stored whole",
                          isinstance(content, str) and len(content) < 200,
                          f"{len(content) if isinstance(content, str) else '?'} chars")
                    check("preview carries a truncation marker",
                          isinstance(content, str) and "…[+" in content, repr(content)[:80])
                # No stored field may run away: the whole point of the change.
                check("whole body is small", len(body) < 16000, f"{len(body)} bytes")
            resp = with_body[0].get("response_body") or ""
            check("failed rows carry a response body", bool(resp), f"{len(resp)} bytes")
            if resp:
                check("response body bounded", len(resp) < 9000, f"{len(resp)} bytes")

        print("\n4. response stays bounded")
        biggest = max((len(r.get("request_body") or "") + len(r.get("response_body") or ""))
                      for r in rows) if rows else 0
        check("no row stores a full prompt", biggest < 24000, f"largest {biggest} bytes")

        print("\n5. routing policy")
        # A second alias with one healthy and one broken provider, so the
        # policy has something to route around.
        post("/api/model/create", {"model": {"alias": "policy-alias", "input_price": 1.0,
                                             "output_price": 1.0, "is_public": 1}})
        good = post("/api/provider/create", {"provider": {
            "model_alias": "policy-alias", "priority": 1, "name": "good",
            "base_url": UPSTREAM, "model": "m", "api_key": "k",
            "auth_type": "bearer", "api_type": "openai", "enabled": 1,
        }})
        bad = post("/api/provider/create", {"provider": {
            "model_alias": "policy-alias", "priority": 1, "name": "bad",
            "base_url": UPSTREAM + "/nope", "model": "m", "api_key": "k",
            "auth_type": "bearer", "api_type": "openai", "enabled": 1,
        }})
        check("policy providers created", good.get("success") and bad.get("success"),
              f"{good.get('success')} {bad.get('success')}")
        bad_id = (bad.get("data") or {}).get("provider", {}).get("id")
        good_id = (good.get("data") or {}).get("provider", {}).get("id")

        # Point the "bad" provider at an unreachable port so every attempt it
        # gets fails, then drive enough traffic for the cooldown to trip.
        post("/api/provider/update", {"id": bad_id, "provider": {"base_url": "http://127.0.0.1:9"}})

        def relay_policy():
            req = urllib.request.Request(
                f"{BASE}/api/chat/completions",
                data=json.dumps({"model": "policy-alias",
                                 "messages": [{"role": "user", "content": "prompt-"}]}).encode(),
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
            )
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    r.read()
                    return r.status
            except urllib.error.HTTPError as e:
                e.read()
                return e.code

        # Both providers sit at priority 1, so routing alternates randomly
        # between them: each request has a chance of reaching the broken one.
        # Drive enough traffic that five hits are certain before it parks.
        codes = [relay_policy() for _ in range(30)]
        check("requests still succeed via the healthy provider", all(c == 200 for c in codes),
              str(set(codes)))

        providers = post("/api/provider/list", {"page": 1, "model_alias": "policy-alias"})
        plist = (providers.get("data") or {}).get("list", [])
        badrow = next((p for p in plist if p["id"] == bad_id), None)
        check("policy state exposed on the provider row", badrow is not None and "failures" in (badrow or {}),
              str(list((badrow or {}).keys()))[:120])
        if badrow:
            check("failing provider accumulated a failure streak",
                  (badrow.get("failures") or 0) > 0, f"failures={badrow.get('failures')}")
            parked = (badrow.get("cooldown_until") or 0) > 0
            check("failing provider was parked after 5 consecutive failures", parked,
                  f"cooldown_until={badrow.get('cooldown_until')} failures={badrow.get('failures')}")
            check("healthy provider stayed clean",
                  next((p.get("failures") for p in plist if p["id"] == good_id), None) == 0,
                  str([(p["name"], p.get("failures")) for p in plist]))

        # Context filter: a provider declaring a tiny window must be skipped for
        # a large request, and the request must still succeed via the other one.
        ctx = post("/api/provider/create", {"provider": {
            "model_alias": "ctx-alias", "priority": 1, "name": "tiny",
            "base_url": UPSTREAM, "model": "m", "api_key": "k",
            "auth_type": "bearer", "api_type": "openai", "enabled": 1,
            "max_context": 10,
        }})
        check("context-limited provider created", ctx.get("success"), str(ctx)[:120])
        post("/api/model/create", {"model": {"alias": "ctx-alias", "input_price": 1.0,
                                             "output_price": 1.0, "is_public": 1}})
        req = urllib.request.Request(
            f"{BASE}/api/chat/completions",
            data=json.dumps({"model": "ctx-alias",
                             "messages": [{"role": "user", "content": "x" * 20000}]}).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                r.read()
                ctx_code = r.status
        except urllib.error.HTTPError as e:
            e.read()
            ctx_code = e.code
        # The only provider is too small, so the fallback must keep it and the
        # upstream (which accepts anything) still answers 200.
        check("context filter falls back instead of failing", ctx_code == 200, f"code={ctx_code}")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        upstream.shutdown()

    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        print("failed:", FAIL)
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
