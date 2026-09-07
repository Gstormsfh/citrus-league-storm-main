"""Independent synthetic semantics; no fits or outcome-selected records."""
from copy import deepcopy
import ast
import math
from pathlib import Path
import pytest
from prior_sog_fidelity import classify


def event(code=506, owner=1, clock='00:10', period=1):
    return {'eventId': 1, 'sortOrder': 1, 'typeCode': code,
            'periodDescriptor': {'number': period, 'periodType': 'REG'},
            'timeInPeriod': clock, 'homeTeamDefendingSide': 'left',
            'details': {'eventOwnerTeamId': owner, 'xCoord': 20, 'yCoord': 5}}


@pytest.mark.parametrize('code,state', [(502,'0'),(503,'0'),(504,'0'),(506,'1'),(507,'0'),(508,'0'),(525,'0'),(505,None),(509,None),(516,None),(999,None)])
def test_exact_live_set_faceoff_included_goal_and_stoppage_excluded(code,state):
    assert classify(event(),event(code=code),1,2)['expected_state']==state


def test_current_outcome_fields_do_not_change_classification_or_mutate_inputs():
    current,prior=event(),event(clock='00:09'); before=deepcopy((current,prior))
    original=classify(current,prior,1,2)
    assert (current,prior)==before
    current.update(typeCode=505,typeDescKey='goal',homeScore=9)
    current['details'].update(scoringPlayerId=99,shotOutcome='goal',goalieInNetId=8)
    assert classify(current,prior,1,2)==original


@pytest.mark.parametrize('seconds,band', [(0,'same_clock'),(1,'up_to_1s'),(2,'over_1_under_3s'),(3,'from_3_to_10s'),(10,'from_3_to_10s'),(11,'over_10s'),(120,'over_10s')])
def test_exact_clock_edges_do_not_impose_new_rebound_window(seconds,band):
    current=event(clock=f'{seconds//60:02}:{seconds%60:02}')
    result=classify(current,event(clock='00:00'),1,2)
    assert result['expected_state']=='1' and result['gap_band']==band
    assert result['gap_seconds']==seconds


def test_missing_or_conflicting_geometry_does_not_null_state():
    current,prior=event(),event(); del current['details']['xCoord']; prior['homeTeamDefendingSide']='right'
    prior['details']['yCoord']=100
    result=classify(current,prior,1,2)
    assert result['expected_state']=='1'
    assert result['facts']['side_conflict']
    assert not result['facts']['current_coordinates_usable']
    assert not result['facts']['prior_coordinates_usable']


@pytest.mark.parametrize('owner',[None,True,1.0,3,-1])
def test_missing_nonparticipant_or_noninteger_owner_is_not_inferred(owner):
    result=classify(event(),event(owner=owner),1,2)
    assert result['expected_state'] is None
    assert result['reason']=='prior_owner_invalid_or_nonparticipant'
    assert result['facts']['owner_relation'] is None


def test_reason_precedence_preserves_independent_owner_facts():
    result=classify(event(owner=None),event(code=509,owner=None),1,2)
    assert result['reason']=='prior_type_outside_baseline_live_set'
    assert not result['facts']['current_owner_known'] and not result['facts']['prior_owner_known']
    assert classify(event(owner=None),event(owner=None),1,2)['reason']=='current_owner_invalid_or_nonparticipant'
    assert classify(event(),event(owner=2),1,2)['expected_state']=='0'


def test_no_previous_and_period_boundary_not_cross_period_time_delta():
    result=classify(event(),None,1,2)
    assert result['reason']=='no_raw_predecessor' and result['gap_seconds'] is None
    result=classify(event(clock='00:01',period=2),event(clock='19:59'),1,2)
    assert result['reason']=='predecessor_other_period' and result['gap_band']=='no_same_period_predecessor'


def test_clock_reversal_and_bad_clock_fail():
    with pytest.raises(ValueError): classify(event(clock='00:01'),event(clock='00:02'),1,2)
    with pytest.raises(ValueError): classify(event(clock='00:60'),event(),1,2)


def test_unrepresentable_coordinate_withheld_not_overflow():
    current=event();current['details']['xCoord']=10**1000
    result=classify(current,event(),1,2)
    assert result['expected_state']=='1' and not result['facts']['current_coordinates_usable']


@pytest.mark.parametrize('owner',[None,True,1.0,1,2,3])
@pytest.mark.parametrize('code',[502,505,506,507,509])
def test_state_parity_with_isolated_original_prefix_helper(owner,code):
    root=Path(__file__).resolve().parents[2]
    scope={'math':math,'LIVE_LOCATION_EVENTS':frozenset((502,503,504,506,507,508,525))}
    for filename,names in [('causal_feature_contract.py',{'_value','_context'}),
                           ('development_feature_export.py',{'_seconds','_period','prefix_measurements'})]:
        tree=ast.parse((root/'data-pipeline/projections'/filename).read_text())
        selected=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names]
        assert len(selected)==len(names)
        exec(compile(ast.Module(body=selected,type_ignores=[]),filename,'exec'),scope)
    scope['EXTRA_NUMERIC']=('x_attacking','y_attacking','immediate_previous_sog_same_team')
    current,previous=event(owner=owner),event(code=code)
    base={'coordinates':{k:{'value':None,'reason':'missing'} for k in ('x_attacking','y_attacking')},'features':{'signed_angle_deg':None}}
    original=scope['prefix_measurements'](current,previous,None,home=1,away=2,base_row=base)
    value=original['values']['immediate_previous_sog_same_team']
    assert classify(current,previous,1,2)['expected_state']==(None if value is None else str(value))


def runner_fixture():
    import audit_prior_sog_fidelity as runner
    prior=event(code=502,clock='00:00'); prior.update(eventId=1,sortOrder=1)
    shot=event(clock='00:10');shot.update(eventId=2,sortOrder=2)
    body={'id':2022020001,'gameDate':'2022-10-01','homeTeam':{'id':1},'awayTeam':{'id':2},'plays':[prior,shot]}
    source=[{'game_id':body['id'],'event_id':2,'game_date':'2022-10-01','target':0,'context':{'prior_sog_same_team':'0'},'groups':{'prior_sog_same_team':'not_prior_same_team_sog'}}]
    predictions=[{'game_id':body['id'],'event_id':2,'target':0,'groups':deepcopy(source[0]['groups']),'predictions':{'fixed':.1,'expanding':.08}}]
    return runner,body,source,predictions


@pytest.mark.parametrize('change',['duplicate','missing','target','groups','state','extra_model','bad_probability'])
def test_runner_saved_exact_membership_and_state_join(change):
    r,body,source,predictions=runner_fixture()
    if change=='duplicate':predictions.append(deepcopy(predictions[0]))
    if change=='missing':predictions=[]
    if change=='target':predictions[0]['target']=1
    if change=='groups':predictions[0]['groups']={}
    if change=='state':source[0]['context']['prior_sog_same_team']=None
    if change=='extra_model':predictions[0]['predictions']['invented']=.2
    if change=='bad_probability':predictions[0]['predictions']['fixed']=float('nan')
    with pytest.raises(ValueError):r.join_saved(source,predictions)


def test_runner_uses_exact_raw_predecessor_and_valid_future_cannot_change_it():
    r,body,source,predictions=runner_fixture(); selected=r.join_saved(source,predictions)
    result=r.audit_game(body,selected,'a'*64)
    assert result[0]['predecessor_event_id']==1
    assert result[0]['classification']['previous_event_type']==502
    future=event(code=509,clock='00:12');future.update(eventId=3,sortOrder=3);body['plays'].append(future)
    assert r.audit_game(body,selected,'a'*64)==result
    body['plays'][0]['typeCode']=509
    with pytest.raises(ValueError):r.audit_game(body,selected,'a'*64)


def test_runner_classification_precedes_outcome_reconciliation():
    r,body,source,predictions=runner_fixture();selected=r.join_saved(source,predictions);seen=[]
    def observer(current,previous,home,away):seen.append(classify(current,previous,home,away));return seen[-1]
    r.audit_game(body,selected,'a'*64,classifier=observer)
    body['plays'][1]['typeCode']=505
    with pytest.raises(ValueError):r.audit_game(body,selected,'a'*64,classifier=observer)
    assert seen[0]==seen[1]


@pytest.mark.parametrize('change',['sort_order','duplicate_event','clock','period_type','game','missing_event','hash_format'])
def test_runner_raw_source_order_and_closure_fail_closed(change):
    r,body,source,predictions=runner_fixture();selected=r.join_saved(source,predictions);sha='a'*64
    if change=='sort_order':body['plays'][1]['sortOrder']=1
    if change=='duplicate_event':body['plays'][1]['eventId']=1
    if change=='clock':body['plays'][0]['timeInPeriod']='00:11'
    if change=='period_type':body['plays'][1]['periodDescriptor']['periodType']='OT'
    if change=='game':body['id']+=1
    if change=='missing_event':body['plays']=body['plays'][:1]
    if change=='hash_format':sha='bad'
    with pytest.raises(ValueError):r.audit_game(body,selected,sha)


def test_runner_accounting_all_three_states_and_conservation():
    r,body,source,predictions=runner_fixture();rows=[]
    for i,(state,reason,gap,target) in enumerate([(None,'boundary','same_clock',1),('0','other','up_to_1s',0),('1','sog','over_10s',1)]):
        rows.append({'game_id':2022020001+i,'event_id':i,'target':target,'classification':{'expected_state':state,'reason':reason,'gap_band':gap},'predictions':{'fixed':.1+.1*i,'expanding':.2+.1*i}})
    result=r.aggregate(rows);overall=result['overall']
    assert overall['events']==3 and overall['goals']==2
    assert {tuple(c['cell']) for c in result['rollups']['state']}=={(None,),('0',),('1',)}
    assert overall['models']['fixed']['expected_goals']==pytest.approx(.6)
    assert overall['models']['expanding']['expected_goals']==pytest.approx(.9)
    for cells in result['rollups'].values():
        assert sum(c['events'] for c in cells)==3 and sum(c['goals'] for c in cells)==2
        for metric in ('brier','log_loss_clipped'):
            assert sum(c['weighted_contributions'][metric] for c in cells)==pytest.approx(overall['expanding_minus_fixed'][metric],abs=1e-14)
        for name in ('fixed','expanding'):
            assert sum(c['models'][name]['expected_goals'] for c in cells)==pytest.approx(overall['models'][name]['expected_goals'])
            for metric in ('brier','log_loss_clipped'):
                assert sum(c['models'][name][metric]*c['events'] for c in cells)/3==pytest.approx(overall['models'][name][metric],abs=1e-14)


def test_current_miss507_is_retained_with_non_goal_target():
    r,body,source,predictions=runner_fixture();body['plays'][1]['typeCode']=507
    selected=r.join_saved(source,predictions)
    assert r.audit_game(body,selected,'a'*64)[0]['target']==0


@pytest.mark.parametrize('change',['raw_date','saved_date','shootout'])
def test_saved_date_and_nonshootout_population_required(change):
    r,body,source,predictions=runner_fixture()
    if change=='raw_date':body['gameDate']='2022-10-02'
    if change=='saved_date':source[0]['game_date']='2022-10-02'
    if change=='shootout':
        for play in body['plays']:play['periodDescriptor']['periodType']='SO'
    with pytest.raises(ValueError):r.audit_game(body,r.join_saved(source,predictions),'a'*64)
