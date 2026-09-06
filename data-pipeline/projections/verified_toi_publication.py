"""Build a publication candidate from frozen official responses and DB export.

Input evidence per player: {observed_at, source_receipt, game_log}; the raw
HTTP receipt must identify this player, season and population. Complete raw NHL
summary receipts independently prove GP. Missing raw receipts yield unavailable
output; inline legacy landing/game-log copies cannot verify a publication.
Capture actual retrieval
timestamps; never backdate current corrected data to an imagined historical date.
No legacy table is modified. A separately authorized publisher installs the result.
"""
from collections import defaultdict
from datetime import datetime
from monitoring.appearance_contract import official_summary_population, reconcile_appearances
from monitoring.toi_source_receipt import validate_game_log_receipt
from projections.analytics_publication import prepare, fingerprint, timestamp


def build_candidate(expected_players, stored_rows, evidence, season, cutoff, code_revision,
                    summary_receipts=None, stored_observed_at=None):
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
    official_population = official_summary_population(summary_receipts, season)
    if summary_receipts is not None:
        receipts.extend(timestamp(r['observed_at']) for r in summary_receipts)
        if official_population is not None and set(official_population) - set(expected_players):
            raise ValueError('Expected manifest omits official season skaters')
    if stored_observed_at is not None:
        receipts.append(timestamp(stored_observed_at))
    for pid in sorted(expected_players):
        receipt=evidence[pid]
        receipts.append(timestamp(receipt['observed_at']))
        source = validate_game_log_receipt(receipt,pid,season)
        if source['observed_at'] is not None:
            receipts.append(source['observed_at'])
        gp=official_population.get(pid) if official_population is not None else None
        proof=(reconcile_appearances(grouped[pid],source['game_log'],gp,season)
               if source['available'] else {'available':False,'reason':source['reason']})
        proofs[str(pid)]=proof
        values.append({'entity_id':pid, 'availability':'available' if proof['available'] else 'unavailable',
                       'value':proof.get('avg_toi_per_game'), 'reason':proof['reason'],
                       'exposure':proof.get('games_played')})
    payload={'season':season,'expected_players':sorted(expected_players),
             'stored_rows':stored_rows,'official_receipts':evidence,'reconciliation':proofs}
    if summary_receipts is not None:
        payload['official_summary_receipts'] = summary_receipts
    if stored_observed_at is not None:
        payload['stored_observed_at'] = timestamp(stored_observed_at)
    health = {'expected':len(expected_players), 'receipts':len(evidence),
              'available':sum(p['available'] for p in proofs.values()),
              'withheld':sum(not p['available'] for p in proofs.values()),
              'official_population_complete':official_population is not None,
              'official_players':len(official_population) if official_population is not None else None}
    return prepare('NHL official TOI + stored appearance snapshot',max(receipts,key=datetime.fromisoformat),payload,
                   {'metric':'avg_toi_per_game','variant':'official-reconciled','unit':'minutes_per_appearance',
                    'season':season,'game_type':'regular','population':'skaters',
                    'feature_version':'official-appearance-v2','model_version':'none',
                    'code_revision':code_revision,'data_cutoff':cutoff},values,
                   {'status':'passed','gate_version':'official-appearance-v2',
                    'freshness_observed_at':min(receipts,key=datetime.fromisoformat),
                    'coverage':health,
                    'evidence_sha256':fingerprint(payload)})
