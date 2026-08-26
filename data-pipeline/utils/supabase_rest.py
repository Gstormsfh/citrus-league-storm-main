#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose:     Supabase REST API client for pipeline writes (service-role JWT)
# Last active: 2026-03-02
# Invoked:     imported by EVERY data-pipeline write path
# Reads:       (env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
# Writes:      (any Supabase table)
# ────────────────────────────────────────────────────────────
"""
supabase_rest.py

Minimal PostgREST client for Supabase that works with the new `sb_secret_...` keys.
We avoid supabase-py here because older versions validate keys as JWTs.

Auth headers:
- apikey: <key>
- Authorization: Bearer <key>
"""

from __future__ import annotations

import json
import logging
import os
import random
import time
from email.utils import parsedate_to_datetime
from typing import Any, Dict, List, Optional, Tuple, Union
from urllib.parse import urlencode

import requests
from requests.adapters import HTTPAdapter


logger = logging.getLogger(__name__)


Filter = Tuple[str, str, Any]  # (col, op, value) where op in {"eq","neq","gte","gt","lte","lt","in"}

# Patient backoff for 5xx bursts + connection/timeout errors. Waits between
# 8 attempts (7 retries): ~1 + 2 + 4 + 8 + 16 + 30 + 30 = 91s ceiling before
# raising. Small jitter (±10%) prevents thundering-herd. Introduced after the
# 2026-07 phase 0c campaign crashed 4× on transient PostgREST 500 squalls that
# resolve in seconds — the prior urllib3 Retry(total=5, backoff_factor=1)
# gave up after ~15s. Success path is untouched: no retry, no sleep, no log
# when the first attempt returns < 500 without raising.
_RETRY_WAITS_SECONDS: Tuple[int, ...] = (1, 2, 4, 8, 16, 30, 30)

# Statuses that trigger a retry in addition to 5xx: 429 (Too Many Requests).
# When a 429 or 503 response carries a Retry-After header, honor it (up to
# _RETRY_AFTER_CAP_SECONDS) instead of the next ladder step.
_RETRY_STATUSES_BELOW_500: Tuple[int, ...] = (429,)
_RETRY_AFTER_CAP_SECONDS: int = 60


def _parse_retry_after(header_value: str) -> Optional[float]:
  """Parse an RFC 7231 Retry-After header. Returns seconds to wait, or None if
  the value can't be interpreted."""
  if not header_value:
    return None
  s = header_value.strip()
  # Try delta-seconds first (integer)
  try:
    return max(0.0, float(s))
  except ValueError:
    pass
  # Fall back to HTTP-date
  try:
    dt = parsedate_to_datetime(s)
    if dt is None:
      return None
    from datetime import datetime, timezone
    if dt.tzinfo is None:
      dt = dt.replace(tzinfo=timezone.utc)
    delta = (dt - datetime.now(timezone.utc)).total_seconds()
    return max(0.0, delta)
  except (TypeError, ValueError):
    return None


class SupabaseRest:
  def __init__(self, supabase_url: Optional[str] = None, supabase_key: Optional[str] = None, schema: str = "public", timeout_seconds: int = 60):
    # Fall back to env vars when args aren't supplied. This is what every
    # caller used to duplicate (read VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY,
    # then pass to constructor); centralising it removes the footgun where
    # `SupabaseRest()` raised TypeError instead of just working.
    if supabase_url is None:
      supabase_url = os.getenv("VITE_SUPABASE_URL") or os.getenv("SUPABASE_URL")
    if supabase_key is None:
      supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not supabase_key:
      raise ValueError(
        "supabase_url and supabase_key are required (pass explicitly or set "
        "VITE_SUPABASE_URL/SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars)"
      )
    self.url = supabase_url.rstrip("/")
    self.key = supabase_key
    self.schema = schema
    self.timeout_seconds = timeout_seconds
    
    # Create a session with connection pooling to prevent socket exhaustion
    self.session = requests.Session()
    self.session.headers.update({
      "apikey": self.key,
      "Authorization": f"Bearer {self.key}",
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Accept-Profile": self.schema,
      "Content-Profile": self.schema,
    })
    
    # Connection pooling only — retries live in _request_with_retry (see
    # module-level _RETRY_WAITS_SECONDS). Byte-identical success path: no
    # sleep, no log, no extra request on first-try success.
    adapter = HTTPAdapter(
      pool_connections=100,  # Number of connection pools to cache
      pool_maxsize=100,       # Max connections per pool
      pool_block=False         # Don't block if pool is full
    )
    self.session.mount("https://", adapter)
    self.session.mount("http://", adapter)

  def _log_path(self, url: str) -> str:
    tail = url.split("/rest/v1/", 1)[-1]
    return tail.split("?", 1)[0]

  def _request_with_retry(self, method: str, url: str, **kwargs) -> requests.Response:
    """Send an HTTP request; retry on 5xx, 429, or connection/timeout errors
    with a patient exponential schedule (see _RETRY_WAITS_SECONDS). 429 and
    503 responses honor a Retry-After header if present (capped at
    _RETRY_AFTER_CAP_SECONDS). Other 4xx responses return immediately — the
    caller decides how to handle them, preserving existing error semantics."""
    last_exc: Optional[BaseException] = None
    last_response: Optional[requests.Response] = None
    max_attempts = len(_RETRY_WAITS_SECONDS) + 1
    for attempt in range(1, max_attempts + 1):
      retry_after: Optional[float] = None
      try:
        r = self.session.request(method, url, **kwargs)
      except (requests.ConnectionError, requests.Timeout) as e:
        last_exc = e
        last_response = None
        status_repr: Union[int, str] = f"exc:{type(e).__name__}"
      else:
        last_exc = None
        last_response = r
        # Success or non-retriable client error: return immediately.
        # Byte-identical to pre-refactor behavior on first attempt.
        if r.status_code < 500 and r.status_code not in _RETRY_STATUSES_BELOW_500:
          return r
        status_repr = r.status_code
        # 429 and 503 may carry a Retry-After telling us exactly how long to
        # wait; honor it if present, capped to prevent pathological delays.
        if r.status_code in (429, 503):
          hint = _parse_retry_after(r.headers.get("Retry-After", ""))
          if hint is not None:
            retry_after = min(hint, float(_RETRY_AFTER_CAP_SECONDS))
      if attempt == max_attempts:
        # Exhausted retries. Re-raise the last connection/timeout error, or
        # return the last response so the caller's existing status-code
        # handling raises with the server's message.
        if last_exc is not None:
          raise last_exc
        return last_response  # type: ignore[return-value]
      if retry_after is not None:
        wait = retry_after
        logger.warning(
          "[supabase_rest] retry attempt=%d/%d status=%s method=%s path=%s "
          "sleeping=%.1fs (honoring Retry-After)",
          attempt, max_attempts, status_repr, method, self._log_path(url), wait,
        )
      else:
        wait_base = _RETRY_WAITS_SECONDS[attempt - 1]
        wait = wait_base * (1.0 + random.uniform(-0.1, 0.1))
        logger.warning(
          "[supabase_rest] retry attempt=%d/%d status=%s method=%s path=%s sleeping=%.1fs",
          attempt, max_attempts, status_repr, method, self._log_path(url), wait,
        )
      time.sleep(wait)
    # Unreachable — the loop either returns or raises.
    if last_exc is not None:  # pragma: no cover
      raise last_exc
    return last_response  # type: ignore[return-value]

  @property
  def rest_base(self) -> str:
    return f"{self.url}/rest/v1"

  def _headers(self, extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    # Headers are now set on the session, but we may need to override for specific requests
    h = {}
    if extra:
      h.update(extra)
    return h

  def _fmt_filter(self, col: str, op: str, val: Any) -> Tuple[str, str]:
    if op == "in":
      if not isinstance(val, (list, tuple, set)):
        raise ValueError("in filter requires a list/tuple/set value")
      # PostgREST expects in.(a,b,c)
      inner = ",".join(str(v) for v in val)
      return col, f"in.({inner})"
    # eq.123, gte.2025-10-07, etc.
    return col, f"{op}.{val}"

  def _build_query(self, select: Optional[str] = None, filters: Optional[List[Filter]] = None, order: Optional[str] = None,
                   limit: Optional[int] = None, offset: Optional[int] = None, on_conflict: Optional[str] = None) -> str:
    params: Dict[str, Any] = {}
    if select:
      params["select"] = select
    if order:
      params["order"] = order
    if limit is not None:
      params["limit"] = int(limit)
    if offset is not None:
      params["offset"] = int(offset)
    if on_conflict:
      params["on_conflict"] = on_conflict
    if filters:
      # Two filters on the same column (`game_date >= X AND game_date <= Y`)
      # arrive as two tuples with the same normalized key. Prior behaviour —
      # `params[k] = v` — silently dropped the earlier filter (dict last-
      # wins). That is how the D-02 backfill misfired for hours: a single-
      # date scrape resolved to `game_date=lte.<date>` and pulled every
      # game up to and including that date. Preserve every filter by
      # accumulating same-key values into a list; `urlencode(..., doseq=True)`
      # emits `game_date=gte.X&game_date=lte.Y`, which PostgREST AND-composes.
      for col, op, val in filters:
        k, v = self._fmt_filter(col, op, val)
        if k in params:
          existing = params[k]
          if isinstance(existing, list):
            existing.append(v)
          else:
            params[k] = [existing, v]
        else:
          params[k] = v
    return urlencode(params, doseq=True)

  # PostgREST caps every response at db-max-rows, which is 1000 on this project.
  # A read asking for more gets 1000 and no error. Measured 2026-08-26: twenty-two
  # active reads ask for 2,000 to 100,000 rows and silently receive 1,000 —
  # including the daily projections path, which asks for "all shots in these
  # games" with limit=50000.
  SAFE_PAGE = 1000

  def _select_once(self, table: str, select: str, filters, order, limit, offset,
                   want_total: bool = False):
    """One request. Returns (rows, total_available_or_None)."""
    qs = self._build_query(select=select, filters=filters, order=order, limit=limit, offset=offset)
    url = f"{self.rest_base}/{table}"
    if qs:
      url = f"{url}?{qs}"
    hdr = self._headers({"Prefer": "count=exact"}) if want_total else self._headers()
    r = self._request_with_retry("GET", url, headers=hdr, timeout=self.timeout_seconds)
    if r.status_code >= 400:
      raise RuntimeError(f"Supabase select failed ({table}): {r.status_code} {r.text}")
    rows = r.json() if r.text else []
    total = None
    if want_total:
      cr = r.headers.get("Content-Range") or r.headers.get("content-range")
      if cr and "/" in cr:
        tail = cr.split("/", 1)[1].strip()
        if tail.isdigit():
          total = int(tail)
    return rows, total

  def select(self, table: str, select: str = "*", filters: Optional[List[Filter]] = None, order: Optional[str] = None,
             limit: Optional[int] = None, offset: Optional[int] = None) -> List[dict]:
    """Read rows, paging transparently rather than being silently truncated.

    A caller asking for at most SAFE_PAGE rows gets exactly the behaviour it
    always had: one request, one response. Nothing about those call sites
    changes.

    A caller asking for more than that — or for no limit at all — used to
    receive whatever the server was willing to return in one go and had no way
    to tell that was not everything. It now pages until it has the whole
    result, and checks the tally against the count PostgREST reports in
    Content-Range. If those disagree it raises, because returning part of an
    answer while looking like the whole one is the failure this guards.

    Offset paging needs a stable sort. When the caller supplies no `order`, a
    deterministic one is added on `id`; a table without that column falls back
    to the caller's original request and a warning, rather than failing.
    """
    if limit is not None and int(limit) <= self.SAFE_PAGE:
      rows, _ = self._select_once(table, select, filters, order, limit, offset)
      return rows

    want = None if limit is None else int(limit)
    page_order = order
    fallback_tried = False
    if page_order is None:
      # deterministic order so offset paging cannot repeat or skip
      page_order = "id.asc"

    out: List[dict] = []
    off = int(offset or 0)
    total = None
    while True:
      take = self.SAFE_PAGE if want is None else min(self.SAFE_PAGE, want - len(out))
      if take <= 0:
        break
      try:
        rows, t = self._select_once(table, select, filters, page_order, take, off,
                                    want_total=(total is None))
      except RuntimeError as e:
        # a table with no `id` column rejects the order we added; drop it once
        if page_order == "id.asc" and order is None and not fallback_tried:
          fallback_tried = True
          page_order = None
          print(f"   [WARN] {table}: no id column to page by, falling back to unordered "
                f"paging. Add an explicit order= to this call.")
          continue
        raise
      if t is not None and total is None:
        total = t
      out.extend(rows)
      if len(rows) < take:
        break
      off += len(rows)

    if total is not None:
      expected = max(0, total - int(offset or 0))
      if want is not None:
        expected = min(want, expected)
      if len(out) != expected:
        raise RuntimeError(
          f"Supabase select ({table}): TRUNCATION — paged to {len(out)} rows but "
          f"Content-Range reports {total} available with offset={offset!r} "
          f"limit={limit!r}, so {expected} were expected. filters={filters!r}. "
          f"Refusing to return part of an answer as if it were the whole one."
        )
    return out

  def select_exact(self, table: str, select: str = "*", filters: Optional[List[Filter]] = None,
                   order: Optional[str] = None, limit: Optional[int] = None,
                   offset: Optional[int] = None) -> List[dict]:
    """Select with `Prefer: count=exact` and truncation guard (0E-XG-11 T2).

    Sends `Prefer: count=exact`, reads the total row count from the
    `Content-Range` response header, and RAISES if the number of rows
    actually returned does not match the request-window's expected slice
    of that total. The prior silent-truncation class ate the 2026-01
    rescore (read 1,369 of 1,394 games, reported success) and the entire
    audit-retention monitor.

    RULES:
    * If the caller requested a paged window (limit/offset set), the
      returned row count must equal min(limit, total - offset). Anything
      less means the transport dropped rows silently.
    * If the caller did not specify limit/offset (full-table select),
      the returned row count must equal the total from Content-Range.
    * PostgREST caps every response at db-max-rows (1000 on this project).
      A large `limit=` does NOT defeat that — it just returns 1000 rows and
      no error. `select()` above now pages transparently; prefer it. Do not
      write `limit=100000` and assume you got 100000.

    Callers that iterate pages should combine with `_expected_total()`
    below or simply loop until returned rows < requested limit.
    """
    qs = self._build_query(select=select, filters=filters, order=order, limit=limit, offset=offset)
    url = f"{self.rest_base}/{table}"
    if qs:
      url = f"{url}?{qs}"
    hdr = self._headers({"Prefer": "count=exact"})
    r = self._request_with_retry("GET", url, headers=hdr, timeout=self.timeout_seconds)
    if r.status_code >= 400:
      raise RuntimeError(f"Supabase select_exact failed ({table}): {r.status_code} {r.text}")
    rows: List[dict] = r.json() if r.text else []
    # Content-Range: "0-999/12345" or "*/12345" (no rows) or "0-4/5"
    cr = r.headers.get("Content-Range") or r.headers.get("content-range")
    if not cr or "/" not in cr:
      raise RuntimeError(
        f"Supabase select_exact ({table}): missing/malformed Content-Range "
        f"header ({cr!r}). Cannot verify row completeness — refusing to trust."
      )
    total_str = cr.split("/", 1)[1].strip()
    if total_str == "*":
      raise RuntimeError(
        f"Supabase select_exact ({table}): PostgREST returned unbounded total "
        f"(Content-Range={cr!r}). Cannot verify completeness."
      )
    try:
      total_available = int(total_str)
    except ValueError:
      raise RuntimeError(
        f"Supabase select_exact ({table}): Content-Range total is not int "
        f"({cr!r})."
      )
    # Expected count for this window
    off = int(offset or 0)
    if limit is not None:
      expected = min(int(limit), max(0, total_available - off))
    else:
      expected = max(0, total_available - off)
    if len(rows) != expected:
      raise RuntimeError(
        f"Supabase select_exact ({table}): TRUNCATION detected — "
        f"received {len(rows)} rows, Content-Range says {total_available} "
        f"available with offset={off} limit={limit!r} → expected {expected}. "
        f"filters={filters!r}. This is the 0E-XG-11 T2 silent-truncation "
        f"class; refusing to return partial data."
      )
    return rows

  @staticmethod
  def _uniform_key_groups(rows: List[dict]) -> List[List[dict]]:
    """
    Split a batch into groups that each share an identical key set.

    PostgREST requires every object in a bulk body to carry exactly the same
    keys and answers 400 PGRST102 "All object keys must match" otherwise. That
    is what broke the daily Refresh Player Directory job every morning from
    2026-08-14 to 2026-08-25: rows are built from the NHL API, which omits
    fields it has nothing for, so one player carries `college_team` and the
    next does not and the whole batch is rejected.

    Grouping rather than padding the short rows with None, deliberately. This
    client upserts with `resolution=merge-duplicates`, which compiles to
    ON CONFLICT DO UPDATE over the columns actually present in the body — so a
    padded None is not "no value", it is an instruction to overwrite whatever
    is already stored with NULL. Padding would have turned a 400 into silent
    data loss on every field the NHL API happened to omit that day, which is
    strictly worse than the failure it replaces.

    One request per distinct key signature. In practice that is a handful.
    """
    groups: Dict[frozenset, List[dict]] = {}
    for row in rows:
      groups.setdefault(frozenset(row.keys()), []).append(row)
    return list(groups.values())

  def upsert(self, table: str, rows: Union[dict, List[dict]], on_conflict: str) -> None:
    """
    Upsert rows with merge-duplicates resolution.

    Note: merge-duplicates in PostgREST merges NULL values from existing rows with
    non-NULL values from new rows. For integer fields with default 0, this means
    that 0 values in new rows will overwrite existing 0 values (which is desired).
    However, if you want to preserve existing non-zero values, you should use
    update() instead or ensure your rows contain all desired values.
    """
    url = f"{self.rest_base}/{table}?{self._build_query(on_conflict=on_conflict)}"
    hdr = self._headers(
      {
        # Merge duplicates on conflict - merges NULL from existing with non-NULL from new
        # For our use case (stats extraction), we want to overwrite with extracted values
        "Prefer": "resolution=merge-duplicates,return=minimal",
      }
    )
    body = rows if isinstance(rows, list) else [rows]
    # See _uniform_key_groups: a bulk body with mixed keys is a 400 (PGRST102).
    for group in self._uniform_key_groups(body):
      r = self._request_with_retry("POST", url, headers=hdr, data=json.dumps(group), timeout=self.timeout_seconds)
      if r.status_code >= 400:
        raise RuntimeError(
          f"Supabase upsert failed ({table}): {r.status_code} {r.text} "
          f"[group of {len(group)} rows, keys={sorted(group[0].keys())}]"
        )

  def insert(self, table: str, rows: Union[dict, List[dict]]) -> None:
    """Plain insert (no upsert). Fails if a row collides with a unique constraint."""
    url = f"{self.rest_base}/{table}"
    hdr = self._headers({"Prefer": "return=minimal"})
    body = rows if isinstance(rows, list) else [rows]
    # Same PGRST102 constraint as upsert().
    for group in self._uniform_key_groups(body):
      r = self._request_with_retry("POST", url, headers=hdr, data=json.dumps(group), timeout=self.timeout_seconds)
      if r.status_code >= 400:
        raise RuntimeError(
          f"Supabase insert failed ({table}): {r.status_code} {r.text} "
          f"[group of {len(group)} rows, keys={sorted(group[0].keys())}]"
        )

  def update(self, table: str, values: dict, filters: List[Filter]) -> None:
    qs = self._build_query(filters=filters)
    url = f"{self.rest_base}/{table}?{qs}"
    hdr = self._headers({"Prefer": "return=minimal"})
    r = self._request_with_retry("PATCH", url, headers=hdr, data=json.dumps(values), timeout=self.timeout_seconds)
    if r.status_code >= 400:
      raise RuntimeError(f"Supabase update failed ({table}): {r.status_code} {r.text}")

  def delete(self, table: str, filters: List[Filter]) -> None:
    qs = self._build_query(filters=filters)
    url = f"{self.rest_base}/{table}?{qs}"
    hdr = self._headers({"Prefer": "return=minimal"})
    r = self._request_with_retry("DELETE", url, headers=hdr, timeout=self.timeout_seconds)
    if r.status_code >= 400:
      raise RuntimeError(f"Supabase delete failed ({table}): {r.status_code} {r.text}")

  # Alias for callers that prefer the more explicit name.
  def delete_where(self, table: str, filters: List[Filter]) -> None:
    self.delete(table, filters)

  def rpc(self, fn: str, payload: dict) -> Any:
    url = f"{self.rest_base}/rpc/{fn}"
    r = self._request_with_retry("POST", url, headers=self._headers(), data=json.dumps(payload), timeout=self.timeout_seconds)
    if r.status_code >= 400:
      raise RuntimeError(f"Supabase rpc failed ({fn}): {r.status_code} {r.text}")
    return r.json() if r.text else None


