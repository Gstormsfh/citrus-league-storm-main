"""Read-only reuse of one pinned completed movement-feature certification.

No training, source projector invocation or model deserialization. Rehashes all
source bytes and certification closure each time. This reuses the historical
certification instant, not a new source-freshness or historical-as-of claim.
"""
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import platform
from pathlib import Path

from projections.analytics_publication import fingerprint
from projections.chronological_fit import cohort_digests
from projections.development_experiment import FOLD_WINDOWS, validate_memberships, validate_configuration
from projections.verified_export_experiment import strict_json

VERSION = 'citrus-verified-movement-feature-reuse-v1'
CONDITIONAL = 'scripts/proof/results/official-conditional-shape-20260906-full'
MOVEMENT = 'scripts/proof/results/official-movement-20260906-full'
EXPORT = 'scripts/proof/results/official-development-features-20260906'
CERTIFICATES = {
    CONDITIONAL: ('0e395d181d810d1c616a3787633d778c9c0b75e76844304f45001663944f19c7', 'complete-conditional-shape-development-not-accepted'),
    MOVEMENT: ('efc58de50aefff913948e624324b97db7ebc57d9edaa1a1c243eb277c925ac22', 'complete-movement-development-not-accepted'),
}
MAX_ROWS = 1_000_000


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        while part := stream.read(1024 * 1024):
            result.update(part)
    return result.hexdigest()


class Closure:
    def __init__(self, root):
        self.root = Path(root).absolute()
        self.checked, self.inventories = {}, {}

    def safe(self, name):
        path = Path(name)
        if not path.is_absolute():
            if '..' in path.parts or path.as_posix() != name:
                raise ValueError('Canonical input path required')
            path = self.root / path
        if not path.is_relative_to(self.root) or any(p.is_symlink() for p in (path, *path.parents)) or not path.is_file():
            raise ValueError('Regular nonsymlink repository input required')
        return path

    def pin(self, name, expected):
        path = self.safe(name)
        if (not isinstance(expected, str) or len(expected) != 64
                or any(c not in '0123456789abcdef' for c in expected)):
            raise ValueError('Exact SHA256 required')
        key = str(path.relative_to(self.root))
        if key in self.checked:
            if self.checked[key] != expected:
                raise ValueError('Conflicting digest declarations')
            return
        if digest(path) != expected:
            raise ValueError('Certified input drift: ' + key)
        self.checked[key] = expected

    def read(self, name):
        path = self.safe(name)
        raw = path.read_bytes()
        sha = hashlib.sha256(raw).hexdigest()
        key = str(path.relative_to(self.root))
        if key in self.checked and self.checked[key] != sha:
            raise ValueError('Input drift during read')
        self.pin(name, sha)
        return strict_json(raw)

    def mapping(self, mapping):
        if not isinstance(mapping, dict) or not mapping:
            raise ValueError('Nonempty source closure required')
        for name, sha in mapping.items():
            self.pin(name, sha)

    def inventory(self, folder, expected):
        directory = self.root / folder
        if directory.is_symlink() or not directory.is_dir():
            raise ValueError('Safe evidence directory required')
        actual = set()
        for path in directory.rglob('*'):
            if path.is_symlink() or not (path.is_file() or path.is_dir()):
                raise ValueError('Unsafe evidence member')
            if path.is_file():
                actual.add(path.relative_to(directory).as_posix())
        if actual != set(expected):
            raise ValueError('Exact certified inventory required')
        self.inventories[folder] = sorted(actual)

    def verify(self):
        for name, expected in self.checked.items():
            if digest(self.safe(name)) != expected:
                raise ValueError('End input drift: ' + name)
        for folder, expected in list(self.inventories.items()):
            self.inventory(folder, expected)

    def lines(self, name):
        path = self.safe(name)
        if str(path.relative_to(self.root)) not in self.checked:
            raise ValueError('JSONL must be certified before reading')
        result = []
        with path.open('rb') as stream:
            for line in stream:
                if len(result) >= MAX_ROWS or len(line) > 100_000:
                    raise ValueError('Bounded JSONL required')
                result.append(strict_json(line))
        return result


def reconstruct(rows, groups, extra, schema, expected):
    """Pure cohort reconstruction; duplicate/omitted/malformed rows fail closed."""
    if not rows or len(rows) > MAX_ROWS or len(groups) != len(rows):
        raise ValueError('Exact bounded row/group population required')
    ids = {(r['game_id'], r['event_id']) for r in rows}
    group_map = {(r['game_id'], r['event_id']): r for r in groups}
    if len(ids) != len(rows) or len(group_map) != len(groups) or ids != set(group_map) or ids != set(extra):
        raise ValueError('Exact unique feature/group identity required')
    augmented = []
    for row in rows:
        if row['split'] != 'development':
            raise ValueError('Original development rows required')
        values = row['features'] + extra[row['game_id'], row['event_id']]
        augmented.append({**row, 'features': values, 'feature_sha256': fingerprint({
            'schema_sha256': fingerprint(schema), 'values': values, 'categorical': row['categorical']})})
    augmented.sort(key=lambda r: (r['game_date'], r['game_id'], r['event_id']))
    folds, grouped = {}, {}
    for fold, windows in FOLD_WINDOWS.items():
        folds[fold] = {}
        for split, window in windows.items():
            selected = [{**row, 'split': split} for row in augmented if window['start'] <= row['game_date'] <= window['end']]
            meta = {'split': split, 'window': deepcopy(window), **cohort_digests(selected)}
            if meta != expected[fold][split]:
                raise ValueError('Certified cohort digest mismatch')
            folds[fold][split] = {**meta, 'rows': selected}
        selected_groups = sorted((group_map[r['game_id'], r['event_id']] for r in folds[fold]['validation']['rows']),
                                 key=lambda r: (r['game_id'], r['event_id']))
        grouped[fold] = {'rows': selected_groups, 'sha256': fingerprint(selected_groups)}
    validate_memberships(folds, schema)
    return folds, grouped


@dataclass
class VerifiedFeatures:
    folds: dict
    groups: dict
    schema: dict
    config: dict
    cache_key: str
    certification_instant: str
    closure: Closure

    def verify(self):
        self.closure.verify()


def load(root):
    """Load a verified fast path; failure never silently invokes slow replay."""
    closure = Closure(root)
    closure.pin(str(Path(__file__).absolute()), digest(Path(__file__)))
    for folder, (sha, status) in CERTIFICATES.items():
        closure.pin(folder + '/health.json', sha)
        health = closure.read(folder + '/health.json')
        if health['status'] != status or health['publishable'] is not False:
            raise ValueError('Complete nonpromoting certification required')
        closure.inventory(folder, [*health['files'], 'health.json'])
        for name, value in health['files'].items():
            if Path(name).is_absolute() or '..' in Path(name).parts:
                raise ValueError('Contained health member required')
            closure.pin(folder + '/' + name, value)
        declaration = closure.read(folder + '/declaration.json')
        closure.mapping(declaration['code_and_reference_sha256'])
        closure.mapping(closure.read(folder + '/consumed-file-sha256.json'))
        closure.mapping(closure.read(folder + '/source-replay.json')['checked'])
    certification = closure.read(CONDITIONAL + '/attempt-started.json')['started_at']
    if datetime.now(timezone.utc) < datetime.fromisoformat(certification):
        raise ValueError('Cannot reuse future certification')
    # Reuse is explicitly at the original certification instant, not a new
    # source-freshness evaluation; immutable historical rows do not acquire age.
    manifest = closure.read(EXPORT + '/manifest.json')
    closure.inventory(EXPORT, [*manifest['outputs'], 'manifest.json', 'health.json'])
    closure.mapping(manifest['evidence_file_sha256'])
    for name, meta in manifest['outputs'].items():
        closure.pin(EXPORT + '/' + name, meta['sha256'])
        if closure.safe(EXPORT + '/' + name).stat().st_size != meta['bytes']:
            raise ValueError('Export byte count drift')
    rows, groups = closure.lines(EXPORT + '/development.jsonl'), closure.lines(EXPORT + '/groups.jsonl')
    audit = closure.read(MOVEMENT + '/feature-audit.json')
    extra = {}
    for item in audit['vectors']:
        key = item['game_id'], item['event_id']
        if key in extra or len(item['values']) != len(audit['names']):
            raise ValueError('Exact unique movement vector width required')
        extra[key] = item['values']
    expected, schema, config = {}, None, None
    for fold in FOLD_WINDOWS:
        receipt = closure.read(CONDITIONAL + '/' + fold + '/fit-receipt.json')
        if schema is not None and (schema != receipt['schema'] or config != receipt['config']):
            raise ValueError('Conflicting fold schema/config')
        schema, config, expected[fold] = receipt['schema'], receipt['config'], receipt['cohorts']
    if schema['names'] != manifest['schema']['names'] + audit['names']:
        raise ValueError('Exact appended movement schema required')
    validate_configuration(schema, config)
    folds, grouped = reconstruct(rows, groups, extra, schema, expected)
    # Bind actual original group vectors via each frozen validation prediction.
    for fold in FOLD_WINDOWS:
        saved = closure.read(MOVEMENT + '/' + fold + '/predictions.json')
        if [{'game_id': r['game_id'], 'event_id': r['event_id'], 'groups': r['groups']} for r in saved] != grouped[fold]['rows']:
            raise ValueError('Frozen validation groups mismatch')
    cache_key = fingerprint({'contract': VERSION, 'files': closure.checked, 'inventories': closure.inventories,
                             'schema': schema, 'cohorts': expected, 'certification_instant': certification,
                             'python': platform.python_version()})
    closure.verify()
    return VerifiedFeatures(folds, grouped, schema, config, cache_key, certification, closure)
