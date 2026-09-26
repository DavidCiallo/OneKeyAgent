"""Check the provider form renders the active-window time inputs.

Opens the create-provider modal over the DevTools protocol and reports the
geometry of the two time inputs and their labels, so a missing or mislabelled
field is caught without eyeballing a screenshot.

Run: python server/check_window_form.py [port]
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
BASE = f"http://127.0.0.1:{PORT}"
CDP_PORT = 9337

PASS, FAIL = [], []


def check(name, ok, detail=""):
    (PASS if ok else FAIL).append(name)
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))


def api(path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["token"] = token
    req = urllib.request.Request(BASE + path, data=json.dumps(body or {}).encode(), headers=headers)
    return json.loads(urllib.request.urlopen(req, timeout=20).read())


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


# Time inputs are identified by type, not by the enclosing label: the label is
# baked into the wrapper and is easier to read from the sibling text.
PROBE = r"""
(() => {
  const modal = document.querySelector('[role="dialog"]') || document.body;
  const out = [];
  for (const el of modal.querySelectorAll('input')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    let label = '';
    let node = el;
    for (let i = 0; i < 5 && node; i++) {
      node = node.parentElement;
      if (!node) break;
      const l = node.querySelector('label');
      if (l) { label = l.textContent.trim(); break; }
    }
    out.push({ type: el.type, label: label, top: Math.round(r.top), left: Math.round(r.left),
               width: Math.round(r.width), right: Math.round(r.right) });
  }
  return JSON.stringify(out);
})()
"""


def main():
    token = api("/api/auth/login", {"identify": {"email": "admin@gmail.com", "password": "demo123@"}})["data"]["token"]

    profile = tempfile.mkdtemp(prefix="winform-cdp-")
    proc = subprocess.Popen([
        CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
        "--disable-extensions", f"--user-data-dir={profile}",
        f"--remote-debugging-port={CDP_PORT}", "--window-size=1400,1100", "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    cdp = CDP(CDP_PORT)
    try:
        cdp.wait()
        with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/list", timeout=5) as r:
            page = next(t for t in json.loads(r.read()) if t["type"] == "page")
        cdp.connect(page["webSocketDebuggerUrl"])
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")

        cdp.call("Page.navigate", {"url": BASE + "/"})
        time.sleep(2.0)
        cdp.eval(
            f"localStorage.setItem('access_token', {json.dumps(token)});"
            "localStorage.setItem('expires_at', String(Date.now() + 86400000));"
            "localStorage.setItem('user_email', 'admin@gmail.com');"
            "localStorage.setItem('user_is_admin', '1');"
        )
        cdp.call("Page.navigate", {"url": BASE + "/provider"})
        time.sleep(4.0)

        # The add button carries the Common locale's ButtonAdd ("Add" / "添加"),
        # so match on those plus the create wording as a fallback.
        opened = cdp.eval(r"""
        (() => {
          const want = /^(add|添加|新增|新建|创建|create)$/i;
          const b = [...document.querySelectorAll('button')].find(x => want.test((x.textContent || '').trim()));
          if (!b) return false;
          b.click();
          return true;
        })()
        """)
        if not opened:
            check("the create modal opened", False, "no create button found")
            return 1
        time.sleep(1.5)

        fields = json.loads(cdp.eval(PROBE) or "[]")
        times = [f for f in fields if f["type"] == "time"]
        check("two time inputs are rendered", len(times) == 2, f"found {len(times)}")
        if len(times) == 2:
            labels = sorted(f["label"] for f in times)
            check("time inputs are labelled",
                  all(l for l in labels), str(labels))
            check("the two time inputs share a row",
                  times[0]["top"] == times[1]["top"], f"tops {times[0]['top']} vs {times[1]['top']}")
            check("the two time inputs do not overlap",
                  times[0]["right"] <= times[1]["left"] or times[1]["right"] <= times[0]["left"],
                  f"{times[0]['right']} vs {times[1]['left']}")
            for f in times:
                print(f"        {f['label']}: top {f['top']} left {f['left']} w {f['width']}")

        # An empty time input means "no window", so the form must not send a value
        # until one is typed.
        check("time inputs start empty",
              all(cdp.eval(f"document.querySelectorAll('input[type=time]')[{i}].value") == "" for i in range(len(times))),
              "")
    finally:
        proc.kill()

    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        print("failed: " + ", ".join(FAIL))
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
