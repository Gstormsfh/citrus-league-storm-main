"""Independent all-era diagnostics contracts; synthetic rows only."""
from copy import deepcopy
import json
import pytest
import audit_timing_eras as audit

SCHEMA={'names':['immediate_previous_sog_same_team'],'categorical_names':['previous_event_type'],'version':'review'}

def fixture(prior_code=506,current_code=506,state=1):
    def event(i,code):return {'eventId':i,'sortOrder':i,'typeCode':code,'timeInPeriod':'00:02','periodDescriptor':{'number':1,'periodType':'REG'},'details':{'eventOwnerTeamId':1,'xCoord':-20,'yCoord':5,'shootingPlayerId':1000001,'scoringPlayerId':1000001}}
    body={'id':2019020001,'season':20192020,'gameType':2,'gameDate':'2019-10-02','homeTeam':{'id':1},'awayTeam':{'id':2},'plays':[event(1,prior_code),event(2,current_code)]}
    row={'game_id':body['id'],'event_id':2,'game_date':body['gameDate'],'label':current_code==505,'split':'development','features':[state],'categorical':{'previous_event_type':str(prior_code)},'source_sha256':'c'*64}
    rehash(row);return body,row

def rehash(row):row['feature_sha256']=audit.fingerprint({'schema_sha256':audit.fingerprint(SCHEMA),'values':row['features'],'categorical':row['categorical']})
def run(body,row):return audit.audit_game(body,[row],SCHEMA,'a'*64,'b'*64,'c'*64)[0]

def test_unknown_actors_are_not_equal_and_signed_raw_coordinates_are_not_folded():
    b,r=fixture();b['plays'][0]['details']['xCoord']=20
    for e in b['plays']:e['details'].pop('shootingPlayerId')
    out=run(b,r);assert out['same_actor'] is None and out['same_raw_coordinates'] is False
    assert out['current_coordinates']==[-20,5] and out['previous_coordinates']==[20,5]

def test_out_of_rink_points_retained_but_equality_unknown():
    b,r=fixture()
    for e in b['plays']:e['details']['xCoord']=1000
    out=run(b,r);assert out['current_coordinates']==[1000,5]
    assert out['same_raw_coordinates'] is None

@pytest.mark.parametrize('owner',[2,None])
def test_actor_literal_equality_remains_diagnostic_with_owner_conflict_or_unknown(owner):
    b,r=fixture(state=0 if owner==2 else None);b['plays'][0]['details']['eventOwnerTeamId']=owner
    out=run(b,r);assert out['same_actor'] is True
    assert out['previous_owner']==owner and out['actor_diagnostic_retrospective_not_predictor'] is True

@pytest.mark.parametrize('prior,current,state',[(506,507,1),(507,506,0),(502,506,0),(509,505,None)])
def test_misses_boundaries_and_goal_actor_diagnostics_preserve_population(prior,current,state):
    b,r=fixture(prior,current,state);out=run(b,r)
    assert out['target']==int(current==505) and out['current_type']==current
    assert out['state']==(None if state is None else str(state))

def test_current_goal_and_future_only_change_retrospective_fields():
    b,r=fixture();original=run(b,r)
    b['plays'][1]['typeCode']=505;r['label']=True
    goal=run(b,r)
    for field in ['state','gap_seconds','gap_band','previous_event_id','previous_source_event_sha256','previous_clock','previous_order']:assert goal[field]==original[field]
    future=deepcopy(b['plays'][1]);future.update(eventId=3,sortOrder=3,timeInPeriod='00:03');b['plays'].append(future)
    assert run(b,r)==goal

@pytest.mark.parametrize('change',['date','body_game','season','hash','label','state','prior_type','missing_selected','shootout'])
def test_exact_original_identity_feature_and_type_contract(change):
    b,r=fixture()
    if change=='date':b['gameDate']='2019-10-03'
    if change=='body_game':b['id']+=1
    if change=='season':b['season']=20202021
    if change=='hash':r['source_sha256']='d'*64
    if change=='label':r['label']=0
    if change=='state':r['features']=[0];rehash(r)
    if change=='prior_type':r['categorical']['previous_event_type']='507';rehash(r)
    if change=='missing_selected':b['plays']=b['plays'][:1]
    if change=='shootout':
        for e in b['plays']:e['periodDescriptor']['periodType']='SO'
    with pytest.raises(ValueError):run(b,r)

@pytest.mark.parametrize('year',[2014,2018,2024,2025])
def test_stream_rejects_outside_declared_source_seasons(year):
    _,r=fixture();r['game_id']=year*1000000+20001
    with pytest.raises(ValueError):list(audit.game_batches([json.dumps(r).encode()]))

def test_noncontiguous_game_and_duplicate_event_cannot_enter_accounting():
    _,r=fixture();s=deepcopy(r);s['game_id']+=1
    for rows in [[r,r],[r,s,r]]:
        with pytest.raises(ValueError):list(audit.game_batches([json.dumps(x).encode() for x in rows]))

def test_all_five_rollups_conserve_exact_population_and_goals():
    rows=[]
    for i,(prior,current,state) in enumerate([(506,506,1),(507,505,0),(509,507,None)]):
        b,r=fixture(prior,current,state);out=run(b,r);out['event_id']=i;rows.append(out)
    acc=audit.Accounting();acc.add(rows);result=acc.finish()
    assert result['events']==3 and result['goals']==1 and len(result['rollups'])==5
    for cells in result['rollups'].values():assert sum(c['events'] for c in cells)==3 and sum(c['goals'] for c in cells)==1

def test_duplicate_event_across_accounting_batches_is_rejected():
    b,r=fixture();out=run(b,r);acc=audit.Accounting();acc.add([out])
    with pytest.raises(ValueError):acc.add([deepcopy(out)])

@pytest.mark.parametrize('field,value',[('state','unknown'),('gap_band','invented'),('game_type','other'),('target',True)])
def test_accounting_rejects_invalid_fixed_categories(field,value):
    b,r=fixture();out=run(b,r);out[field]=value
    with pytest.raises(ValueError):audit.Accounting().add([out])
