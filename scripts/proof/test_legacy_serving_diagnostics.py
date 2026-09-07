"""Witness current source behavior; passing is NOT a serving-correctness claim.

Executes only inspected feature-imputation AST loops. Never imports acquisition,
opens serialized artifacts, contacts a service, or runs a prediction/write path.
"""
import ast
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[2]


def imputation_blocks():
    tree = ast.parse((ROOT / 'data-pipeline/acquisition/data_acquisition.py').read_text())
    blocks = []
    for name in ('process_game_from_raw_data', 'scrape_pbp_and_process'):
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
        selected = [n for n in ast.walk(function) if isinstance(n, ast.For)
                    and ast.unparse(n.target) == 'feature'
                    and ast.unparse(n.iter) == 'MODEL_FEATURES'
                    and 'non_zero_values.median()' in ast.unparse(n)]
        assert len(selected) == 1, 'Source changed: inspect before updating diagnostic'
        blocks.append(selected[0])
    return blocks


def run_imputation(node, values):
    scope = {'pd': pd, 'MODEL_FEATURES': ['time_since_last_event'],
             'X_predict': pd.DataFrame({'time_since_last_event': values})}
    exec(compile(ast.Module(body=[node], type_ignores=[]), '<isolated-legacy-imputation>', 'exec'), scope)
    return scope['X_predict']['time_since_last_event'].tolist()


@pytest.mark.parametrize('path_index', [0, 1], ids=['per-game', 'aggregate'])
def test_missing_shot_value_changes_with_other_shots_witness(path_index):
    node = imputation_blocks()[path_index]
    # Row zero represents the identical missing observation in every frame.
    assert run_imputation(node, [float('nan'), 2.0])[0] == 2.0
    assert run_imputation(node, [float('nan'), 20.0])[0] == 20.0
    assert run_imputation(node, [float('nan'), 2.0, 20.0])[0] == 11.0


@pytest.mark.parametrize('path_index', [0, 1], ids=['per-game', 'aggregate'])
def test_missing_shot_alone_becomes_zero_witness(path_index):
    assert run_imputation(imputation_blocks()[path_index], [float('nan')]) == [0.0]


@pytest.mark.parametrize('path_index', [0, 1], ids=['per-game', 'aggregate'])
def test_observed_values_preserved_by_selected_loop(path_index):
    assert run_imputation(imputation_blocks()[path_index], [0.0, 2.0, 20.0]) == [0.0, 2.0, 20.0]
