"""Executable contextual refresh using an independently pinned release policy.

The policy approves a source and exact methods, not arbitrary future model
outputs. Every run still reconciles the complete population before completing
the existing protected database transaction. No legacy per-row writes exist.
"""
import argparse
from datetime import date, datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'data-pipeline'))
from projections.contextual_attempt_journal import AttemptJournal
from projections.contextual_projection_service import ContextualProjectionService
from projections.contextual_refresh_worker import (
    ContextualRefreshWorker, WorkerError, encoded, strict_json, valid_revision)
from audit_matchup_population import audit as audit_population

PRODUCER_ARGUMENTS = ('capture', 'stints', 'model', 'opposition_review',
    'state_counts', 'defence', 'gar_replay', 'replay_input', 'count_calibration')
TEST_MARKERS = ('qa_fixture', 'qa_context_rehearsal', 'rollback_only_method_probe')


def digest(path):
    return sha256(Path(path).read_bytes()).hexdigest()


def read_policy(path, expected_sha256, *, project, as_of):
    """Refuse unreviewed, expired, substituted or wrong-project policies."""
    if not valid_revision(expected_sha256) or digest(path) != expected_sha256:
        raise WorkerError('release_policy_fingerprint_mismatch')
    policy = strict_json(Path(path).read_text())
    if (policy.get('schema') != 'citrus.contextual-release-policy.v1'
            or policy.get('status') != 'approved'
            or policy.get('project') != project
            or policy.get('scope') != 'preseason'
            or type(policy.get('season')) is not int
            or not valid_revision(policy.get('source_revision'))
            or not isinstance(policy.get('reviewer'), str) or not policy['reviewer'].strip()
            or not policy.get('review_evidence_sha256')
            or not policy.get('methods_sha256') or not policy.get('inputs_sha256')
            or not policy.get('model_version') or not policy.get('uncertainty_engine')
            or type(policy.get('draws')) is not int or policy['draws'] < 1000
            or set(policy.get('producer', {})) != set(PRODUCER_ARGUMENTS)):
        raise WorkerError('unapproved_or_incomplete_release_policy')
    if not (date.fromisoformat(policy['reviewed_at']) <= date.fromisoformat(as_of)
            < date.fromisoformat(policy['review_after'])):
        raise WorkerError('release_policy_review_due')
    for group in ('review_evidence_sha256', 'methods_sha256', 'inputs_sha256'):
        for name, expected in policy[group].items():
            path = (ROOT / name).resolve()
            if (not path.is_relative_to(ROOT) or not valid_revision(expected)
                    or digest(path) != expected):
                raise WorkerError('release_evidence_changed')
    # Pin the operational boundary as well as the numerical producer. The
    # historical package's hash list alone does not cover this entrypoint.
    required = ('scripts/ops/run_contextual_refresh.py',
        'scripts/ops/audit_matchup_population.py',
        'data-pipeline/projections/contextual_projection_service.py',
        'data-pipeline/projections/contextual_refresh_worker.py',
        'data-pipeline/projections/contextual_attempt_journal.py')
    if not all(name in policy['methods_sha256'] for name in required):
        raise WorkerError('unbound_worker_implementation')
    for name, value in policy['producer'].items():
        if not isinstance(value, str) or not (ROOT / value).resolve().is_relative_to(ROOT):
            raise WorkerError('invalid_producer_path')
        evidence_path = value.rstrip('/') + '/manifest.json' if name in ('capture', 'replay_input') else value
        if evidence_path not in policy['inputs_sha256']:
            raise WorkerError('unbound_producer_input')
    return policy


def approve_run(raw, games, context, policy):
    """Apply a separately reviewed release policy, never approve a new source."""
    candidate = strict_json(raw)
    if (candidate.get('source_revision') != policy['source_revision']
            or candidate.get('season') != policy['season']
            or candidate.get('contract', {}).get('publication_ready') is not True
            or candidate.get('publish_blockers') != []
            or any(k in candidate for k in TEST_MARKERS)
            or context.get('status') != 'review_only'
            or context.get('candidate_revision') != candidate.get('revision')
            or context.get('model_version') != policy['model_version']
            or context.get('uncertainty_engine') != policy['uncertainty_engine']
            or context.get('scoring_scope') != 'canonical_defaults_only'
            or context.get('counts_basis') != 'unconditional_remaining_season'):
        raise WorkerError('unapproved_source_or_context')
    as_of = candidate['refresh_at'][:10]
    if (context.get('as_of') != as_of or not policy['reviewed_at'] <= as_of < policy['review_after']
            or any((p.get('remaining', {}).get('actual_gp') or 0) > 0 for p in candidate['players'])):
        raise WorkerError('outside_reviewed_preseason_scope')
    evidence = context.get('producer_evidence', {})
    if evidence.get('inputs_sha256') != policy['inputs_sha256']:
        raise WorkerError('generated_input_evidence_mismatch')
    methods = evidence.get('methods_sha256', {})
    if not methods or any(policy['methods_sha256'].get(k) != v for k, v in methods.items()):
        raise WorkerError('generated_method_evidence_mismatch')
    result = audit_population(candidate, games,
        ({**row, 'canonical_revision': context['candidate_revision']} for row in context['rows']))
    if result['status'] != 'PASS' or result['rows'] == 0:
        raise WorkerError('independent_population_audit_failed')
    # The worker requires every field and row to be unchanged except status.
    return {**context, 'status': 'validated'}, result


def execute(service, *, policy_path, policy_sha256, project, attempt, resume=False,
            producer_factory=None, clock=None, emit=print, journal_factory=AttemptJournal,
            completion_mode='publish'):
    if completion_mode not in ('publish', 'prepare'):
        raise WorkerError('invalid_completion_mode')
    clock = clock or (lambda: datetime.now(timezone.utc))
    attempt = Path(attempt)
    if not resume and attempt.exists():
        raise WorkerError('new_attempt_directory_required')
    if resume and not (attempt / 'completion-request.exact.json').is_file():
        raise WorkerError('only_uncertain_saved_completion_can_resume')
    with journal_factory(attempt) as journal:
        worker = ContextualRefreshWorker(service, audit=journal.audit, save=journal.save, clock=clock)
        worker.event('policy', 'started', policy_sha256=policy_sha256, project=project)
        try:
            if resume:
                raw = (attempt / 'candidate.exact.json').read_text()
                as_of = strict_json(raw)['refresh_at'][:10]
                events = [strict_json(p.read_text()) for p in sorted(attempt.glob('event-*.json'))]
                prior = [e for e in events[:-1] if e['stage'] == 'policy' and e['status'] == 'accepted']
                if not prior or any(e.get('policy_sha256') != policy_sha256 or e.get('project') != project for e in prior):
                    raise WorkerError('retry_policy_or_project_changed')
            else:
                as_of = clock().astimezone(timezone.utc).date().isoformat()
            policy = read_policy(policy_path, policy_sha256, project=project, as_of=as_of)
            worker.event('policy', 'accepted', policy_sha256=policy_sha256, project=project,
                         source_revision=policy['source_revision'])
            if not resume:
                if producer_factory is None:
                    from contextual_population_producer import PopulationProducer
                    producer_factory = PopulationProducer

                def progress(event):
                    worker.event('generation', 'started', progress=event)
                    emit(encoded({'event': 'contextual.worker.progress', **event}))

                producer = producer_factory(**policy['producer'], draws=policy['draws'], progress=progress)
                def generate(raw, games, *, as_of):
                    candidate = strict_json(raw)
                    if (candidate.get('source_revision') != policy['source_revision']
                            or candidate.get('contract', {}).get('publication_ready') is not True
                            or candidate.get('publish_blockers') != []
                            or any(k in candidate for k in TEST_MARKERS)):
                        raise WorkerError('source_changed_or_unapproved')
                    return producer(raw, games, as_of=as_of)
                worker.generate(policy['season'], generate, source_revision=policy['source_revision'])
                raw = (attempt / 'candidate.exact.json').read_text()
            games = strict_json((attempt / 'schedule.json').read_text())
            review = strict_json((attempt / 'context.review.json').read_text())
            # Recheck policy bytes and code after the expensive model run.
            read_policy(policy_path, policy_sha256, project=project, as_of=as_of)
            approved, audit = approve_run(raw, games, review, policy)
            worker.event('independent_audit', 'complete', rows=audit['rows'],
                         maximum_count_error=audit['maximum_count_error'], policy_sha256=policy_sha256)
            if completion_mode == 'prepare':
                from projections.contextual_nightly import seal_request_body
                request = seal_request_body(raw, approved)
                journal.save('completion-request.exact.json', request)
                worker.event('completion', 'prepared', request_sha256=sha256(request.encode()).hexdigest())
                result = {'status': 'awaiting_publication', 'candidate_revision': strict_json(raw)['revision']}
                emit(encoded({'event': 'contextual.worker.prepared', 'ready_for_publication': True, **result}))
                return result
            result = worker.finish_review(raw, review, approved)
            emit(encoded({'event': 'contextual.worker.heartbeat', 'healthy': result['status'] in
                         ('success', 'already_active'), **result}))
            return result
        except Exception as error:
            # Do not overwrite an uncertain-completion journal state with a
            # misleading safe failure. The request might already be committed.
            from projections.contextual_refresh_worker import CompletionUncertain
            if not isinstance(error, CompletionUncertain):
                worker.event('runner', 'failed', error_type=type(error).__name__)
            emit(encoded({'event': 'contextual.worker.heartbeat', 'healthy': False,
                          'status': 'uncertain' if isinstance(error, CompletionUncertain) else 'failed',
                          'error_type': type(error).__name__}))
            raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--policy', type=Path, required=True)
    parser.add_argument('--policy-sha256', required=True)
    parser.add_argument('--project', required=True, choices=('iezwazccqqrhrjupxzvf', 'jjgspcpvqaiitloglxbb'))
    parser.add_argument('--attempt', type=Path, required=True)
    parser.add_argument('--resume', action='store_true')
    args = parser.parse_args(argv)
    try:
        url = os.environ.get('SUPABASE_URL')
        if url != 'https://' + args.project + '.supabase.co':
            raise WorkerError('configured_project_mismatch')
        service = ContextualProjectionService(url, os.environ.get('SUPABASE_SERVICE_ROLE_KEY'))
        result = execute(service, policy_path=args.policy, policy_sha256=args.policy_sha256,
                         project=args.project, attempt=args.attempt, resume=args.resume)
        return 0 if result['status'] in ('success', 'already_active') else 1
    except Exception as error:
        print(encoded({'event': 'contextual.worker.exit', 'healthy': False, 'error_type': type(error).__name__}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
