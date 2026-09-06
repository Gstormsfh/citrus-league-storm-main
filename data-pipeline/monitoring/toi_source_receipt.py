"""Pure source-bound validation for frozen NHL regular-season game-log receipts.

A receipt's raw HTTP response is authoritative; duplicated convenience fields cannot replace
its player/season identity, HTTP outcome, observation time, or corrected game log.
"""
from copy import deepcopy
from datetime import datetime, timezone


def receipt_time(value):
    if not isinstance(value, str):
        raise ValueError('Receipt timestamp must be a string')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('Receipt timestamp requires an explicit timezone')
    return parsed.astimezone(timezone.utc)


def validate_game_log_receipt(receipt, player_id, season):
    """Return source evidence or a reason for withholding, without any I/O.

    Inner timestamps are retained even for HTTP failures when they are valid.
    Missing raw receipts are unavailable; legacy derived lists are never evidence.
    Domain reconciliation separately validates each appearance identity and TOI.
    """
    result = {'available':False, 'reason':'official_receipt_missing',
              'game_log':None, 'observed_at':None, 'requested_at':None}
    if not isinstance(receipt, dict) or not isinstance(receipt.get('source_receipt'), dict):
        return result
    source = receipt['source_receipt']
    try:
        requested = receipt_time(source.get('requested_at'))
        observed = receipt_time(source.get('observed_at'))
    except (ValueError, OverflowError):
        return {**result, 'reason':'official_receipt_timestamp_invalid'}
    result.update(requested_at=requested.isoformat(), observed_at=observed.isoformat())
    if requested > observed:
        return {**result, 'reason':'official_receipt_timestamp_invalid'}
    if 'observed_at' in receipt:
        try:
            outer = receipt_time(receipt['observed_at'])
        except (ValueError, OverflowError):
            return {**result, 'reason':'official_receipt_timestamp_invalid'}
        if outer != observed:
            return {**result, 'reason':'official_receipt_timestamp_mismatch'}
    if (type(player_id) is not int or player_id <= 0 or type(season) is not int
            or source.get('url') != f'https://api-web.nhle.com/v1/player/{player_id}/game-log/{season}{season + 1}/2'
            or source.get('params') != {}):
        return {**result, 'reason':'official_receipt_identity_mismatch'}
    if source.get('status') != 'ok' or type(source.get('http_status')) is not int or source['http_status'] != 200:
        return {**result, 'reason':'official_receipt_failed'}
    payload = source.get('payload')
    if (not isinstance(payload, dict) or type(payload.get('seasonId')) is not int
            or payload['seasonId'] != season * 10000 + season + 1
            or type(payload.get('gameTypeId')) is not int or payload['gameTypeId'] != 2):
        return {**result, 'reason':'official_receipt_population_mismatch'}
    log = payload.get('gameLog')
    if not isinstance(log, list):
        return {**result, 'reason':'official_receipt_payload_invalid'}
    if 'game_log' in receipt and receipt['game_log'] != log:
        return {**result, 'reason':'official_receipt_payload_mismatch'}
    return {**result, 'available':True, 'reason':'verified_source', 'game_log':deepcopy(log)}
