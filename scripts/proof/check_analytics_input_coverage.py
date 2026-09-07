"""Fail on unreviewed changes to inventoried inputs; never infer acceptance.

The initial ledger deliberately leaves every delivery gate open. Coverage is
not predictive validation or an exhaustive deployed-runtime discovery claim.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path
from audit_legacy_xg_inputs import build, literal_assignment, ROOT

LEDGER = ROOT / 'docs/analytics-input-coverage-ledger-20260907-v9.json'
FAMILIES = ('neutral_xg', 'pass_movement_context', 'rebound_probability',
            'rebound_continuation_value', 'flurry_accounting', 'shooting_talent',
            'created_xg', 'expected_assists', 'goalie_gsax', 'goalie_rebound_control',
            'rink_adjustment', 'penalty_strength_context', 'shift_rest_composition',
            'daily_physical_forecasts', 'joint_forecast_uncertainty', 'onice_gar',
            'fantasy_fpar', 'possession_action_value_research')
GATES = ('source_semantics', 'availability_and_identity', 'causal_timing',
         'training_and_serving_parity', 'chronological_quality', 'consumer_lineage')


def scope():
    inventory = build()
    items = {}
    for version, names in inventory['training_feature_lists'].items():
        for name in names:
            items[f'training:{version}:{name}'] = {'kind': 'declared_training_input', 'name': name}
    for record in inventory['shot_record_assignments']:
        for field in record['fields']:
            key = f'extractor:{record["line"]}:{field["name"]}'
            if key in items:
                raise ValueError('Duplicate inventory identity')
            items[key] = {'kind': 'emitted_field_not_necessarily_predictor', **field}
    for name in inventory['development_numeric_features'] + inventory['development_categorical_features']:
        items[f'development:{name}'] = {'kind': 'experimental_input', 'name': name}
    for name in FAMILIES:
        items[f'family:{name}'] = {'kind': 'model_or_research_family', 'name': name}
    # Discover additions/removals, not only edits to an already known file list.
    catalog = {}
    for directory in ('data-pipeline/projections', 'data-pipeline/acquisition',
                      'data-pipeline/scoring', 'scripts/utilities'):
        for path in sorted((ROOT / directory).rglob('*.py')):
            catalog[str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
    for name in ('pre_shot_movement.py', 'pre_shot_history.py', 'fixed_feature_transform.py',
                 'pre_shot_zone_context.py', 'pre_shot_penalty_context.py', 'conditional_calibration_shape.py',
                 'pl_onice_membership.py', 'offline_xg_bundle.py', 'verified_movement_reuse.py',
                 'verified_movement_reuse_v2.py', 'recorded_penalty_features.py', 'xg_candidate_inference.py'):
        items[f'new_component:{name}'] = {'kind': 'offline_component_requires_integration', 'name': name}
    movement = ast.parse((ROOT / 'data-pipeline/projections/pre_shot_movement.py').read_text())
    for name in literal_assignment(movement, 'NAMES'):
        items[f'new_movement_input:{name}'] = {'kind': 'offline_movement_measurement', 'name': name}
    zone = ast.parse((ROOT / 'data-pipeline/projections/pre_shot_zone_context.py').read_text())
    for name in literal_assignment(zone, 'NAMES') + ['zone', 'status']:
        items[f'new_zone_input:{name}'] = {'kind': 'offline_zone_comparator', 'name': name}
    penalty = ast.parse((ROOT / 'data-pipeline/projections/pre_shot_penalty_context.py').read_text())
    empty = next(node for node in penalty.body if isinstance(node, ast.FunctionDef) and node.name == '_empty')
    returns = [node.value for node in ast.walk(empty) if isinstance(node, ast.Return)]
    if len(returns) != 1 or not isinstance(returns[0], ast.Dict):
        raise ValueError('Explicit penalty context field inventory required')
    for key in returns[0].keys:
        if not isinstance(key, ast.Constant) or not isinstance(key.value, str):
            raise ValueError('Literal penalty context field required')
        for channel in ('same_team', 'opponent'):
            name = channel + ':' + key.value
            items[f'new_penalty_context:{name}'] = {'kind': 'recorded_annotation_not_active_penalty', 'name': name}
    onice = ast.parse((ROOT / 'data-pipeline/projections/pl_onice_membership.py').read_text())
    # Conservative enumeration includes literal intermediate/output fields;
    # none is automatically an eligible predictor or a verified shift input.
    names = {key.value for node in ast.walk(onice) if isinstance(node, ast.Dict)
             for key in node.keys if isinstance(key, ast.Constant) and isinstance(key.value, str)}
    if not {'publishable', 'prediction_eligible', 'report_rows', 'player_ids'} <= names:
        raise ValueError('Explicit retrospective membership contract required')
    for name in sorted(names):
        items[f'new_onice_annotation:{name}'] = {'kind': 'retrospective_membership_not_verified_pre_shot', 'name': name}
    for module in ('offline_xg_bundle', 'verified_movement_reuse', 'verified_movement_reuse_v2', 'xg_candidate_inference'):
        tree = ast.parse((ROOT / f'data-pipeline/projections/{module}.py').read_text())
        fields = {key.value for node in ast.walk(tree) if isinstance(node, ast.Dict)
                  for key in node.keys if isinstance(key, ast.Constant) and isinstance(key.value, str)}
        for node in tree.body:
            if isinstance(node, ast.ClassDef) and node.name == 'VerifiedFeatures':
                fields.update(field.target.id for field in node.body
                              if isinstance(field, ast.AnnAssign) and isinstance(field.target, ast.Name))
        for name in sorted(fields):
            items[f'new_offline_contract:{module}:{name}'] = {
                'kind': 'offline_contract_field_not_production_acceptance', 'name': name}
    plan_path = 'docs/analytics-recorded-penalty-candidate-plan-20260906.json'
    plan_bytes = (ROOT / plan_path).read_bytes()
    plan = json.loads(plan_bytes)
    if plan.get('contract') != 'citrus-recorded-penalty-candidate-v1:plan' or plan.get('publishable') is not False:
        raise ValueError('Explicit nonpublishing recorded-penalty feature plan required')
    for kind, group in (('numeric', 'append_numeric'), ('categorical', 'append_categorical')):
        definitions = plan['features'][group]
        if not isinstance(definitions, list) or len(definitions) != 4:
            raise ValueError('Exact four numeric and four categorical penalty obligations required')
        for definition in definitions:
            key = 'recorded_penalty_predictor:' + definition['name']
            if key in items or not definition.get('source'):
                raise ValueError('Unique explicit penalty predictor source mapping required')
            if kind == 'numeric' and (not definition.get('unit') or 'range' not in definition):
                raise ValueError('Numeric penalty unit and range required')
            if kind == 'categorical' and not ('allowed' in definition or 'rule' in definition):
                raise ValueError('Categorical penalty state semantics required')
            items[key] = {'kind': 'candidate_recorded_annotation_not_active_penalty',
                          'predictor_type': kind, 'definition': definition, 'plan_path': plan_path,
                          'mapping_module': 'data-pipeline/projections/recorded_penalty_features.py',
                          'source_module': 'data-pipeline/projections/pre_shot_penalty_context.py'}
    return {'source_sha256': inventory['source_sha256'], 'python_source_catalog': catalog, 'items': items,
            'plan_source_sha256': {plan_path: hashlib.sha256(plan_bytes).hexdigest()}}


def initial(current):
    return {'version': 'citrus-input-coverage-ledger-v1', 'scope': current,
            'items': {key: {'disposition': 'unresolved',
                            'gates': {g: {'status': 'open', 'evidence_sha256': {}} for g in GATES}}
                      for key in current['items']},
            'limitations': ['Static inventoried source only; undiscovered modules and deployed artifacts remain open.',
                            'Recorded outcomes are retained but not automatically eligible predictors.',
                            'Coverage success is not acceptance. Require all gates separately.']}


def check(ledger, current, *, require_accepted=False):
    if ledger.get('version') != 'citrus-input-coverage-ledger-v1':
        raise ValueError('Unsupported ledger')
    if ledger.get('scope') != current:
        raise ValueError('Source or input inventory changed: explicit scope reconciliation required')
    if set(ledger.get('items', {})) != set(current['items']):
        raise ValueError('Missing or extra tracked inputs')
    opened = 0
    for item in ledger['items'].values():
        if item.get('disposition') not in ('unresolved', 'candidate_predictor', 'actual_or_target', 'metadata', 'separate_quantity', 'research_only'):
            raise ValueError('Explicit valid disposition required')
        if set(item.get('gates', {})) != set(GATES):
            raise ValueError('Every delivery gate required')
        opened += item['disposition'] == 'unresolved'
        for gate in item['gates'].values():
            if gate.get('status') not in ('open', 'verified', 'not_applicable'):
                raise ValueError('Invalid gate status')
            evidence = gate.get('evidence_sha256')
            if not isinstance(evidence, dict):
                raise ValueError('Evidence map required')
            if gate['status'] != 'open' and not evidence:
                raise ValueError('Closing or exempting a gate requires evidence')
            for relative, expected in evidence.items():
                path = (ROOT / relative).resolve()
                if not path.is_relative_to(ROOT) or not path.is_file():
                    raise ValueError('Evidence must be a local workspace file')
                if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                    raise ValueError('Evidence changed')
            opened += gate['status'] == 'open'
    if require_accepted and opened:
        raise ValueError('Acceptance blocked: unresolved inputs or delivery gates remain')
    return {'status': 'coverage_reconciled_only', 'items': len(current['items']),
            'open_decisions_and_gates': opened, 'accepted': opened == 0,
            'production_authorized_by_this_check': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--initialize', action='store_true')
    parser.add_argument('--require-accepted', action='store_true')
    args = parser.parse_args()
    current = scope()
    if args.initialize:
        with LEDGER.open('x') as stream:
            json.dump(initial(current), stream, indent=2, allow_nan=False)
            stream.write('\n')
    print(json.dumps(check(json.loads(LEDGER.read_text()), current, require_accepted=args.require_accepted)))
