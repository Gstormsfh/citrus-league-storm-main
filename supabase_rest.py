#!/usr/bin/env python3
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
from typing import Any, Dict, Iterable, List, Optional, Tuple, Union
from urllib.parse import urlencode

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


Filter = Tuple[str, str, Any]  # (col, op, value) where op in {"eq","neq","gte","gt","lte","lt","in"}


class SupabaseRest:
  def __init__(self, supabase_url: str, supabase_key: str, schema: str = "public", timeout_seconds: int = 60):
    if not supabase_url or not supabase_key:
      raise ValueError("supabase_url and supabase_key are required")
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
    
    # Configure retry strategy for transient errors
    retry_strategy = Retry(
      total=5,
      backoff_factor=1,
      status_forcelist=[502, 503, 504, 429],  # Bad Gateway, Service Unavailable, Gateway Timeout, Too Many Requests
      allowed_methods=["GET", "POST", "PATCH", "DELETE"]
    )
    
    # Mount adapter with connection pooling
    adapter = HTTPAdapter(
      max_retries=retry_strategy,
      pool_connections=100,  # Number of connection pools to cache
      pool_maxsize=100,       # Max connections per pool
      pool_block=False         # Don't block if pool is full
    )
    self.session.mount("https://", adapter)
    self.session.mount("http://", adapter)

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
      for col, op, val in filters:
        k, v = self._fmt_filter(col, op, val)
        params[k] = v
    return urlencode(params, doseq=True)

  def select(self, table: str, select: str = "*", filters: Optional[List[Filter]] = None, order: Optional[str] = None,
             limit: Optional[int] = None, offset: Optional[int] = None) -> List[dict]:
    qs = self._build_query(select=select, filters=filters, order=order, limit=limit, offset=offset)
    url = f"{self.rest_base}/{table}"
    if qs:
      url = f"{url}?{qs}"
    # Use session.get() instead of requests.get() for connection pooling
    r = self.session.get(url, headers=self._headers(), timeout=self.timeout_seconds)
    if r.status_code >= 400:
      raise RuntimeError(f"Supabase select failed ({table}): {r.status_code} {r.text}")
    return r.json() if r.text else []

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
    # Use session.post() instead of requests.post() for connection pooling
    r = self.session.post(url, headers=hdr, data=json.dumps(body), timeout=self.timeout_seconds)
    if r.status_code >= 400:
      raise RuntimeError(f"Supabase upsert failed ({table}): {r.status_code} {r.text}")

  def update(self, table: str, values: dict, filters: List[Filter]) -> None:
    qs = self._build_query(filters=filters)
    url = f"{self.rest_base}/{table}?{qs}"
    hdr = self._headers({"Prefer": "return=minimal"})
    # Use session.patch() instead of requests.patch() for connection pooling
    r = self.session.patch(url, headers=hdr, data=json.dumps(values), timeout=self.timeout_seconds)
    if r.status_code >= 400:
      raise RuntimeError(f"Supabase update failed ({table}): {r.status_code} {r.text}")

  def delete(self, table: str, filters: List[Filter]) -> None:
    qs = self._build_query(filters=filters)
    url = f"{self.rest_base}/{table}?{qs}"
    hdr = self._headers({"Prefer": "return=minimal"})
    # Use session.delete() instead of requests.delete() for connection pooling
    r = self.session.delete(url, headers=hdr, timeout=self.timeout_seconds)
    if r.status_code >= 400:
      raise RuntimeError(f"Supabase delete failed ({table}): {r.status_code} {r.text}")

  def rpc(self, fn: str, payload: dict) -> Any:
    url = f"{self.rest_base}/rpc/{fn}"
    # Use session.post() instead of requests.post() for connection pooling
    r = self.session.post(url, headers=self._headers(), data=json.dumps(payload), timeout=self.timeout_seconds)
    if r.status_code >= 400:
      raise RuntimeError(f"Supabase rpc failed ({fn}): {r.status_code} {r.text}")
    return r.json() if r.text else None


