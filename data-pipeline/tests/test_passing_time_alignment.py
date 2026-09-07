import pytest
from projections.passing_time_alignment import reconcile,duration_bounds


def anchors():
    return [dict(name=str(i),video_seconds=[i-.05,i+.05],replay_ticks=[i*10+4,i*10+6],
                 evidence_reference='synthetic fixture') for i in (1,2,3)]


def test_reconciles_intersection_without_forcing_exact_offset():
    r=reconcile(anchors(),seconds_per_tick=.1)
    assert r['consistent']
    assert r['video_minus_replay_seconds']==pytest.approx([-.65,-.35])


def test_bad_anchor_fails_instead_of_averaging_away_mismatch():
    a=anchors();a[-1]['video_seconds']=[20,21]
    r=reconcile(a,seconds_per_tick=.1)
    assert not r['consistent'] and r['video_minus_replay_seconds'] is None


def test_duration_uncertainty_stays_separate():
    r=duration_bounds(release=[59,60],reception=[69,71],shot=[92,93],seconds_per_tick=.1)
    assert r['flight_seconds_interval']==pytest.approx([.9,1.2])
    assert r['reception_to_shot_seconds_interval']==pytest.approx([2.1,2.4])


def test_overlap_and_insufficient_landmarks_rejected():
    with pytest.raises(ValueError):duration_bounds(release=[1,3],reception=[2,4],shot=[5,6],seconds_per_tick=.1)
    with pytest.raises(ValueError):reconcile(anchors()[:2],seconds_per_tick=.1)
