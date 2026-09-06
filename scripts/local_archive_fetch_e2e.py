"""Actual REST archive-writer tests against an EMPTY disposable localhost fixture.

Print --print-fixture-ddl for root-provisioned PostgreSQL/PostgREST setup. Never
loads .env, model files, hosted credentials, or actual NHL payloads. Does not
provision Docker. Only NHL HTTP responses and sleep are faked; race injectors
perform actual independent REST mutations before the writer's guarded request.
"""
import argparse
import base64
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
from urllib.parse import urlparse


FIXTURE_DDL = """
create table public.raw_nhl_data (
 id bigserial primary key, game_id integer unique not null,
 game_date date not null, raw_json jsonb not null, scraped_at timestamptz default now(),
 processed boolean default false, created_at timestamptz default now(),
 stats_extracted boolean default false, stats_extracted_at timestamptz,
 boxscore_json jsonb, source_url text, content_sha256 text, fetched_at timestamptz
);
create table public.archive_fixture_audits (
 id bigint generated always as identity primary key, season integer,
 gate_name text, expected integer, actual integer, note text
);
alter table public.raw_nhl_data enable row level security;
alter table public.archive_fixture_audits enable row level security;
create function public.record_rebuild_audit(p_season integer,p_gate_name text,
 p_expected integer,p_actual integer,p_note text) returns void language sql as $$
 insert into public.archive_fixture_audits(season,gate_name,expected,actual,note)
 values(p_season,p_gate_name,p_expected,p_actual,p_note);
$$;
create function public.archive_fixture_contract() returns text language sql as $$
 select 'citrus-disposable-archive-fixture-v1'::text;
$$;
revoke all on function public.record_rebuild_audit(integer,text,integer,integer,text) from public;
revoke all on function public.archive_fixture_contract() from public;
grant usage on schema public to service_role;
grant all on public.raw_nhl_data,public.archive_fixture_audits to service_role;
grant usage,select on sequence public.archive_fixture_audits_id_seq to service_role;
grant usage,select on sequence public.raw_nhl_data_id_seq to service_role;
grant execute on function public.record_rebuild_audit(integer,text,integer,integer,text) to service_role;
grant execute on function public.archive_fixture_contract() to service_role;
notify pgrst, 'reload schema';
"""


def guard_local(base_url, token):
    parsed = urlparse(base_url)
    if (parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost', '::1')
            or not parsed.port or parsed.username or parsed.password
            or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
        raise ValueError('Explicit disposable localhost base URL required')
    try:
        segment = token.split('.')[1]
        claims = json.loads(base64.urlsafe_b64decode(segment + '=' * (-len(segment) % 4)))
    except Exception:
        raise ValueError('Synthetic JWT required') from None
    if claims.get('iss') != 'citrus-local-integration' or claims.get('role') != 'service_role':
        raise ValueError('Only synthetic local integration issuer/service-role permitted')


def run_local(base_url, token):
    guard_local(base_url, token)
    path = Path(__file__).resolve().parent / 'nhl_archive/fetch_pbp.py'
    spec = importlib.util.spec_from_file_location('local_archive_fetcher', path)
    fetcher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fetcher)
    db = fetcher.SupabaseRest(base_url, token)
    racing_db = fetcher.SupabaseRest(base_url, token)
    assert db.rpc('archive_fixture_contract', {}) == 'citrus-disposable-archive-fixture-v1'
    for table in ('raw_nhl_data', 'archive_fixture_audits'):
        assert db.select_exact(table, select='game_id' if table == 'raw_nhl_data' else 'id', limit=1) == [], 'Fixture must be empty'
    day, old_time = '2024-10-01', '2024-10-02T01:00:00+00:00'
    pairs = {}

    def pair(gid):
        common = {'id': gid, 'gameDate': day, 'season': 20242025, 'gameType': 2,
                  'gameState': 'OFF', 'homeTeam': {'id': 1}, 'awayTeam': {'id': 2}}
        return ({**deepcopy(common), 'plays': [{'eventId': 1}]},
                {**deepcopy(common), 'playerByGameStats': {
                    'homeTeam': {'forwards': []}, 'awayTeam': {'forwards': []}}})

    def source_row(gid, box=True):
        pbp, payload = pair(gid)
        return {'game_id': gid, 'game_date': day, 'raw_json': pbp,
                'boxscore_json': payload if box else None, 'content_sha256': fetcher._sha256_of(pbp),
                'source_url': f'{fetcher.NHL_API_BASE}/gamecenter/{gid}/play-by-play',
                'processed': True, 'fetched_at': old_time}

    def row(gid):
        return db.select_exact('raw_nhl_data', select='*', filters=[('game_id', 'eq', gid)], limit=1)[0]

    class Response:
        status_code = 200
        def __init__(self, payload): self.payload = payload
        def json(self): return deepcopy(self.payload)

    def official(url, **kwargs):
        gid = int(url.split('/')[-2])
        return Response(pairs[gid][1 if url.endswith('/boxscore') else 0])

    def run(gid, client=db):
        pairs.setdefault(gid, pair(gid))
        code = fetcher.run(client, [{'game_id': gid, 'date': day}], 2024, 0.01)
        latest = db.select_exact('archive_fixture_audits', select='*', order='id.desc', limit=1)[0]
        assert latest['gate_name'] == 'pbp_fetch_complete'
        assert latest['actual'] == (1 if code == 0 else 0)
        return code

    phases = []
    original_http, original_sleep = fetcher.citrus_request, fetcher.time.sleep
    fetcher.citrus_request, fetcher.time.sleep = official, lambda _: None
    try:
        gid = 2024020001
        assert run(gid) == 0
        frozen = row(gid)
        assert run(gid) == 0 and row(gid) == frozen
        phases.extend(['new_insert', 'unchanged_replay_exact_row_preserved'])

        gid = 2024020002
        db.insert('raw_nhl_data', [source_row(gid, box=False)])
        original = row(gid)
        assert run(gid) == 0
        expected = {**original, 'boxscore_json': pair(gid)[1]}
        assert row(gid) == expected
        phases.append('missing_box_jsonb_compare_and_set_preserves_other_fields')

        # Exercise realistic payload scale too: a tiny JSONB filter alone cannot
        # establish that the HTTP request survives a full PBP-sized document.
        gid = 2024020005
        pairs[gid] = pair(gid)
        pairs[gid][0]['plays'] = [{'eventId': i, 'synthetic_context': 'x' * 512} for i in range(600)]
        large = source_row(gid, box=False)
        large.update(raw_json=pairs[gid][0], content_sha256=fetcher._sha256_of(pairs[gid][0]))
        db.insert('raw_nhl_data', [large])
        original = row(gid)
        assert run(gid) == 0
        assert row(gid) == {**original, 'boxscore_json': pairs[gid][1]}
        phases.append('large_payload_missing_box_jsonb_cas_preserves_other_fields')

        gid = 2024020003
        db.insert('raw_nhl_data', [source_row(gid, box=False)])
        concurrent = row(gid)
        concurrent['raw_json']['source_correction'] = True
        concurrent['content_sha256'] = fetcher._sha256_of(concurrent['raw_json'])
        class CorrectionRace(fetcher.SupabaseRest):
            def rpc(self, name, args):
                if name == 'citrus_fill_archive_boxscore':
                    racing_db.update('raw_nhl_data', {'raw_json': concurrent['raw_json'],
                                        'content_sha256': concurrent['content_sha256']},
                                 [('game_id', 'eq', gid)])
                return super().rpc(name, args)
        assert run(gid, CorrectionRace(base_url, token)) == 1
        assert row(gid) == concurrent
        phases.append('concurrent_pbp_correction_cas_noop_preserves_concurrent_row')

        gid = 2024020004
        concurrent = source_row(gid)
        concurrent['raw_json']['concurrent_insert'] = True
        concurrent['content_sha256'] = fetcher._sha256_of(concurrent['raw_json'])
        inserted = {}
        class InsertRace(fetcher.SupabaseRest):
            def insert(self, table, rows):
                racing_db.insert(table, [concurrent])
                inserted.update(row(gid))
                super().insert(table, rows)
        assert run(gid, InsertRace(base_url, token)) == 1
        assert row(gid) == inserted
        phases.append('duplicate_insert_conflict_preserves_concurrent_row')

        gid = 2024020001
        pairs[gid][0]['later_correction'] = True
        assert run(gid) == 1 and row(gid) == frozen
        phases.append('existing_correction_withheld_old_row_preserved')
    finally:
        fetcher.citrus_request, fetcher.time.sleep = original_http, original_sleep
    return {'status': 'passed', 'phases': phases, 'synthetic_fixture': True,
            'hosted_access': False, 'nhl_network_used': False,
            'scope': 'structural_pair_integrity_not_official_stat_adjudication'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--print-fixture-ddl', action='store_true')
    parser.add_argument('--base-url')
    parser.add_argument('--token-file', type=Path)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    if args.print_fixture_ddl:
        print(FIXTURE_DDL)
        return
    if not args.base_url or not args.token_file or not args.report:
        parser.error('base-url, synthetic token-file and new report path required')
    if args.report.exists():
        parser.error('Report must not already exist')
    result = run_local(args.base_url, args.token_file.read_text().strip())
    with args.report.open('x') as stream:
        json.dump(result, stream, indent=2)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
