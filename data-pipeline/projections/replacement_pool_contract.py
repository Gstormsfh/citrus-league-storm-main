"""One-dimensional replacement baseline, not FPAR or a roster optimizer.

Pure declaration validation: receipt hashes must be authenticated upstream.
No database access, defaults, fantasy scoring, GAR conversion or publication.
"""
from datetime import date, datetime, timezone
import math
import re

from projections.analytics_publication import fingerprint


def _evidence(value):
    # Preserve malformed numeric evidence without emitting invalid JSON or
    # confusing a genuine string with an invalid floating-point token.
    if isinstance(value, float) and not math.isfinite(value):
        return {'invalid_float_token': repr(value)}
    if isinstance(value, dict):
        return {k: _evidence(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_evidence(v) for v in value]
    return value


def _finite_points(value):
    try:
        return type(value) in (int,float) and math.isfinite(value)
    except OverflowError:
        return False


def replacement_pool(*, league_id, scoring_sha256, season, horizon, as_of,
                     expected_player_ids, rows, position, roster_demand, receipts):
    """Rows declare player_id/season/horizon/as_of/position/projected_points,
    eligible/ir_status/coverage. IR status is exactly active|ir; coverage must
    be complete. Receipts are league_sha256, horizon_sha256, scoring_sha256.

    Demand counts the already allocated slots for this ONE position; replacement
    is the next candidate after that count. No multi-position allocation implied.
    All expected players need exactly one row, including explicitly excluded IR
    or ineligible players. A missing row is never interpreted as zero or active.
    """
    evidence = _evidence(dict(league_id=league_id, scoring_sha256=scoring_sha256,
        season=season, horizon=horizon, as_of=as_of, expected_player_ids=expected_player_ids,
        rows=rows, position=position, roster_demand=roster_demand, receipts=receipts))
    reasons, candidates = [], []
    sha = lambda v: isinstance(v, str) and re.fullmatch('[0-9a-f]{64}', v) is not None
    def fail(reason):
        if reason not in reasons: reasons.append(reason)
    def day(v):
        return date.fromisoformat(v) if isinstance(v,str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}',v) else None
    try:
        if not isinstance(league_id,str) or not league_id.strip(): fail('explicit_league_required')
        if not sha(scoring_sha256): fail('explicit_scoring_fingerprint_required')
        if (not isinstance(receipts,dict) or set(receipts) != {'league_sha256','horizon_sha256','scoring_sha256'}
                or not all(sha(v) for v in receipts.values()) or receipts.get('scoring_sha256') != scoring_sha256):
            fail('upstream_league_horizon_scoring_receipts_required')
        if type(season) is not int or not 1900 <= season <= 9998: fail('explicit_season_required')
        if not isinstance(position,str) or position not in ('C','LW','RW','D','G','F'): fail('explicit_position_required')
        if type(roster_demand) is not int or roster_demand < 0: fail('explicit_nonnegative_roster_demand_required')
        valid_horizon = isinstance(horizon,dict) and set(horizon)=={'start','end'}
        if not valid_horizon: fail('explicit_common_horizon_required')
        else:
            start,end=day(horizon['start']),day(horizon['end'])
            if start is None or end is None or start>end: fail('invalid_horizon')
            elif type(season) is int and (start.year not in (season,season+1) or end.year not in (season,season+1)):
                fail('horizon_outside_requested_season_years')
        clock=datetime.fromisoformat(as_of.replace('Z','+00:00')) if isinstance(as_of,str) else None
        if clock is None or clock.tzinfo is None or clock.utcoffset() is None: fail('aware_as_of_required')
        elif valid_horizon and start and clock.astimezone(timezone.utc).date()>start: fail('as_of_after_horizon_start')
    except (ValueError,TypeError):
        fail('invalid_horizon_or_as_of')
    expected_valid = (isinstance(expected_player_ids,list) and bool(expected_player_ids)
        and all(type(pid) is int and pid>0 for pid in expected_player_ids))
    if not expected_valid: fail('complete_expected_membership_required')
    elif len(set(expected_player_ids)) != len(expected_player_ids): fail('duplicate_expected_player')
    expected=set(expected_player_ids) if expected_valid else set()
    observed=set()
    if not isinstance(rows,list): fail('explicit_observed_rows_required')
    else:
        for index,row in enumerate(rows):
            errors=[]
            required={'player_id','season','horizon','as_of','position','projected_points','eligible','ir_status','coverage'}
            if not isinstance(row,dict) or set(row)!=required:
                candidates.append({'input_index':index,'decision':'invalid','reasons':['exact_row_contract_required']})
                fail('invalid_candidate');continue
            pid=row['player_id']
            if type(pid) is not int or pid<=0: errors.append('invalid_player_id')
            else:
                if pid in observed: errors.append('duplicate_player_horizon')
                observed.add(pid)
                if pid not in expected: errors.append('unexpected_player')
            if type(row['season']) is not int or row['season']!=season: errors.append('mixed_season')
            if row['horizon']!=horizon: errors.append('mixed_horizon')
            if row['as_of']!=as_of: errors.append('stale_or_mixed_as_of')
            if row['position']!=position: errors.append('mixed_position')
            if row['coverage']!='complete': errors.append('incomplete_projection_coverage')
            if type(row['eligible']) is not bool: errors.append('unknown_eligibility')
            if row['ir_status'] not in ('active','ir'): errors.append('unknown_ir_status')
            points=row['projected_points']
            if not _finite_points(points): errors.append('invalid_points')
            excluded=[]
            if row['ir_status']=='ir': excluded.append('explicit_ir')
            if row['eligible'] is False: excluded.append('explicit_ineligible')
            decision='invalid' if errors else 'excluded' if excluded else 'included'
            candidates.append({'input_index':index,'player_id':pid,'decision':decision,'reasons':errors or excluded,
                               'projected_points':_evidence(points)})
            if errors: fail('invalid_candidate')
    missing=sorted(expected-observed)
    if missing: fail('missing_expected_players')
    ranked=sorted((c for c in candidates if c['decision']=='included'),
                  key=lambda c:(-c['projected_points'],c['player_id']))
    if type(roster_demand) is int and roster_demand>=0 and len(ranked)<=roster_demand:
        fail('insufficient_complete_eligible_pool_for_replacement')
    baseline=None if reasons else ranked[roster_demand]
    body={'contract':'one-position-replacement-pool-v1','status':'unavailable' if reasons else 'measured_baseline_only',
        'publishable':False,'is_fpar':False,'reasons':reasons,'missing_player_ids':missing,
        'baseline_points':None if baseline is None else baseline['projected_points'],
        'replacement_player_id':None if baseline is None else baseline['player_id'],
        'ranking':[{'player_id':c['player_id'],'projected_points':c['projected_points']} for c in ranked],
        'candidates':candidates,'input_evidence':evidence,'input_sha256':fingerprint(evidence),
        'ranked_pool_sha256':fingerprint([{'player_id':c['player_id'],'projected_points':c['projected_points']} for c in ranked]),
        'receipt_authentication':'required_upstream_not_proven_by_hash_presence',
        'scope':'one_position_common_horizon_points_not_gar_or_multi_position_allocation'}
    return {**body,'receipt_sha256':fingerprint(body)}
