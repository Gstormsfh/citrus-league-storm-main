"""Check a generated guide against its source snapshot and scoring manifest.

Usage: python verify_pdf.py output/pdf/Citrus-Draft-Kit-2026-27-Complete.pdf
Use --data for a reconciled snapshot and --manifest for a nonstandard manifest.
Checks PDF content and vector row highlights, independently of build.py.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import re

import pymupdf as fitz
from scoring import calculate

ROOT = Path(__file__).resolve().parent


def norm(value):
    return re.sub(r'\s+', ' ', str(value)).strip()


def fmt(value, decimals=1):
    return '-' if value is None else f'{value:,.{decimals}f}'


def row_text(page, name, top, bottom):
    hits = [r for r in page.search_for(str(name)) if top < r.y0 < bottom]
    assert len(hits) == 1, ('row name missing/duplicated', page.number + 1, name, hits)
    rect = hits[0]
    text = norm(page.get_text(clip=fitz.Rect(35, rect.y0 - 1, 578, rect.y1 + 1), sort=True))
    return text, rect


def verify(pdf, data_path, manifest_path):
    data = json.loads(data_path.read_text())
    manifest = json.loads(manifest_path.read_text())
    assert manifest['source']['sha256'] == data['source']['sha256'], 'Manifest/source snapshot mismatch'
    result = calculate(data, manifest['weights'])
    players = {p['key']: p for p in result['players']}
    byname = {p['name']: p for p in result['players']}
    doc = fitz.open(pdf)
    assert len(doc) == manifest['pages'], 'Manifest page count mismatch'
    checked_rows = 0
    main_keys = []
    position_keys = []
    highlighted = []
    team_entries = {}
    rookie_entries = []
    for item in manifest['content']:
        page = doc[item['page'] - 1]
        kind = item['type']
        if kind in ('ranking', 'focus'):
            row_rects = {}
            for key in item['keys']:
                p = players[key]
                actual, rect = row_text(page, p['name'], 195, (196 + len(item['keys']) * 18) if kind == 'ranking' else 225)
                row_rects[key] = rect
                expected = [str(p['rank']), p['name'], p['team'], p['position'] + str(p['positionRank']),
                            fmt(p['games'], 0), fmt(p['pointsPerGame'], 2), fmt(p['fantasyPoints'])]
                if kind == 'ranking':
                    # Independently derive season counts: rate first, volume last.
                    stats = {key: value / p['baseGames'] * p['games'] if p['baseGames'] else 0
                             for key, value in p['stats'].items()}
                    expected += [fmt(stats['wins'] if p['isGoalie'] else stats['goals'] + stats['assists']),
                                 fmt(stats['saves'] if p['isGoalie'] else stats['shots_on_goal'], 0),
                                 fmt(stats['goals_against'] if p['isGoalie'] else stats['blocks'], 0)]
                expected += [p['source'] or '-']
                assert actual == norm(' '.join(expected)), ('rendered ranking row', item['page'], key, expected, actual)
                checked_rows += 1
            if kind == 'ranking':
                (main_keys if item['title'] in ('THE SKATER BOARD', 'GOALTENDERS') else position_keys).extend(item['keys'])
            # A table-row orange rectangle is distinguishable from accents and bars.
            orange_rows = [d['rect'] for d in page.get_drawings()
                           if d.get('fill') and abs(d['rect'].width - 540) < .2
                           and 10 < d['rect'].height < 23
                           and d['fill'][0] > .8 and .2 < d['fill'][1] < .8 and d['fill'][2] < .3]
            featured = item.get('featured')
            assert len(orange_rows) == (1 if featured else 0), ('orange table rows', item['page'], orange_rows)
            text = page.get_text()
            assert text.count('PLAYER CALL-OUT /') == (1 if featured else 0), ('callout count', item['page'])
            if featured:
                assert featured in row_rects, ('featured absent from table', item['page'])
                assert orange_rows[0].intersects(row_rects[featured]), ('highlight wrong player', item['page'])
                p = players[featured]
                lower = norm(page.get_text(clip=fitz.Rect(35, orange_rows[0].y1 + 1, 578, 750)))
                assert p['name'].upper() in lower, ('callout name', item['page'], p['name'])
                assert fmt(p['fantasyPoints']) in lower, ('callout score', item['page'], p['name'])
                highlighted.append(p['name'])
        elif kind == 'team':
            team_entries.setdefault(item['team'], []).append(item)
        elif kind == 'rookie':
            rookie_entries.append(item)
        else:
            raise AssertionError(('Unknown manifest content', kind))

    assert Counter(main_keys) == Counter(players.keys()), 'Main board must contain each source player exactly once'
    assert Counter(position_keys) == Counter(p['key'] for p in players.values() if not p['isGoalie']), 'Position board coverage'
    photos = json.loads((ROOT / 'assets/player-photos.json').read_text())
    expected_features = set(photos) & set(byname)
    assert Counter(highlighted) == Counter(expected_features), ('missing/duplicate original player callouts', highlighted)
    assert sorted(highlighted) == manifest['featured'], 'Featured manifest mismatch'

    expected_rookies = []
    for rookie in data['rookies']:
        p = byname.get(rookie['name'])
        key = p['key'] if p else 'rookie:' + str(rookie['sourceRow'])
        expected_rookies.append(key)
        entries = [e for e in rookie_entries if e['key'] == key]
        assert len(entries) == 1, ('rookie manifest', rookie['name'])
        page = doc[entries[0]['page'] - 1]
        text = norm(page.get_text())
        assert rookie['name'].upper() in text, ('rookie name', rookie['name'])
        assert norm(rookie['support']) in text, ('rookie source commentary', rookie['name'])
        if p:
            assert f'{fmt(p["fantasyPoints"])} FPTS' in text, ('rookie score', rookie['name'])
    assert Counter(e['key'] for e in rookie_entries) == Counter(expected_rookies), 'Rookie coverage'

    assert set(team_entries) == {t['team'] for t in data['teams']}, 'Team coverage'
    slot_count = 0
    for team in data['teams']:
        slots = [r for r in team['rawRows'][3:] if len(r) > 2 and r[1] in ('C', 'LW', 'RW', 'D', 'LD', 'RD', 'G')]
        actual_rows = []
        actual_keys = []
        for entry in team_entries[team['team']]:
            page = doc[entry['page'] - 1]
            actual_keys.extend(entry['keys'])
            # Text lines are read by source slot sequence, avoiding false matches in notes.
            words = page.get_text('words')
            ys = sorted({round(w[1], 1) for w in words if 210 < w[1] < 708 and 87 < w[0] < 245})
            for y in ys:
                actual_rows.append(norm(page.get_text(clip=fitz.Rect(35, y - 1, 578, y + 13), sort=True)))
        expected_rows = []
        expected_keys = []
        for row in slots:
            p = byname.get(row[2])
            expected_keys.append(p['key'] if p else 'missing:' + str(row[2]))
            expected_rows.append(norm(' '.join([
                str(row[0] or ''), str(row[2]), str(row[1]),
                str(p['rank']) + (' G' if p['isGoalie'] else '') if p else ('- G' if row[1] == 'G' else '-'),
                fmt(p['games'], 0) if p else '-', fmt(p['fantasyPoints']) if p else '-',
                (p['source'] or '-') if p else 'MISSING', (p['line'] or '-') if p else '-',
                (p['powerPlay'] or '-') if p else '-',
            ])))
        assert actual_keys == expected_keys, ('team manifest slots', team['team'])
        assert actual_rows == expected_rows, ('team rendered rows', team['team'], expected_rows, actual_rows)
        slot_count += len(slots)

    toc = doc.get_toc()
    assert len(toc) == len(doc), 'Every page needs a bookmark'
    assert {e[2] for e in toc} == set(range(1, len(doc) + 1)), 'Bookmark destinations'
    links = doc[1].get_links()
    assert len(links) == len(manifest['sections']), 'Contents link count'
    assert sorted(link['page'] + 1 for link in links) == sorted(s[1] for s in manifest['sections']), 'Contents destinations'
    for page in doc:
        assert page.rect == fitz.Rect(0, 0, 612, 792), ('page size', page.number + 1)
        assert '\ufffd' not in page.get_text(), ('missing glyph', page.number + 1)
        for word in page.get_text('words'):
            assert word[0] >= -1 and word[1] >= -1 and word[2] <= 613 and word[3] <= 793, ('off-page text', page.number + 1, word)
    print(f'PASS: {len(doc)} pages; {len(main_keys)} unique main-board players; '
          f'{checked_rows} ranking rows with exact rendered scores; {len(rookie_entries)} rookies; '
          f'{len(team_entries)} teams / {slot_count} lineup slots; {len(highlighted)} unique matched highlights/callouts; '
          f'{len(toc)} bookmarks / {len(links)} contents links; bounds and glyphs.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    parser.add_argument('--data', type=Path, default=ROOT / 'workbook-data.json')
    parser.add_argument('--manifest', type=Path)
    args = parser.parse_args()
    verify(args.pdf, args.data, args.manifest or args.pdf.with_suffix('.manifest.json'))


if __name__ == '__main__':
    main()
