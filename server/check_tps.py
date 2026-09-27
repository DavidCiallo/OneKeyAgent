"""Throughput check — first-token latency is measured, and TPS excludes it.

Starts a real gateway against a stub upstream that streams SSE with a deliberate
think before its first output, so the two timing numbers are separable:

  1. a streaming request records ttft_ms, and it lands near the stub's think time
  2. the audit row's tps is computed over generation only — strictly above
     output/duration, which is what including the wait would give
  3. a non-streaming request records no ttft (there is no first token to time)
  4. a thinking model's thinking starts the clock, so tps covers the thinking
     rather than just the visible tail it precedes
  5. a provider's per-block delay holds its stream back, and the thinking is
     held back by the same rule as the text after it
  6. /api/audit/tps returns a per-provider series with both numbers
  7. the range selector is honoured, an unknown range falls back, and a
     non-admin is refused

Run: python server/check_tps.py
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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 3316
UPSTREAM_PORT = 3317
BASE = f"http://127.0.0.1:{PORT}"
UPSTREAM = f"http://127.0.0.1:{UPSTREAM_PORT}"

# How long the stub thinks before its first output. Long enough to be
# unmistakable, short enough to keep the check quick.
THINK = 0.4
# A visible tail after a thinking model's thinking, so the two possible clocks
# give different answers instead of the tail being instantaneous: with the clock
# at the thinking, tps is the full-span rate; at the first visible token, it
# would be the tail rate, several times higher.
TAIL = 0.15
# What the stub reports as output tokens; only used to make TPS a readable
# number rather than a fraction.
OUT_TOKENS = 200
# The delayed case: a burst of single-character deltas, and the per-block wait
# the provider is configured with. One token per block at 10ms a block works out
# at ~100 t/s, which is the rate the checks below read back off the audit.
PACED_TOKENS = 200
PACED_DELAY_MS = 10
PACED_TPS = 100
# The stub writes one frame at a time with a hair of a gap, the way a real
# provider delivers. Without the gap the whole burst can land in one read, which
# is exactly the shape the per-block wait exists to slow.
PACED_FRAME_GAP = 0.001

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
    """Streams SSE when asked to stream: a role-only frame, a pause, then the
    content. TTFT must land on the first content frame, not the role frame.

    HTTP/1.0 with no Content-Length: the body ends when the connection closes,
    which is the simplest way to stream out of the stdlib server — and each
    flush still reaches the gateway as its own chunk.
    """

    protocol_version = "HTTP/1.0"

    def log_message(self, *a):
        pass

    def _frame(self, obj):
        self.wfile.write(("data: " + json.dumps(obj) + "\n\n").encode())
        self.wfile.flush()

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n)
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = {}
        # The prompt decides which stream the stub plays, so the whole request
        # has to be searchable, not just the parsed content.
        try:
            text = json.dumps(parsed)
        except Exception:
            text = raw.decode(errors="replace")

        if parsed.get("stream"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            if "burst-" in text:
                # The worst case for a wait: the whole stream handed over as fast
                # as the socket takes it, so it can land in a single read.
                self._frame({"choices": [{"index": 0, "delta": {"role": "assistant"}}]})
                for _ in range(PACED_TOKENS):
                    self._frame({"choices": [{"index": 0, "delta": {"content": "x"}}]})
                self._frame({
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 5, "completion_tokens": PACED_TOKENS,
                              "total_tokens": 5 + PACED_TOKENS},
                })
                self._frame("[DONE]")
                return
            if "thinkd-" in text:
                # A thinking model under a wait. Its thinking is the bulk of what
                # it streams and the first thing on the wire, so the wait has to
                # cover the thinking as well as the text that follows it: slowing
                # only the visible tail would leave almost all of it at speed.
                self._frame({"choices": [{"index": 0, "delta": {"role": "assistant"}}]})
                for _ in range(PACED_TOKENS):
                    self._frame({"choices": [{"index": 0, "delta": {"reasoning_content": "x"}}]})
                self._frame({"choices": [{"index": 0, "delta": {"content": "done"}}]})
                self._frame({
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 5,
                              "completion_tokens": PACED_TOKENS + 1,
                              "total_tokens": 5 + PACED_TOKENS + 1},
                })
                self._frame("[DONE]")
                return
            if "paced-" in text:
                # A provider far faster than the wait it is configured with: the
                # whole response in a burst of single-character deltas.
                self._frame({"choices": [{"index": 0, "delta": {"role": "assistant"}}]})
                for _ in range(PACED_TOKENS):
                    self._frame({"choices": [{"index": 0, "delta": {"content": "x"}}]})
                    time.sleep(PACED_FRAME_GAP)
                self._frame({
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 5, "completion_tokens": PACED_TOKENS,
                              "total_tokens": 5 + PACED_TOKENS},
                })
                self._frame("[DONE]")
                return
            if "think-" in text:
                # A thinking model: its first output is the thinking, sent at
                # once, and the visible text only starts after the same think
                # delay. The clock has to start here — the provider bills this
                # thinking inside completion_tokens.
                self._frame({"choices": [{"index": 0, "delta": {"reasoning_content": "let me think"}}]})
                time.sleep(THINK)
                for part in ["Hello", " there", " world"]:
                    self._frame({"choices": [{"index": 0, "delta": {"content": part}}]})
                    time.sleep(TAIL / 3)
                self._frame({
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 5, "completion_tokens": OUT_TOKENS,
                              "total_tokens": 5 + OUT_TOKENS},
                })
                self._frame("[DONE]")
                return
            self._frame({"choices": [{"index": 0, "delta": {"role": "assistant"}}]})
            time.sleep(THINK)
            self._frame({"choices": [{"index": 0, "delta": {"content": "Hello"}}]})
            time.sleep(0.1)
            self._frame({"choices": [{"index": 0, "delta": {"content": " world"}}]})
            self._frame({
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 5, "completion_tokens": OUT_TOKENS,
                          "total_tokens": 5 + OUT_TOKENS},
            })
            self._frame("[DONE]")
            return

        payload = json.dumps({
            "id": "cmpl-1", "object": "chat.completion", "model": "m",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"},
                         "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 5, "completion_tokens": OUT_TOKENS,
                      "total_tokens": 5 + OUT_TOKENS},
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def relay(stream, api_key, content="prompt", alias="tps-alias"):
    req = urllib.request.Request(
        f"{BASE}/api/chat/completions",
        data=json.dumps({"model": alias, "stream": stream,
                         "messages": [{"role": "user", "content": content}]}).encode(),
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {api_key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            r.read()
            return r.status
    except urllib.error.HTTPError as e:
        e.read()
        return e.code


def main():
    tmp = tempfile.mkdtemp(prefix="tps-check-")
    db_path = os.path.join(tmp, "onekey.db")

    upstream = ThreadingHTTPServer(("127.0.0.1", UPSTREAM_PORT), Upstream)
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
        if not login.get("success"):
            print(f"login failed: {login}")
            return 1
        TOKEN["value"] = login["data"]["token"]

        post("/api/provider/create", {"provider": {
            "model_alias": "tps-alias", "priority": 1, "name": "streamer",
            "base_url": UPSTREAM, "model": "m", "api_key": "k",
            "auth_type": "bearer", "api_type": "openai", "enabled": 1,
        }})
        post("/api/model/create", {"model": {
            "alias": "tps-alias", "input_price": 1.0, "output_price": 1.0, "is_public": 1}})
        acct = post("/api/account/profile", {}).get("data", {}).get("account", {})
        api_key = acct.get("api_key")
        post("/api/account/update", {"id": acct.get("id"), "account": {"balance": 50.0}})
        if not api_key:
            print("no api key")
            return 1

        print("\n1. a streaming request records its first-token wait")
        code = relay(True, api_key, "stream-one")
        check("streaming relay succeeded", code == 200, f"code={code}")

        rows = (post("/api/audit/list", {}).get("data") or {}).get("list", [])
        streams = [r for r in rows if r.get("stream") == 1]
        check("the streaming attempt is in the audit list", len(streams) >= 1,
              f"{len(streams)} of {len(rows)} rows")
        if not streams:
            return 1
        row = streams[0]
        ttft = row.get("ttft_ms") or 0
        check("ttft is measured on a stream", ttft > 0, f"ttft_ms={ttft}")
        # The stub thinks for THINK before releasing content, so the measurement
        # has to be at least that; the upper bound only guards against the clock
        # being read at the wrong end of the request.
        check("ttft reflects the stub's think time",
              THINK * 1000 * 0.6 <= ttft <= THINK * 1000 + 1500,
              f"ttft_ms={ttft}, stub thinks {int(THINK * 1000)}ms")

        print("\n2. tps is computed over generation, not the whole call")
        duration = row.get("duration_ms") or 0
        out = row.get("output_tokens") or 0
        tps = row.get("tps") or 0
        check("the row has tokens and a duration", out > 0 and duration > 0,
              f"out={out} duration={duration}")
        naive = out / (duration / 1000)
        check("tps beats output-over-total-duration", tps > naive,
              f"tps={tps} vs naive={round(naive, 1)} (ttft={ttft} of {duration})")
        # With the wait removed the implied generation window should match the
        # measured numbers, which is the whole point of storing ttft.
        gen = duration - ttft
        check("tps matches output over the generation window",
              abs(tps - out / (gen / 1000)) < 1, f"tps={tps} gen={gen}ms")

        print("\n3. a non-streaming request records no ttft")
        # A separate alias on the same stub, so its window holds non-streaming
        # traffic only — that is what isolates the next assertion.
        post("/api/model/create", {"model": {
            "alias": "plain-alias", "input_price": 1.0, "output_price": 1.0, "is_public": 1}})
        post("/api/provider/create", {"provider": {
            "model_alias": "plain-alias", "priority": 1, "name": "plain",
            "base_url": UPSTREAM, "model": "m", "api_key": "k",
            "auth_type": "bearer", "api_type": "openai", "enabled": 1,
        }})
        code = relay(False, api_key, "nonstream-one", alias="plain-alias")
        check("non-streaming relay succeeded", code == 200, f"code={code}")
        rows = (post("/api/audit/list", {}).get("data") or {}).get("list", [])
        plain = [r for r in rows if r.get("stream") != 1]
        check("the non-streaming attempt is recorded", len(plain) >= 1, f"{len(plain)} rows")
        if plain:
            check("no ttft on the non-streaming path", (plain[0].get("ttft_ms") or 0) == 0,
                  f"ttft_ms={plain[0].get('ttft_ms')}")

        # A non-streaming caller still has a duration, and dropping it would
        # leave the chart blank for anyone not streaming.
        d = post("/api/audit/tps", {"range": "1h", "model_alias": "plain-alias"}).get("data") or {}
        pids = [p["id"] for p in (d.get("providers") or [])]
        check("the non-streaming alias has a series", len(pids) == 1, str(pids))
        if pids:
            with_tps = [p for p in (d.get("points") or []) if (p.get("tps") or {}).get(pids[0])]
            check("a non-streaming-only window still reports tps", len(with_tps) >= 1,
                  f"{len(with_tps)} points")
            with_ttft = [p for p in (d.get("points") or []) if (p.get("ttft") or {}).get(pids[0])]
            check("and reports no ttft average", len(with_ttft) == 0, f"{len(with_ttft)} points")

        print("\n4. a thinking model's thinking starts the clock")
        # Same stub, same think delay before the visible text — but this one
        # emits its thinking immediately. If the clock waited for the first
        # visible token, ttft and tps would come out exactly as they do above.
        post("/api/model/create", {"model": {
            "alias": "think-alias", "input_price": 1.0, "output_price": 1.0, "is_public": 1}})
        post("/api/provider/create", {"provider": {
            "model_alias": "think-alias", "priority": 1, "name": "thinker",
            "base_url": UPSTREAM, "model": "m", "api_key": "k",
            "auth_type": "bearer", "api_type": "openai", "enabled": 1,
        }})
        code = relay(True, api_key, "think-one", alias="think-alias")
        check("thinking relay succeeded", code == 200, f"code={code}")
        rows = (post("/api/audit/list", {}).get("data") or {}).get("list", [])
        mine = [r for r in rows if r.get("model_alias") == "think-alias"]
        check("the thinking attempt is recorded", len(mine) >= 1, f"{len(mine)} rows")
        if mine:
            row = mine[0]
            ttft = row.get("ttft_ms") or 0
            duration = row.get("duration_ms") or 0
            out = row.get("output_tokens") or 0
            tps = row.get("tps") or 0
            # The thinking frame is the first thing on the wire, so the wait is
            # the round trip, not the think time.
            check("ttft lands on the thinking, not on the visible text",
                  ttft < THINK * 1000 * 0.6,
                  f"ttft_ms={ttft}, content only starts at ~{int(THINK * 1000)}ms")
            # tps is over the span the provider was producing output for, so it
            # sits near output/duration instead of near output/visible-tail.
            naive = out / (duration / 1000)
            check("tps covers the thinking span, not just the visible tail",
                  tps < naive * 1.5,
                  f"tps={tps} full-span={round(naive)} "
                  f"visible-tail-only would be ~{round(out / max(duration - THINK * 1000, 1) * 1000)}")
            check("ttft is a small part of the request", ttft < duration / 3,
                  f"ttft={ttft} of {duration}")

        print("\n5. a provider's per-block delay slows its stream down")
        # The same burst of traffic through two providers, one with a wait set and
        # one without: the only difference between the two measurements is the
        # wait, so the drop can only have come from it.
        post("/api/model/create", {"model": {
            "alias": "fast-alias", "input_price": 1.0, "output_price": 1.0, "is_public": 1}})
        post("/api/provider/create", {"provider": {
            "model_alias": "fast-alias", "priority": 1, "name": "fast",
            "base_url": UPSTREAM, "model": "m", "api_key": "k",
            "auth_type": "bearer", "api_type": "openai", "enabled": 1,
        }})
        post("/api/model/create", {"model": {
            "alias": "paced-alias", "input_price": 1.0, "output_price": 1.0, "is_public": 1}})
        made = post("/api/provider/create", {"provider": {
            "model_alias": "paced-alias", "priority": 1, "name": "paced",
            "base_url": UPSTREAM, "model": "m", "api_key": "k",
            "auth_type": "bearer", "api_type": "openai", "enabled": 1,
            "chunk_delay_ms": PACED_DELAY_MS,
        }})
        stored = ((made.get("data") or {}).get("provider") or {}).get("chunk_delay_ms")
        check("the delay is stored on the provider", stored == PACED_DELAY_MS,
              f"chunk_delay_ms={stored}")

        code = relay(True, api_key, "paced-one", alias="fast-alias")
        check("the undelayed relay succeeded", code == 200, f"code={code}")
        code = relay(True, api_key, "paced-one", alias="paced-alias")
        check("the delayed relay succeeded", code == 200, f"code={code}")

        rows = (post("/api/audit/list", {}).get("data") or {}).get("list", [])

        def attempt(alias):
            mine = [r for r in rows if r.get("model_alias") == alias]
            return mine[0] if mine else None

        fast, paced = attempt("fast-alias"), attempt("paced-alias")
        check("both attempts are recorded", fast is not None and paced is not None,
              f"fast={fast is not None} paced={paced is not None}")
        if fast and paced:
            f_tps, p_tps = fast.get("tps") or 0, paced.get("tps") or 0
            check("the undelayed stream is far faster than the delayed one",
                  f_tps > PACED_TPS * 2, f"tps={round(f_tps, 1)}")
            check("the delayed stream is held near the rate the wait implies",
                  p_tps <= PACED_TPS * 1.2, f"tps={round(p_tps, 1)}")
            # Above the floor matters as much as below the top: a stream that
            # merely came out slow would pass a one-sided check.
            check("it is delayed to that rate, not just under it",
                  p_tps >= PACED_TPS * 0.8, f"tps={round(p_tps, 1)}")
            check("the wait is what slowed it", p_tps < f_tps * 0.5,
                  f"delayed={round(p_tps, 1)} undelayed={round(f_tps, 1)}")
            check("the stream really waited",
                  (paced.get("duration_ms") or 0) >= 1000 * PACED_TOKENS / PACED_TPS * 0.8,
                  f"duration={paced.get('duration_ms')}ms for {paced.get('output_tokens')} "
                  f"blocks {PACED_DELAY_MS}ms apart")
            # The first block is written at once, so the wait for the first token
            # is not the thing being slowed.
            check("the delay leaves the first token alone",
                  (paced.get("ttft_ms") or 0) < 250,
                  f"ttft_ms={paced.get('ttft_ms')}")

        # The same wait against a stream that arrives as one burst rather than
        # frame by frame. A wait applied per read would let this one through
        # untouched, since the read that starts the clock is the read exempted.
        post("/api/model/create", {"model": {
            "alias": "burst-alias", "input_price": 1.0, "output_price": 1.0, "is_public": 1}})
        post("/api/provider/create", {"provider": {
            "model_alias": "burst-alias", "priority": 1, "name": "bursty",
            "base_url": UPSTREAM, "model": "m", "api_key": "k",
            "auth_type": "bearer", "api_type": "openai", "enabled": 1,
            "chunk_delay_ms": PACED_DELAY_MS,
        }})
        code = relay(True, api_key, "burst-one", alias="burst-alias")
        check("the burst relay succeeded", code == 200, f"code={code}")
        rows = (post("/api/audit/list", {}).get("data") or {}).get("list", [])
        burst = attempt("burst-alias")
        check("the burst attempt is recorded", burst is not None, f"burst={burst is not None}")
        if burst:
            b_tps = burst.get("tps") or 0
            check("a stream that arrives in one burst is still held back",
                  b_tps <= PACED_TPS * 1.2, f"tps={round(b_tps, 1)}")
            check("the burst is delayed to that rate, not just under it",
                  b_tps >= PACED_TPS * 0.8, f"tps={round(b_tps, 1)}")
            check("the burst really waited",
                  (burst.get("duration_ms") or 0) >= 1000 * PACED_TOKENS / PACED_TPS * 0.8,
                  f"duration={burst.get('duration_ms')}ms for {burst.get('output_tokens')} tokens")

        # A thinking model streams its thinking first and that thinking is the
        # bulk of what it bills, so the wait has to cover it too. Slowing only the
        # visible tail would leave nearly the whole response at full speed.
        post("/api/model/create", {"model": {
            "alias": "think-paced-alias", "input_price": 1.0, "output_price": 1.0, "is_public": 1}})
        post("/api/provider/create", {"provider": {
            "model_alias": "think-paced-alias", "priority": 1, "name": "think-paced",
            "base_url": UPSTREAM, "model": "m", "api_key": "k",
            "auth_type": "bearer", "api_type": "openai", "enabled": 1,
            "chunk_delay_ms": PACED_DELAY_MS,
        }})
        code = relay(True, api_key, "thinkd-one", alias="think-paced-alias")
        check("the thinking relay succeeded", code == 200, f"code={code}")
        rows = (post("/api/audit/list", {}).get("data") or {}).get("list", [])
        tpace = attempt("think-paced-alias")
        check("the delayed thinking attempt is recorded", tpace is not None,
              f"think-paced={tpace is not None}")
        if tpace:
            tp_tps = tpace.get("tps") or 0
            check("thinking is held back by the same wait as the text after it",
                  tp_tps <= PACED_TPS * 1.2,
                  f"tps={round(tp_tps, 1)}: {PACED_TOKENS} thinking blocks plus one of text")
            check("the thinking stream is delayed to that rate, not just under it",
                  tp_tps >= PACED_TPS * 0.8, f"tps={round(tp_tps, 1)}")
            check("the thinking stream really waited",
                  (tpace.get("duration_ms") or 0) >= 1000 * PACED_TOKENS / PACED_TPS * 0.8,
                  f"duration={tpace.get('duration_ms')}ms for {tpace.get('output_tokens')} tokens")

        print("\n6. the series endpoint")
        series = post("/api/audit/tps", {"range": "1h"})
        check("series request succeeded", series.get("success"), str(series)[:160])
        allp = series.get("data") or {}
        names = sorted(p.get("name") for p in (allp.get("providers") or []))
        check("every provider with traffic appears in the series",
              {"plain", "streamer", "thinker", "fast", "paced", "bursty",
               "think-paced"} <= set(names), str(names))
        check("the series covers the requested range", allp.get("range") == "1h",
              f"range={allp.get('range')} granularity={allp.get('granularity')}")

        # Narrowed to the streaming alias, so the timing assertions address the
        # provider that actually has a first-token measurement.
        data = post("/api/audit/tps", {"range": "1h", "model_alias": "tps-alias"}).get("data") or {}
        providers = data.get("providers") or []
        points = data.get("points") or []
        check("the alias filter narrows the series", len(providers) == 1,
              str([p.get("name") for p in providers]))
        check("60 one-minute points for 1h", len(points) == 60, f"{len(points)} points")
        if providers:
            pid = providers[0]["id"]
            with_tps = [p for p in points if (p.get("tps") or {}).get(pid)]
            check("the bucket carries a tps value", len(with_tps) >= 1,
                  f"{len(with_tps)} points with tps")
            if with_tps:
                v = with_tps[-1]["tps"][pid]
                check("the bucket tps is positive", v > 0, f"tps={v}")
            with_ttft = [p for p in points if (p.get("ttft") or {}).get(pid)]
            check("the bucket carries an average ttft", len(with_ttft) >= 1,
                  f"{len(with_ttft)} points with ttft")
            if with_ttft:
                v = with_ttft[-1]["ttft"][pid]
                check("the average ttft is near the stub's think time",
                      THINK * 1000 * 0.6 <= v <= THINK * 1000 + 1500, f"ttft={v}")
            # A slot with no traffic must be absent, not zero: the line is meant
            # to break rather than drop to the axis.
            empty = [p for p in points if pid not in (p.get("tps") or {})]
            check("idle slots are omitted rather than zero", len(empty) > 0,
                  f"{len(empty)} idle slots of {len(points)}")

        print("\n7. ranges and access")
        for rng, count, gran in [("12h", 720, "1m"), ("48h", 48, "60m")]:
            d = post("/api/audit/tps", {"range": rng}).get("data") or {}
            check(f"{rng} uses {gran} with {count} points",
                  d.get("granularity") == gran and len(d.get("points") or []) == count,
                  f"granularity={d.get('granularity')} points={len(d.get('points') or [])}")
        unknown = post("/api/audit/tps", {"range": "nonsense"}).get("data") or {}
        check("an unknown range falls back to the default",
              unknown.get("range") == "1h", f"range={unknown.get('range')}")

        nonadmin = post("/api/account/create", {"account": {
            "name": "viewer", "email": "viewer@example.com", "password": "viewer123@",
            "is_admin": 0}})
        if nonadmin.get("success"):
            admin_token = TOKEN["value"]
            login2 = post("/api/auth/login", {"identify": {
                "email": "viewer@example.com", "password": "viewer123@"}})
            TOKEN["value"] = (login2.get("data") or {}).get("token", "")
            denied = post("/api/audit/tps", {"range": "1h"})
            check("non-admin cannot read the series", not denied.get("success"),
                  str(denied)[:120])
            TOKEN["value"] = admin_token
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        upstream.shutdown()
        log.close()

    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        print("failed:", FAIL)
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
