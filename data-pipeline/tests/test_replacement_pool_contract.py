import copy

import pytest

from projections.replacement_pool_contract import replacement_pool
from projections.analytics_publication import fingerprint


def inputs(count=4):
    horizon={'start':'2026-10-01','end':'2026-10-07'}
    return dict(league_id='league-synthetic',scoring_sha256='a'*64,season=2026,horizon=horizon,
        as_of='2026-09-30T12:00:00Z',expected_player_ids=list(range(1,count+1)),position='C',roster_demand=2,
        receipts={'league_sha256':'b'*64,'horizon_sha256':'c'*64,'scoring_sha256':'a'*64},
        rows=[{'player_id':pid,'season':2026,'horizon':copy.deepcopy(horizon),'as_of':'2026-09-30T12:00:00Z',
               'position':'C','projected_points':float(count-pid),'eligible':True,'ir_status':'active',
               'coverage':'complete'} for pid in range(1,count+1)])


def test_measured_zero_is_not_missing_and_receipt_preserves_inputs():
    args=inputs(3);before=copy.deepcopy(args)
    result=replacement_pool(**args)
    assert result['status']=='measured_baseline_only' and result['baseline_points']==0
    assert result['replacement_player_id']==3 and not result['is_fpar'] and not result['publishable']
    assert args==before and result['input_evidence']==before
    assert fingerprint({k:v for k,v in result.items() if k!='receipt_sha256'})==result['receipt_sha256']
    args['rows'].pop()
    missing=replacement_pool(**args)
    assert missing['status']=='unavailable' and missing['baseline_points'] is None
    assert missing['missing_player_ids']==[3]


@pytest.mark.parametrize('change',['league','receipts','scoring','missing','duplicate','season','horizon','stale',
    'ir_unknown','eligible_unknown','coverage','nan','none','position','demand','expected_duplicate'])
def test_partial_mixed_or_unknown_inputs_withhold_baseline(change):
    args=inputs();r=args['rows'][0]
    if change=='league':args['league_id']=None
    if change=='receipts':args['receipts']={}
    if change=='scoring':args['receipts']['scoring_sha256']='f'*64
    if change=='missing':args['rows'].pop()
    if change=='duplicate':args['rows'].append(copy.deepcopy(r))
    if change=='season':r['season']=2025
    if change=='horizon':r['horizon']['end']='2026-10-08'
    if change=='stale':r['as_of']='2026-09-29T12:00:00Z'
    if change=='ir_unknown':r['ir_status']=None
    if change=='eligible_unknown':r['eligible']=None
    if change=='coverage':r['coverage']='partial'
    if change=='nan':r['projected_points']=float('nan')
    if change=='none':r['projected_points']=None
    if change=='position':r['position']='D'
    if change=='demand':args['roster_demand']=None
    if change=='expected_duplicate':args['expected_player_ids'].append(1)
    result=replacement_pool(**args)
    assert result['status']=='unavailable' and result['baseline_points'] is None and result['reasons']
    assert len(result['candidates'])==len(args['rows'])


def test_explicit_ir_excluded_but_not_silently_missing_active():
    args=inputs(5);args['rows'][0]['ir_status']='ir'
    result=replacement_pool(**args)
    assert result['replacement_player_id']==4
    assert result['candidates'][0]['reasons']==['explicit_ir']
    args['rows'][1]['eligible']=False
    assert replacement_pool(**args)['replacement_player_id']==5


def test_complete_large_pool_ranking_is_batch_order_independent_and_ties_use_player_id():
    args=inputs(1205);args['roster_demand']=2
    for row in args['rows']:row['projected_points']=0.
    for row in args['rows'][-3:]:row['projected_points']=100.
    first=replacement_pool(**args)
    assert first['replacement_player_id']==1205
    args['rows'].reverse();args['expected_player_ids'].reverse()
    second=replacement_pool(**args)
    assert second['ranking']==first['ranking']
    assert second['ranked_pool_sha256']==first['ranked_pool_sha256']


def test_repeated_player_different_horizon_does_not_fill_replacement_slot():
    args=inputs();extra=copy.deepcopy(args['rows'][0]);extra['horizon']['start']='2026-10-08'
    args['rows'].append(extra)
    result=replacement_pool(**args)
    assert result['baseline_points'] is None
    assert 'duplicate_player_horizon' in result['candidates'][-1]['reasons']
