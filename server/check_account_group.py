"""End-to-end check of the account-group feature against a live server.

Starts nothing itself: point it at a running instance.

    python server/check_account_group.py [base_url]

It signs in as an admin, creates a group, puts accounts in it, and asserts that
the usage endpoint's group filter returns exactly the members' combined usage —
plus the two cases that are easy to get wrong: a group with no members must
return nothing rather than everything, and an account in two selected groups must
not be counted twice.
"""

import json
import sys
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8080"
TOKEN = ""


def call(path, body=None):
    url = BASE + path
    data = json.dumps(body or {}).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if TOKEN:
        req.add_header("Authorization", TOKEN)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return {"success": False, "message": f"HTTP {e.code}", "raw": e.read().decode(errors="replace")}


def need(res, what):
    if not res.get("success"):
        raise SystemExit(f"FAIL {what}: {res.get('message')}")
    return res["data"]


def main():
    global TOKEN
    email = sys.argv[2] if len(sys.argv) > 2 else "admin@example.com"
    password = sys.argv[3] if len(sys.argv) > 3 else "admin123"

    login = call("/api/auth/login", {"identify": {"email": email, "password": password}})
    if not login.get("success"):
        raise SystemExit(f"cannot sign in ({login.get('message')}); pass email/password as argv[2..3]")
    TOKEN = login["data"]["token"]
    print("signed in")

    accounts = need(call("/api/account/list", {"page": 1, "filter": {}}), "account list")["list"]
    if len(accounts) < 2:
        raise SystemExit("need at least 2 accounts to exercise grouping")
    a, b = accounts[0], accounts[1]
    print(f"accounts: {a['name']}, {b['name']}")

    # Clean slate for the names this script owns. A previous run may have died
    # partway, so this deletes rather than assumes.
    for g in need(call("/api/group/list", {}), "group list")["list"]:
        if g["name"].startswith("e2e-"):
            call("/api/group/delete", {"id": g["id"]})

    g1 = need(call("/api/group/create", {"name": "e2e-one", "remark": "script"}), "create")["group"]
    res2 = call("/api/group/create", {"name": "e2e-two", "remark": "script"})
    if not res2.get("success"):
        raise SystemExit(f"FAIL second create: {res2}")
    g2 = res2["data"]["group"]
    print(f"created groups {g1['id']} / {g2['id']}")

    # A duplicate name must be refused with a readable message.
    dup = call("/api/group/create", {"name": "e2e-one", "remark": ""})
    assert not dup.get("success"), "duplicate group name was accepted"
    print(f"duplicate rejected: {dup.get('message')}")

    # `a` is in both groups; `b` only in the first.
    need(call("/api/group/assign", {"id": g1["id"], "account_ids": [a["id"], b["id"]]}), "assign g1")
    need(call("/api/group/assign", {"id": g2["id"], "account_ids": [a["id"]]}), "assign g2")

    detail = need(call("/api/group/detail", {"id": g1["id"]}), "detail")
    assert len(detail["member_ids"]) == 2, f"g1 has {len(detail['member_ids'])} members, want 2"
    print("membership matches what was assigned")

    # Union of both groups is {a, b} — a belongs to two but must appear once.
    listed = need(call("/api/group/list", {}), "list")["list"]
    counts = {g["name"]: g["member_count"] for g in listed if g["name"].startswith("e2e-")}
    assert counts.get("e2e-one") == 2 and counts.get("e2e-two") == 1, f"counts wrong: {counts}"
    print(f"member counts: {counts}")

    # The filter resolves to the members and not to everyone.
    both = need(call("/api/usage/sessions", {
        "gapMinutes": 60, "since": 0, "group_ids": [g1["id"], g2["id"]],
    }), "usage sessions (both groups)")
    totals_both = both["totals"]
    only_b = need(call("/api/usage/sessions", {
        "gapMinutes": 60, "since": 0, "group_ids": [g2["id"]],
    }), "usage sessions (g2 only)")
    totals_b = only_b["totals"]
    print(f"both groups: {totals_both['totalRequests']} requests, "
          f"g2 only: {totals_b['totalRequests']} requests")
    assert totals_both["totalRequests"] >= totals_b["totalRequests"], "union is smaller than one of its parts"

    # Both groups are {a, b} and g2 is {a}, so the difference must be exactly
    # b's own traffic. If the union double-counted a (it is in both groups) this
    # would not add up.
    per_account = need(call("/api/usage/sessions", {
        "gapMinutes": 60, "since": 0, "account_ids": [b["id"]],
    }), "usage sessions (b alone)")["totals"]
    diff = totals_both["totalRequests"] - totals_b["totalRequests"]
    assert diff == per_account["totalRequests"], (
        f"union-minus-g2 is {diff}, but {b['name']} alone reports "
        f"{per_account['totalRequests']} — the overlapping account was miscounted"
    )
    print(f"{b['name']} alone: {per_account['totalRequests']} requests (matches the difference)")

    # An empty group must return the empty shape, NOT the whole instance's usage.
    empty = need(call("/api/group/create", {"name": "e2e-empty", "remark": "script"}), "create empty")["group"]
    got = need(call("/api/usage/sessions", {
        "gapMinutes": 60, "since": 0, "group_ids": [empty["id"]],
    }), "usage sessions (empty group)")
    assert got["totals"]["totalRequests"] == 0, \
        f"an empty group returned {got['totals']['totalRequests']} requests — the filter was dropped"
    print("empty group correctly returns nothing")

    for g in (g1, g2, empty):
        need(call("/api/group/delete", {"id": g["id"]}), "cleanup delete")
    remaining = [g["name"] for g in need(call("/api/group/list", {}), "list")["list"]
                 if g["name"].startswith("e2e-")]
    assert not remaining, f"cleanup left {remaining}"
    print("\nPASS — group CRUD, membership, counts and the usage filter all behave")


if __name__ == "__main__":
    main()
