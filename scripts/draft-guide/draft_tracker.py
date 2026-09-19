"""Print-friendly, native PDF form over the existing custom Citrus top 300."""
import argparse
import hashlib
import io
import json
from pathlib import Path

from reportlab.lib.colors import HexColor
from layout import Guide, INK, MUTED, ORANGE, WHITE, pdfmetrics
from customer_data import clean, top_players, verify_snapshot, require_preseason_horizon
from scoring import calculate


def checkbox_name(player):
    return 'drafted_' + str(player['playerId'])


def tracker_bytes(players, league, as_of):
    if len(players) != 300 or len({p['key'] for p in players}) != 300:
        raise ValueError('The checklist requires exactly 300 distinct ranked players.')
    if [p['overallRank'] for p in players] != list(range(1, 301)):
        raise ValueError('Checklist order must match the combined custom ranking.')
    if len({checkbox_name(p) for p in players}) != 300:
        raise ValueError('Checklist player IDs must be unique.')
    g = Guide()
    g.c.setTitle('Citrus Draft-Day Checklist | ' + clean(league))
    records = []
    for sheet in range(6):
        g.number += 1
        chunk = players[sheet * 50:(sheet + 1) * 50]
        g.rect(0, 0, 612, 792, WHITE)
        g.text('CITRUS / DRAFT KIT 2026-27', 36, 29, 8, 'Semi', MUTED)
        g.text(f'SHEET {sheet + 1} OF 6', 576, 29, 8, 'Semi', MUTED, 'right')
        g.line(36, 40, 540)
        g.rect(36, 59, 4, 39, ORANGE)
        g.text('DRAFT-DAY CHECKLIST', 49, 94, 39, 'Display')
        name = clean(league)
        size = min(12, 425 / max(pdfmetrics.stringWidth(name, 'Semi', 1), 1))
        g.text(name, 36, 119, size, 'Semi')
        g.text(f'RANKS {chunk[0]["overallRank"]}-{chunk[-1]["overallRank"]}', 576, 119, 10, 'Bold', INK, 'right')
        g.text('Tick each player as they are drafted. The order follows your custom league scoring.', 36, 139, 10, 'Body', MUTED)
        g.text('On screen: open in a PDF reader and save your copy. On paper: print these six sheets.', 36, 154, 10, 'Body', MUTED)
        for column in range(2):
            x = 36 + column * 280
            g.text('PICKED', x, 177, 6.5, 'Bold', MUTED)
            g.text('#', x + 24, 177, 7.5, 'Bold', MUTED)
            g.text('PLAYER', x + 45, 177, 7.5, 'Bold', MUTED)
            g.text('TEAM', x + 194, 177, 7.5, 'Bold', MUTED)
            g.text('POS', x + 233, 177, 7.5, 'Bold', MUTED)
            g.line(x, 184, 260, INK)
            for row, p in enumerate(chunk[column * 25:(column + 1) * 25]):
                y = 186 + row * 19
                g.c.acroForm.checkbox(
                    name=checkbox_name(p), tooltip=f"Drafted: #{p['overallRank']} {p['name']}",
                    x=x + 1, y=792 - y - 15, size=11, checked=False,
                    borderWidth=.65, borderColor=HexColor(INK), fillColor=HexColor(WHITE),
                    textColor=HexColor(INK), annotationFlags='print', fieldFlags='', forceBorder=True)
                g.text(str(p['overallRank']), x + 36, y + 13, 9, 'Body', MUTED, 'right')
                size = min(10.5, 143 / max(pdfmetrics.stringWidth(p['name'], 'Semi', 1), 1))
                g.text(p['name'], x + 45, y + 13, size, 'Semi')
                g.text(p['team'], x + 194, y + 13, 9, 'Body', MUTED)
                g.text(p['position'], x + 233, y + 13, 9, 'Body', MUTED)
                g.line(x, y + 19, 260, '#E4E8E2')
        g.text('YOUR NEXT PICKS / NOTES', 36, 681, 9, 'Bold')
        g.c.acroForm.textfield(
            name=f'tracker_notes_{sheet+1:02}', tooltip=f'Notes for checklist sheet {sheet+1}',
            x=36, y=792-738, width=540, height=47, fontName='Helvetica', fontSize=10,
            borderWidth=.65, borderColor=HexColor('#B0BBB1'), fillColor=HexColor(WHITE),
            textColor=HexColor(INK), annotationFlags='print', fieldFlags='multiline',
            maxlen=250, forceBorder=True)
        g.line(36, 752, 540)
        g.text('CitrusFantasySports.com', 36, 770, 9, 'Semi')
        g.text(f'PROJECTIONS: {as_of[:10]} / REVIEW', 576, 770, 7.5, 'Body', MUTED, 'right')
        records.append(dict(page=sheet+1, section='Draft-day checklist', type='draft-tracker',
                            keys=[p['key'] for p in chunk],
                            fields=[checkbox_name(p) for p in chunk],
                            notesField=f'tracker_notes_{sheet+1:02}'))
        g.end()
    g.c.save()
    return g.buf.getvalue(), records


def verify_forms(path, players):
    """Require a connected field tree, printable widgets and valid appearances."""
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(path) if isinstance(path, bytes) else path)
    fields = reader.get_fields() or {}
    expected = {checkbox_name(p) for p in players} | {f'tracker_notes_{i:02}' for i in range(1, 7)}
    assert set(fields) == expected, 'Missing, duplicated or unexpected form fields'
    widgets = {}
    for page in reader.pages:
        for ref in page.get('/Annots', []):
            widget = ref.get_object()
            if widget.get('/Subtype') != '/Widget':
                continue
            owner = widget.get('/Parent', ref).get_object()
            name = owner.get('/T')
            assert name not in widgets, 'Duplicate widget name'
            assert name in fields, 'Orphan widget'
            assert owner.indirect_reference == fields[name].indirect_reference, 'Disconnected canonical field'
            value = widget.get('/V', owner.get('/V', ''))
            assert value == fields[name].get('/V', ''), 'Stale widget value'
            assert widget.get('/F', 0) & 4, 'Field does not print'
            appearance = widget['/AP']['/N'].get_object()
            if fields[name]['/FT'] == '/Btn':
                assert widget['/AS'] == value and value in appearance
                assert appearance['/Off'].get_object().get_data()
                assert appearance['/Yes'].get_object().get_data()
            else:
                assert appearance.get_data(), 'Empty text appearance'
            widgets[name] = widget
    assert set(widgets) == expected
    return fields


def generate_tracker(data, weights, league, path, *, source_root=None):
    require_preseason_horizon(data)
    verify_snapshot(data,source_root=source_root)
    result = calculate(data, weights)
    players = top_players(result)
    payload, content = tracker_bytes(players, league, data['source'].get('asOf', 'undated'))
    verify_forms(payload, players)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    manifest = dict(pages=6, source=data['source'], canonicalRevision=data['canonicalRevision'],
                    league=clean(league), weights=result['weights'],
                    scoringSha256=hashlib.sha256(json.dumps(result['weights'], sort_keys=True).encode()).hexdigest(),
                    top300Keys=[p['key'] for p in players], content=content, publicationReady=False)
    path.with_suffix('.manifest.json').write_text(json.dumps(manifest, indent=2))
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', type=Path, required=True)
    parser.add_argument('--settings', type=Path)
    parser.add_argument('--league', default='Citrus points league')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    data = json.loads(args.data.read_text())
    weights = json.loads(args.settings.read_text()) if args.settings else data['weights']
    generate_tracker(data, weights.get('weights', weights), args.league, args.output)
    print('Built 6 printable sheets with 300 clickable checkboxes and 6 notes fields.')
