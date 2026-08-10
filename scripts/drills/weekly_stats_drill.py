#!/usr/bin/env python3
"""
weekly_stats_drill.py — proves populate_player_weekly_stats writes rows for
a specified historical week (Sun-Sat convention per
20260216000000_shift_weeks_to_sunday_saturday.sql) and that the totals
match hand-summed player_game_stats.

Anti-best-ball. A pass requires:
  * post-run count > pre-run count for the target week, OR
  * post-run row totals for a spot-checked player match sum(player_game_stats).
"""

import os
import sys
import argparse
import datetime as dt

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'data-pipeline'))
import _bootstrap  # noqa: F401
from data_pipeline.utils.supabase_rest import SupabaseRest


def _sun_sat_week(anchor: dt.date) -> tuple[dt.date, dt.date]:
    """Return the (Sunday, Saturday) of the week that contains `anchor`.
    date.weekday(): Monday=0..Sunday=6. Sun-Sat means Sun is day 0 of the week.
    """
    # Days since Sunday
    days_since_sun = (anchor.weekday() + 1) % 7
    sun = anchor - dt.timedelta(days=days_since_sun)
    sat = sun + dt.timedelta(days=6)
    return sun, sat


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--anchor-date', help='YYYY-MM-DD — pick a date INSIDE the target week. '
                    'Default: 2026-02-01 (mid-2025-26 season, dense games)')
    ap.add_argument('--week-number', type=int, default=None,
                    help='Override week number; default = ISO week of anchor')
    ap.add_argument('--i-know-this-is-prod', action='store_true')
    args = ap.parse_args()

    from urllib.parse import urlparse
    host = urlparse(os.environ['VITE_SUPABASE_URL']).hostname or ''
    is_prod = 'prod' in host or ('citrus' in host and 'staging' not in host)
    if is_prod and not args.i_know_this_is_prod:
        print(f'REFUSING: resolved host {host} looks like prod', file=sys.stderr)
        return 1
    print(f'[drill] Supabase host: {host}')

    anchor = dt.date.fromisoformat(args.anchor_date) if args.anchor_date else dt.date(2026, 2, 1)
    week_start, week_end = _sun_sat_week(anchor)
    week_number = args.week_number if args.week_number is not None else week_start.isocalendar()[1]
    print(f'[drill] target week: {week_start.isoformat()} (Sun) .. {week_end.isoformat()} (Sat)  #{week_number}')

    db = SupabaseRest(os.environ['VITE_SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY'])

    # Pre-run: how many weekly rows exist for this week today?
    pre = db.select('player_weekly_stats', select='player_id',
                    filters=[('week_number', 'eq', week_number),
                             ('week_start_date', 'eq', week_start.isoformat()),
                             ('week_end_date', 'eq', week_end.isoformat())],
                    limit=1000) or []
    # Paginate if capped at 1000.
    pre_count = len(pre)
    if pre_count == 1000:
        offset = 1000
        while True:
            more = db.select('player_weekly_stats', select='player_id',
                             filters=[('week_number', 'eq', week_number),
                                      ('week_start_date', 'eq', week_start.isoformat()),
                                      ('week_end_date', 'eq', week_end.isoformat())],
                             limit=1000, offset=offset) or []
            pre_count += len(more)
            if len(more) < 1000:
                break
            offset += 1000
    print(f'[drill] pre-run row count for this week: {pre_count}')

    # Fire the RPC
    print('[drill] calling populate_player_weekly_stats...')
    result = db.rpc('populate_player_weekly_stats', {
        'p_week_number': week_number,
        'p_week_start_date': week_start.isoformat(),
        'p_week_end_date': week_end.isoformat(),
    })
    print(f'[drill] rpc returned: {result}')

    # Post-run count
    post = db.select('player_weekly_stats', select='player_id',
                     filters=[('week_number', 'eq', week_number),
                              ('week_start_date', 'eq', week_start.isoformat()),
                              ('week_end_date', 'eq', week_end.isoformat())],
                     limit=1000) or []
    post_count = len(post)
    if post_count == 1000:
        offset = 1000
        while True:
            more = db.select('player_weekly_stats', select='player_id',
                             filters=[('week_number', 'eq', week_number),
                                      ('week_start_date', 'eq', week_start.isoformat()),
                                      ('week_end_date', 'eq', week_end.isoformat())],
                             limit=1000, offset=offset) or []
            post_count += len(more)
            if len(more) < 1000:
                break
            offset += 1000
    print(f'[drill] post-run row count for this week: {post_count}')

    if post_count == 0:
        print('DRILL FAIL: 0 weekly rows for this week — either the source '
              'player_game_stats is empty for this week or the function did nothing.',
              file=sys.stderr)
        return 2

    # Spot-check: pick one player from post, sum their player_game_stats
    # for the week, compare to weekly row.
    sample = post[0]
    sample_pid = int(sample['player_id'])
    print(f'[drill] spot-check player_id: {sample_pid}')
    weekly = db.select('player_weekly_stats',
                       select='nhl_goals,nhl_assists,nhl_shots_on_goal,nhl_hits,nhl_blocks',
                       filters=[('player_id', 'eq', sample_pid),
                                ('week_number', 'eq', week_number),
                                ('week_start_date', 'eq', week_start.isoformat())],
                       limit=1) or []
    if not weekly:
        print('DRILL FAIL: spot-check player has no weekly row', file=sys.stderr)
        return 2
    w = weekly[0]

    # Sum player_game_stats for that same week for this player
    games = db.select('player_game_stats',
                      select='nhl_goals,nhl_assists,nhl_shots_on_goal,nhl_hits,nhl_blocks,game_date',
                      filters=[('player_id', 'eq', sample_pid),
                               ('game_date', 'gte', week_start.isoformat()),
                               ('game_date', 'lte', week_end.isoformat())],
                      limit=100) or []
    sums = {'goals': 0, 'assists': 0, 'sog': 0, 'hits': 0, 'blocks': 0}
    for g in games:
        sums['goals'] += int(g.get('nhl_goals') or 0)
        sums['assists'] += int(g.get('nhl_assists') or 0)
        sums['sog'] += int(g.get('nhl_shots_on_goal') or 0)
        sums['hits'] += int(g.get('nhl_hits') or 0)
        sums['blocks'] += int(g.get('nhl_blocks') or 0)
    print(f'[drill] hand-summed from {len(games)} games: {sums}')
    print(f'[drill] weekly row values: '
          f'goals={w.get("nhl_goals")}  assists={w.get("nhl_assists")}  '
          f'sog={w.get("nhl_shots_on_goal")}  hits={w.get("nhl_hits")}  '
          f'blocks={w.get("nhl_blocks")}')

    mismatch = []
    if int(w.get('nhl_goals') or 0) != sums['goals']:
        mismatch.append(f'goals {w.get("nhl_goals")} vs sum {sums["goals"]}')
    if int(w.get('nhl_assists') or 0) != sums['assists']:
        mismatch.append(f'assists {w.get("nhl_assists")} vs sum {sums["assists"]}')
    if int(w.get('nhl_shots_on_goal') or 0) != sums['sog']:
        mismatch.append(f'sog {w.get("nhl_shots_on_goal")} vs sum {sums["sog"]}')
    if int(w.get('nhl_hits') or 0) != sums['hits']:
        mismatch.append(f'hits {w.get("nhl_hits")} vs sum {sums["hits"]}')
    if int(w.get('nhl_blocks') or 0) != sums['blocks']:
        mismatch.append(f'blocks {w.get("nhl_blocks")} vs sum {sums["blocks"]}')

    if mismatch:
        print('DRILL FAIL: weekly totals disagree with player_game_stats sums:', file=sys.stderr)
        for m in mismatch:
            print(f'  {m}', file=sys.stderr)
        return 2

    print(f'[drill] PASS: weekly stats populated ({post_count} rows), spot-check matches.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
