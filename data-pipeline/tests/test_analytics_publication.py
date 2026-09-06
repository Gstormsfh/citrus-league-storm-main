import copy
import pytest
from projections.analytics_publication import prepare, AnalyticsPublisher


def prepared(value=5):
    return prepare('NHL fixtures','2026-09-05T00:00:00Z',{'gameLog':[]},
      {'metric':'avg_toi','variant':'official','unit':'minutes','season':2025,
       'game_type':'regular','population':'skaters','feature_version':'v1',
       'model_version':'none','code_revision':'0'*40,'data_cutoff':'2026-09-05T00:00:00Z'},
      [{'entity_id':1,'value':value,'availability':'available','reason':'verified','exposure':2}],
      {'status':'passed','gate_version':'fixture-v1','evidence_sha256':'a'*64})


class Db:
    def __init__(self):
        self.tables = {}
        self.fail = None

    def select(self,table,filters,**kwargs):
        return copy.deepcopy([r for r in self.tables.get(table,[]) if all(r[k]==v for k,op,v in filters)])

    select_exact = select

    def insert(self,table,rows):
        if table==self.fail:
            raise RuntimeError('transport failure')
        self.tables.setdefault(table,[]).extend(copy.deepcopy(rows))


def test_idempotence_and_corrections_create_distinct_immutable_batches():
    db=Db()
    publisher=AnalyticsPublisher(db)
    a=publisher.publish(prepared())
    b=publisher.publish(prepared())
    assert a['batch_id']==b['batch_id'] and b['replayed']
    assert len(db.tables['analytics_publications'])==1
    c=publisher.publish(prepared(6))
    assert c['batch_id']!=a['batch_id']
    assert len(db.tables['analytics_metric_values'])==2


def test_failed_preparation_never_publishes_and_retry_resumes():
    db=Db()
    publisher=AnalyticsPublisher(db)
    db.fail='analytics_metric_values'
    with pytest.raises(RuntimeError): publisher.publish(prepared())
    assert not db.tables.get('analytics_publications')
    db.fail=None
    assert publisher.publish(prepared())['published']
    assert len(db.tables['analytics_source_snapshots'])==1


def test_conflicting_stored_value_is_not_overwritten():
    db=Db()
    publisher=AnalyticsPublisher(db)
    publisher.publish(prepared())
    db.tables['analytics_metric_values'][0]['value']=999
    with pytest.raises(ValueError,match='conflict'):
        publisher.publish(prepared())


def test_nonfinite_values_rejected_before_database_work():
    with pytest.raises(ValueError,match='finite'):
        prepared(float('nan'))
