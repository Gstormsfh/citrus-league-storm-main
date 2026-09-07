"""Retrospective PL on-ice annotations; never continuous shifts or predictors.

Reuse the unchanged vetted header/event-text parser, adding a separate nested
membership parser and bidirectionally unique shot correspondence. No model,
database or network operations. Roster membership is not on-ice membership.
"""
from collections import defaultdict
import hashlib
from html import escape
from html.parser import HTMLParser
import re
from projections.report_feature_source_v2 import parse_report

VERSION = 'citrus-retrospective-pl-onice-v1'
POSITIONS = {'C', 'L', 'R', 'D', 'G'}


class _Outer(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = self.td = 0
        self.row_depth = self.cell_depth = None
        self.rows, self.cells, self.cell = [], [], []

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.depth += 1
            if dict(attrs).get('class') in ('evenColor', 'oddColor'):
                if self.row_depth is not None: raise ValueError('Nested event row')
                self.row_depth, self.cells = self.depth, []
        if tag == 'td':
            self.td += 1
            if self.row_depth == self.depth and self.cell_depth is None:
                self.cell_depth, self.cell = self.td, []
                return
        if self.cell_depth is not None: self.cell.append(self.get_starttag_text())

    def handle_endtag(self, tag):
        outer = tag == 'td' and self.cell_depth == self.td
        if self.cell_depth is not None and not outer: self.cell.append('</' + tag + '>')
        if tag == 'td':
            if outer:
                self.cells.append(''.join(self.cell)); self.cell_depth = None
            self.td -= 1
        if tag == 'tr':
            if self.row_depth == self.depth:
                if len(self.cells) != 8: raise ValueError('Exactly eight event columns required')
                self.rows.append(self.cells); self.row_depth = None
            self.depth -= 1
        if self.depth < 0 or self.td < 0: raise ValueError('Invalid table nesting')

    def handle_data(self, data):
        if self.cell_depth is not None: self.cell.append(escape(data))


class _Players(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.entries, self.texts, self.font, self.errors = [], [], None, []
        self.cell_text, self.table_depth, self.row_depth = [], 0, 0
        self.table_ids, self.next_table_id = [], 0

    def handle_starttag(self, tag, attrs):
        if tag == 'table':
            self.table_depth += 1
            self.next_table_id += 1
            self.table_ids.append(self.next_table_id)
        if tag == 'tr': self.row_depth += 1
        if tag == 'td': self.cell_text.append([])
        if tag == 'font':
            if self.font is not None: self.errors.append('nested_player_font')
            self.font = {'raw_title': dict(attrs).get('title'), 'text': []}

    def handle_data(self, data):
        self.texts.append(data)
        if self.cell_text: self.cell_text[-1].append(data)
        if self.font is not None: self.font['text'].append(data)

    def handle_endtag(self, tag):
        if tag == 'font':
            if self.font is None:
                self.errors.append('unmatched_player_font'); return
            text = ''.join(self.font.pop('text')).strip()
            entry = {**self.font, 'raw_sweater': text, 'sweater_number': int(text) if re.fullmatch(r'[0-9]{1,2}', text) else None,
                     'recorded_position': None, '_table_depth': self.table_ids[-1] if self.table_ids else None}
            self.entries.append(entry); self.font = None
        if tag == 'td':
            if not self.cell_text:
                self.errors.append('unmatched_cell'); return
            text = ''.join(self.cell_text.pop()).strip()
            if text in POSITIONS:
                if (self.entries and self.entries[-1]['recorded_position'] is None
                        and self.table_ids and self.entries[-1]['_table_depth'] == self.table_ids[-1]):
                    self.entries[-1]['recorded_position'] = text
                else:
                    self.errors.append('unbound_or_duplicate_position')
            elif text and not text.isdigit() and text not in POSITIONS:
                self.errors.append('unrecognized_membership_text')
        if tag == 'table':
            self.table_depth -= 1
            if self.table_ids: self.table_ids.pop()
        if tag == 'tr': self.row_depth -= 1
        if self.table_depth < 0 or self.row_depth < 0: self.errors.append('invalid_nesting')


def parse_cell(raw_html):
    parser = _Players(); parser.feed(raw_html); parser.close()
    errors = set(parser.errors)
    if parser.font is not None or parser.cell_text or parser.table_depth or parser.row_depth:
        errors.add('incomplete_membership_structure')
    for entry in parser.entries:
        entry.pop('_table_depth')
        if entry['sweater_number'] is None or entry['recorded_position'] not in POSITIONS or not entry['raw_title']:
            errors.add('malformed_player_entry')
    jerseys = [e['sweater_number'] for e in parser.entries]
    if len(jerseys) != len(set(jerseys)): errors.add('duplicate_recorded_sweater')
    if len(jerseys) > 7: errors.add('implausible_membership_count')
    if not parser.entries and ''.join(parser.texts).strip(): errors.add('unparsed_membership_content')
    return {'raw_cell_html': raw_html, 'raw_entries': parser.entries,
            'status': 'malformed' if errors else 'recorded' if parser.entries else 'empty_unavailable',
            'reasons': sorted(errors) if errors else []}


def resolve_cell(cell, team, roster):
    result = {**cell, 'team_id': team, 'player_ids': None, 'resolved_entries': []}
    if cell['status'] != 'recorded': return result
    reasons = []
    for entry in cell['raw_entries']:
        matches = roster.get((team, entry['sweater_number']), {})
        if len(matches) != 1:
            reasons.append('missing_or_ambiguous_team_sweater'); continue
        player, positions = next(iter(matches.items()))
        if sum(player in members for (roster_team, _), members in roster.items() if roster_team == team) != 1:
            reasons.append('ambiguous_player_sweater'); continue
        result['resolved_entries'].append({**entry, 'player_id': player,
                                          'roster_positions': sorted(positions),
                                          'position_agrees': positions == {entry['recorded_position']}})
    ids = [e['player_id'] for e in result['resolved_entries']]
    if len(ids) != len(set(ids)): reasons.append('duplicate_resolved_player')
    if reasons:
        result.update(status='unavailable_mapping', reasons=sorted(set(reasons)))
    else:
        result.update(status='resolved_retrospective', player_ids=sorted(ids))
    return result


def join_rows(rows, pbp):
    home, away = pbp['homeTeam'], pbp['awayTeam']
    if (any(type(team.get('id')) is not int or team['id'] <= 0 for team in (home, away))
            or home['id'] == away['id']): raise ValueError('Distinct positive team identities required')
    roster, actors = defaultdict(dict), defaultdict(set)
    for person in pbp.get('rosterSpots', []):
        team, player, sweater = (person.get(k) for k in ('teamId', 'playerId', 'sweaterNumber'))
        if (any(type(x) is not int for x in (team, player, sweater)) or team not in (home['id'], away['id'])
                or player <= 0 or not 0 <= sweater <= 99):
            raise ValueError('Malformed roster identity must not be silently ignored')
        positions = roster[team, sweater].setdefault(player, set())
        if isinstance(person.get('positionCode'), str): positions.add(person['positionCode'])
        actors[team, player].add(sweater)
    reports = defaultdict(list)
    for row in rows:
        key = row['period'], row['seconds_into_period'], row['event_type'], row['actor_team_abbrev'], row['actor_sweater']
        reports[key].append(row['report_row'])
    pending, use = [], defaultdict(list)
    seen = set()
    for event in pbp['plays']:
        eid = event.get('eventId')
        if type(eid) is not int or eid < 0 or eid in seen: raise ValueError('Unique nonnegative PBP event IDs required')
        seen.add(eid)
        if event.get('typeCode') not in (505, 506, 507): continue
        d, p = event.get('details', {}), event['periodDescriptor']
        if (not isinstance(d, dict) or not isinstance(p, dict) or type(p.get('number')) is not int
                or not 1 <= p['number'] <= 20 or p.get('periodType') not in ('REG', 'OT', 'SO')):
            raise ValueError('Canonical PBP details and period identity required')
        code = {505: 'GOAL', 506: 'SHOT', 507: 'MISS'}[event['typeCode']]
        owner = d.get('eventOwnerTeamId'); actor = d.get('scoringPlayerId' if code == 'GOAL' else 'shootingPlayerId')
        sweaters = actors.get((owner, actor), set())
        clock = event.get('timeInPeriod', '')
        if re.fullmatch(r'[0-9]{2}:[0-9]{2}', clock) is None: raise ValueError('Canonical PBP clock required')
        minute, second = map(int, clock.split(':'))
        if second >= 60 or minute * 60 + second > 1200: raise ValueError('Invalid seconds')
        candidates = []
        if (p.get('periodType') != 'SO' and len(sweaters) == 1 and type(owner) is int
                and type(actor) is int and actor > 0):
            abbrev = {home['id']: home['abbrev'], away['id']: away['abbrev']}.get(owner)
            sweater = next(iter(sweaters))
            if set(roster.get((owner, sweater), {})) == {actor}:
                candidates = reports.get((p['number'], minute * 60 + second, code, abbrev, sweater), [])
        pending.append({'event_id': eid, 'candidate_report_rows': list(candidates)})
        for row in candidates: use[row].append(eid)
    by_id = {row['report_row']: row for row in rows}
    if len(by_id) != len(rows): raise ValueError('Unique report rows required')
    shots = []
    for item in pending:
        candidates = item['candidate_report_rows']
        unique = len(candidates) == 1 and len(use[candidates[0]]) == 1
        result = {**item, 'status': 'uniquely_matched_retrospective' if unique else 'unmatched_or_ambiguous',
                  'report_row': candidates[0] if unique else None, 'away': None, 'home': None}
        if unique:
            row = by_id[candidates[0]]
            for side, team in (('away', away['id']), ('home', home['id'])):
                result[side] = resolve_cell(row[side], team, roster)
        shots.append(result)
    return shots


def build(report_body, pbp):
    if type(report_body) is not bytes or not 0 < len(report_body) <= 4000000:
        raise ValueError('Bounded exact report bytes required')
    rows = parse_report(report_body, game_id=pbp['id'], game_date=pbp['gameDate'],
                        away_abbrev=pbp['awayTeam']['abbrev'], home_abbrev=pbp['homeTeam']['abbrev'],
                        away_team_id=pbp['awayTeam']['id'], home_team_id=pbp['homeTeam']['id'])
    parser = _Outer(); parser.feed(report_body.decode('latin-1')); parser.close()
    if parser.row_depth is not None or parser.cell_depth is not None or parser.depth or parser.td or len(parser.rows) != len(rows):
        raise ValueError('Incomplete membership outer structure')
    enriched = [{**row, 'away': parse_cell(cells[6]), 'home': parse_cell(cells[7])}
                for row, cells in zip(rows, parser.rows)]
    return {'version': VERSION, 'publishable': False, 'prediction_eligible': False,
            'scope': 'retrospective_recorded_onice_membership_not_shift_intervals',
            'game_id': pbp['id'], 'report_body_sha256': hashlib.sha256(report_body).hexdigest(),
            'report_rows': enriched, 'shots': join_rows(enriched, pbp)}
