from copy import deepcopy
import repair_reviewed_score_origin as m
from test_reconstruct_reviewed_features import fixture


def test_extra_official_period_metadata_preserved_without_unknown_score():
    p, side = fixture()
    for e, s in zip(p['plays'], side['events']):
        e['periodDescriptor']['maxRegulationPeriods'] = 3
        s['source_event_sha256'] = m.fingerprint(e)
    original = deepcopy(p); old = m.prior.project(p, side); saved = deepcopy(old)
    out = m.correct(p, old); index = m.prior.SCHEMA['names'].index('score_differential_pre_shot')
    assert p == original and old == saved
    assert [r['features'][index] for r in out['rows']] == [0, 1]
    assert out['score_origin_correction']['changed_rows'] == 2
    for before, after in zip(old['rows'], out['rows']):
        assert before['features'][:index]+before['features'][index+1:] == after['features'][:index]+after['features'][index+1:]


def test_no_opening_event_does_not_invent_zero_score():
    p, side = fixture(); p['plays'][0]['typeCode'] = 502
    side['events'][0]['source_event_sha256'] = m.fingerprint(p['plays'][0])
    out = m.correct(p, m.prior.project(p, side)); index = m.prior.SCHEMA['names'].index('score_differential_pre_shot')
    assert all(r['features'][index] is None for r in out['rows'])
