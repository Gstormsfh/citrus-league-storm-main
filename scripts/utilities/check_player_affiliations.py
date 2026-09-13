"""Read-only daily affiliation health; reviewed events are never overwritten by feed data."""
import datetime as dt
import json
import os
import sys
from pathlib import Path


def assess(current, raw, events):
    raw_by_id = {r['player_id']: r for r in raw}
    latest = {}
    for event in events:
        pid = event['player_id']
        if pid not in latest or event['sequence'] > latest[pid]['sequence']:
            latest[pid] = event
    failures, conflicts = [], []
    current_by_id = {r['player_id']: r for r in current}
    for pid, event in latest.items():
        row = current_by_id.get(pid)
        if not row or row['current_affiliation']['event_id'] != event['id'] or row['team_abbrev'] != event['team_abbrev']:
            failures.append({'player_id': pid, 'reason': 'Reviewed event missing or ineffective'})
        feed = raw_by_id.get(pid, {}).get('team_abbrev')
        if feed != event['team_abbrev']:
            conflicts.append({'player_id': pid, 'feed': feed, 'reviewed': event['team_abbrev'], 'new_since_review': feed != event['feed_team_at_review']})
    return {'status': 'FAIL' if failures or any(c['new_since_review'] for c in conflicts) else 'OK',
            'players': len(current), 'reviewed_players': len(latest), 'failures': failures,
            'feed_conflicts': conflicts,
            'unknown_players': sum(r['current_affiliation']['status'] == 'unknown' for r in current)}


def main():
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'data-pipeline'))
    import _bootstrap  # noqa: F401
    from data_pipeline.utils.supabase_rest import SupabaseRest
    from data_pipeline.utils.season_config import seasons_to_populate
    db = SupabaseRest(os.environ['VITE_SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY'])
    season = max(seasons_to_populate(dt.date.today()))
    def rows(table, columns, order):
        result = []
        while True:
            batch = db.select(table, select=columns, filters=[('season', 'eq', season)], order=order, limit=1000, offset=len(result)) or []
            result.extend(batch)
            if len(batch) < 1000:
                return result
    report = assess(rows('player_current_directory', 'player_id,team_abbrev,current_affiliation', 'player_id.asc'),
                    rows('player_directory', 'player_id,team_abbrev', 'player_id.asc'),
                    rows('player_affiliation_events', 'id,player_id,sequence,team_abbrev,feed_team_at_review', 'sequence.asc'))
    report.update(season=season, checked_at=dt.datetime.now(dt.timezone.utc).isoformat())
    if not report['players']:
        report['status'] = 'FAIL'
    print(json.dumps(report, indent=2))
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a') as f:
            f.write('\n### Current affiliation health\n```json\n' + json.dumps(report, indent=2) + '\n```\n')
    if report['status'] != 'OK':
        raise SystemExit('Affiliation review required; feed did not overwrite reviewed evidence.')


if __name__ == '__main__':
    main()
