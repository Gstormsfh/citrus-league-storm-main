"""Additional geometry invariants, without editing the frozen fit/test inputs."""
from copy import deepcopy
import math
import pytest
from projections.event_memory_features import project
from tests.test_event_memory_features import event


def test_rotating_both_events_and_defending_side_preserves_geometry():
    rows=[event(1,0,520),event(2,1),event(3,2)]
    rows[2]['details'].update(xCoord=80,yCoord=-15)
    first=project(rows,home=1,away=2)[3]
    rotated=deepcopy(rows)
    for r in rotated:
        r['homeTeamDefendingSide']='right'
        r['details']['xCoord'] *= -1; r['details']['yCoord'] *= -1
    assert project(rotated,home=1,away=2)[3] == first
    assert first[5] == pytest.approx(math.hypot(10,25))


def test_angle_wrap_uses_short_arc_behind_goal():
    rows=[event(1,0,520),event(2,1),event(3,2)]
    rows[1]['details'].update(xCoord=95,yCoord=.1)
    rows[2]['details'].update(xCoord=95,yCoord=-.1)
    values=project(rows,home=1,away=2)[3]
    assert values[5] == .2 and values[6] < 2


def test_goal_center_has_displacement_but_no_angle():
    rows=[event(1,0,520),event(2,1),event(3,2)]
    rows[2]['details'].update(xCoord=89,yCoord=0)
    values=project(rows,home=1,away=2)[3]
    assert values[5] is not None and values[6] is None


def test_invalid_strength_does_not_reuse_previous_spell():
    rows=[event(1,0,520),event(2,1,situationCode='1010'),event(3,2),event(4,3)]
    values=project(rows,home=1,away=2)
    assert values[2][7] is None and values[3][7] is None and values[4][7] == 1


def test_boolean_owner_is_not_team_one():
    rows=[event(1,0,520),event(2,1,team=True),event(3,2)]
    values=project(rows,home=1,away=2)
    assert values[2][:7] == [None]*7 and values[3][:4] == [None]*4


def test_orientation_conflict_withholds_geometry_only():
    rows=[event(1,0,520),event(2,1),event(3,2,homeTeamDefendingSide='right')]
    values=project(rows,home=1,away=2)[3]
    assert values[:5] == [1,0,1,0,1] and values[5:7] == [None,None]
