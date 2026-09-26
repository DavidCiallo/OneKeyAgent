"""Check the show_home_page flag end to end.

Asserts the server injects the flag into index.html and that the SPA then routes
/home and unknown paths accordingly (login page when signed out, the account's
own default page when signed in).

Run one instance per flag value, e.g.

    python server/check_home_flag.py 3311 1
    python server/check_home_flag.py 3312 0

Usage: python server/check_home_flag.py [port] [1|0]
"""

import base64
import json
import os
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
from urllib.parse import urlparse

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = sys.argv[1] if len(sys.argv) > 1 else "3311"
# The value the setting carries: 1 keeps the home page, 0 closes it.
WANT = sys.argv[2] if len(sys.argv) > 2 else "1"
SHOWN = WANT == "1"
BASE = f"http://127.0.0.1:{PORT}"
CDP_PORT = 9336

PASS, FAIL = [], []


def check(name, ok, detail=""):
    (PASS if ok else FAIL).append(name)
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))


def api(path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["token"] = token
    req = urllib.request.Request(BASE + path, data=json.dumps(body or {}).encode(), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"success": False, "message": str(e)}


def get_raw(path):
    with urllib.request.urlopen(BASE + path, timeout=20) as r:
        return r.headers, r.read().decode("utf-8", "replace")


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
                      {"expression": expr, "returnByValue": True, "awaitPromise": True}, timeout=timeout)
        res = r.get("result", {})
        if "exceptionDetails" in res:
            raise RuntimeError(str(res["exceptionDetails"])[:300])
        return res.get("result", {}).get("value")


def wait_path(cdp, want, timeout=12):
    """Navigate currentPath away, then poll until the router has settled."""
    end = time.time() + timeout
    while time.time() < end:
        path = cdp.eval("window.location.pathname")
        if path == want:
            return path
        time.sleep(0.3)
    return cdp.eval("window.location.pathname")


def main():
    print(f"port {PORT}, show_home_page={WANT} (home page {'shown' if SHOWN else 'closed'})")

    # ── the server injects the flag ────────────────────────────────────────────
    headers, body = get_raw("/")
    marker = f'window.__APP_CONFIG__={{"show_home_page":{"true" if SHOWN else "false"}}}'
    check("index.html carries the flag", marker in body, marker if marker not in body else "")
    check("index.html is not cached", headers.get("Cache-Control") == "no-store", str(headers.get("Cache-Control")))
    check("index.html is html", "text/html" in (headers.get("Content-Type") or ""), str(headers.get("Content-Type")))
    check("head is still closed", "</head>" in body and body.index(marker) < body.index("</head>")
          if marker in body else False)

    # A deep link must get the same document, since that is the SPA entry point.
    _, deep = get_raw("/provider")
    check("SPA fallback carries the flag", marker in deep)

    # The setting is the effective value, not just the env default.
    login = api("/api/auth/login", {"identify": {"email": "admin@gmail.com", "password": "demo123@"}})
    if not login.get("success"):
        print(f"  login failed: {login}")
        return 1
    token = login["data"]["token"]
    listed = api("/api/settings/list", {}, token)
    entries = {e["key"]: e["value"] for e in listed.get("data", {}).get("entries", [])}
    check("settings list reports the flag",
          entries.get("show_home_page", "") == WANT,
          f"show_home_page={entries.get('show_home_page')!r}")

    # ── the SPA honours it ─────────────────────────────────────────────────────
    profile = tempfile.mkdtemp(prefix="home-cdp-")
    proc = subprocess.Popen([
        CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
        "--disable-extensions", f"--user-data-dir={profile}",
        f"--remote-debugging-port={CDP_PORT}", "--window-size=1400,1000", "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    cdp = CDP(CDP_PORT)
    try:
        cdp.wait()
        with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/list", timeout=5) as r:
            page = next(t for t in json.loads(r.read()) if t["type"] == "page")
        cdp.connect(page["webSocketDebuggerUrl"])
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")

        signed_out = "/home" if SHOWN else "/auth"

        cdp.call("Page.navigate", {"url": BASE + "/home"})
        time.sleep(3.5)
        path = wait_path(cdp, signed_out)
        check(f"signed out, /home lands on {signed_out}", path == signed_out, f"got {path}")

        # Unknown paths are the other entry point the flag has to cover.
        cdp.call("Page.navigate", {"url": BASE + "/does-not-exist"})
        time.sleep(3.5)
        path = wait_path(cdp, signed_out)
        check(f"signed out, unknown path lands on {signed_out}", path == signed_out, f"got {path}")

        # Root is the address most visitors actually type.
        cdp.call("Page.navigate", {"url": BASE + "/"})
        time.sleep(3.5)
        path = wait_path(cdp, signed_out)
        check(f"signed out, / lands on {signed_out}", path == signed_out, f"got {path}")

        # Now as an admin: the console is where logging in would have gone.
        signed_in = "/home" if SHOWN else "/account"
        cdp.eval(
            f"localStorage.setItem('access_token', {json.dumps(token)});"
            "localStorage.setItem('expires_at', String(Date.now() + 86400000));"
            "localStorage.setItem('user_email', 'admin@gmail.com');"
            "localStorage.setItem('user_is_admin', '1');"
            "localStorage.setItem('user_roles', JSON.stringify([{name:'account',type:'menu'}]));"
        )
        cdp.call("Page.navigate", {"url": BASE + "/home"})
        time.sleep(3.5)
        path = wait_path(cdp, signed_in)
        check(f"signed in, /home lands on {signed_in}", path == signed_in, f"got {path}")

        # A signed-in account must never be bounced back to the login form.
        if not SHOWN:
            check("signed in is not sent to the login page",
                  cdp.eval("window.location.pathname") != "/auth")
    finally:
        proc.kill()

    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        print("failed: " + ", ".join(FAIL))
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
