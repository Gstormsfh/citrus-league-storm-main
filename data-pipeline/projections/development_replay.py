"""Create-only development execution after complete frozen-source byte replay.

Hashes establish consistency of the declared local evidence, not publisher
authentication or historical availability. No later-season event files or legacy
model artifacts are opened. Source inventories are compared, never repaired.
"""
import argparse
from collections import Counter
from contextlib import ExitStack
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
from pathlib import Path

from projections.analytics_publication import fingerprint
from projections import development_feature_export as exporter
from projections import development_experiment as evaluator
from projections.development_experiment import (FOLD_WINDOWS, run_development_experiment,
    validate_configuration, validate_memberships)
from projections.chronological_fit import cohort_digests
from projections.chronological_experiment import _persist
from projections.verified_export_experiment import DEPENDENCIES, file_sha, strict_json

VERSION = 'citrus-source-replayed-development-v1'
FILES = ('development.jsonl', 'groups.jsonl', 'feature-audit.jsonl', 'game-inventory.jsonl')
INNER_FILES = {'declaration.json','groups.json'} | {
    fold + '/' + name for fold in FOLD_WINDOWS for name in (
        'geometry.pickle','base_context.pickle','enhanced_context.pickle',
        'fit-receipt.json','predictions.json','base-scorecard.json',
        'enhanced-scorecard.json','context_ablation-scorecard.json','health.json')}


def _canonical(path):
    path = Path(path).absolute()
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError('Nonsymlink evidence path required')
    return path.resolve()


def _safe(path):
    path = _canonical(path)
    if not path.is_file():
        raise ValueError('Regular nonsymlink evidence file required')
    return path


class Replay:
    def __init__(self, freeze_dir, export_dir, plan_path, *, now=None):
        self.freeze = _canonical(freeze_dir)
        self.export = _canonical(export_dir)
        self.checked = {}
        self.now = now or datetime.now(timezone.utc).isoformat()
        pipeline = Path(__file__).resolve().parents[1]
        self.export_code = {str(pipeline / n) for n in DEPENDENCIES} | {
            str(pipeline / ('projections/' + n + '.py')) for n in (
                'development_feature_export', 'verified_export_experiment', 'chronological_fit',
                'probability_scorecard', 'chronological_experiment')}
        for p in self.export_code | {str(Path(__file__).resolve()),
                                     str(pipeline / 'projections/development_experiment.py')}:
            self.checked[p] = file_sha(_safe(p))
        self.plan_path = _safe(plan_path)
        self.plan = strict_json(self.read(self.plan_path))
        p = self.plan
        if (p.get('contract') != 'citrus-earlier-development-ablation-plan-v1'
                or p.get('schema') != exporter.SCHEMA or p.get('source_seasons') != exporter.SEASONS
                or p.get('publishable') is not False or p.get('folds') != FOLD_WINDOWS
                or p.get('historical_as_of_verified') is not False or p.get('untouched_test_claim') is not False
                or p.get('evidence_claim') != 'retrospective_current_source_revisions'
                or not isinstance(p.get('selection'), dict)
                or p['selection'].get('version') != 'equal_fold_probability_shortlist-v1'
                or p['selection'].get('automatic_acceptance_or_serving_promotion') is not False
                or p['selection'].get('later_2025_observed_test_used_for_ranking') is not False
                or p['selection'].get('ranking') != ['mean_fold_log_loss_equal_fold_weight',
                    'mean_fold_Brier_equal_fold_weight','fixed_complexity_tie_order']):
            raise ValueError('Exact predeclared nonpublishing development plan required')
        limits = {'max_numeric_features':evaluator.MAX_NUMERIC_FEATURES,
            'max_categorical_features':evaluator.MAX_CATEGORICAL_FEATURES,
            'max_rows_per_fold':evaluator.MAX_ROWS_PER_FOLD,
            'max_categories_per_field':evaluator.MAX_CATEGORIES_PER_FIELD,
            'max_design_cells_per_fold':evaluator.MAX_DESIGN_CELLS,
            'policy':'reject_before_dense_design_no_truncation_or_category_merging','cpu_threads':1}
        if fingerprint(p.get('operational_limits')) != fingerprint(limits):
            raise ValueError('Declared operational limits differ from evaluator guards')
        validate_configuration(p['schema'], p['config'])
        self.manifest_path = self.export / 'manifest.json'
        m = self.manifest = strict_json(self.read(self.manifest_path))
        expected_keys = {'contract','status','publishable','historical_as_of_verified','observed_at',
            'schema','source_seasons','counts','evidence_file_sha256','plan_sha256','outputs',
            'later_period_event_files_opened','limitations','manifest_sha256'}
        if (set(m) != expected_keys or m['contract'] != exporter.VERSION
                or m['status'] != 'complete-development-export-not-fit-accepted'
                or m['publishable'] is not False or m['historical_as_of_verified'] is not False
                or m['later_period_event_files_opened'] is not False
                or m['schema'] != p['schema'] or m['source_seasons'] != exporter.SEASONS
                or m['plan_sha256'] != self.checked[str(self.plan_path)]
                or m['manifest_sha256'] != fingerprint({k:v for k,v in m.items() if k != 'manifest_sha256'})
                or set(m['outputs']) != set(FILES)):
            raise ValueError('Invalid complete development manifest')
        health = strict_json(self.read(self.export / 'health.json'))
        if health != {'status':m['status'], 'manifest_file_sha256':self.checked[str(self.manifest_path)],
                       'publishable':False}:
            raise ValueError('Invalid export health')
        schedule_path = self.freeze / 'schedule-manifest.json'
        schedule = strict_json(self.read(schedule_path))
        if self.checked[str(schedule_path)] != p['source_schedule_sha256']:
            raise ValueError('Schedule differs from declared bytes')
        self.expected = {}
        for season in exporter.SEASONS:
            report = schedule[str(season)]
            if (report['season'] != season or report['window_complete'] is not True
                    or report['reported_season_within_window'] is not True or report['unresolved_game_ids']):
                raise ValueError('Incomplete selected schedule')
            for gid in report['terminal_game_ids']:
                if type(gid) is not int or gid // 1000000 != season or gid in self.expected:
                    raise ValueError('Invalid or duplicate selected identity')
                identity = report['games'][str(gid)]
                w = exporter.SOURCE_WINDOWS['train']
                if not w['start'] <= identity['date'] <= w['end']:
                    raise ValueError('Later or out-of-window game forbidden')
                self.expected[gid] = identity
        if not self.expected or len(self.expected) > 7000:
            raise ValueError('Bounded complete development population required')
        source_paths = {str(path) for gid in self.expected for path in self.paths(gid)}
        expected_evidence = self.export_code | source_paths | {str(self.plan_path), str(schedule_path)}
        if set(m['evidence_file_sha256']) != expected_evidence:
            raise ValueError('Exact source and code closure required')
        for path in self.export_code | {str(self.plan_path), str(schedule_path)}:
            if m['evidence_file_sha256'][path] != self.checked[path]:
                raise ValueError('Export dependency changed')
        self.verify()

    def paths(self, gid):
        folder = self.freeze / str(gid // 1000000) / 'pbp'
        return folder / f'{gid}.body.json', folder / f'{gid}.receipt.json'

    def read(self, path):
        path = _safe(path)
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if str(path) in self.checked and self.checked[str(path)] != digest:
            raise ValueError('Consumed evidence changed')
        self.checked[str(path)] = digest
        return raw

    def verify(self):
        if (self.export / 'failure.json').exists():
            raise ValueError('Export failure evidence present')
        for path, digest in self.checked.items():
            if file_sha(_safe(path)) != digest:
                raise ValueError('Consumed source/export/code drift')
        for name, meta in self.manifest['outputs'].items():
            path = _safe(self.export / name)
            if (set(meta) != {'bytes','sha256'} or type(meta['bytes']) is not int or meta['bytes'] < 0
                    or path.stat().st_size != meta['bytes'] or file_sha(path) != meta['sha256']):
                raise ValueError('Export output bytes changed')

    def replay(self):
        rows, groups, counts = [], [], Counter()
        hashes = {n:hashlib.sha256() for n in FILES}
        sizes = Counter()
        with ExitStack() as stack:
            streams = {n:stack.enter_context(_safe(self.export / n).open('rb')) for n in FILES}
            def compare(name, row):
                consumed = streams[name].readline()
                expected = (exporter._json(row) + '\n').encode()
                if consumed != expected:
                    raise ValueError('Source replay differs from complete export inventory')
                hashes[name].update(consumed); sizes[name] += len(consumed)
            for gid, identity in sorted(self.expected.items()):
                body_path, receipt_path = self.paths(gid)
                body, receipt_bytes = self.read(body_path), self.read(receipt_path)
                for path in (body_path, receipt_path):
                    if self.checked[str(path)] != self.manifest['evidence_file_sha256'][str(path)]:
                        raise ValueError('Source bytes differ from export')
                receipt = strict_json(receipt_bytes)
                if receipt['schedule_identity'] != identity:
                    raise ValueError('Detached source schedule identity')
                source = exporter.adapt_frozen_feature_source(body, receipt, now=self.now)
                projected = exporter.project_development_game(source, evidence_kind='real', now=self.now)
                game = projected['game_inventory']
                game.update(source_body_file=str(body_path), source_receipt_file=str(receipt_path),
                    source_body_bytes_sha256=self.checked[str(body_path)],
                    source_receipt_bytes_sha256=self.checked[str(receipt_path)])
                for key, name in [('rows',FILES[0]),('groups',FILES[1]),('feature_audit',FILES[2])]:
                    for row in projected[key]: compare(name, row)
                compare(FILES[3], game)
                rows.extend(projected['rows']); groups.extend(projected['groups'])
                counts['games'] += 1; counts['eligible_events'] += len(projected['rows'])
                counts['source_excluded_games'] += game['source_excluded_game']
                counts['candidate_events'] += len(projected['feature_audit'])
                if counts['games'] % 100 == 0:
                    print(exporter._json({'event':'development_replay.progress',**dict(counts)}),flush=True)
            if any(s.read(1) for s in streams.values()):
                raise ValueError('Extra export inventory rows')
        for name in FILES:
            if self.manifest['outputs'][name] != {'sha256':hashes[name].hexdigest(),'bytes':sizes[name]}:
                raise ValueError('Consumed output differs from manifest')
            self.checked[str(self.export / name)] = hashes[name].hexdigest()
        if dict(counts) != self.manifest['counts']:
            raise ValueError('Population count mismatch')
        rows.sort(key=lambda r:(r['game_date'],r['game_id'],r['event_id']))
        folds, grouped = {}, {}
        for name, windows in FOLD_WINDOWS.items():
            folds[name] = {}
            for split, window in windows.items():
                selected = [{**r,'split':split} for r in rows if window['start'] <= r['game_date'] <= window['end']]
                folds[name][split] = {'split':split,'window':deepcopy(window),'rows':selected,**cohort_digests(selected)}
            ids = {(r['game_id'],r['event_id']) for r in folds[name]['validation']['rows']}
            selected = sorted((g for g in groups if (g['game_id'],g['event_id']) in ids),
                              key=lambda g:(g['game_id'],g['event_id']))
            if len(selected) != len(ids) or {(g['game_id'],g['event_id']) for g in selected} != ids:
                raise ValueError('Exact validation group membership required')
            grouped[name] = {'rows':selected,'sha256':fingerprint(selected)}
        validate_memberships(folds, self.plan['schema'])
        self.verify()
        return folds, grouped


def run_replayed_development(freeze_dir, export_dir, plan_path, output, *, now=None):
    output = _canonical(output)
    output.mkdir(exist_ok=False)
    try:
        outer = {str(output / 'attempt-started.json'):
            _persist(output, 'attempt-started.json', {'contract':VERSION,'publishable':False})}
        replay = Replay(freeze_dir, export_dir, plan_path, now=now)
        folds, groups = replay.replay()
        outer[str(output / 'source-replay.json')] = _persist(output, 'source-replay.json', {'contract':VERSION,'publishable':False,
            'consumed_file_sha256':replay.checked, 'folds_sha256':fingerprint(folds),
            'groups_sha256':fingerprint(groups),'later_period_event_files_opened':False})
        replay.verify()
        inner = output / 'experiment'
        print(exporter._json({'event':'development_replay.fit_dispatch',
            'fold_rows':{name:{s:len(c['rows']) for s,c in parts.items()} for name,parts in folds.items()},
            'publishable':False}),flush=True)
        result = run_development_experiment(folds=folds, groups=groups,
            schema=replay.plan['schema'], config=replay.plan['config'],
            provenance={'source_manifest_sha256':replay.checked[str(replay.manifest_path)],
                'execution_plan_sha256':replay.checked[str(replay.plan_path)],'evidence_kind':'real'}, output=inner)
        health_bytes = _safe(inner / 'health.json').read_bytes()
        health = strict_json(health_bytes)
        if (set(health) != {'status','folds','files','code_drift_verified','publishable','no_late_period_access'}
                or health != result or health['status'] != 'completed-development-not-selected-not-publishable'
                or health['folds'] != list(FOLD_WINDOWS) or health['code_drift_verified'] is not True
                or health['no_late_period_access'] is not True or set(health['files']) != INNER_FILES
                or health['publishable'] is not False or (inner / 'failure.json').exists()):
            raise ValueError('Incomplete evaluator artifacts')
        checked = {str(inner / 'health.json'):hashlib.sha256(health_bytes).hexdigest()}
        for name, digest in health['files'].items():
            rel = Path(name)
            if (not isinstance(name,str) or rel.is_absolute() or '..' in rel.parts
                    or rel.as_posix() != name or name in ('health.json','failure.json')):
                raise ValueError('Unsafe evaluator artifact')
            path = _safe(inner / rel)
            if file_sha(path) != digest: raise ValueError('Evaluator artifact drift')
            checked[str(path)] = digest
        # The evaluator's health indexes model/score artifacts; also bind its
        # retained start markers without pretending those were evaluator-hashed.
        indexed = {str(inner / n) for n in health['files']} | {str(inner / 'health.json')}
        allowed_starts = {str(inner / 'attempt-started.json')} | {
            str(inner / fold / 'attempt-started.json') for fold in FOLD_WINDOWS}
        for path in allowed_starts:
            checked[path] = file_sha(_safe(path))
        for path in inner.rglob('*'):
            if path.is_symlink(): raise ValueError('Symlink evaluator artifact')
            if path.is_file() and str(path) not in indexed:
                if str(path) not in allowed_starts: raise ValueError('Unindexed evaluator artifact')
                checked[str(path)] = file_sha(_safe(path))
        checked.update(outer)
        replay.verify()
        report = {'contract':VERSION,'status':'complete-source-replayed-development-not-publishable',
            'publishable':False,'selection':'not-executed','artifacts_sha256':checked,
            'source_manifest_sha256':replay.checked[str(replay.manifest_path)]}
        final_sha = _persist(output, 'health.json', report)
        replay.verify()
        if (file_sha(_safe(output / 'health.json')) != final_sha
                or any(file_sha(_safe(p)) != h for p,h in checked.items())
                or (inner / 'failure.json').exists()
                or {str(p) for p in inner.rglob('*') if p.is_file()} !=
                    {p for p in checked if Path(p).is_relative_to(inner)}):
            raise ValueError('End artifact drift')
        return report
    except BaseException as exc:
        try: _persist(output, 'failure.json', {'status':'failed-source-replayed-development',
                      'error_type':type(exc).__name__,'publishable':False})
        except OSError: pass
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('freeze-dir','export-dir','plan','output'): parser.add_argument('--'+name, required=True)
    args = parser.parse_args()
    try: run_replayed_development(args.freeze_dir,args.export_dir,args.plan,args.output)
    except BaseException as exc:
        print(exporter._json({'status':'failed-source-replayed-development','error_type':type(exc).__name__}))
        return 1
    return 0


if __name__ == '__main__': raise SystemExit(main())
