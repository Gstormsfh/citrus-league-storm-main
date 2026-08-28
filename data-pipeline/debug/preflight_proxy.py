#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose:     Prove CITRUS_PROXY_* credentials clear ESPN before they become secrets
# Last active: 2026-08-27
# Invoked:     manually, by a human, from the repo root
# Reads:       CITRUS_PROXY_* from the local environment, ESPN injuries feed
# Writes:      nothing
# ────────────────────────────────────────────────────────────
"""
preflight_proxy.py - does this proxy actually get us past ESPN?

WHY THIS EXISTS
───────────────
Setting CITRUS_PROXY_* as GitHub secrets and dispatching the workflow is a
slow way to answer a fast question, and it answers it only after money has
been spent. Worse, ProxyManager is deliberately non-fatal: every failure
mode here — missing credential, wrong list format, unreachable endpoint —
degrades to direct mode with a WARNING and the job still goes green. So a
bad credential does not look like a bad credential. It looks like success
followed by a 403 several steps later.

This runs the real path — the same ProxyManager and the same citrus_request
that fetch_injury_status.py uses — against the same ESPN URL, and says
plainly whether the request got through and whether it went through a proxy.

Webshare's free tier (10 datacenter proxies, 1GB/month) is enough to answer
the question. Those IPs are shared between customers, so the honest risk is
that ESPN has already blocked one; this script is how you find that out for
nothing instead of after a purchase.

USAGE
─────
    export CITRUS_PROXY_API_URL='...'
    export CITRUS_PROXY_USERNAME='...'
    export CITRUS_PROXY_PASSWORD='...'
    python data-pipeline/debug/preflight_proxy.py

Exit 0 = the feed came back and parsed. Exit 1 = it did not; the reason is
printed above the summary.

This script never prints a credential. It reports presence, lengths and
counts only, so its output is safe to paste anywhere — including into a
chat with an assistant.
"""

import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from data_pipeline.utils.proxy_manager import get_proxy_manager
from data_pipeline.utils.citrus_request import citrus_request

ESPN_INJURIES_URL = (
    "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries?limit=1000"
)

VARS = ("CITRUS_PROXY_API_URL", "CITRUS_PROXY_USERNAME", "CITRUS_PROXY_PASSWORD")

# INFO level on purpose. citrus_request logs one line per attempt reading
# `Requesting <url> via <ip>`, where the ip is masked to three octets and is
# the literal string `direct` when no proxy was used. That line is the most
# direct proof available that traffic actually left through the proxy, so it
# should be visible rather than swallowed.
logging.basicConfig(level=logging.INFO, format="  %(levelname)s %(message)s")


def rule(title: str) -> None:
    """Print a section header.

    This function prints ASCII only, and so does every message below it.

    On Windows, Python encodes a redirected stdout with the locale codepage.
    U+2500 (the box-drawing rule this used to print) does not exist in cp1252,
    so the script died with UnicodeEncodeError on its first section header --
    before running a single check, in the one environment it was written for.
    CI never saw it: the runners are Linux and UTF-8.

    sys.stdout.reconfigure() would also fix it, but it is absent when stdout
    has been replaced by a capture object, which is exactly where redirected
    output comes from. ASCII has no failure mode.
    """
    print("\n" + title)
    print("-" * max(len(title), 40))


def main() -> int:
    rule("1. Credentials present in this environment")
    missing = []
    for name in VARS:
        val = os.getenv(name)
        if val:
            # Length only. The value itself never reaches stdout.
            print(f"  {name:<24} set ({len(val)} chars)")
        else:
            print(f"  {name:<24} MISSING")
            missing.append(name)

    if missing:
        print(
            "\n  ProxyManager treats a missing credential as 'run direct', not as an\n"
            "  error, so this would have gone green in CI and then 403'd. Export the\n"
            "  names above exactly as spelled and re-run."
        )
        return 1

    rule("2. ProxyManager initialisation")
    pm = get_proxy_manager()
    print(f"  enabled      {pm.is_enabled()}")
    print(f"  proxies      {pm.get_proxy_count()}")

    if not pm.is_enabled():
        print(
            "\n  Disabled despite all three being set -- check CITRUS_PROXY_ENABLED,\n"
            "  which defaults to true and can only turn things off."
        )
        return 1

    if pm.get_proxy_count() == 0:
        print(
            "\n  Zero proxies loaded. _fetch_proxy_list_from_api returns an empty\n"
            "  list for two unrelated reasons and the ERROR/WARNING line above is\n"
            "  what tells them apart:\n"
            "\n"
            "    'Failed to fetch proxy list: ...'\n"
            "        The URL never returned. Wrong host, expired link, or no\n"
            "        network route to it. Open the URL in a browser to confirm\n"
            "        it is live.\n"
            "\n"
            "    'No proxies parsed from API response'\n"
            "        The URL responded, but not in the format the parser expects:\n"
            "        plain text, one proxy per line, shaped IP:PORT:USER:PASS.\n"
            "        A JSON endpoint lands here. In the Webshare dashboard take\n"
            "        Proxy List -> Download -> the API link, and confirm in a\n"
            "        browser that the response is lines and not JSON."
        )
        return 1

    rule("3. ESPN injuries feed, through the proxy")
    print(f"  GET {ESPN_INJURIES_URL}")
    print("  watch for `via <ip>` below -- `via direct` means no proxy was used\n")
    try:
        resp = citrus_request(ESPN_INJURIES_URL, timeout=20)
    except Exception as exc:  # noqa: BLE001 - preflight reports, never raises
        print(f"  request raised: {type(exc).__name__}: {exc}")
        return 1

    status = getattr(resp, "status_code", None)
    print(f"  status       {status}")

    if status == 403:
        print(
            "\n  403 -- this is the failure the proxy is meant to solve, so the proxy\n"
            "  is not solving it. Most likely the exit IP is itself blocked. On the\n"
            "  free tier the IPs are shared between customers, which makes that\n"
            "  ordinary rather than surprising. Re-run to draw a different IP from\n"
            "  the rotation; if it keeps failing, the datacenter pool is burnt for\n"
            "  this endpoint and residential is the next step."
        )
        return 1

    if status != 200:
        print(f"\n  Unexpected status {status}. Not a proxy verdict either way.")
        return 1

    try:
        payload = resp.json()
    except Exception as exc:  # noqa: BLE001
        print(f"  body did not parse as JSON: {exc}")
        return 1

    teams = payload.get("injuries", [])
    players = sum(len(t.get("injuries", [])) for t in teams)
    print(f"  teams        {len(teams)}")
    print(f"  players      {players}")

    if not teams:
        print(
            "\n  200 with an empty injuries[] -- the request got through but the feed\n"
            "  shape has moved. That is a fetch_injury_status.py problem, not a\n"
            "  proxy problem."
        )
        return 1

    rule("PASS")
    print(
        f"  {pm.get_proxy_count()} proxies loaded, feed returned {players} designations\n"
        f"  across {len(teams)} teams. These three values are safe to add as GitHub\n"
        "  repository secrets under the same names."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
