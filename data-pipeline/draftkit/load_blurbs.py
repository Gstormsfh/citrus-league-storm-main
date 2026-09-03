#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose:     Validate and publish hand-written Draft Kit blurbs from Markdown files
# Last active: 2026-09-02
# Invoked:     manual — `python data-pipeline/draftkit/load_blurbs.py [--apply]`
# Reads:       data-pipeline/draftkit/blurbs/**/*.md, player_directory
# Writes:      draft_kit_blurbs (service role; dry-run unless --apply)
# ────────────────────────────────────────────────────────────
"""
load_blurbs.py — get the written half of the Draft Kit out of a text editor
and into the database, without anyone typing SQL or a player id.

WHY THIS EXISTS
The Draft Kit shipped with real percentile cards and 134 real club changes,
and `draft_kit_blurbs` empty. `author_name` is NOT NULL and nothing generates
these rows on purpose — the pitch is the founder's own read plus sourced
hockey writers, and a machine-written blurb under a real byline would be the
one thing that torches the credibility being sold. So the words have to be
typed by a person. This makes that the only hard part.

THE FILE IS THE ROW
Each `.md` file under `blurbs/` is one blurb. Its id is `uuid5` of its path
relative to that directory, so:

  * re-running updates the row in place — edit the file, run again, done;
  * nothing needs a unique constraint added to the table;
  * renaming a file creates a NEW row and orphans the old one, which this
    script reports (it never deletes — see --prune-sql).

WHAT IT REFUSES TO DO
Every CHECK constraint in the migration is re-implemented here so a mistake
reads as `mcdavid.md:4  tier_required must be free|kit|suite, got 'paid'`
rather than a Postgres 23514 with no filename in it. And a player name that
matches two people is an ERROR, never a guess: publishing analysis under the
wrong player is worse than publishing none.

USAGE
    python data-pipeline/draftkit/load_blurbs.py              # dry run
    python data-pipeline/draftkit/load_blurbs.py --apply      # write
    python data-pipeline/draftkit/load_blurbs.py --prune-sql  # orphan cleanup

EXIT CODES
    0  everything valid (and applied, with --apply)
    1  one or more files failed validation — nothing was written
    2  could not reach the database
"""

from __future__ import annotations

import argparse
import os
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from data_pipeline.utils.supabase_rest import SupabaseRest  # noqa: E402

# ── Vocabulary, mirrored from the migration ─────────────────────────────
# 20260902090000_draft_kit_entitlements_and_blurbs.sql. Kept here so a bad
# value is caught with a filename attached instead of as a constraint
# violation from PostgREST.
KINDS = ('player', 'roster_change', 'tier', 'strategy')
TIERS = ('free', 'kit', 'suite')

BLURB_DIR = Path(__file__).resolve().parent / 'blurbs'

# Stable namespace for file-path → row id. Fixed forever: change it and every
# existing blurb orphans itself on the next run.
NAMESPACE = uuid.UUID('7d1f6b2a-9c34-5e88-b0a1-4f2c6d9e3a57')

TRUE_WORDS = {'true', 'yes', 'y', '1', 'on'}
FALSE_WORDS = {'false', 'no', 'n', '0', 'off', ''}


@dataclass
class Blurb:
    path: Path
    row: Dict[str, Any]
    player_name: Optional[str] = None
    warnings: List[str] = field(default_factory=list)


@dataclass
class Problem:
    path: Path
    line: Optional[int]
    message: str

    def render(self, root: Path) -> str:
        where = self.path.relative_to(root) if self.path.is_relative_to(root) else self.path
        loc = f'{where}:{self.line}' if self.line else str(where)
        return f'  {loc}  {self.message}'


# ── Parsing ─────────────────────────────────────────────────────────────

def split_frontmatter(text: str, path: Path) -> Tuple[Dict[str, Tuple[str, int]], str, List[Problem]]:
    """
    A deliberately small frontmatter reader: `key: value` lines between two
    `---` fences, then the body. No YAML dependency and no nesting, because
    the schema has no nested field and a real YAML parser would accept
    structures this loader would then have to reject anyway.

    Values keep their source line number so an error can point at it.
    """
    problems: List[Problem] = []
    lines = text.splitlines()
    if not lines or lines[0].strip() != '---':
        problems.append(Problem(path, 1, "file must start with a '---' frontmatter fence"))
        return {}, '', problems

    end = None
    for i in range(1, len(lines)):
        if lines[i].strip() == '---':
            end = i
            break
    if end is None:
        problems.append(Problem(path, 1, "frontmatter is never closed with a second '---'"))
        return {}, '', problems

    fields: Dict[str, Tuple[str, int]] = {}
    for i in range(1, end):
        raw = lines[i]
        if not raw.strip() or raw.lstrip().startswith('#'):
            continue
        if ':' not in raw:
            problems.append(Problem(path, i + 1, f'not a "key: value" line: {raw.strip()!r}'))
            continue
        key, _, value = raw.partition(':')
        key = key.strip().lower()
        if key in fields:
            problems.append(Problem(path, i + 1, f'duplicate key {key!r}'))
        fields[key] = (value.strip(), i + 1)

    body = '\n'.join(lines[end + 1:]).strip()
    return fields, body, problems


def as_bool(value: str) -> Optional[bool]:
    v = value.strip().lower()
    if v in TRUE_WORDS:
        return True
    if v in FALSE_WORDS:
        return False
    return None


def build_blurb(path: Path, root: Path, default_season: int) -> Tuple[Optional[Blurb], List[Problem]]:
    text = path.read_text(encoding='utf-8')
    fields, body, problems = split_frontmatter(text, path)
    if problems:
        return None, problems

    def get(key: str) -> Tuple[str, Optional[int]]:
        v, ln = fields.get(key, ('', None))
        return v, ln

    def require(key: str) -> Tuple[str, Optional[int]]:
        v, ln = get(key)
        if not v:
            problems.append(Problem(path, ln, f'{key} is required and cannot be blank'))
        return v, ln

    title, _ = require('title')
    author_name, _ = require('author')

    if not body:
        problems.append(Problem(path, None, 'the body (everything under the closing ---) is empty'))

    season_raw, season_ln = get('season')
    season = default_season
    if season_raw:
        try:
            season = int(season_raw)
        except ValueError:
            problems.append(Problem(path, season_ln, f'season must be a year, got {season_raw!r}'))

    kind, kind_ln = get('kind')
    kind = kind or 'player'
    if kind not in KINDS:
        problems.append(Problem(path, kind_ln, f'kind must be one of {"|".join(KINDS)}, got {kind!r}'))

    tier, tier_ln = get('tier')
    tier = tier or 'kit'
    if tier not in TIERS:
        problems.append(Problem(path, tier_ln, f'tier must be one of {"|".join(TIERS)}, got {tier!r}'))

    source_name, sn_ln = get('source_name')
    source_url, su_ln = get('source_url')
    # The schema's draft_kit_blurbs_source_pair_check, enforced early: a
    # credit with nothing to click, or a link with no credit, is not a state
    # this content is allowed to be in.
    if bool(source_name) != bool(source_url):
        missing = 'source_url' if source_name else 'source_name'
        problems.append(Problem(path, sn_ln or su_ln, f'source_name and source_url travel together — {missing} is missing'))

    publish_raw, publish_ln = get('publish')
    published = as_bool(publish_raw) if publish_raw else False
    if published is None:
        problems.append(Problem(path, publish_ln, f'publish must be true or false, got {publish_raw!r}'))
        published = False

    player_id_raw, pid_ln = get('player_id')
    player_id: Optional[int] = None
    if player_id_raw:
        try:
            player_id = int(player_id_raw)
        except ValueError:
            problems.append(Problem(path, pid_ln, f'player_id must be a number, got {player_id_raw!r}'))

    player_name, _ = get('player')
    if player_name and player_id is not None:
        problems.append(Problem(path, pid_ln, 'set player OR player_id, not both'))
    if kind == 'player' and not player_name and player_id is None:
        problems.append(Problem(path, None, "kind is 'player' but no player or player_id was given"))

    if problems:
        return None, problems

    rel = path.relative_to(root).as_posix()
    now = datetime.now(timezone.utc).isoformat()

    row: Dict[str, Any] = {
        'id': str(uuid.uuid5(NAMESPACE, rel)),
        'player_id': player_id,
        'season': season,
        'kind': kind,
        'title': title,
        'body': body,
        'author_name': author_name,
        'author_role': get('author_role')[0] or None,
        'source_name': source_name or None,
        'source_url': source_url or None,
        'tier_required': tier,
        'is_published': published,
        # draft_kit_blurbs_published_at_check: published rows carry a date.
        # Set once, here, rather than defaulting in the database — a
        # publication timestamp that moves on every re-run is worse than none.
        'published_at': now if published else None,
        'updated_at': now,
    }
    return Blurb(path=path, row=row, player_name=player_name or None), []


# ── Player resolution ───────────────────────────────────────────────────

def resolve_players(db: SupabaseRest, blurbs: List[Blurb], season: int, root: Path) -> List[Problem]:
    """
    Names → ids, from `player_directory`.

    An ambiguous name is an ERROR with every candidate listed, never a
    best guess. Two Sebastian Ahos have played in the same league; attaching
    the founder's read on the centre to the defenceman is the kind of mistake
    that reads as carelessness about the whole product.
    """
    problems: List[Problem] = []
    wanted = [b for b in blurbs if b.player_name]
    if not wanted:
        return problems

    rows = db.select(
        'player_directory',
        select='player_id,full_name,team_abbrev,position_code,season',
        filters=[('season', 'eq', season)],
    )
    by_name: Dict[str, List[dict]] = {}
    for r in rows:
        by_name.setdefault(str(r.get('full_name', '')).strip().lower(), []).append(r)

    for b in wanted:
        key = (b.player_name or '').strip().lower()
        matches = by_name.get(key, [])
        if not matches:
            near = [n for n in by_name if key and (key in n or n in key)]
            hint = f' Did you mean: {", ".join(sorted(near)[:4])}?' if near else ''
            problems.append(Problem(b.path, None, f'no player named {b.player_name!r} in the {season} directory.{hint}'))
        elif len(matches) > 1:
            listed = ', '.join(f"{m['player_id']} ({m.get('team_abbrev')}, {m.get('position_code')})" for m in matches)
            problems.append(Problem(b.path, None, f'{b.player_name!r} matches {len(matches)} players — use player_id. Candidates: {listed}'))
        else:
            b.row['player_id'] = int(matches[0]['player_id'])
    return problems


# ── Reporting ───────────────────────────────────────────────────────────

def summarise(blurbs: List[Blurb], existing_ids: set, root: Path) -> None:
    new = [b for b in blurbs if b.row['id'] not in existing_ids]
    upd = [b for b in blurbs if b.row['id'] in existing_ids]
    pub = [b for b in blurbs if b.row['is_published']]

    print(f'\n  {len(blurbs)} blurb(s): {len(new)} new, {len(upd)} updated, '
          f'{len(pub)} published, {len(blurbs) - len(pub)} draft')
    print()
    for b in sorted(blurbs, key=lambda x: str(x.path)):
        rel = b.path.relative_to(root).as_posix()
        state = 'PUBLISH' if b.row['is_published'] else 'draft  '
        who = b.player_name or (f"player {b.row['player_id']}" if b.row['player_id'] else b.row['kind'])
        print(f'  {state}  {b.row["tier_required"]:<5}  {who:<28}  {b.row["title"][:44]:<44}  {rel}')


def main() -> int:
    ap = argparse.ArgumentParser(description='Validate and publish Draft Kit blurbs.')
    ap.add_argument('--apply', action='store_true', help='write to the database (default is a dry run)')
    ap.add_argument('--season', type=int, default=None, help='default season for files that omit it')
    ap.add_argument('--dir', type=Path, default=BLURB_DIR, help='directory of .md blurbs')
    ap.add_argument('--prune-sql', action='store_true', help='print SQL for rows whose source file is gone')
    args = ap.parse_args()

    root: Path = args.dir.resolve()
    if not root.is_dir():
        print(f'No blurb directory at {root}', file=sys.stderr)
        return 1

    files = sorted(p for p in root.rglob('*.md') if p.name.upper() != 'README.MD' and not p.name.startswith('_'))
    if not files:
        print(f'No .md blurbs under {root}. Copy _TEMPLATE.md to get started.')
        return 0

    try:
        db = SupabaseRest()
    except Exception as exc:  # noqa: BLE001
        print(f'Could not reach Supabase: {exc}', file=sys.stderr)
        return 2

    season = args.season
    if season is None:
        # The season being drafted for: the newest directory we hold.
        dirs = db.select('player_directory', select='season', order='season.desc', limit=1)
        season = int(dirs[0]['season']) if dirs else datetime.now(timezone.utc).year

    blurbs: List[Blurb] = []
    problems: List[Problem] = []
    for path in files:
        blurb, errs = build_blurb(path, root, season)
        problems.extend(errs)
        if blurb:
            blurbs.append(blurb)

    if blurbs:
        problems.extend(resolve_players(db, blurbs, season, root))

    if problems:
        print(f'\n{len(problems)} problem(s) — nothing was written:\n')
        for p in sorted(problems, key=lambda x: (str(x.path), x.line or 0)):
            print(p.render(root))
        print()
        return 1

    existing = db.select('draft_kit_blurbs', select='id')
    existing_ids = {str(r['id']) for r in existing}
    summarise(blurbs, existing_ids, root)

    if args.prune_sql:
        orphans = existing_ids - {b.row['id'] for b in blurbs}
        if orphans:
            ids = ', '.join(f"'{o}'" for o in sorted(orphans))
            print(f'\n  {len(orphans)} row(s) in the table have no file. To remove them:\n')
            print(f'    delete from public.draft_kit_blurbs where id in ({ids});\n')
        else:
            print('\n  No orphaned rows.\n')

    if not args.apply:
        print('\n  Dry run. Re-run with --apply to write.\n')
        return 0

    db.upsert('draft_kit_blurbs', [b.row for b in blurbs], on_conflict='id')
    print(f'\n  Wrote {len(blurbs)} blurb(s).\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
