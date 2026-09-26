"""Check the provider form modal layout via DevTools Protocol.

Opens the create-provider modal on a live server and reports whether the paired
fields really share a row, and that no hint text is rendered under them.

Run: python server/check_form.py [port]
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
CDP_PORT = 9334

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


# Finds the labelled inputs inside the modal and reports their geometry: fields
# sharing a row have the same top and different left.
PROBE = r"""
(() => {
  const modal = document.querySelector('[role="dialog"]') || document.body;
  const seen = [];
  for (const el of modal.querySelectorAll('input')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    // The label is the sibling text of the field wrapper.
    let lab = '';
    let node = el;
    for (let i = 0; i < 5 && node; i++) {
      node = node.parentElement;
      if (!node) break;
      const l = node.querySelector('label');
      if (l) { lab = l.textContent.trim(); break; }
    }
    seen.push({ kind: 'input', label: lab, top: Math.round(r.top), left: Math.round(r.left),
                width: Math.round(r.width), right: Math.round(r.right) });
  }
  // HeroUI Selects render as buttons with data-slot="trigger"; the label text is
  // baked into the trigger's own text ("Auth Type" + "Bearer").
  const SEL_LABELS = ['Auth Type', 'API Type', 'Priority'];
  for (const el of modal.querySelectorAll('[aria-haspopup="listbox"]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    const txt = (el.textContent || '').trim();
    const lab = SEL_LABELS.find(l => txt.startsWith(l)) || txt.slice(0, 20);
    seen.push({ kind: 'select', label: lab, top: Math.round(r.top), left: Math.round(r.left),
                width: Math.round(r.width), right: Math.round(r.right) });
  }
  const hints = [...modal.querySelectorAll('[data-slot="description"], .text-tiny, small')]
      .map(e => (e.textContent || '').trim()).filter(Boolean);
  return JSON.stringify({ inputs: seen, hints,
                          modalText: (modal.innerText || '').slice(0, 1200) });
})()
"""


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
        import struct
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
        import struct
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


def main():
    login = api("/api/auth/login", {"identify": {"email": "admin@gmail.com", "password": "demo123@"}})
    if not login.get("success"):
        print(f"login failed: {login}")
        return 1
    token = login["data"]["token"]

    profile = tempfile.mkdtemp(prefix="form-cdp-")
    seed = (
        f"localStorage.setItem('access_token', {json.dumps(token)});"
        f"localStorage.setItem('expires_at', String(Date.now() + 86400000));"
        f"localStorage.setItem('user_email', 'admin@gmail.com');"
        f"localStorage.setItem('user_is_admin', '1');"
    )
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
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": 1400, "height": 1000, "deviceScaleFactor": 1, "mobile": False})

        cdp.call("Page.navigate", {"url": BASE + "/"})
        time.sleep(2.0)
        cdp.eval(seed)
        cdp.call("Page.navigate", {"url": BASE + "/provider"})
        time.sleep(4.0)

        # Open the create modal: the first button containing the locale's
        # create label; fall back to any primary button in the toolbar.
        opened = cdp.eval(r"""
        (() => {
          const btns = [...document.querySelectorAll('button')];
          const b = btns.find(x => /create|新建|创建|添加/i.test(x.textContent))
                 || btns.find(x => x.className.includes('bg-primary'));
          if (!b) return 'no button';
          b.click();
          return b.textContent.trim();
        })()
        """)
        print(f"opened via: {opened}")
        time.sleep(1.5)

        raw = cdp.eval(PROBE)
        data = json.loads(raw or "{}")
        inputs = data.get("inputs", [])
        check("modal opened with inputs", len(inputs) >= 6, f"{len(inputs)} inputs")

        by_label = {}
        for i in inputs:
            by_label.setdefault(i["label"], []).append(i)

        def row_of(want):
            # Select labels carry the selected value too ("Auth TypeBearer"), so
            # match on prefix as well as exact.
            out = by_label.get(want, [])
            if not out:
                for k, v in by_label.items():
                    if k.startswith(want):
                        out = v
                        break
            return out

        for lab in ["BaseURL", "Model", "Auth Type", "API Type"]:
            print(f"        {lab}: {row_of(lab)}")

        # Paired fields must share a top coordinate and not overlap.
        for a, b in [("BaseURL", "Model"), ("Auth Type", "API Type")]:
            ra, rb = row_of(a), row_of(b)
            if not ra or not rb:
                check(f"{a} + {b} present", False, f"{a}={len(ra)} {b}={len(rb)}")
                continue
            same_row = ra[0]["top"] == rb[0]["top"]
            no_overlap = ra[0]["right"] <= rb[0]["left"] or rb[0]["right"] <= ra[0]["left"]
            check(f"{a} + {b} share one row", same_row,
                  f"tops {ra[0]['top']} vs {rb[0]['top']}")
            check(f"{a} + {b} do not overlap", no_overlap,
                  f"{a} right {ra[0]['right']} vs {b} left {rb[0]['left']}")

        hints = data.get("hints", [])
        check("no hint text under the numeric fields", not hints, f"hints={hints[:3]}")

        text = data.get("modalText", "")
        check("'no limit' copy is gone", "no limit" not in text.lower(),
              text[:160].replace("\n", " / "))
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
