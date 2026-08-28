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
