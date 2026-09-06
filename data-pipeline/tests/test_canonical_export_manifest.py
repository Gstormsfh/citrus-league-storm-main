"""Persisted corpus files must retain scope, ordering and boundary evidence."""
import hashlib
import json

import pytest

from monitoring.canonical_corpus import SOURCES, load_export_manifest


def write_fixture(tmp_path):
    manifest = {'contract': 'citrus-catalog-export-v1', 'season': 2025,
                'project_ref': 'expected-project', 'observed_from': '2026-01-01T00:00:00Z',
                'observed_to': '2026-01-01T00:01:00Z', 'sources': {}}
    for name, spec in SOURCES.items():
        row = {key: None for key in spec[1].split(',')}
        row.update(game_id=2025020001, event_id=71, season=2025)
        if name == 'raw':
            row['id'] = 1
        part = {'columns': list(row), 'rows': [list(row.values())]}
        part_path = tmp_path / f'{name}.json'
        part_path.write_text(json.dumps(part))
        boundary = {'n': 1, 'digest': 'a' * 32}
        manifest['sources'][name] = {
            **boundary, 'boundary_before': boundary.copy(), 'boundary_after': boundary.copy(),
            'paths': [part_path.name],
            'part_sha256': {part_path.name: hashlib.sha256(part_path.read_bytes()).hexdigest()}}
    path = tmp_path / 'manifest.json'
    path.write_text(json.dumps(manifest))
    return path, manifest


def save(path, manifest):
    path.write_text(json.dumps(manifest))


def test_valid_manifest_preserves_evidence_without_claiming_transaction_snapshot(tmp_path):
    path, _ = write_fixture(tmp_path)
    rows, evidence = load_export_manifest(path, 2025, 'expected-project')
    assert len(rows['nhl']) == len(rows['raw']) == 1
    assert 'not transaction snapshot' in evidence['consistency']
    assert 'stable_double_read' not in evidence
    assert evidence['export_manifest_sha256'] == hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.mark.parametrize('field,value', [
    ('contract', 'unknown'), ('season', 2024), ('season', True),
    ('project_ref', 'different-project'), ('observed_from', '2026-01-01T00:00:00'),
    ('observed_from', '2026-01-02T00:00:00Z'), ('observed_to', '2099-01-01T00:00:00Z'),
])
def test_manifest_rejects_scope_and_window_conflicts(tmp_path, field, value):
    path, manifest = write_fixture(tmp_path)
    manifest[field] = value
    save(path, manifest)
    with pytest.raises(ValueError):
        load_export_manifest(path, 2025, 'expected-project')


@pytest.mark.parametrize('change', ['missing_boundary', 'changed_boundary', 'missing_hash', 'duplicate_part',
                                     'corrupt_part', 'symlink', 'escape', 'count'])
def test_manifest_rejects_missing_or_inconsistent_part_evidence(tmp_path, change):
    path, manifest = write_fixture(tmp_path)
    source = manifest['sources']['nhl']
    part_path = tmp_path / 'nhl.json'
    if change == 'missing_boundary':
        del source['boundary_before']
    elif change == 'changed_boundary':
        source['boundary_after']['digest'] = 'b' * 32
    elif change == 'missing_hash':
        source['part_sha256'] = {}
    elif change == 'duplicate_part':
        source['paths'] *= 2
    elif change == 'corrupt_part':
        part_path.write_text(part_path.read_text() + ' ')
    elif change in ('symlink', 'escape'):
        alternate = tmp_path / 'alternate.json'
        if change == 'symlink':
            alternate.symlink_to(part_path)
        else:
            alternate = tmp_path.parent / (tmp_path.name + '-outside.json')
            alternate.write_bytes(part_path.read_bytes())
        source['paths'] = [str(alternate)]
        source['part_sha256'] = {str(alternate): hashlib.sha256(alternate.read_bytes()).hexdigest()}
    elif change == 'count':
        source['n'] = source['boundary_before']['n'] = source['boundary_after']['n'] = 2
    save(path, manifest)
    with pytest.raises(ValueError):
        load_export_manifest(path, 2025, 'expected-project')


@pytest.mark.parametrize('change', ['wrong_season', 'bool_identity', 'duplicate_row', 'reverse_rows', 'columns'])
def test_manifest_rejects_invalid_or_reordered_rows_even_with_updated_part_hash(tmp_path, change):
    path, manifest = write_fixture(tmp_path)
    part_path = tmp_path / 'nhl.json'
    part = json.loads(part_path.read_text())
    if change == 'wrong_season':
        part['rows'][0][part['columns'].index('season')] = 2024
    elif change == 'bool_identity':
        part['rows'][0][part['columns'].index('event_id')] = True
    elif change == 'duplicate_row':
        part['rows'] *= 2
    elif change == 'reverse_rows':
        earlier = part['rows'][0].copy()
        earlier[part['columns'].index('event_id')] = 70
        part['rows'].append(earlier)
    else:
        part['columns'].reverse()
    part_path.write_text(json.dumps(part))
    source = manifest['sources']['nhl']
    source['n'] = source['boundary_before']['n'] = source['boundary_after']['n'] = len(part['rows'])
    source['part_sha256'][part_path.name] = hashlib.sha256(part_path.read_bytes()).hexdigest()
    save(path, manifest)
    with pytest.raises(ValueError):
        load_export_manifest(path, 2025, 'expected-project')
