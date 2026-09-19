"""Customer downloads from the same verified, full-season Citrus board.

No second ranking engine, inferred ADP, or changed numerical projections.
"""
import argparse
import csv
import hashlib
import io
import json
import math
from pathlib import Path

import pymupdf as fitz
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from layout import ASSETS, INK, ORANGE, MUTED, RULE, pdfmetrics
from customer_data import clean, raw_totals, top_players, verify_snapshot, require_preseason_horizon
from scoring import calculate

STAT_COLUMNS = [
    ('goals', 'Projected goals'), ('assists', 'Projected assists'),
    ('shots_on_goal', 'Projected shots on goal'), ('power_play_points', 'Projected power-play points'),
    ('hits', 'Projected hits'), ('blocks', 'Projected blocks'),
    ('penalty_minutes', 'Projected penalty minutes'), ('short_handed_points', 'Projected short-handed points'),
    ('plus_minus', 'Projected plus/minus'), ('wins', 'Projected wins'),
    ('saves', 'Projected saves'), ('goals_against', 'Projected goals against'), ('shutouts', 'Projected shutouts'),
]


def select_board(data, weights, *, source_root=None):
    require_preseason_horizon(data)
    verify_snapshot(data,source_root=source_root)
    result = calculate(data, weights)
    players = top_players(result)
    if len(players) != 300 or len({p['key'] for p in players}) != 300:
        raise ValueError('Downloads require exactly 300 distinct scorable players.')
    return players, result['weights']


def safe_cell(value):
    """Protect spreadsheet imports without turning negative numeric totals into text."""
    if value is None:
        return ''
    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            raise ValueError('A CSV numeric value is not finite.')
        return value
    text = str(value)
    if text.lstrip().startswith(('=', '+', '-', '@')) or text.startswith(('\t', '\r', '\n')):
        return "'" + text
    return text


def rankings_csv(data, weights, league, *, source_root=None):
    players, weights = select_board(data, weights,source_root=source_root)
    output = io.StringIO(newline='')
    writer = csv.writer(output)
    writer.writerow(['Drafted', 'Overall rank', 'NHL player ID', 'Player', 'Team', 'Position',
                     'Projected fantasy points', 'Projected games', 'Projected goalie starts',
                     *[label for _, label in STAT_COLUMNS], 'League', 'Projection date',
                     'Projection revision', 'Scoring weights JSON'])
    scoring = json.dumps(weights, sort_keys=True, separators=(',', ':'))
    for p in players:
        totals = raw_totals(p)
        row = ['', p['overallRank'], str(p['playerId']), p['name'], p['team'], p['position'],
               p['fantasyPoints'], None if p['isGoalie'] else p['games'], p['games'] if p['isGoalie'] else None,
               *[totals.get(key) for key, _ in STAT_COLUMNS], clean(league), data['source']['asOf'][:10],
               data['canonicalRevision'], scoring]
        writer.writerow([safe_cell(v) for v in row])
    # Excel recognizes the UTF-8 BOM. Blank stats mean unavailable/not applicable, never fabricated zeros.
    return ('\ufeff' + output.getvalue()).encode('utf-8')


def cheat_sheet(data, weights, league, *, source_root=None):
    """Four landscape sheets: 75 names each, with a single unambiguous points column."""
    players, weights = select_board(data, weights,source_root=source_root)
    output = io.BytesIO()
    c = canvas.Canvas(output, pagesize=(792, 612))
    c.setTitle('Citrus Draft-Day Cheat Sheet | ' + clean(league))
    c.setAuthor('Citrus Fantasy Sports')
    def text(value, x, y, size=9, font='Body', color=INK, right=False):
        c.setFillColor(HexColor(color)); c.setFont(font, size)
        (c.drawRightString if right else c.drawString)(x, 612-y, str(value))
    def rect(x, y, w, h, color):
        c.setFillColor(HexColor(color)); c.rect(x, 612-y-h, w, h, fill=1, stroke=0)
    for sheet in range(4):
        text('CITRUS / 2026-27', 28, 25, 8, 'Bold', MUTED)
        text('DRAFT-DAY CHEAT SHEET', 28, 61, 32, 'Display')
        title = clean(league)
        text(title, 28, 81, min(11, 510/max(pdfmetrics.stringWidth(title, 'Semi', 1), 1)), 'Semi')
        text('Your scoring. Combined ranks. Tick names as they go.', 28, 99, 9, color=MUTED)
        # A licensed editorial image, not a substitute portrait for any ranked player.
        c.drawImage(str(ASSETS/'mcdavid.jpg'), 650, 524, width=114, height=76)
        text(f'SHEET {sheet+1} / 4', 764, 103, 8, 'Bold', MUTED, True)
        chunk = players[sheet*75:(sheet+1)*75]
        for col in range(3):
            x = 28+col*250
            rect(x, 115, 236, 20, INK)
            for label, dx in [('#', 17), ('PLAYER', 37), ('TM', 155), ('POS', 177)]:
                text(label, x+dx, 129, 7.5, 'Bold', '#FFFFFF')
            text('FPTS', x+230, 129, 7.5, 'Bold', '#FFFFFF', True)
            for row, p in enumerate(chunk[col*25:(col+1)*25]):
                y = 135+row*15
                if row % 2 == 0: rect(x, y, 236, 15, '#F1F3EE')
                c.setStrokeColor(HexColor(MUTED)); c.setLineWidth(.5)
                c.rect(x+3, 612-y-11, 7, 7, fill=0, stroke=1)
                text(p['overallRank'], x+32, y+11, 8, color=MUTED, right=True)
                name_size = min(9, 113/max(pdfmetrics.stringWidth(p['name'], 'Semi', 1), 1))
                text(p['name'], x+37, y+11, name_size, 'Semi')
                text(p['team'], x+155, y+11, 7.6)
                text(p['position'], x+177, y+11, 7.6)
                text(f"{p['fantasyPoints']:.1f}", x+230, y+11, 8.5, 'Bold', right=True)
        text('NEXT PICKS / NOTES', 28, 530, 8, 'Bold', MUTED)
        rect(128, 533, 636, .5, RULE)
        text('FPTS = projected fantasy points in your settings. Not ADP, auction value or category-league value.', 28, 551, 8, color=MUTED)
        text(f"Projection date: {data['source']['asOf'][:10]} / Full scoring weights are in your kit and CSV.", 28, 564, 8, color=MUTED)
        text('McDavid: Brian Murphy / All-Pro Reels. CC BY-SA 2.0. Resized; photographic adaptation retains that licence.', 28, 578, 7, color=MUTED)
        c.linkURL('https://commons.wikimedia.org/wiki/File:Connor_McDavid_of_the_Edmonton_Oilers.jpg', (28, 29, 550, 42), relative=0)
        c.linkURL('https://creativecommons.org/licenses/by-sa/2.0/', (650, 524, 764, 600), relative=0)
        text('CitrusFantasySports.com', 764, 596, 8, 'Bold', right=True)
        c.showPage()
    c.save()
    return output.getvalue()


def sample_kit(source, destination):
    """Extract real guide pages, not a separate sample with different editorial claims."""
    source, destination = Path(source), Path(destination)
    manifest = json.loads(source.with_suffix('.manifest.json').read_text())
    content = manifest['content']
    selected = [1]
    for kind in ('strategy', 'ranking', 'profile', 'team', 'movers', 'credits'):
        matches = [r for r in content if r.get('type') == kind]
        if not matches: raise ValueError('Sample source missing section: '+kind)
        selected.append(matches[0]['page'])
    with fitz.open(source) as full:
        sample = fitz.open()
        for page_number in selected:
            sample.insert_pdf(full, from_page=page_number-1, to_page=page_number-1, links=False)
            page = sample[-1]
            # Keep source/licence links, not broken links into omitted guide pages.
            for link in full[page_number-1].get_links():
                if link.get('kind') == fitz.LINK_URI:
                    page.insert_link({k:link[k] for k in ('kind', 'from', 'uri')})
            page.insert_text((237, 13), 'SAMPLE / SELECTED PAGES', fontsize=7, color=(.82,.25,.04))
        sample.set_metadata({'title':'Citrus Draft Kit | Sample pages', 'author':'Citrus Fantasy Sports'})
        destination.parent.mkdir(parents=True, exist_ok=True)
        sample.save(destination, garbage=4, deflate=True)
    receipt = {'kind':'sample', 'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
               'canonicalRevision':manifest['canonicalRevision'], 'sourcePages':selected,
               'league':manifest['league'], 'weights':manifest['weights'],
               'projectionDate':manifest['source']['asOf'][:10],
               'fullGuidePages':manifest['pages'],
               'selectedPlayerReads':sum(r.get('type')=='profile' for r in content)}
    destination.with_suffix('.manifest.json').write_text(json.dumps(receipt, indent=2)+'\n')
    return receipt

def publish_sample(source,public_dir):
    """Refresh preview pages and their provenance together from the reviewed PDF."""
    from PIL import Image
    public_dir=Path(public_dir);public_dir.mkdir(parents=True,exist_ok=True)
    receipt=sample_kit(source,public_dir/'sample.pdf')
    with fitz.open(public_dir/'sample.pdf') as sample:
        for name,index in [('strategy',1),('player',3),('team',4)]:
            pix=sample[index].get_pixmap(matrix=fitz.Matrix(1,1),alpha=False)
            Image.frombytes('RGB',(pix.width,pix.height),pix.samples).save(public_dir/f'sample-{name}.webp',quality=88)
    (public_dir/'sample-info.json').write_text(json.dumps(receipt,indent=2)+'\n')
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', type=Path, required=True)
    parser.add_argument('--settings', type=Path)
    parser.add_argument('--league', default='Citrus points league')
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--sample-source', type=Path)
    parser.add_argument('--public-dir', type=Path)
    args = parser.parse_args()
    data = json.loads(args.data.read_text())
    weights = json.loads(args.settings.read_text()) if args.settings else data['weights']
    weights = weights.get('weights', weights)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir/'Citrus-Draft-Rankings.csv').write_bytes(rankings_csv(data, weights, args.league))
    (args.output_dir/'Citrus-Draft-Cheat-Sheet.pdf').write_bytes(cheat_sheet(data, weights, args.league))
    if args.sample_source:
        print(sample_kit(args.sample_source, args.output_dir/'Citrus-Draft-Kit-Sample.pdf'))
        if args.public_dir:
            publish_sample(args.sample_source,args.public_dir)
