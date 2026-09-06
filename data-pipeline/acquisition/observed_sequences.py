"""Source-only consecutive-attempt chains, NOT inferred hockey possession.

Our versioned definition uses the FULL frozen play stream: consecutive
unblocked attempts, one attacking team/period, and an explicit maximum gap
between attempts. Every non-attempt, opponent attempt, period change, or goal
breaks the chain. This is not a claim to reproduce any external site's rules.

Accepts the existing collect_observations frozen envelope. Recomputing its
normalization and identities detects inconsistent artifacts, not a malicious
rewrite of both source and hashes. Final team totals are necessary evidence,
not independent proof that the upstream feed omitted no non-shot events.
No probabilities, fitted thresholds, network, database, or model loading.
"""
from datetime import datetime, timezone
import json
import re

from acquisition.canonical_events import normalize_pbp
from acquisition.event_observation_service import prepare_observation
from monitoring.final_game_evidence import verify_final_game
from projections.analytics_publication import fingerprint, timestamp


DEFINITION = 'nhl-consecutive-unblocked-attempts-v1'
ATTEMPTS = (505, 506, 507)


def extract_observed_sequences(receipt, *, max_gap_seconds, now=None):
    """Return all chains (including singletons), or no chains on any failure.

    sortOrder is authoritative and must strictly increase in raw list order;
    eventId is an identity, never a clock/order substitute. Same-clock events
    are allowed only with distinct ordered sortOrder. No sorting repairs input.
    The caller must choose and retain the threshold; it is not learned here.
    A verified result can attest source membership for sequence_value, but
    supplies neither prediction lineage nor a possession-prediction claim.
    ``now`` optionally supplies an aware datetime or ISO timestamp validation
    clock; otherwise UTC wall time is used. It never replaces source time or
    enters source/chain identity. Future observations are unavailable.
    """
    if (type(max_gap_seconds) not in (int, float)
            or not 0 <= max_gap_seconds < float('inf')):
        raise ValueError('An explicit finite nonnegative gap threshold is required')
    try:
        clock = datetime.now(timezone.utc) if now is None else now
        if isinstance(clock, datetime):
            clock = clock.isoformat()
        validation_clock = datetime.fromisoformat(timestamp(clock))
    except (TypeError, ValueError, AttributeError):
        raise ValueError('Validation clock must be an aware timestamp') from None
    result = {'definition': DEFINITION, 'max_gap_seconds': max_gap_seconds,
              'semantics': 'bounded-consecutive-attempts-not-inferred-possession',
              'status': 'unavailable', 'verified': False, 'chains': []}

    def fail(reason, status='quarantined'):
        return {**result, 'status': status, 'reason': reason, 'chains': [], 'verified': False}

    try:
        receipt = json.loads(json.dumps(receipt, allow_nan=False))
        result['source_receipt_sha256'] = fingerprint(receipt)
        if not isinstance(receipt, dict) or receipt.get('status') != 'complete':
            return fail('receipt_not_complete', 'unavailable')
        prepared = receipt.get('prepared')
        if not isinstance(prepared, list) or len(prepared) != 3:
            return fail('missing_prepared_source', 'unavailable')
        source = prepared[0]
        payload = source['payload']['pbp']
        observed = timestamp(receipt['observed_at'])
        gid = payload['id']
        if (type(receipt.get('game_id')) is not int or receipt['game_id'] != gid
                or receipt.get('url') != f'https://api-web.nhle.com/v1/gamecenter/{gid}/play-by-play'
                or timestamp(source['observed_at']) != observed):
            return fail('source_identity_or_observation_conflict')
        result.update(game_id=gid, observed_at=observed,
                      source_payload_sha256=fingerprint(payload), source_snapshot_id=source['id'])
        if datetime.fromisoformat(observed) > validation_clock:
            return fail('source_observation_in_future', 'unavailable')
        normalized = normalize_pbp(payload)
        if not normalized['complete']:
            return fail('canonical_normalization_incomplete')
        # Bind every persisted derived field to this exact raw payload; do not
        # trust a previously saved complete flag, normalized event, or hash.
        if list(prepare_observation(payload, observed)) != prepared:
            return fail('frozen_normalization_or_identity_conflict')
        final = verify_final_game(payload)
        result['final_game_evidence'] = final
        if final['status'] != 'verified':
            return fail(final['reason'], final['status'])
        plays = payload['plays']
        events = {event['event_id']: event for event in normalized['events']}
        seen, previous, ordered = set(), None, []
        for ordinal, play in enumerate(plays):
            if type(play.get('typeCode')) is not int:
                return fail('missing_full_stream_event_type', 'unavailable')
            eid, order = play.get('eventId'), play.get('sortOrder')
            if (type(eid) is not int or eid < 0 or eid in seen
                    or type(order) is not int or order < 0):
                return fail('missing_or_ambiguous_full_stream_identity_or_order')
            seen.add(eid)
            descriptor = play.get('periodDescriptor')
            if not isinstance(descriptor, dict):
                return fail('missing_full_stream_period', 'unavailable')
            period, kind = descriptor.get('number'), descriptor.get('periodType')
            if (type(period) is not int or period < 1 or kind not in ('REG', 'OT', 'SO')
                    or (period <= 3 and kind != 'REG')
                    or (period > 3 and kind == 'REG')
                    or (payload['gameType'] == 2 and ((kind == 'OT' and period != 4)
                                                       or (kind == 'SO' and period != 5)))
                    or (payload['gameType'] == 3 and kind == 'SO')):
                return fail('invalid_full_stream_period')
            clock = play.get('timeInPeriod')
            if not isinstance(clock, str) or re.fullmatch(r'\d{2}:\d{2}', clock) is None:
                return fail('missing_or_invalid_full_stream_clock', 'unavailable')
            minutes, seconds = map(int, clock.split(':'))
            elapsed = minutes * 60 + seconds
            limit = 300 if kind == 'OT' and payload['gameType'] == 2 else 1200
            if seconds >= 60 or elapsed > limit:
                return fail('invalid_full_stream_clock')
            if previous is not None and (order <= previous[0] or period < previous[1]
                    or (period == previous[1] and (kind != previous[2] or elapsed < previous[3]))):
                return fail('nonmonotone_full_stream_order_or_clock')
            previous = (order, period, kind, elapsed)
            ordered.append((ordinal, play, period, kind, elapsed))
        chains, active = [], []

        def finish():
            if not active:
                return
            body = {'definition': DEFINITION, 'max_gap_seconds': max_gap_seconds,
                    'source_receipt_sha256': result['source_receipt_sha256'],
                    'source_payload_sha256': result['source_payload_sha256'],
                    'source_snapshot_id': result['source_snapshot_id'],
                    'game_id': gid, 'team_id': active[0]['team_id'],
                    'period': active[0]['period'], 'events': list(active)}
            chains.append({**body, 'chain_id': fingerprint(body), 'sequence_verified': True})
            active.clear()

        for ordinal, play, period, kind, elapsed in ordered:
            if play.get('typeCode') not in ATTEMPTS or kind == 'SO':
                finish()
                continue
            event = events[play['eventId']]
            owner = play['details'].get('eventOwnerTeamId')
            if type(owner) is not int or owner not in (payload['homeTeam']['id'], payload['awayTeam']['id']):
                return fail('unknown_attacking_team', 'unavailable')
            if active and (owner != active[-1]['team_id'] or period != active[-1]['period']
                           or elapsed - active[-1]['seconds_into_period'] > max_gap_seconds):
                finish()
            active.append({'game_id': gid, 'event_id': play['eventId'], 'raw_ordinal': ordinal,
                           'sort_order': play['sortOrder'], 'period': period, 'period_type': kind,
                           'seconds_into_period': elapsed, 'team_id': owner,
                           'is_goal': event['is_goal'], 'source_event_sha256': fingerprint(play)})
            if event['is_goal']:
                finish()
        finish()
        return {**result, 'status': 'verified', 'verified': True,
                'reason': 'verified_consecutive_attempt_definition', 'chains': chains,
                'full_stream_events': len(plays), 'included_attempts': len(events),
                'excluded': normalized['excluded']}
    except (KeyError, TypeError, ValueError, AttributeError, OverflowError):
        return fail('malformed_or_missing_source_context', 'unavailable')
