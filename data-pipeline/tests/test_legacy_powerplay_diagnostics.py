"""Reproduce legacy PP defects without importing acquisition or model binaries.

These assertions preserve evidence of current behavior, not acceptance of it.
Only the inspected pure parser and timing statements are AST-executed.
"""
import ast
from pathlib import Path

import pytest


SOURCE = Path(__file__).resolve().parents[2] / 'data-pipeline/acquisition/data_acquisition.py'


def parser():
    tree = ast.parse(SOURCE.read_text())
    functions = [n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)
                 and n.name == 'parse_situation_code']
    assert len(functions) == 1
    scope = {}
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(SOURCE), 'exec'), scope)
    return scope['parse_situation_code']


def tracker(which):
    tree = ast.parse(SOURCE.read_text())
    matches = sorted([n for n in ast.walk(tree) if isinstance(n, ast.If)
                      and ast.unparse(n.test) == 'is_power_play and event_owner_team_id'],
                     key=lambda n: n.lineno)
    assert len(matches) == 2
    timing = matches[which]
    resets = sorted([n for n in ast.walk(tree) if isinstance(n, ast.If)
                     and ast.unparse(n.test) == 'type_code == 505'
                     and any(isinstance(x, ast.Name) and x.id == 'powerplay_start_times'
                             for x in ast.walk(n))], key=lambda n: n.lineno)
    assert len(resets) == 2
    code = compile(ast.Module(body=[timing, resets[which]], type_ignores=[]), str(SOURCE), 'exec')
    state = {'powerplay_start_times': {}, 'home_team_id': 1, 'away_team_id': 2}

    def shot(time, owner=1, pp=True, period=1, goal=False):
        state.update(current_time_seconds=time, event_owner_team_id=owner,
                     is_power_play=int(pp), period_number=period,
                     type_code=505 if goal else 506, time_since_powerplay_started=0.)
        exec(code, state)
        return state['time_since_powerplay_started']
    return shot


def test_legacy_numeric_strength_inverts_home_and_away_skaters():
    home, away, *_ = parser()('1451', 1, 1)
    # Official-style digits are away-goalie, away-skaters, home-skaters, home-goalie.
    assert (home, away) == (4, 5)  # Reproduced legacy defect: should be (5, 4).


def test_legacy_empty_net_flags_come_from_six_skaters_not_goalie_digits():
    home, away, empty, home_empty, away_empty, *_ = parser()('0551', 1, 1)
    assert (home, away) == (5, 5)
    assert (empty, home_empty, away_empty) == (False, False, False)
    # Away-goalie digit 0 was discarded by int conversion; actual state is not recovered.


@pytest.mark.parametrize('code', [None, '', 'bad'])
def test_unknown_situation_silently_becomes_five_on_five(code):
    assert parser()(code, 1, 1)[:2] == (5, 5)


@pytest.mark.parametrize('which', [0, 1])
def test_first_pp_shot_starts_clock_not_prior_penalty_or_strength_event(which):
    shot = tracker(which)
    assert shot(70) == 0
    assert shot(90) == 20
    # The isolated block has no penalty-event input: a penalty at 50 would not yield age20 at70.


@pytest.mark.parametrize('which', [0, 1])
def test_opponent_even_strength_shot_does_not_clear_old_team_clock(which):
    shot = tracker(which)
    assert shot(50) == 0
    assert shot(120, owner=2, pp=False) == 0
    assert shot(240) == 190  # A new advantage inherits first advantage's old origin.


def test_extraction_and_full_paths_disagree_on_same_team_even_strength_reset():
    extraction, full = tracker(0), tracker(1)
    for shot in (extraction, full):
        shot(50)
        shot(120, pp=False)
    assert extraction(240) == 190
    assert full(240) == 0


@pytest.mark.parametrize('which', [0, 1])
def test_goal_unconditionally_resets_clock_despite_continuing_observed_advantage(which):
    shot = tracker(which)
    shot(50)
    assert shot(70, goal=True) == 20
    assert shot(80, pp=True) == 0


@pytest.mark.parametrize('which', [0, 1])
def test_period_key_drops_elapsed_continuation(which):
    shot = tracker(which)
    shot(1190, period=1)
    assert shot(10, period=2) == 0


@pytest.mark.parametrize('which', [0, 1])
def test_current_goal_does_not_change_current_emitted_age(which):
    goal, miss = tracker(which), tracker(which)
    goal(50)
    miss(50)
    assert goal(70, goal=True) == miss(70, goal=False) == 20
