import numpy as np
from run_movement_interactions import interactions, CONTEXTS


def test_movement_timing_and_missingness():
    names = ['distance_to_goal_ft']+[c+'__'+n for c in CONTEXTS for n in
        ('event_elapsed_seconds', 'same_team_indicator', 'event_lateral_displacement_ft', 'event_angle_change_deg', 'event_crossed_centerline')]
    raw = np.array([[15, 0, 1, 30, 60, 1, 0, 1, 30, 60, 1],
                    [15, 3, 1, 30, 60, 1, 3, 1, 30, 60, 1]], dtype=float)
    values = interactions(raw, names)
    assert values[0, 0] == 30  # Same-clock geometry retained; no fabricated speed.
    assert values[0, 3] == 20
    np.testing.assert_allclose(values[1], values[0]/np.e)
    raw[0, names.index(CONTEXTS[0]+'__same_team_indicator')] = 0
    assert (interactions(raw, names)[0, :4] == 0).all()
    raw[0, names.index(CONTEXTS[0]+'__same_team_indicator')] = np.nan
    assert np.isnan(interactions(raw, names)[0, :4]).all()
    raw[1, names.index(CONTEXTS[1]+'__event_lateral_displacement_ft')] = np.nan
    assert np.isnan(interactions(raw, names)[1, 4])
