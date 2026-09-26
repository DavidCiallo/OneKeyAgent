"""Audit page UI check — the bodies are fetched on click, not with the list.

Starts a real gateway against a stub upstream, drives failing relays so there
are failed rows carrying a body summary, then opens the audit page in headless
Chrome with a request recorder installed before the app boots:

  1. loading the page calls /api/audit/list and does NOT call /api/audit/detail
  2. expanding a failed row is what triggers /api/audit/detail
  3. the body renders in the expanded row, and collapsing hides it again
  4. re-expanding the same row does not fetch it twice (cached until refresh)
  5. refreshing keeps the contract: list again, no detail

Run: python server/check_audit_ui.py
"""

import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 3314
UPSTREAM_PORT = 3315
CDP_PORT = 9334
BASE = f"http://127.0.0.1:{PORT}"
UPSTREAM = f"http://127.0.0.1:{UPSTREAM_PORT}"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

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
    """Relays whose prompt contains 'broken-' fail with a 400 carrying a large
    error document, so the row has a body summary worth fetching."""

    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n)
        try:
            text = json.dumps(json.loads(raw))
        except Exception:
            text = raw.decode(errors="replace")

        if "broken-" in text:
            payload = json.dumps({"error": {
                "message": "invalid tool messages: " + ("detail " * 400),
                "type": "invalid_request_error",
            }}).encode()
            self.send_response(400)
        else:
            payload = json.dumps({
                "id": "cmpl-1", "object": "chat.completion", "model": "m",
                "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"},
                             "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7},
            }).encode()
            self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


class CDP:
    def __init__(self, port):
        self.port = port
        self.next_id = 1

    def wait(self, timeout=40):
        end = time.time() + timeout
        while time.time() < end:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json/version", timeout=2) as r:
                    return json.loads(r.read())
            except Exception:
                time.sleep(0.4)
        raise RuntimeError("devtools never came up")

    def connect(self, ws_url):
        import base64
        from urllib.parse import urlparse
        u = urlparse(ws_url)
        s = socket.create_connection((u.hostname, u.port), timeout=30)
        key = base64.b64encode(os.urandom(16)).decode()
        s.sendall((
            f"GET {u.path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\n"
            f"Upgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        ).encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = s.recv(4096)
            if not chunk:
                raise RuntimeError("handshake failed")
            buf += chunk
        self.sock = s
        self.buf = buf.split(b"\r\n\r\n", 1)[1]

    def _send(self, payload):
        data = json.dumps(payload).encode()
        h = bytearray([0x81])
        n = len(data)
        if n < 126:
            h.append(0x80 | n)
        elif n < 65536:
            h.append(0x80 | 126)
            h += struct.pack(">H", n)
        else:
            h.append(0x80 | 127)
            h += struct.pack(">Q", n)
        mask = os.urandom(4)
        h += mask
        self.sock.sendall(bytes(h) + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def _recv(self):
        def need(n):
            while len(self.buf) < n:
                chunk = self.sock.recv(65536)
                if not chunk:
                    raise RuntimeError("closed")
                self.buf += chunk
        need(2)
        op = self.buf[0] & 0x0F
        ln = self.buf[1] & 0x7F
        off = 2
        if ln == 126:
            need(4); ln = struct.unpack(">H", self.buf[2:4])[0]; off = 4
        elif ln == 127:
            need(10); ln = struct.unpack(">Q", self.buf[2:10])[0]; off = 10
        need(off + ln)
        payload = self.buf[off:off + ln]
        self.buf = self.buf[off + ln:]
        if op == 0x8:
            raise RuntimeError("socket closed")
        return payload.decode("utf-8", "replace") if op == 0x1 else ""

    def call(self, method, params=None, timeout=60):
        mid = self.next_id
        self.next_id += 1
        self._send({"id": mid, "method": method, "params": params or {}})
        end = time.time() + timeout
        while time.time() < end:
            msg = self._recv()
            if not msg:
                continue
            try:
                obj = json.loads(msg)
            except Exception:
                continue
            if obj.get("id") == mid:
                return obj
        raise TimeoutError(method)

    def eval(self, expr, timeout=60):
        r = self.call("Runtime.evaluate",
                      {"expression": expr, "returnByValue": True, "awaitPromise": True},
                      timeout=timeout)
        res = r.get("result", {})
        if "exceptionDetails" in res:
            raise RuntimeError(str(res["exceptionDetails"])[:300])
        return res.get("result", {}).get("value")


# Installed before the app boots, so nothing it does can slip past.
RECORDER = r"""
(() => {
  window.__reqs = [];
  const note = (u) => { try { window.__reqs.push(String(u)); } catch (e) {} };
  const of = window.fetch;
  window.fetch = function (...a) {
    const u = a[0];
    note(u && u.url ? u.url : u);
    return of.apply(this, a);
  };
  const oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u, ...r) {
    note(u);
    return oo.call(this, m, u, ...r);
  };
  window.__hits = (frag) => window.__reqs.filter(u => u.indexOf(frag) >= 0).length;
  // HeroUI drives selection and buttons through react-aria press events, which
  // a bare .click() does not produce — dispatch the whole sequence.
  window.__press = (el) => {
    if (!el) return false;
    const o = {bubbles: true, cancelable: true, composed: true, view: window,
               button: 0, buttons: 1, pointerId: 1, isPrimary: true, pointerType: 'mouse'};
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new PointerEvent('pointerup', o));
    el.dispatchEvent(new MouseEvent('click', o));
    return true;
  };
})()
"""

# Clicks the failed outcome's expand button and reports the page state. The
# button is found inside the table so the check does not depend on the locale
# label, and the tab is picked by position for the same reason.
CLICK_DETAIL = r"""
(() => {
  const btns = [...document.querySelectorAll('table td button')];
  window.__btns = btns.length;
  if (!btns.length) return { clicked: false, buttons: 0 };
  const label = btns[0].textContent.trim();
  window.__press(btns[0]);
  return { clicked: true, buttons: btns.length, label };
})()
"""

READ_EXPANDED = r"""
(() => {
  const pres = [...document.querySelectorAll('pre')].map(p => p.textContent || '');
  const loading = [...document.querySelectorAll('p')].some(p => (p.textContent || '').trim() === 'Loading...');
  return { pres, loading, hits: window.__reqs.slice(), detail: window.__hits('/api/audit/detail') };
})()
"""

SELECT_FAILED_TAB = r"""
(() => {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  if (tabs.length < 2) return { ok: false, tabs: tabs.map(t => t.textContent.trim()) };
  const label = tabs[1].textContent.trim();
  window.__press(tabs[1]);
  return { ok: true, label, tabs: tabs.map(t => t.textContent.trim()) };
})()
"""


def wait_for(cdp, expr, want, tries=30, pause=0.5):
    """Poll an expression until it satisfies want, returning the last value."""
    last = None
    for _ in range(tries):
        last = cdp.eval(expr)
        if want(last):
            return last
        time.sleep(pause)
    return last


def main():
    tmp = tempfile.mkdtemp(prefix="audit-ui-")
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

    profile = tempfile.mkdtemp(prefix="audit-ui-cdp-")
    chrome = None
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
        if not login.get("success"):
            print(f"login failed: {login}")
            return 1
        TOKEN["value"] = login["data"]["token"]

        post("/api/provider/create", {"provider": {
            "model_alias": "ui-alias", "priority": 1, "name": "stub",
            "base_url": UPSTREAM, "model": "m", "api_key": "k",
            "auth_type": "bearer", "api_type": "openai", "enabled": 1,
        }})
        post("/api/model/create", {"model": {
            "alias": "ui-alias", "input_price": 1.0, "output_price": 1.0, "is_public": 1}})
        acct = post("/api/account/profile", {}).get("data", {}).get("account", {})
        api_key = acct.get("api_key")
        post("/api/account/update", {"id": acct.get("id"), "account": {"balance": 50.0}})
        if not api_key:
            print("no api key")
            return 1

        def relay(tag):
            req = urllib.request.Request(
                f"{BASE}/api/chat/completions",
                data=json.dumps({"model": "ui-alias",
                                 "messages": [{"role": "user", "content": tag * 300}]}).encode(),
                headers={"Content-Type": "application/json",
                         "Authorization": f"Bearer {api_key}"},
            )
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    r.read()
                    return r.status
            except urllib.error.HTTPError as e:
                e.read()
                return e.code

        print("\n1. produce failed rows with bodies")
        codes = [relay(f"broken-{i:03d}-") for i in range(3)]
        check("failing relays answered non-200", all(c != 200 for c in codes), str(set(codes)))
        rows = (post("/api/audit/list", {}).get("data") or {}).get("list", [])
        failed = [r for r in rows if r["success"] != 1]
        check("failed rows listed with has_detail",
              len(failed) == 3 and all(r.get("has_detail") for r in failed),
              f"{len(failed)} rows")

        print("\n2. open the page")
        chrome = subprocess.Popen([
            CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
            "--disable-extensions", f"--user-data-dir={profile}",
            f"--remote-debugging-port={CDP_PORT}", "--window-size=1400,1000", "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        cdp = CDP(CDP_PORT)
        cdp.wait()
        with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/list", timeout=5) as r:
            page = next(t for t in json.loads(r.read()) if t["type"] == "page")
        cdp.connect(page["webSocketDebuggerUrl"])
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")
        cdp.call("Page.addScriptToEvaluateOnNewDocument", {"source": RECORDER})
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": 1400, "height": 1000, "deviceScaleFactor": 1, "mobile": False})

        token = TOKEN["value"]
        cdp.call("Page.navigate", {"url": BASE + "/"})
        time.sleep(2.0)
        cdp.eval(
            f"localStorage.setItem('access_token', {json.dumps(token)});"
            f"localStorage.setItem('expires_at', String(Date.now() + 86400000));"
            f"localStorage.setItem('user_email', 'admin@gmail.com');"
            f"localStorage.setItem('user_is_admin', '1');"
        )
        cdp.call("Page.navigate", {"url": BASE + "/audit"})

        state = wait_for(cdp, READ_EXPANDED, lambda v: v and v.get("hits"), tries=40)
        hits = (state or {}).get("hits", [])
        check("the page requested the list",
              any("/api/audit/list" in u for u in hits), f"{len(hits)} requests")
        check("loading the page did NOT request a detail",
              not any("/api/audit/detail" in u for u in hits), str([u for u in hits if "audit" in u]))

        print("\n3. expanding a failed row is what fetches the body")
        opened_tab = cdp.eval(SELECT_FAILED_TAB)
        check("failed tab selected", (opened_tab or {}).get("ok"),
              str((opened_tab or {}).get("tabs")))
        time.sleep(1.0)
        check("failed rows offer an expand control",
              cdp.eval("document.querySelectorAll('table td button').length") > 0,
              f"{cdp.eval('document.querySelectorAll(\"table td button\").length')} buttons")

        before = cdp.eval("window.__hits('/api/audit/detail')")
        clicked = cdp.eval(CLICK_DETAIL)
        check("a detail button exists on failed rows", clicked.get("clicked"),
              str(clicked))

        after = wait_for(cdp, READ_EXPANDED,
                         lambda v: v and v.get("detail", 0) > (before or 0)
                         and not v.get("loading") and any(p.strip() for p in v.get("pres", [])),
                         tries=25)
        check("clicking fetched the detail",
              (after or {}).get("detail", 0) > (before or 0),
              f"before={before} after={(after or {}).get('detail')}")
        check("the fetch happened only after the click", before == 0, f"before={before}")

        pres = [p for p in (after or {}).get("pres", []) if p.strip()]
        check("the body renders in the expanded row", len(pres) >= 1,
              f"{len(pres)} blocks, first {len(pres[0]) if pres else 0} chars")
        check("the rendered body is the request summary",
              any("messages" in p for p in pres),
              (pres[0][:80].replace("\n", " ") if pres else ""))
        check("no loading placeholder left behind", not (after or {}).get("loading"), "")

        print("\n4. collapsing and re-expanding reuses the fetched body")
        cdp.eval(CLICK_DETAIL)  # the same button now reads 收起详情
        time.sleep(0.6)
        collapsed = cdp.eval(READ_EXPANDED)
        check("collapsing hides the body",
              not [p for p in collapsed.get("pres", []) if p.strip()],
              f"{len(collapsed.get('pres', []))} blocks")

        fetched = collapsed.get("detail")
        cdp.eval(CLICK_DETAIL)
        time.sleep(0.8)
        again = cdp.eval(READ_EXPANDED)
        check("re-expanding shows the body again",
              any("messages" in p for p in again.get("pres", [])),
              f"{len(again.get('pres', []))} blocks")
        check("re-expanding did not fetch it again", again.get("detail") == fetched,
              f"{fetched} then {again.get('detail')}")

        print("\n5. refresh keeps the contract")
        lists_before = len([u for u in again.get("hits", []) if "/api/audit/list" in u])
        refreshed = cdp.eval(r"""
        (() => {
          // The toolbar button: not in the table, not one of the outcome tabs.
          const b = [...document.querySelectorAll('button')]
            .filter(x => !x.closest('table') && x.getAttribute('role') !== 'tab')
            .pop();
          if (!b) return { ok: false };
          const label = b.textContent.trim();
          window.__press(b);
          return { ok: true, label };
        })()
        """)
        check("refresh button found", (refreshed or {}).get("ok"), str(refreshed))
        time.sleep(2.0)
        final = cdp.eval(READ_EXPANDED)
        lists_after = len([u for u in final.get("hits", []) if "/api/audit/list" in u])
        check("refresh re-requested the list", lists_after > lists_before,
              f"{lists_before} -> {lists_after} list calls")
        check("refresh did not request every body",
              final.get("detail") == fetched,
              f"detail calls {final.get('detail')} (was {fetched})")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        upstream.shutdown()
        if chrome is not None:
            chrome.terminate()
            try:
                chrome.wait(timeout=10)
            except subprocess.TimeoutExpired:
                chrome.kill()
        shutil.rmtree(profile, ignore_errors=True)
        log.close()

    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        print("failed:", FAIL)
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
