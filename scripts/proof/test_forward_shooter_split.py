from copy import deepcopy
import pytest
from forward_shooter_split import partition


def rows():
    return [dict(game_id=2025020001+i, event_id=1, game_date='2025-10-'+day, target=i%2)
            for i,day in enumerate(('01','02','02','03','04'))]


def test_cut_moves_to_start_of_date_and_preserves_all_games():
    r = rows(); before = deepcopy(r)
    a,b,receipt = partition(r)
    assert len(a) == 1 and len(b) == 4
    assert receipt['cutoff_date'] == '2025-10-02'
    assert a[-1]['game_date'] < b[0]['game_date']
    assert sorted(x['game_id'] for x in a+b) == sorted(x['game_id'] for x in r)
    assert r == before
    assert partition(r[::-1]) == (a,b,receipt)


def test_outcomes_do_not_select_split():
    original = rows()
    changed = [{**r,'target': 1-r['target']} for r in original]
    assert partition(original)[2] == partition(changed)[2]


@pytest.mark.parametrize('mutation', ['duplicate','alias','date','game_date','same_day','one_game'])
def test_malformed_or_unsplittable_rejected(mutation):
    r = rows()
    if mutation == 'duplicate': r.append(dict(r[0]))
    if mutation == 'alias': r[0]['event_id'] = True
    if mutation == 'date': r[0]['game_date'] = '2025-1-1'
    if mutation == 'game_date': r[1].update(game_id=r[0]['game_id'], event_id=2)
    if mutation == 'same_day':
        for x in r: x['game_date'] = '2025-10-01'
    if mutation == 'one_game': r = [r[0],{**r[0], 'event_id':2}]
    with pytest.raises(ValueError): partition(r)
