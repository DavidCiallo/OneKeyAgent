"""Measure the provider page layout in headless Chrome via DevTools Protocol.

Logs into a live server, seeds the token, loads the provider page at several
viewport widths, and evaluates real geometry: does the single-line row inside
each card overflow the card? Overflow is the bug — the fields must shrink and
ellipsise rather than pushing the action buttons past the card edge.

Run: python server/check_layout.py [port]
"""

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = sys.argv[1] if len(sys.argv) > 1 else "3311"
BASE = f"http://127.0.0.1:{PORT}"
CDP_PORT = 9333

WIDTHS = [1024, 1280, 1440, 1920, 2560]

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


PROBE = r"""
(() => {
  const cards = [...document.querySelectorAll('div.rounded-xl')]
      .filter(c => (c.className || '').includes('transition-shadow'));
  const out = {
    url: location.href,
    width: window.innerWidth,
    cards: cards.length,
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
    rows: [],
  };
  for (const c of cards.slice(0, 5)) {
    const line = c.firstElementChild;
    if (!line) continue;
    const cb = c.getBoundingClientRect();
    const lbs = line.getBoundingClientRect();
    out.rows.push({
      cardW: Math.round(cb.width),
      cardRight: Math.round(cb.right),
      lineClient: Math.round(line.clientWidth),
      lineScroll: Math.round(line.scrollWidth),
      overflowPx: Math.round(line.scrollWidth - line.clientWidth),
      lineRight: Math.round(lbs.right),
    });
  }
  return JSON.stringify(out);
})()
"""


class CDP:
    """Minimal DevTools Protocol client over the HTTP + websocket endpoints."""

    def __init__(self, port):
        self.port = port
        self.ws = None
        self.next_id = 1

    def wait(self, timeout=40):
        end = time.time() + timeout
        while time.time() < end:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json/version", timeout=2) as r:
                    return json.loads(r.read())
            except Exception:
                time.sleep(0.4)
        raise RuntimeError("chrome devtools never came up")

    def connect(self, ws_url):
        # Tiny websocket client: enough for text frames, which is all CDP uses.
        import base64
        import hashlib
        import struct
        from urllib.parse import urlparse

        u = urlparse(ws_url)
        s = socket.create_connection((u.hostname, u.port), timeout=30)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET {u.path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\n"
            f"Upgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        s.sendall(req.encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = s.recv(4096)
            if not chunk:
                raise RuntimeError("websocket handshake failed")
            buf += chunk
        self.sock = s
        self.buf = buf.split(b"\r\n\r\n", 1)[1]

    def _send(self, payload):
        import struct
        data = json.dumps(payload).encode()
        header = bytearray([0x81])
        n = len(data)
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", n)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", n)
        mask = os.urandom(4)
        header += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        self.sock.sendall(bytes(header) + masked)

    def _recv(self):
        import struct
        def need(n):
            while len(self.buf) < n:
                chunk = self.sock.recv(65536)
                if not chunk:
                    raise RuntimeError("socket closed")
                self.buf += chunk
        need(2)
        b1, b2 = self.buf[0], self.buf[1]
        opcode = b1 & 0x0F
        ln = b2 & 0x7F
        off = 2
        if ln == 126:
            need(4)
            ln = struct.unpack(">H", self.buf[2:4])[0]
            off = 4
        elif ln == 127:
            need(10)
            ln = struct.unpack(">Q", self.buf[2:10])[0]
            off = 10
        need(off + ln)
        payload = self.buf[off:off + ln]
        self.buf = self.buf[off + ln:]
        if opcode == 0x8:
            raise RuntimeError("websocket closed")
        if opcode == 0x1:
            return payload.decode("utf-8", "replace")
        return ""

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


def main():
    login = api("/api/auth/login", {"identify": {"email": "admin@gmail.com", "password": "demo123@"}})
    if not login.get("success"):
        print(f"login failed: {login}")
        return 1
    token = login["data"]["token"]

    rows = (api("/api/provider/list", {"page": 1}, token).get("data") or {}).get("list", [])
    print(f"live providers: {len(rows)}")
    if not rows:
        print("no providers to measure")
        return 1
    for r in rows[:3]:
        print(f"  {r['name']}: base_url {len(r.get('base_url') or '')} chars, "
              f"model {len(r.get('model') or '')} chars")

    profile = tempfile.mkdtemp(prefix="layout-cdp-")
    # Same shape the SPA writes on login: it reads access_token and expires_at
    # from localStorage and bounces to /auth when either is missing or stale.
    seed = (
        f"localStorage.setItem('access_token', {json.dumps(token)});"
        f"localStorage.setItem('expires_at', String(Date.now() + 86400000));"
        f"localStorage.setItem('user_email', 'admin@gmail.com');"
        f"localStorage.setItem('user_is_admin', '1');"
    )
    proc = subprocess.Popen([
        CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
        "--disable-extensions", f"--user-data-dir={profile}",
        f"--remote-debugging-port={CDP_PORT}", "--window-size=1440,1000",
        "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    cdp = CDP(CDP_PORT)
    try:
        cdp.wait()
        with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/list", timeout=5) as r:
            targets = json.loads(r.read())
        page = next(t for t in targets if t["type"] == "page")
        cdp.connect(page["webSocketDebuggerUrl"])
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")

        for w in WIDTHS:
            cdp.call("Emulation.setDeviceMetricsOverride", {
                "width": w, "height": 1000, "deviceScaleFactor": 1, "mobile": False,
            })
            # Load the app origin first so localStorage is available, seed the
            # session, then navigate to the page under test.
            cdp.call("Page.navigate", {"url": BASE + "/"})
            time.sleep(2.0)
            cdp.eval(seed)
            cdp.call("Page.navigate", {"url": BASE + "/provider"})
            time.sleep(4.0)

            raw = cdp.eval(PROBE)
            if not raw:
                check(f"{w}px: provider cards render", False, "probe returned nothing")
                continue
            data = json.loads(raw)
            check(f"{w}px: provider cards render", data["cards"] > 0,
                  f"cards={data['cards']} url={data.get('url')}")
            if not data["cards"]:
                continue

            worst = max((r["overflowPx"] for r in data["rows"]), default=0)
            check(f"{w}px: no row overflows its card", worst <= 1,
                  f"worst +{worst}px over {len(data['rows'])} rows")

            hscroll = data["docScrollW"] - data["docClientW"]
            check(f"{w}px: page does not scroll horizontally", hscroll <= 1,
                  f"scrollW={data['docScrollW']} clientW={data['docClientW']} (+{hscroll})")

            for r in data["rows"][:2]:
                print(f"        card {r['cardW']}px, line client {r['lineClient']} / "
                      f"scroll {r['lineScroll']} (overflow {r['overflowPx']})")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)

    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        print("failed:", FAIL)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
