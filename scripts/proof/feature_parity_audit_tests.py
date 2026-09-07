"""Isolated AST witnesses of legacy wiring, not desired-behavior assertions.

No acquisition imports, database access, fitted models, or external data.
"""
import ast
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[2]
TREE = ast.parse((ROOT / 'data-pipeline/acquisition/data_acquisition.py').read_text())


def execute(nodes, scope):
    exec(compile(ast.Module(body=nodes, type_ignores=[]), '<audited-source>', 'exec'), scope)
    return scope


def test_previous_play_overwritten_before_royal_road_in_both_builders():
    assignments = [n for n in ast.walk(TREE) if isinstance(n, ast.Assign)
                   and ast.unparse(n) == 'previous_play = play']
    crossings = [n for n in ast.walk(TREE) if isinstance(n, ast.If)
                 and ast.unparse(n.test) == 'is_rebound and previous_play']
    assert len(assignments) == len(crossings) == 2
    for assignment, crossing in zip(sorted(assignments, key=lambda n: n.lineno),
                                    sorted(crossings, key=lambda n: n.lineno)):
        assert assignment.lineno < crossing.lineno
        current = {'details': {'yCoord': 12}}
        scope = execute([assignment], {'play': current, 'previous_play': {'details': {'yCoord': -12}}})
        assert scope['previous_play'] is current


def test_pass_origin_flip_disagrees_with_common_shooting_frame():
    flips = [n for n in ast.walk(TREE) if isinstance(n, ast.If)
             and ast.unparse(n.test) == 'pass_x < 0']
    assert flips
    # Attacking +x: origin x=-10,y=-20, shot x=70,y=20. True lateral change=40.
    for node in flips:
        out = execute([node], {'pass_x': -10, 'pass_y': -20})
        assert abs(20 - out['pass_y']) == 0
        assert out['pass_x'] == 10


@pytest.mark.parametrize('raw_y', [0, 10])
def test_nonshot_state_pre_normalizes_before_later_shooter_flip(raw_y):
    flips = [n for n in ast.walk(TREE) if isinstance(n, ast.If)
             and ast.unparse(n.test) == 'current_x < 0'
             and 'current_y = -current_y if current_y else None' in ast.unparse(n)]
    assert flips
    for node in flips:
        out = execute([node], {'current_x': -70, 'current_y': raw_y})
        assert out['current_x'] == 70
        if raw_y == 0:
            assert out['current_y'] is None  # Legitimate centre-line becomes missing.
        else:
            assert -out['current_x'] == -70  # Later attacking-negative flip undoes desired +70.


def test_active_powerplay_tracker_does_not_clear_on_even_strength():
    extractor = next(n for n in TREE.body if isinstance(n, ast.FunctionDef)
                     and n.name == '_extract_shots_from_game')
    node = next(n for n in ast.walk(extractor) if isinstance(n, ast.If)
                and ast.unparse(n.test) == 'is_power_play and event_owner_team_id')
    assert not node.orelse
    scope = {'is_power_play': True, 'event_owner_team_id': 1, 'period_number': 1,
             'current_time_seconds': 10, 'powerplay_start_times': {}, 'time_since_powerplay_started': 0}
    execute([node], scope)
    scope.update(is_power_play=False, current_time_seconds=130, time_since_powerplay_started=0)
    execute([node], scope)
    scope.update(is_power_play=True, current_time_seconds=300, time_since_powerplay_started=0)
    execute([node], scope)
    assert scope['time_since_powerplay_started'] == 290  # New PP incorrectly inherits old onset.
