"""A destination 403 must advance the rotation, not re-send through one IP.

On 2026-08-28 the injury sync reported five failed attempts, every one logged
as `via 89.45.125.xxx`. That read as "ESPN has blocked the whole Webshare
range" and very nearly justified buying a residential proxy plan.

It was one proxy tried five times out of a hundred. 403 and 407 shared a
branch that called force_refresh(), which rebuilds the pool AND resets
itertools.cycle to index 0 — so each retry re-sent through proxy_list[0], the
one exit IP already known to be refused. _extract_ip_from_proxy masks the last
octet, so a hundred distinct proxies and one repeated proxy log identically.

These tests pin the distinction: a destination refusal rotates, a proxy auth
failure refreshes.
"""
import itertools
import os
import sys
import threading

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from data_pipeline.utils import citrus_request as cr

POOL = [f"http://u:p@89.45.{125 + i // 25}.{10 + i % 25}:8080" for i in range(100)]


class FakeProxyManager:
    def __init__(self):
        self.cycle = itertools.cycle(POOL)
        self.refreshes = 0
        self.lock = threading.Lock()

    def get_next_proxy(self):
        return next(self.cycle)

    def force_refresh(self):
        self.refreshes += 1
        # The real implementation rebuilds the cycle from index 0. Reproduce
        # that faithfully — the bug lived in this exact side effect.
        self.cycle = itertools.cycle(POOL)
        return True

    def get_proxy_count(self):
        return len(POOL)


class FakeResponse:
    def __init__(self, status_code):
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise cr.requests.exceptions.HTTPError(response=self)

    def json(self):
        return {}


class RecordingSession:
    """Captures the proxy used on every attempt."""

    def __init__(self, status_code):
        self.status_code = status_code
        self.proxies_used = []

    def request(self, *, proxies=None, **kwargs):
        self.proxies_used.append(proxies["https"] if proxies else None)
        return FakeResponse(self.status_code)


@pytest.fixture
def wired(monkeypatch):
    pm = FakeProxyManager()
    monkeypatch.setattr(cr, "get_proxy_manager", lambda: pm)
    monkeypatch.setattr(cr, "_get_session", lambda: RecordingSession(403))
    monkeypatch.setattr(cr.time, "sleep", lambda *_: None)
    return pm


def _run(monkeypatch, status_code):
    pm = FakeProxyManager()
    session = RecordingSession(status_code)
    monkeypatch.setattr(cr, "get_proxy_manager", lambda: pm)
    monkeypatch.setattr(cr, "_get_session", lambda: session)
    monkeypatch.setattr(cr.time, "sleep", lambda *_: None)
    monkeypatch.setattr(cr, "_check_circuit_breaker", lambda: False)
    with pytest.raises(cr.requests.exceptions.RequestException):
        cr.citrus_request("https://site.api.espn.com/x", max_retries=5)
    return pm, session


def test_destination_403_uses_a_different_proxy_every_attempt(monkeypatch):
    """The regression guard. Five attempts must mean five exit IPs."""
    pm, session = _run(monkeypatch, 403)
    assert len(session.proxies_used) == 5, session.proxies_used
    assert len(set(session.proxies_used)) == 5, (
        "retries re-used an exit IP already refused: " + repr(session.proxies_used)
    )


def test_destination_403_does_not_refresh_the_pool(monkeypatch):
    """The pool is healthy when a destination refuses; refreshing resets the
    cycle and is what caused the repeat."""
    pm, _ = _run(monkeypatch, 403)
    assert pm.refreshes == 0


def test_proxy_auth_407_does_refresh(monkeypatch):
    """407 is the opposite case — our credentials were rejected, so rebuilding
    the pool is the correct response and must not regress with the 403 fix."""
    pm, session = _run(monkeypatch, 407)
    assert pm.refreshes >= 1


def test_pool_order_is_shuffled_per_process(monkeypatch):
    """Second half of the 2026-08-28 postmortem: Webshare returns the pool in
    a STABLE order and every short-lived pipeline process rebuilt its cycle
    from index 0 — so across runs, the same front-of-list IPs carried every
    request while the back ninety never got asked, and ESPN flagged exactly
    the recurring leaders. A refresh must cache a shuffled permutation.

    (Identity-order flake risk is 1 in 100!, i.e. none.)
    """
    from data_pipeline.utils import proxy_manager as pmod

    monkeypatch.setenv("CITRUS_PROXY_ENABLED", "true")
    monkeypatch.setenv("CITRUS_PROXY_USERNAME", "u")
    monkeypatch.setenv("CITRUS_PROXY_PASSWORD", "p")
    monkeypatch.setenv("CITRUS_PROXY_API_URL", "http://pool.invalid/list")

    raw = [{"proxy_address": f"10.0.0.{i}", "port": str(1000 + i)} for i in range(100)]
    monkeypatch.setattr(
        pmod.ProxyManager, "_fetch_proxy_list_from_api", lambda self: list(raw)
    )

    manager = pmod.ProxyManager()
    api_order = [f"http://u:p@10.0.0.{i}:{1000 + i}" for i in range(100)]

    assert sorted(manager.proxy_list) == sorted(api_order), "pool contents must be unchanged"
    assert manager.proxy_list != api_order, (
        "pool kept the API's stable order — every process run would walk the "
        "same IPs from index 0 again"
    )
    # Rotation within a run stays a strict no-repeat cycle over the whole pool.
    seen = [manager.get_next_proxy() for _ in range(100)]
    assert sorted(seen) == sorted(api_order)
