"""Mock OpenAI-compatible upstream + smoke tests for the Go server.

Starts a mock provider on :3398 that answers /chat/completions (stream and
non-stream), then exercises the Go server on :3399:
  login -> models -> chat (non-stream + stream) -> balance/bucket assertions.
"""
import json
import sqlite3
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

DB = sys.argv[1] if len(sys.argv) > 1 else "/tmp/oktest/onekey.db"
PORT_SVR = 3399
PORT_MOCK = 3398

MOCK_RESPONSE = {
    "id": "chatcmpl-mock-1",
    "object": "chat.completion",
    "model": "mock-model",
    "choices": [{"index": 0, "message": {"role": "assistant", "content": "Hello from mock!"}, "finish_reason": "stop"}],
    "usage": {"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120},
}

def sse_chunks():
    parts = ["Hello", " from", " mock", " stream!"]
    for i, p in enumerate(parts):
        yield {"id": "chatcmpl-mock-s", "object": "chat.completion.chunk", "created": 1, "model": "mock-model",
               "choices": [{"index": 0, "delta": {"content": p}, "finish_reason": None}]}
    yield {"id": "chatcmpl-mock-s", "object": "chat.completion.chunk", "created": 1, "model": "mock-model",
           "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
           "usage": {"prompt_tokens": 100, "completion_tokens": 40, "total_tokens": 140}}

LAST_BODY = {}

class MockHandler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        LAST_BODY["json"] = body
        auth = self.headers.get("Authorization", "")
        assert auth == "Bearer mock-upstream-key", f"bad auth header: {auth}"
        if body.get("stream"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for chunk in sse_chunks():
                self.wfile.write(b"data: " + json.dumps(chunk).encode() + b"\n\n")
            self.wfile.write(b"data: [DONE]\n\n")
        else:
            resp = dict(MOCK_RESPONSE)
            resp["model"] = body.get("model", "mock-model")
            data = json.dumps(resp).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

def http_post(url, payload, headers=None):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def http_get(url, headers=None):
    req = urllib.request.Request(url)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def main():
    # 1. mock upstream
    mock = HTTPServer(("127.0.0.1", PORT_MOCK), MockHandler)
    threading.Thread(target=mock.serve_forever, daemon=True).start()
    print("[ok] mock upstream on", PORT_MOCK)

    con = sqlite3.connect(DB)
    cur = con.cursor()

    # 2. pick a test account + add a model/prices + provider to the mock
    acc = cur.execute("SELECT id, api_key, balance FROM account WHERE delete_time IS NULL LIMIT 1").fetchone()
    assert acc, "no account"
    acc_id, api_key, balance0 = acc
    cur.execute("INSERT OR REPLACE INTO model (id, alias, input_price, cache_price, output_price, is_public, create_time) VALUES ('mockm1','mock-alias',1.0,0.5,2.0,1,1)")
    cur.execute("INSERT OR REPLACE INTO provider (id, model_alias, priority, name, base_url, model, api_key, api_type, enabled, create_time) VALUES ('mockp1','mock-alias',1,'Mock','http://127.0.0.1:3398/v1','mock-model','mock-upstream-key','openai',1,1)")
    con.commit()
    print(f"[ok] account={acc_id} key={api_key[:8]}... balance={balance0}")

    B = f"http://127.0.0.1:{PORT_SVR}"
    fails = []
    def check(name, cond, detail=""):
        print(("PASS " if cond else "FAIL ") + name, detail if not cond else "")
        if not cond: fails.append(name)

    # 3. config endpoint
    st, body = http_get(B + "/api/auth/config")
    d = json.loads(body)
    check("auth/config", st == 200 and d["success"] is True and "enable_recharge" in d["data"], body[:200])

    # 4. models with api key
    st, body = http_get(B + "/api/models", {"x-api-key": api_key})
    d = json.loads(body)
    aliases = [m["id"] for m in d.get("data", [])]
    check("models", st == 200 and d.get("success") is True and "mock-alias" in aliases, body[:300])

    # 5. non-stream chat completion (raw OpenAI shape, no envelope)
    st, body = http_post(B + "/api/chat/completions", {"model": "mock-alias", "messages": [{"role": "user", "content": "hi"}]}, {"x-api-key": api_key})
    d = json.loads(body)
    check("chat non-stream", st == 200 and d["object"] == "chat.completion" and d["model"] == "mock-alias" and d["choices"][0]["message"]["content"] == "Hello from mock!", body[:300])

    # billing: in=100 (0 cached) out=20, prices 1.0 / 2.0 per 1M
    exp_cost = (100 * 1.0 + 20 * 2.0) / 1e6
    bal1 = cur.execute("SELECT balance FROM account WHERE id=?", (acc_id,)).fetchone()[0]
    check("billing non-stream deduct", abs((balance0 - bal1) - exp_cost) < 1e-9, f"balance0={balance0} bal1={bal1} exp={exp_cost}")
    row = cur.execute("SELECT input_tokens, output_tokens, request_count, granularity FROM usage_bucket WHERE account_id=? AND model_alias='mock-alias' AND granularity='1m' ORDER BY create_time DESC LIMIT 1", (acc_id,)).fetchone()
    check("usage bucket logged", row is not None and row[0] == 100 and row[1] == 20 and row[2] == 1, str(row))

    # 6. streaming completion
    bal1b = cur.execute("SELECT balance FROM account WHERE id=?", (acc_id,)).fetchone()[0]
    req = urllib.request.Request(B + "/api/chat/completions", data=json.dumps({"model": "mock-alias", "messages": [{"role": "user", "content": "hi"}], "stream": True}).encode(), method="POST")
    req.add_header("x-api-key", api_key)
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=30) as r:
        ct = r.headers.get("Content-Type", "")
        raw = r.read().decode()
    check("chat stream content-type", "text/event-stream" in ct, ct)
    check("chat stream chunks", raw.count("data: ") >= 5 and raw.endswith("data: [DONE]\n\n"), raw[-120:])
    check("chat stream passthrough", '"content":"Hello"' in raw or '"content":"Hello"' in raw.replace(" ", ""), raw[:200])
    exp_cost2 = (100 * 1.0 + 40 * 2.0) / 1e6
    bal2 = cur.execute("SELECT balance FROM account WHERE id=?", (acc_id,)).fetchone()[0]
    check("billing stream deduct", abs((bal1b - bal2) - exp_cost2) < 1e-9, f"bal1b={bal1b} bal2={bal2} exp={exp_cost2}")
    # same minute window as the first request -> accumulated (100+100, 20+40), 2 requests
    row = cur.execute("SELECT input_tokens, output_tokens, request_count FROM usage_bucket WHERE account_id=? AND model_alias='mock-alias' AND granularity='1m' ORDER BY create_time DESC, rowid DESC LIMIT 1", (acc_id,)).fetchone()
    check("usage bucket stream accumulate", row is not None and row[0] == 200 and row[1] == 60 and row[2] == 2, str(row))

    # 6b. preflight: zero balance must be rejected BEFORE the upstream call
    cur.execute("UPDATE account SET balance = 0 WHERE id=?", (acc_id,))
    con.commit()
    st, body = http_post(B + "/api/chat/completions", {"model": "mock-alias", "messages": [{"role": "user", "content": "hi"}]}, {"x-api-key": api_key})
    d = json.loads(body)
    check("preflight zero balance 429", st == 400 and "429 Insufficient balance" in d.get("message", ""), f"{st} {body[:200]}")
    cur.execute("UPDATE account SET balance = ? WHERE id=?", (balance0, acc_id))
    con.commit()

    # 7. anthropic /v1/messages non-stream
    st, body = http_post(B + "/api/v1/messages", {"model": "mock-alias", "max_tokens": 100, "messages": [{"role": "user", "content": "hi"}]}, {"x-api-key": api_key})
    d = json.loads(body)
    check("v1/messages", st == 200 and d.get("type") == "message" and d.get("stop_reason") == "end_turn" and d["content"][0]["text"] == "Hello from mock!", body[:300])

    # 8. anthropic /v1/messages streaming
    req = urllib.request.Request(B + "/api/v1/messages", data=json.dumps({"model": "mock-alias", "max_tokens": 100, "stream": True, "messages": [{"role": "user", "content": "hi"}]}).encode(), method="POST")
    req.add_header("x-api-key", api_key)
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read().decode()
    check("v1/messages stream events", "event: message_start" in raw and "content_block_delta" in raw and "message_stop" in raw, raw[:200])

    # 9. invalid key
    st, body = http_post(B + "/api/chat/completions", {"model": "mock-alias", "messages": []}, {"x-api-key": "sk-bogus"})
    d = json.loads(body)
    check("invalid key 400 envelope", st == 400 and d["success"] is False and d["message"] == "Invalid API Key", body[:200])

    # 10. static fallback + unknown api 404
    st, body = http_get(B + "/")
    check("static root 404 (no dist)", st in (404, 200), str(st))
    st, body = http_get(B + "/api/nonexistent")
    check("unknown api 404", st == 404, str(st))

    # 10b. extra_json shallow override (provider-level body patch)
    cur.execute("UPDATE provider SET extra_json = ? WHERE id = 'mockp1'", ('{"max_tokens": 555, "temperature": 0.1}',))
    con.commit()
    st, body = http_post(B + "/api/chat/completions", {"model": "mock-alias", "max_tokens": 100, "messages": [{"role": "user", "content": "hi"}]}, {"x-api-key": api_key})
    check("extra_json override request ok", st == 200, body[:200])
    up = LAST_BODY.get("json", {})
    check("extra_json overrides client field", up.get("max_tokens") == 555, str(up.get("max_tokens")))
    check("extra_json adds new field", up.get("temperature") == 0.1, str(up.get("temperature")))
    check("extra_json keeps other fields", up.get("model") == "mock-model" and up.get("stream") is False, str({k: up.get(k) for k in ("model", "stream")}))

    # 10c. invalid extra_json silently ignored
    cur.execute("UPDATE provider SET extra_json = 'not-json{{' WHERE id = 'mockp1'")
    con.commit()
    st, body = http_post(B + "/api/chat/completions", {"model": "mock-alias", "messages": [{"role": "user", "content": "hi"}], "max_tokens": 77}, {"x-api-key": api_key})
    check("invalid extra_json ignored", st == 200 and LAST_BODY.get("json", {}).get("max_tokens") == 77, f"{st} {LAST_BODY.get('json', {}).get('max_tokens')}")
    cur.execute("UPDATE provider SET extra_json = NULL WHERE id = 'mockp1'")
    con.commit()

    # 11. CORS headers present
    req = urllib.request.Request(B + "/api/auth/config")
    with urllib.request.urlopen(req, timeout=30) as r:
        acao = r.headers.get("Access-Control-Allow-Origin")
    check("CORS header", acao == "*", str(acao))

    print()
    if fails:
        print("FAILED:", fails)
        sys.exit(1)
    print("ALL TESTS PASSED")

if __name__ == "__main__":
    main()
