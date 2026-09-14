"""Turn a reviewed injury table into a canonical_review.py patch.

THE AVAILABILITY REVIEW PROCESS (2026-09-14). Every availability change to the
canonical source document goes through this file, so the record of what a
manager sees on a player card is a CSV row with a URL, not a sentence typed
into JSON at 4pm. The CSV is the review; this script is the transcription.

    python3 data-pipeline/draftkit/availability_patch.py \
        --source tmp/canonical/source-<rev>.json \
        --csv data-pipeline/draftkit/availability/2026-09-14-injury-reconciliation.csv \
        --as-of 2026-09-14 --reviewed-by "Garrett Storms" \
        --reason "Pre-draft injury reconciliation against CBS and Puckpedia" \
        --output tmp/canonical/patch-2026-09-14.json

The CSV columns are player_id, name, team, status, reason, source_url and
secondary_url. The reason is written for a manager: what happened and how
long, in one or two sentences, no caveats. Provenance lives in the source
record, not in the prose.

Guards, in order: every player_id must exist in the source document and its
name and team must match the CSV exactly (a glyph-precise identity check, so
a typo in the id cannot re-label the wrong player); every status must be one
canonical_review accepts; every source_url must be https; no id may repeat.
The review window is derived from the status — a day-to-day designation is
re-checked in 7 days, everything else in 14 — because the camp window moves
and a stale OUT is as wrong as a missing one.
"""
import argparse
import csv
import json
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlparse

STATUSES = {'healthy', 'injured', 'out', 'ir', 'ltir', 'day_to_day', 'suspended', 'unknown'}
REVIEW_DAYS = {'day_to_day': 7, 'healthy': 14, 'unknown': 7}
DEFAULT_REVIEW_DAYS = 14
SOURCE_KIND = 'injury_report'


class PatchError(ValueError):
    pass


def https(url):
    try:
        u = urlparse(url)
    except (TypeError, ValueError):
        return False
    return u.scheme == 'https' and bool(u.hostname) and not u.username and not u.password


def publisher(url):
    return urlparse(url).hostname.removeprefix('www.')


def read_rows(path):
    with open(path, newline='', encoding='utf-8') as handle:
        rows = list(csv.DictReader(handle))
    required = {'player_id', 'name', 'team', 'status', 'reason', 'source_url', 'secondary_url'}
    if not rows or required - set(rows[0]):
        raise PatchError(f'CSV needs columns {sorted(required)}')
    return rows


def build_patch(document, rows, *, as_of, reviewed_by, reason, today=None):
    today = today or date.today()
    observed = date.fromisoformat(as_of)
    if observed > today:
        raise PatchError('as_of cannot be in the future')
    players = {p['player_id']: p for p in document['players']}
    seen, updates, evidence = set(), [], []
    for index, row in enumerate(rows, start=2):
        pid = row['player_id'].strip()
        if pid in seen:
            raise PatchError(f'line {index}: duplicate player_id {pid}')
        seen.add(pid)
        player = players.get(pid)
        if player is None:
            raise PatchError(f'line {index}: {pid} is not in the canonical document')
        if player['name'] != row['name'].strip() or player['team'] != row['team'].strip():
            raise PatchError(f"line {index}: {pid} is {player['name']} ({player['team']}) in the document, "
                             f"not {row['name']} ({row['team']})")
        status = row['status'].strip()
        if status not in STATUSES:
            raise PatchError(f'line {index}: {pid} has unsupported status {status!r}')
        text = ' '.join(row['reason'].split())
        if not text:
            raise PatchError(f'line {index}: {pid} needs a reason')
        url = row['source_url'].strip()
        if not https(url):
            raise PatchError(f'line {index}: {pid} source_url must be https')
        secondary = row['secondary_url'].strip() or None
        if secondary and not https(secondary):
            raise PatchError(f'line {index}: {pid} secondary_url must be https')
        for u in (url, secondary):
            if u and u not in evidence:
                evidence.append(u)
        review_after = observed + timedelta(days=REVIEW_DAYS.get(status, DEFAULT_REVIEW_DAYS))
        source = {
            'kind': SOURCE_KIND,
            'url': url,
            'publisher': publisher(url),
            'source_date': as_of,
            'reviewed_at': as_of,
            'reviewed_by': reviewed_by,
            'review_policy': 'Operational freshness deadline, not a predicted recovery date.',
        }
        if secondary:
            source['secondary_url'] = secondary
        updates.append({'player_id': pid, 'changes': {'availability': {
            'status': status, 'as_of': as_of, 'reason': text, 'source': source,
            'return_window': None, 'review_after': review_after.isoformat(), 'authority': 'reviewed_report',
        }}})
    if not updates:
        raise PatchError('CSV has no rows')
    return {'base_revision': document['revision'], 'reason': reason, 'evidence': evidence,
            'player_updates': updates, 'team_updates': []}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--source', type=Path, required=True, help='exported canonical source document')
    parser.add_argument('--csv', type=Path, required=True)
    parser.add_argument('--as-of', required=True, help='YYYY-MM-DD the reports were read')
    parser.add_argument('--reviewed-by', required=True)
    parser.add_argument('--reason', required=True, help='one line for review_history')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    document = json.loads(args.source.read_text())
    patch = build_patch(document, read_rows(args.csv), as_of=args.as_of, reviewed_by=args.reviewed_by, reason=args.reason)
    with open(args.output, 'x', encoding='utf-8') as handle:
        handle.write(json.dumps(patch, indent=2, sort_keys=True) + '\n')
    print(json.dumps({'output': str(args.output.resolve()), 'base_revision': patch['base_revision'],
                      'players': len(patch['player_updates']), 'evidence': len(patch['evidence'])}))


if __name__ == '__main__':
    main()
