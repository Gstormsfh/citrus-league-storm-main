import copy
import pytest
from acquisition.collect_observations import capture_game
from monitoring.canonical_corpus import compare_official, export_rows
from tests.test_collect_observations import Response


def receipt():
    return capture_game(2025020001,lambda *args,**kwargs:Response(),lambda:'2026-01-01T00:00:00Z')


def test_corpus_receipts_are_recomputed_and_revision_selection_is_explicit():
    item=receipt()
    result=compare_official({'nhl':[],'raw':[]},[item])
    # A v1 complete observation is not proof of final game coverage.
    assert result['status_counts']=={'official_unavailable':2}
    with pytest.raises(ValueError,match='one explicitly'):
        compare_official({'nhl':[],'raw':[]},[item,item])
    changed=copy.deepcopy(item)
    changed['prepared'][1][0]['is_goal']=True
    with pytest.raises(ValueError,match='integrity'):
        compare_official({'nhl':[],'raw':[]},[changed])


def test_export_only_calls_ordered_exact_reads_and_propagates_failure():
    class DB:
        def select_exact(self,table,**kwargs):
            assert kwargs['limit']==500 and 'event_id.asc' in kwargs['order']
            assert kwargs['filters']==[('season','eq',2025)]
            if table=='raw_shots':
                raise RuntimeError('partial read')
            return []
    with pytest.raises(RuntimeError,match='partial'):
        export_rows(DB(),2025)
