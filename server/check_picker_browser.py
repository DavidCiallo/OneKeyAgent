"""Drive the date-range picker in a real browser and assert the click behaviour.

The reported bugs were interaction bugs, not layout ones:
  1. only the calendar icon opened the panel; clicking the field focused the
     input, which flickered and swallowed the click
  2. a single click on a day immediately changed the range

Both are timing/focus/state issues that only a real browser reproduces, so this
drives Chrome over the DevTools protocol and inspects the actual DOM.

It serves client/dist (run `rsbuild build` first) plus a stub API, so no backend
is needed.

Run: python server/check_picker_browser.py
"""

import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 3411
DEBUG_PORT = 9411

failures = []


def check(label, ok, detail=""):
    print(("  PASS  " if ok else "  FAIL  ") + label + ((" — " + detail) if detail else ""))
    if not ok:
        failures.append(label)


class Handler(SimpleHTTPRequestHandler):
    """Serve dist/, and answer the few API calls the page makes."""

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=DIST, **kw)

    def log_message(self, *a):
        pass

    def _json(self, body):
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        req = json.loads(self.rfile.read(n) or b"{}")
        path = self.path
        if path == "/api/auth/login":
            return self._json({"success": True, "data": {"token": "t", "is_admin": 1, "roles": []}})
        if path == "/api/auth/alive":
            return self._json({"success": True, "data": {
                "is_admin": 0,
                # The route guard checks the menu list, so the stub has to grant
                # the usage menu or the page redirects to /nocontent.
                "roles": [{"name": "usage", "type": "menu"}],
            }})
        if path == "/api/account/list":
            return self._json({"success": True, "data": {"list": [], "total": 0}})
        if path == "/api/provider/list":
            return self._json({"success": True, "data": {"list": [], "total": 0}})
        if path == "/api/model/list":
            return self._json({"success": True, "data": {"list": [], "total": 0}})
        if path == "/api/group/list":
            return self._json({"success": True, "data": {"list": [], "total": 0}})
        if path == "/api/usage/sessions":
            return self._json({"success": True, "data": {
                "list": [], "recentSessions": [],
                "totals": {"totalTokens": 0, "totalInputTokens": 0, "totalCachedInputTokens": 0,
                           "totalOutputTokens": 0, "totalCost": 0, "totalRequests": 0},
            }})
        if path == "/api/boot_config":
            return self._json({"success": True, "data": {"timezone": "Asia/Shanghai"}})
        return self._json({"success": True, "data": {}})

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._json({"success": True, "data": {}})
        # SPA fallback: /usage is a client route, not a file, so an unknown path
        # has to serve index.html or the app never mounts.
        target = self.path.split("?")[0].lstrip("/")
        if target and os.path.exists(os.path.join(DIST, target)):
            return super().do_GET()
        self.path = "/index.html"
        return super().do_GET()


def cdp_targets():
    with urllib.request.urlopen(f"http://127.0.0.1:{DEBUG_PORT}/json", timeout=10) as r:
        return json.loads(r.read().decode())


class CDP:
    """A very small DevTools-protocol client over a websocket."""

    def __init__(self, ws_url):
        import base64
        import socket
        from urllib.parse import urlparse

        u = urlparse(ws_url)
        self.sock = socket.create_connection((u.hostname, u.port), timeout=30)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET {u.path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\n"
            "Upgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(req.encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.sock.recv(4096)
        self.buf = buf.split(b"\r\n\r\n", 1)[1]
        self.msg_id = 0

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

        def read(n):
            while len(self.buf) < n:
                chunk = self.sock.recv(65536)
                if not chunk:
                    raise EOFError
                self.buf += chunk
            out, self.buf = self.buf[:n], self.buf[n:]
            return out

        b0, b1 = read(2)
        ln = b1 & 0x7F
        if ln == 126:
            ln = struct.unpack(">H", read(2))[0]
        elif ln == 127:
            ln = struct.unpack(">Q", read(8))[0]
        return json.loads(read(ln).decode())

    def call(self, method, params=None, timeout=30):
        self.msg_id += 1
        mid = self.msg_id
        self._send({"id": mid, "method": method, "params": params or {}})
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = self._recv()
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})
        raise TimeoutError(method)

    def eval(self, expr):
        r = self.call("Runtime.evaluate", {
            "expression": expr, "returnByValue": True, "awaitPromise": True,
        })
        res = r.get("result", {})
        if r.get("exceptionDetails"):
            raise RuntimeError(json.dumps(r["exceptionDetails"])[:400])
        return res.get("value")


def main():
    if not os.path.isdir(DIST):
        raise SystemExit("dist/ missing — run the client build first")

    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    profile = os.path.join(ROOT, ".probe-chrome-profile")
    shutil.rmtree(profile, ignore_errors=True)
    chrome = subprocess.Popen([
        CHROME, "--headless=new", f"--remote-debugging-port={DEBUG_PORT}",
        f"--user-data-dir={profile}", "--no-first-run", "--no-default-browser-check",
        "--disable-gpu", f"http://127.0.0.1:{PORT}/",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    try:
        ws = None
        for _ in range(60):
            time.sleep(0.5)
            try:
                for t in cdp_targets():
                    if t.get("type") == "page" and t.get("webSocketDebuggerUrl"):
                        ws = t["webSocketDebuggerUrl"]
                        break
            except Exception:
                continue
            if ws:
                break
        if not ws:
            raise SystemExit("could not attach to Chrome")

        c = CDP(ws)
        c.call("Runtime.enable")
        c.call("Page.enable")
        time.sleep(2)
        # The app gates /usage on three stored values: a token, a future expiry
        # (getAuthStatus checks it), and the cached role list the route guard
        # reads before the alive call returns.
        c.eval("""
          localStorage.setItem('access_token','t');
          localStorage.setItem('expires_at', String(Date.now() + 3600e3));
          localStorage.setItem('user_email','e2e@example.com');
          localStorage.setItem('user_is_admin','0');
          localStorage.setItem('user_roles', JSON.stringify([{name:'usage',type:'menu'}]));
        """)
        c.call("Page.navigate", {"url": f"http://127.0.0.1:{PORT}/usage"})
        time.sleep(3)

        def find_picker():
            return c.eval("""
              (() => {
                const inp = document.querySelector('input[aria-label="Date range"]');
                if (!inp) return null;
                const box = inp.closest('div.flex.items-center.gap-2');
                const icon = box ? box.querySelector('button[aria-expanded]') : null;
                const r = inp.getBoundingClientRect();
                return {value: inp.value, x: r.x + r.width/2, y: r.y + r.height/2,
                        active: document.activeElement === inp};
              })()
            """)

        p = find_picker()
        if not p:
            # Dump where we actually landed; a redirect to /auth or /nocontent is
            # the usual reason the picker is absent.
            where = c.eval("location.pathname")
            body = c.eval("document.body.innerText.slice(0,200)")
            print(f"path={where}\nbody={body!r}")
            raise SystemExit("date range input not found on the page — is /usage route right?")
        print(f"picker at ({p['x']:.0f},{p['y']:.0f}), value={p['value']}")

        def panel_open():
            # Select the panel by a stable data attribute rather than a Tailwind
            # arbitrary class: the class name is a styling detail, and matching
            # it meant a genuine open panel could read as closed.
            return c.eval("!!document.querySelector('[data-date-range-panel]')")

        def grid_count():
            return c.eval("""
              (() => {
                const panel = document.querySelector('[data-date-range-panel]');
                if (!panel) return -1;
                return panel.querySelectorAll('button.h-7.rounded-medium').length;
              })()
            """)

        def range_value():
            return c.eval("document.querySelector('input[aria-label=\"Date range\"]').value")

        def click_at(x, y):
            for t in ("mousePressed", "mouseReleased"):
                c.call("Input.dispatchMouseEvent", {
                    "type": t, "x": x, "y": y, "button": "left", "clickCount": 1,
                })
            time.sleep(0.6)

        def click_day(n):
            box = c.eval("""
              (() => {
                const panel = document.querySelector('[data-date-range-panel]');
                const b = Array.from(panel.querySelectorAll('button.h-7.rounded-medium'))
                  .find(e => e.textContent.trim() === '%d');
                if (!b) return null;
                const r = b.getBoundingClientRect();
                return {x: r.x + r.width/2, y: r.y + r.height/2};
              })()
            """ % n)
            if not box:
                raise RuntimeError(f"day {n} not in the grid")
            click_at(box["x"], box["y"])

        print("\n1. the panel opens from the input, not only the icon")
        before = range_value()
        click_at(p["x"], p["y"])
        check("clicking the input opens the panel", panel_open())
        check("the panel has a full month grid", grid_count() >= 28, f"cells={grid_count()}")
        check("opening did not change the value", range_value() == before, range_value())

        print("\n2. one click selects a start without committing a range")
        click_day(10)
        mid = range_value()
        check("a single day click leaves the value unchanged", mid == before,
              f"{before} -> {mid}")
        check("the panel stays open after the first click", panel_open())

        print("\n3. the second click commits the range")
        click_day(15)
        after = range_value()
        check("the value became a yyyymmdd-yyyymmdd range",
              len(after) == 17 and after[8] == "-", after)
        check("the range spans the two clicked days",
              after.endswith("10-20") is False and after.split("-")[0].endswith("10")
              and after.split("-")[1].endswith("15"), after)
        check("the panel closes after committing", not panel_open())

        print("\n4. reopening starts fresh and does not flicker the field")
        click_at(p["x"], p["y"])
        check("reopening keeps the committed value", range_value() == after, range_value())
        check("the panel is open again", panel_open())

        print("\n5. clicking outside closes without changing the value")
        # Click the page body, well clear of the top-left corner: that holds the
        # mobile nav trigger, and clicking it opens a full-screen menu overlay
        # which then covers the picker and breaks the section below.
        outside = c.eval("""
          (() => {
            const root = document.querySelector('input[aria-label="Date range"]')
                           .closest('div.relative');
            // Search the viewport for a point outside the picker that is inert:
            // no nav/menu/dropdown role and no click handler on its ancestors.
            // Guessing a coordinate is how a stray click on the nav menu ends up
            // opening an overlay that then poisons every later section.
            const r = root.getBoundingClientRect();
            for (let y = r.y + r.height + 40; y < window.innerHeight - 20; y += 20) {
              for (const x of [10, 30, window.innerWidth / 2, window.innerWidth - 20]) {
                const e = document.elementFromPoint(x, y);
                if (!e || root.contains(e)) continue;
                if (e.closest('li, nav, a, [role="menu"], [role="menuitem"], button, [role="dialog"]')) continue;
                return {x, y};
              }
            }
            return null;
          })()
        """)
        check("an inert point outside the picker exists", outside is not None,
              str(outside))
        if outside:
            click_at(outside["x"], outside["y"])
        check("the panel closed", not panel_open())
        check("the value is untouched", range_value() == after, range_value())

        print("\n6. the calendar icon still toggles")
        check("the panel is closed before the icon test", not panel_open())
        # Query the icon live rather than reusing coordinates captured earlier:
        # opening and closing the panel shifts the layout, and elementFromPoint
        # at a stale position lands on the page, not the button.
        icon = c.eval("""
          (() => {
            // Scope to the picker: other buttons on the page (nav toggles,
            // dropdowns) also carry aria-expanded, and matching one of those
            // made a working icon look broken.
            const root = document.querySelector('input[aria-label="Date range"]')
                           .closest('div.relative');
            const b = root.querySelector('button[aria-expanded]');
            if (!b) return null;
            const r = b.getBoundingClientRect();
            return {x: r.x + r.width/2, y: r.y + r.height/2,
                    hit: (() => { const e = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
                                  return e ? e.tagName : 'none'; })()};
          })()
        """)
        check("the icon is the topmost element at its own centre",
              icon is not None and icon["hit"] in ("svg", "path", "BUTTON"),
              f"hit={icon and icon['hit']}")
        click_at(icon["x"], icon["y"])
        # React commits asynchronously, so poll rather than sampling once.
        opened = False
        for _ in range(20):
            if panel_open():
                opened = True
                break
            time.sleep(0.15)
        check("the icon opened the panel", opened)
        click_at(icon["x"], icon["y"])
        check("the icon closed it again", not panel_open())

    finally:
        chrome.terminate()
        try:
            chrome.wait(timeout=10)
        except Exception:
            chrome.kill()
        httpd.shutdown()
        shutil.rmtree(profile, ignore_errors=True)

    print()
    if failures:
        print(f"FAIL — {len(failures)} check(s) failed")
        for f in failures:
            print("  - " + f)
        raise SystemExit(1)
    print("PASS — range picker behaves in a real browser")


if __name__ == "__main__":
    main()
