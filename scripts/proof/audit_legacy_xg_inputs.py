"""Read-only AST inventory; never imports acquisition/training or model binaries.

This is source wiring evidence, not a deployed artifact or data-coverage audit.
Generated receipts are create-only. Keep outcome fields even though they must
not enter pre-shot predictors.
"""
import ast
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
FILES = ['scripts/utilities/train_xg_v3.py', 'scripts/utilities/train_xg_v4.py',
         'data-pipeline/acquisition/data_acquisition.py',
         'scripts/utilities/feature_calculations.py',
         'data-pipeline/projections/compact_feature_export.py',
         'data-pipeline/projections/development_feature_export.py']


def literal_assignment(tree, name):
    for node in tree.body:
        targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, ast.AnnAssign) else []
        if any(isinstance(t, ast.Name) and t.id == name for t in targets):
            return list(ast.literal_eval(node.value))
    raise ValueError(name)


def build():
    bodies = {p: (ROOT / p).read_bytes() for p in FILES}
    trees = {p: ast.parse(b) for p, b in bodies.items()}
    training = {v: literal_assignment(trees[FILES[i]], v.upper() + '_FEATURES')
                for i, v in enumerate(['v3', 'v4'])}
    records = []
    for node in ast.walk(trees[FILES[2]]):
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'shot_record' for t in node.targets):
            if not isinstance(node.value, ast.Dict):
                raise ValueError('Nonliteral shot_record requires manual audit')
            fields = []
            for k, v in zip(node.value.keys, node.value.values):
                name = ast.literal_eval(k)
                fields.append({'name': name, 'line': k.lineno, 'expression': ast.unparse(v),
                               'v3_selected': name in training['v3'], 'v4_selected': name in training['v4']})
            records.append({'line': node.lineno, 'fields': fields})
    compact = trees[FILES[4]]
    names = literal_assignment(compact, 'BASELINE_FEATURES') + literal_assignment(compact, 'CONTEXT_FEATURES')
    names += literal_assignment(trees[FILES[5]], 'EXTRA_NUMERIC')
    return {'status': 'static-source-inventory-only', 'publishable': False,
            'source_sha256': {p: hashlib.sha256(b).hexdigest() for p, b in bodies.items()},
            'training_feature_lists': training, 'shot_record_assignments': sorted(records, key=lambda r: r['line']),
            'development_numeric_features': names,
            'development_categorical_features': ['shot_type', 'previous_event_type'],
            'limitations': ['Declared training list is not proof of deployed model schema.',
                           'Emitted key is not proof of populated, causal, varying or consumed data.',
                           'Different feature names may encode related concepts; no automatic semantic equivalence.',
                           'This inventories literal shot_record dictionaries, not every database or runtime field.']}


if __name__ == '__main__':
    result = build()
    with Path(sys.argv[1]).open('x') as stream:
        json.dump(result, stream, indent=2, allow_nan=False)
        stream.write('\n')
    print(json.dumps({'record_sizes': [len(r['fields']) for r in result['shot_record_assignments']],
                      'training_sizes': {k: len(v) for k, v in result['training_feature_lists'].items()}}))
