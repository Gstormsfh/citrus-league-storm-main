"""Preserve PostgreSQL numeric JSON across reviewed operator file/SQL boundaries.
Never serialize a parsed float back into an expected payload or revision preimage.
"""
from decimal import Decimal
from hashlib import sha256
import json
from pathlib import Path
from uuid import uuid4


def sql_json_literal(path: Path) -> str:
    raw = path.read_text(encoding='utf-8')
    json.loads(raw, parse_float=Decimal)  # Validate shape without changing text.
    delimiter = '$raw_json_' + uuid4().hex + '$'
    assert delimiter not in raw
    return delimiter + raw + delimiter + '::jsonb'


def verify_postgres_revision(payload_path: Path, preimage_path: Path, revision: str) -> None:
    raw = preimage_path.read_bytes()
    if sha256(raw).hexdigest() != revision:
        raise ValueError('PostgreSQL revision preimage hash mismatch')
    payload = json.loads(payload_path.read_text(encoding='utf-8'), parse_float=Decimal)
    preimage = json.loads(raw, parse_float=Decimal)
    if payload.get('revision') != revision or {k: v for k, v in payload.items() if k != 'revision'} != preimage:
        raise ValueError('Payload differs from exact PostgreSQL revision preimage')
