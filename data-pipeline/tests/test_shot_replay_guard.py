import pytest
from monitoring.shot_replay_guard import assert_safe_replay, preflight_raw_shot_replay


def row(**changes):
    return dict(game_id=2025020001,event_id=1,player_id=7,shot_x=70,shot_y=2,
                shot_type_code=1,period=1,is_goal=False,**changes)


def test_late_coordinates_actor_or_outcome_cannot_create_a_duplicate():
    original = row()
    for change in ({'shot_x':71},{'player_id':8},{'is_goal':True}):
        with pytest.raises(ValueError,match='source revision'):
            assert_safe_replay([{**original,**change}],[original])


def test_identical_coordinates_on_distinct_events_cannot_be_collapsed():
    a = row()
    with pytest.raises(ValueError,match='collapses'):
        assert_safe_replay([a,{**a,'event_id':2}],[])


def test_idempotent_replay_and_new_events_pass_but_ambiguous_history_fails():
    a = row()
    assert_safe_replay([a],[a])
    assert_safe_replay([a],[])
    with pytest.raises(ValueError,match='ambiguous'):
        assert_safe_replay([a],[a,a])


def test_preflight_read_failure_propagates():
    class Db:
        def select(self,*args,**kwargs):
            assert kwargs['order']=='id.asc'
            raise RuntimeError('read incomplete')
    with pytest.raises(RuntimeError,match='read incomplete'):
        preflight_raw_shot_replay(Db(),[row()])


def test_actual_save_boundary_stops_before_dataframe_dedup_or_write():
    # Execute the real saver without importing its unrelated model binaries.
    import ast
    from pathlib import Path
    from collections import defaultdict
    import types
    import logging
    path = Path(__file__).parents[1] / 'acquisition/data_acquisition.py'
    tree = ast.parse(path.read_text())
    saver = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name=='_save_shots_to_database')
    def reject(db, records):
        assert len(records)==1
        raise ValueError('quarantine before write')
    namespace = {'pd':types.SimpleNamespace(notna=lambda v:v is not None),
                 'logger':logging.getLogger('test'), 'preflight_raw_shot_replay':reject}
    exec(compile(ast.Module(body=[saver],type_ignores=[]),str(path),'exec'),namespace)
    values = defaultdict(int, playerId=7,game_id=2025020001,xG_Value=0.1)
    frame = types.SimpleNamespace(empty=False,iterrows=lambda:iter([(0,values)]))
    with pytest.raises(ValueError,match='quarantine before write'):
        namespace['_save_shots_to_database'](frame,object(),2025020001)
