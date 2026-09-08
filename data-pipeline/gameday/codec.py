"""Answer obfuscation — the Python twin of `packages/shared/src/utils/gameDay.ts`.

NOT ENCRYPTION, and nothing here should ever be treated as though it were.
A puzzle the browser grades offline is a puzzle the browser can spoil; this
only stops the answer being legible to an idle glance at devtools. Grading
offline is what keeps thousands of concurrent phones off our servers.

The two implementations must agree byte for byte. They are pinned against a
shared vector by `data-pipeline/tests/test_gameday_codec.py` and
`packages/shared/src/utils/__tests__/gameDay.test.ts`; a drift means every
client renders a puzzle whose answer will not decode.
"""
import base64
import json
from typing import Any, Callable

_UINT32 = 0xFFFFFFFF
_FNV_OFFSET = 0x811C9DC5
_FNV_PRIME = 0x01000193


def fnv1a32(text: str) -> int:
  """FNV-1a over the low byte of each UTF-16 code unit, as JS charCodeAt does."""
  h = _FNV_OFFSET
  for ch in text:
    h ^= ord(ch) & 0xFF
    h = (h * _FNV_PRIME) & _UINT32
  return h


def xorshift32(seed_text: str) -> Callable[[], int]:
  """A full-width xorshift32 stream seeded from a string.

  Shared by the obfuscation keystream below and by every generator's puzzle
  selection, so that "deterministic given the puzzle date" means the same
  thing everywhere and re-running any date reproduces that date exactly.
  Seed 0 is the generator's fixed point, so it is replaced.
  """
  state = fnv1a32(seed_text) or 0x9E3779B9

  def nxt() -> int:
    nonlocal state
    state ^= (state << 13) & _UINT32
    state &= _UINT32
    state ^= state >> 17
    state ^= (state << 5) & _UINT32
    state &= _UINT32
    return state

  return nxt


def _make_keystream(seed_text: str) -> Callable[[], int]:
  stream = xorshift32(seed_text)
  return lambda: stream() & 0xFF


def seeded_shuffle(items: list, seed_text: str) -> list:
  """Fisher-Yates driven by `xorshift32`. Returns a new list, so a caller can
  shuffle the same candidate list under several seeds without inheriting an
  order it did not ask for."""
  out = list(items)
  nxt = xorshift32(seed_text)
  for i in range(len(out) - 1, 0, -1):
    j = nxt() % (i + 1)
    out[i], out[j] = out[j], out[i]
  return out


def encode_answer(answer: Any, puzzle_id: str) -> str:
  # separators must match JSON.stringify's compact output, or the two sides
  # produce different ciphertext for the same object.
  plain = json.dumps(answer, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
  nxt = _make_keystream(puzzle_id)
  cipher = bytes(b ^ nxt() for b in plain)
  return base64.b64encode(cipher).decode("ascii")


def decode_answer(encoded: str, puzzle_id: str) -> Any:
  cipher = base64.b64decode(encoded)
  nxt = _make_keystream(puzzle_id)
  plain = bytes(b ^ nxt() for b in cipher)
  return json.loads(plain.decode("utf-8"))
