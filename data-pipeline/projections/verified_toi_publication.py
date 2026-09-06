"""Build a publication candidate from frozen official responses and DB export.

Input evidence per player: {observed_at, landing, game_log}; failed responses may
use None for either payload, yielding unavailable output. Capture actual retrieval
timestamps; never backdate current corrected data to an imagined historical date.
No legacy table is modified. A separately authorized publisher installs the result.
"""
from collections import defaultdict
from monitoring.appearance_contract import official_gp_from_landing, reconcile_appearances
from projections.analytics_publication import prepare, fingerprint, timestamp


def build_candidate(expected_players, stored_rows, evidence, season, cutoff, code_revision):
    if not expected_players or len(set(expected_players)) != len(expected_players):
        raise ValueError('A unique expected skater manifest is required')
    grouped = defaultdict(list)
    for row in stored_rows:
        gid = row['game_id']
        if row.get('season') != season or not season * 1000000 + 20000 <= gid < season * 1000000 + 30000:
            raise ValueError('Snapshot mixes seasons or game populations')
        if row.get('is_goalie'):
            raise ValueError('Skater TOI publication cannot contain goalies')
        grouped[row['player_id']].append(row)
    if set(grouped)-set(expected_players):
        raise ValueError('Stored snapshot contains unexpected players')
    if set(evidence) != set(expected_players):
        raise ValueError('Every expected player requires a source receipt, including failures')
    values=[]
    proofs={}
    receipts=[]
    for pid in sorted(expected_players):
        receipt=evidence[pid]
        receipts.append(timestamp(receipt['observed_at']))
        gp=official_gp_from_landing(receipt.get('landing') or {},season)
        log=receipt.get('game_log')
        proof=reconcile_appearances(grouped[pid],log,gp,season)
        proofs[str(pid)]=proof
        values.append({'entity_id':pid, 'availability':'available' if proof['available'] else 'unavailable',
                       'value':proof.get('avg_toi_per_game'), 'reason':proof['reason'],
                       'exposure':proof.get('games_played')})
    payload={'season':season,'expected_players':sorted(expected_players),
             'stored_rows':stored_rows,'official_receipts':evidence,'reconciliation':proofs}
    return prepare('NHL official TOI + stored appearance snapshot',max(receipts),payload,
                   {'metric':'avg_toi_per_game','variant':'official-reconciled','unit':'minutes_per_appearance',
                    'season':season,'game_type':'regular','population':'skaters',
                    'feature_version':'official-appearance-v2','model_version':'none',
                    'code_revision':code_revision,'data_cutoff':cutoff},values,
                   {'status':'passed','gate_version':'official-appearance-v2',
                    'evidence_sha256':fingerprint(payload)})
