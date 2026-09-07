"""Raw strict-prefix audit of evaluated prior-SOG timing; no source correction."""
import argparse
from collections import Counter, defaultdict
from pathlib import Path
import re
import diagnose_expanded_timing as diagnostic
import evaluate_recovered_xg as evaluation
from run_calibration_transfer import ROOT, reuse, pin_run, file_sha, fingerprint
from collect_development_sog_reports import module


def seconds(clock):
    if not isinstance(clock, str) or re.fullmatch(r'\d{2}:\d{2}', clock) is None or int(clock[3:]) >= 60:
        raise ValueError('Canonical clock required')
    return int(clock[:2])*60+int(clock[3:])


def pair(play, previous, expected_gap):
    if previous is None or previous['typeCode'] != 506:
        raise ValueError('Immediate raw saved shot required')
    pd, qd = play['periodDescriptor'], previous['periodDescriptor']
    if ((pd['number'], pd['periodType']) != (qd['number'], qd['periodType']) or pd['periodType'] == 'SO'
            or play['details']['eventOwnerTeamId'] != previous['details']['eventOwnerTeamId']):
        raise ValueError('Same-period same-team raw prior SOG required')
    gap = seconds(play['timeInPeriod'])-seconds(previous['timeInPeriod'])
    if gap < 0 or gap != expected_gap: raise ValueError('Saved/raw timing mismatch')
    a, b = play['details'], previous['details']; shooter = a.get('scoringPlayerId') if play['typeCode'] == 505 else a.get('shootingPlayerId')
    coords = all(k in a and k in b for k in ('xCoord', 'yCoord'))
    remaining = None
    if play.get('timeRemaining') is not None and previous.get('timeRemaining') is not None:
        remaining = seconds(previous['timeRemaining'])-seconds(play['timeRemaining']) == gap
    return {'gap_seconds': gap, 'previous_event_id': previous['eventId'],
        'previous_source_event_sha256': fingerprint(previous),
        'same_shooter': shooter is not None and shooter == b.get('shootingPlayerId'),
        'same_recorded_coordinates': coords and all(a[k] == b[k] for k in ('xCoord', 'yCoord')),
        'remaining_clock_consistent': remaining, 'current_type_code': play['typeCode']}


def run(output):
    output = Path(output).absolute()
    if output.parent != ROOT/'scripts/proof/results' or any(p.is_symlink() for p in (output, *output.parents)):
        raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False); closure = reuse.Closure(ROOT); writer = module('collect_goal_sog_evidence')
    for n in ('audit_raw_followup_clocks.py', 'test_audit_raw_followup_clocks.py'):
        path = 'scripts/proof/'+n; closure.pin(path, file_sha(ROOT/path))
    pin_run(closure, diagnostic.SOURCE, diagnostic.SHA, 'complete-recovered-xg-evaluation-not-accepted')
    closure.mapping(closure.read(diagnostic.SOURCE+'/consumed-file-sha256.json'))
    schema = closure.read(evaluation.FEATURES+'/schema.json'); gi = schema['names'].index('seconds_since_immediate_event')
    manifest = closure.read(evaluation.BUNDLES+'/manifest.json')['bundles']; summary = {}
    for fold in ('fold1', 'fold2'):
        inputs = []; targets = evaluation.unique(closure.read(f'{evaluation.TARGETS}/{fold}/predictions.json'))
        for entry in manifest:
            if entry['fold'] == fold: inputs.extend(closure.read(f'{evaluation.TARGETS}/{fold}/{entry["month"]}/test-inputs.json'))
        selected = [dict(r, target=targets[r['game_id'], r['event_id']]['target'], population='original')
                    for r in inputs if r['context']['prior_sog_same_team'] == '1']
        games = {}
        for r in closure.read(f'{diagnostic.SOURCE}/{fold}-predictions.json'):
            if r['context']['prior_sog_same_team'] != '1': continue
            gid = r['game_id']
            if gid not in games: games[gid] = evaluation.unique(closure.read(f'{evaluation.FEATURES}/{gid}.json')['rows'])
            selected.append(dict(r, gap_seconds=games[gid][gid, r['event_id']]['features'][gi], population='recovered'))
        indexed = evaluation.unique(selected); by_game = defaultdict(dict)
        for (gid, eid), row in indexed.items(): by_game[gid][eid] = row
        records = []; failures = []; counts = defaultdict(Counter)
        for gid, wanted in sorted(by_game.items()):
            stem = f'scripts/proof/results/historical-official-freeze-20260906/{gid//1000000}/pbp/{gid}'
            # The upstream consumed closure pins these original raw bytes.
            if stem+'.body.json' not in closure.checked: raise ValueError('Unbound raw source')
            payload = closure.read(stem+'.body.json'); previous = None; seen = set()
            for play in payload['plays']:
                eid = play['eventId']
                if eid in wanted:
                    row = wanted[eid]; seen.add(eid)
                    if int(play['typeCode'] == 505) != row['target']: raise ValueError('Raw outcome mismatch')
                    try: observation = pair(play, previous, row['gap_seconds'])
                    except ValueError as error:
                        failures.append({'game_id': gid, 'event_id': eid, 'reason': str(error)}); previous = play; continue
                    band = diagnostic.timing(row['context'], row['gap_seconds'])
                    records.append({'game_id': gid, 'event_id': eid, 'target': row['target'], 'band': band,
                        'population': row['population'], 'source_event_sha256': fingerprint(play), **observation})
                    key = row['population']+'/'+band; c = counts[key]; c['events'] += 1; c['goals'] += row['target']
                    c['same_shooter'] += observation['same_shooter']; c['same_coordinates'] += observation['same_recorded_coordinates']
                    repeated = observation['same_shooter'] and observation['same_recorded_coordinates']
                    c['same_shooter_and_coordinates'] += repeated
                    c['goals_same_shooter_and_coordinates'] += repeated and row['target'] == 1
                    c['remaining_clock_mismatch'] += observation['remaining_clock_consistent'] is False
                    c['remaining_clock_unknown'] += observation['remaining_clock_consistent'] is None
                previous = play
            if seen != set(wanted): raise ValueError('Missing raw selected events')
        writer.write_new(output/f'{fold}-pairs.json', records); writer.write_new(output/f'{fold}-failures.json', failures)
        summary[fold] = {'selected_events': len(selected), 'verified_pairs': len(records), 'failed_pairs': len(failures),
                         'groups': dict(counts)}
        print(f'{fold}: {len(records)} raw pairs verified, {len(failures)} mismatches', flush=True)
    closure.verify(); writer.write_new(output/'summary.json', summary)
    writer.write_new(output/'consumed-file-sha256.json', closure.checked)
    writer.write_new(output/'health.json', {'status': 'complete-raw-followup-clock-audit', 'publishable': False,
        'files': {p.name: file_sha(p) for p in output.iterdir() if p.is_file()}, 'production_changed': False})


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--output', required=True); run(p.parse_args().output)
