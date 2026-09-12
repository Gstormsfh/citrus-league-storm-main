"""Verify canonical review PDFs independently of generation geometry and caches.

python verify_canonical_pdf.py draft.pdf --data draft-data.json
Alternatively --canonical canonical.json rebuilds adapter data in memory, using
--editorial (defaults to workbook-data.json). No source or PDF writes occur.
"""
import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path

import pymupdf as fitz
from import_canonical import convert
from scoring import calculate
from verify_pdf import norm, fmt, row_text

ROOT = Path(__file__).resolve().parent


def verify(path, data):
    manifest = json.loads(path.with_suffix('.manifest.json').read_text())
    doc = fitz.open(path)
    revision = data['canonicalRevision']
    assert manifest['source']['canonicalRevision'] == revision, 'Canonical revision mismatch'
    assert manifest['canonicalRevision'] == revision
    edition = data.get('edition') or {}
    effective = edition.get('kind') == 'effective_runtime'
    if effective:
        assert manifest['edition'] == edition, 'Runtime edition identity mismatch'
        assert edition['horizon'] == 'remaining_season'
        for key in ('parentSourceRevision', 'runtimeRevision', 'runtimeRunId', 'asOf'):
            assert isinstance(edition.get(key), str) and edition[key].strip(), ('missing edition field', key)
        assert manifest['publication'] == data.get('publication'), 'Export publication metadata mismatch'
    else:
        assert manifest['publication']['status'] == 'draft'
        assert manifest['publication']['publicationReady'] is False
    identity = manifest['scoringIdentity']
    expected_hash = sha256(json.dumps(manifest['weights'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    assert identity['weightsSha256'] == expected_hash, 'Scoring fingerprint mismatch'
    assert identity['label'] == manifest['league'], 'Scoring label mismatch'
    assert identity['kind'] == 'explicit_local_preview'
    scored = calculate(data, manifest['weights'])['players']
    players = {p['key']: p for p in scored}
    projected = {k: p for k, p in players.items() if p['rank'] is not None}
    unavailable = {k: p for k, p in players.items() if p['rank'] is None}
    assert len(doc) == manifest['pages']
    # Independently derive fantasy totals directly from canonical per-exposure rates.
    for p in scored:
        assert p['adjustedPoints'] is None, ('probability must remain metadata', p['key'])
        if p['key'] in unavailable:
            assert p['fantasyPoints'] is None and p['positionRank'] is None
            continue
        weights = manifest['weights']['goalie' if p['isGoalie'] else 'skater']
        expected = sum(p['canonicalRates'].get(k, 0) * weight for k, weight in weights.items()) * p['games']
        assert abs(p['fantasyPoints'] - expected) < 1e-7, ('canonical rate/exposure score', p['key'])
    main = []; positions = []; team_entries = {}; row_count = 0
    for item in manifest['content']:
        page = doc[item['page'] - 1]
        if item['type'] == 'ranking':
            assert manifest['league'] in norm(page.get_text()), ('league identity on board', item['page'])
            for key in item['keys']:
                assert key in projected, ('unavailable player ranked', key)
                p = projected[key]
                text, _ = row_text(page, p['name'], 195, 196 + len(item['keys']) * 18)
                prefix = norm(' '.join([str(p['rank']), p['name'], str(p['team']), p['position'] + str(p['positionRank']),
                                        fmt(p['games'], 0), fmt(p['pointsPerGame'], 2), fmt(p['fantasyPoints'])]))
                assert text.startswith(prefix + ' '), ('PDF league score/rank', item['page'], key, text, prefix)
                row_count += 1
            (main if item['title'] in ('THE SKATER BOARD', 'GOALTENDERS') else positions).extend(item['keys'])
        elif item['type'] == 'team':
            team_entries.setdefault(item['team'], []).append(item)
    assert Counter(main) == Counter(projected.keys()), 'Ranked main-board coverage'
    assert Counter(positions) == Counter(p['key'] for p in projected.values() if not p['isGoalie']), 'Position coverage'
    text = norm('\n'.join(page.get_text() for page in doc))
    review_pages = [norm(p.get_text()) for p in doc if 'FORECASTS TO REVIEW' in p.get_text()]
    review_text = ' '.join(review_pages)
    for p in unavailable.values():
        assert p['name'] in review_text, ('unavailable player absent from review appendix', p['name'])
        expected = f"{p['name']} / {p['team']} / {p['position']}"
        assert norm(expected) in review_text, ('unavailable identity', p['key'])
    assert 'FPTS and rank unavailable' in review_text
    # Stable-ID team keys must equal canonical slots in source order, even when
    # imported names are outdated or unresolved names resemble real players.
    slot_count = 0
    assert set(team_entries) == {t['team'] for t in data['teams']}
    for team in data['teams']:
        entries = team_entries[team['team']]
        expected = [s['key'] or 'missing:' + str(s.get('imported_name')) for s in team['lineupSlots']]
        actual = [k for item in entries for k in item['keys']]
        assert actual == expected, ('team ID mapping', team['team'])
        offset = 0
        for item in entries:
            page = doc[item['page'] - 1]
            words = page.get_text('words')
            ys = sorted({round(w[1], 1) for w in words if 210 < w[1] < 708 and 87 < w[0] < 245})
            actual_rows = [norm(page.get_text(clip=fitz.Rect(35, y - 1, 578, y + 13), sort=True)) for y in ys]
            slots = team['lineupSlots'][offset:offset + len(item['keys'])]
            assert len(actual_rows) == len(slots), ('team row count', team['team'])
            for slot, actual_row in zip(slots, actual_rows):
                p = players.get(slot['key'])
                goalie = p['isGoalie'] if p else slot['position'] == 'G'
                rank = '-' if not p or p['rank'] is None else str(p['rank'])
                values = [slot.get('slot') or '', p['name'] if p else slot['name'], slot['position'],
                          rank + (' G' if goalie else ''), fmt(p['games'], 0) if p else '-',
                          fmt(p['fantasyPoints']) if p else '-', (p['source'] or '-') if p else 'UNRESOLVED',
                          (p['line'] or '-') if p else '-', (p['powerPlay'] or '-') if p else '-']
                assert actual_row == norm(' '.join(values)), ('team rendered score/ID', team['team'], values, actual_row)
            offset += len(slots); slot_count += len(slots)
    if effective:
        stamp = ('RUNTIME ' + edition['runtimeRevision'][:12] + ' / SOURCE ' + edition['parentSourceRevision'][:12]
                 + ' / AS OF ' + edition['asOf'][:10] + ' / REMAINING SEASON')
        assert 'EFFECTIVE RUNTIME / REMAINING SEASON' in norm(doc[0].get_text()), 'Runtime cover label missing'
        for label, key in [('Parent source revision:', 'parentSourceRevision'), ('Runtime revision:', 'runtimeRevision'),
                           ('Runtime run ID:', 'runtimeRunId'), ('As of:', 'asOf'), ('Horizon:', 'horizon')]:
            assert norm(label + ' ' + edition[key]) in text, ('missing full runtime metadata', key)
        assert 'not an activated production projection run' not in text, 'Stale local-draft/runtime-inactive claim'
        assert 'Parent source full-season exposure' in text, 'Source/runtime exposure distinction missing'
        for item in manifest['content']:
            if item['type'] == 'ranking':
                assert 'Remaining-season totals' in norm(doc[item['page'] - 1].get_text()), ('runtime horizon label', item['page'])
    else:
        stamp = 'DRAFT / CANONICAL ' + revision[:16] + ' / LOCAL SCORING PREVIEW'
    for page in doc:
        footer = norm(page.get_text(clip=fitz.Rect(0, 735, 612, 754)))
        assert stamp in footer, ('missing draft/revision footer', page.number + 1)
        # Text extraction can see an old stamp underneath an opaque overlay.
        # Require rendered orange pixels at its actual baseline region as well.
        pix = page.get_pixmap(clip=fitz.Rect(145, 740, 470, 751), alpha=False)
        pixels = pix.samples
        orange = sum(1 for i in range(0, len(pixels), pix.n)
                     if pixels[i] > 180 and 45 < pixels[i + 1] < 175 and pixels[i + 2] < 100)
        assert orange > 20, ('draft footer obscured in rendered PDF', page.number + 1, orange)
        assert '\ufffd' not in page.get_text(), ('missing glyph', page.number + 1)
        for w in page.get_text('words'):
            assert w[0] >= -1 and w[1] >= -1 and w[2] <= 613 and w[3] <= 793, ('off-page text', page.number + 1, w)
    assert len(doc.get_toc()) == len(doc)
    assert sorted(l['page'] + 1 for l in doc[1].get_links()) == sorted(s[1] for s in manifest['sections'])
    print(f'PASS: {len(doc)} {'effective-runtime' if effective else 'draft'} pages / {len(projected)} ranked + {len(unavailable)} unavailable; '
          f'{row_count} league-score rows; {len(team_entries)} teams / {slot_count} stable-ID slots; '
          f'revision {revision[:16]}; scoring {expected_hash[:16]}; visible stamps, navigation and bounds.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--data', type=Path)
    group.add_argument('--canonical', type=Path)
    parser.add_argument('--editorial', type=Path, default=ROOT / 'workbook-data.json')
    args = parser.parse_args()
    if args.data:
        data = json.loads(args.data.read_text())
    else:
        canonical = json.loads(args.canonical.read_text())
        data = convert(canonical, json.loads(args.editorial.read_text()), canonical['revision'])
    verify(args.pdf, data)


if __name__ == '__main__':
    main()
