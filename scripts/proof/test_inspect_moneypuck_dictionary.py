from pathlib import Path
import pytest
import inspect_moneypuck_dictionary as scanner


def test_pinned_dictionary_categories_are_disjoint_and_complete():
    raw = (scanner.ROOT / scanner.DICTIONARY).read_bytes()
    result = scanner.inspect(raw)
    categories = list(result['categories'].values())
    assert result['unique_named_fields'] == 124
    flat = [field for group in categories for field in group]
    assert len(flat) == len(set(flat)) == result['unique_named_fields']
    assert 'shotGeneratedRebound' in categories[0]
    assert 'shotRebound' in categories[3]
    assert 'xGoal' in categories[1]
    assert result['shot_data_rows_read'] == 0
    assert result['model_artifacts_deserialized'] == 0
    assert result['training_performed'] is False


@pytest.mark.parametrize('data', [b'goal,xGoal\n1,.8\n', b'', b'pickle-not-loaded', 'not-bytes'])
def test_arbitrary_dataset_or_model_bytes_are_rejected(data):
    with pytest.raises(ValueError, match='pinned explanatory dictionary'):
        scanner.inspect(data)


def test_even_dictionary_corrections_require_separate_review():
    raw = (scanner.ROOT / scanner.DICTIONARY).read_bytes()
    with pytest.raises(ValueError): scanner.inspect(raw + b'\n')
