"""Where an emitted artifact goes.

THE READ PATH IS THE WHOLE POINT. Near-zero traffic, then thousands of
concurrent sessions on congested mobile networks, all asking for the same
one file. That file must come off a CDN edge and must never touch Postgres
or the Hono server. Everything else about this module is detail.

A NOTE ON THE CHOSEN TARGET (raise this before changing it). The decision on
record was "static JSON to the Firebase Hosting CDN we already host on".
Firebase Hosting serves whatever is in `apps/web/dist`, which is published by
a full site deploy -- so a puzzle emitted at 05:00 could not reach users
without either running a web build and deploy every morning, or standing up a
second Hosting site with its own credentials and a new `connect-src` entry in
the CSP. Supabase Storage's public CDN needs neither: the crons already carry
the pipeline's existing service-role env var, and `firebase.json` already
allows `https://*.supabase.co` in connect-src. So `supabase_storage` is the
default here and `local_dir` exists for tests and dry runs. If you want the
Firebase path anyway, add a third Publisher below -- the emit CLI selects by
name and nothing else in the package knows the difference.
"""
import hashlib
import json
import os
from abc import ABC, abstractmethod
from typing import Optional

import requests

DEFAULT_BUCKET = "game-day-artifacts"

# Ten minutes, not a year. A dated artifact is immutable in principle, but
# `immutable, max-age=31536000` would make a bad puzzle unfixable for a year,
# and the burst is absorbed at the CDN edge either way -- the cache that
# matters here is the shared one, not each phone's.
CACHE_CONTROL = "public, max-age=600"


def artifact_path(game: str, puzzle_date: str, schema_version: int) -> str:
  """`gameday/v1/daily_player/2026-09-06.json`.

  The schema version is in the path so a breaking contract change can be
  rolled out beside the old one rather than on top of it: clients that
  already shipped keep reading v1 while v2 fills up.
  """
  return f"gameday/v{schema_version}/{game}/{puzzle_date}.json"


def serialise(artifact: dict) -> bytes:
  # sort_keys so that re-emitting an unchanged puzzle produces an identical
  # sha256, which is what makes the digest worth logging.
  return json.dumps(artifact, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_of(body: bytes) -> str:
  return hashlib.sha256(body).hexdigest()


class Publisher(ABC):
  @abstractmethod
  def publish(self, path: str, body: bytes) -> str:
    """Write the artifact and return the URL or path it can be read from."""


class LocalDirPublisher(Publisher):
  """Writes to a directory. For tests, dry runs and local play."""

  def __init__(self, root: str):
    self.root = root

  def publish(self, path: str, body: bytes) -> str:
    target = os.path.join(self.root, path)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "wb") as fh:
      fh.write(body)
    return target


class SupabaseStoragePublisher(Publisher):
  """Writes to a public Supabase Storage bucket, which is CDN-fronted."""

  def __init__(
    self,
    supabase_url: Optional[str] = None,
    service_key: Optional[str] = None,
    bucket: str = DEFAULT_BUCKET,
    timeout_seconds: int = 60,
  ):
    self.supabase_url = (supabase_url or os.getenv("VITE_SUPABASE_URL") or "").rstrip("/")
    self.service_key = service_key or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not self.supabase_url or not self.service_key:
      raise RuntimeError(
        "SupabaseStoragePublisher needs VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"
      )
    self.bucket = bucket
    self.timeout = timeout_seconds

  def _headers(self) -> dict:
    return {
      "Authorization": f"Bearer {self.service_key}",
      "apikey": self.service_key,
    }

  def ensure_bucket(self) -> None:
    """Idempotent. A 400 saying the bucket already exists is the success case
    on every run after the first, and treating it as an error would break the
    cron a day after it started working."""
    resp = requests.post(
      f"{self.supabase_url}/storage/v1/bucket",
      headers={**self._headers(), "Content-Type": "application/json"},
      json={
        "id": self.bucket,
        "name": self.bucket,
        "public": True,
        "file_size_limit": 5 * 1024 * 1024,
        "allowed_mime_types": ["application/json"],
      },
      timeout=self.timeout,
    )
    if resp.status_code in (200, 201):
      return
    if resp.status_code in (400, 409) and "exist" in resp.text.lower():
      return
    resp.raise_for_status()

  def publish(self, path: str, body: bytes) -> str:
    resp = requests.post(
      f"{self.supabase_url}/storage/v1/object/{self.bucket}/{path}",
      headers={
        **self._headers(),
        "Content-Type": "application/json",
        "Cache-Control": CACHE_CONTROL,
        # Re-emitting the same date overwrites rather than 409s, so a
        # generator fix can be rolled out the same morning.
        "x-upsert": "true",
      },
      data=body,
      timeout=self.timeout,
    )
    resp.raise_for_status()
    return self.public_url(path)

  def public_url(self, path: str) -> str:
    return f"{self.supabase_url}/storage/v1/object/public/{self.bucket}/{path}"


def make_publisher(target: str, local_root: Optional[str] = None) -> Publisher:
  if target == "local_dir":
    if not local_root:
      raise ValueError("local_dir publishing needs --out")
    return LocalDirPublisher(local_root)
  if target == "supabase_storage":
    publisher = SupabaseStoragePublisher()
    publisher.ensure_bucket()
    return publisher
  raise ValueError(f"Unknown publish target: {target}")
