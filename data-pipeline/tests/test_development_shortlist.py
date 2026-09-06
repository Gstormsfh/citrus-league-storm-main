"""Synthetic scorecards only; no real candidate results or model loading."""
from copy import deepcopy
import json
from pathlib import Path

import pytest
from projections import development_shortlist as module
from projections.analytics_publication import fingerprint
from projections.probability_scorecard import probability_scorecard


def inputs(*,tie=False,bad_second=False):
    plan=json.loads((Path(__file__).resolve().parents[2]/'docs/analytics-development-ablation-plan-20260906.json').read_bytes())
    plan['source_schedule_sha256']='a'*64;plan['groups']=['state']
    plan['config']['scorecard']={'bin_edges':[0,.2,.5,1],'log_loss_epsilon':1e-12,
        'resamples':2,'seed':17,'confidence':.9,'min_games':2,'min_events':2,'min_valid_fraction':.8}
    scores={}
    for fold,year in [('fold1',2022),('fold2',2023)]:
        scores[fold]={};rows=[]
        for game in range(4 if fold=='fold1' else 6):
            for event,target in enumerate((0,1,0,1)):
                predictions={}
                for i,name in enumerate(module.CONSTANTS+module.CANDIDATES):
                    predictions[name]=.4 if tie else (.5 if name.startswith('prevalence') else (.2-i*.009 if target==0 else .4+i*.03))
                    if bad_second and fold=='fold2' and name=='enhanced_context_isotonic':predictions[name]=.99 if target==0 else .01
                rows.append({'game_id':year*1000000+20001+game,'event_id':event,'target':target,'groups':{'state':None if game==0 else 'known'},'predictions':predictions})
        for batch,names in module.BATCHES.items():
            selected=[{**r,'predictions':{n:r['predictions'][n] for n in names}} for r in rows]
            scores[fold][batch]=probability_scorecard(selected,config=plan['config']['scorecard'],evidence_kind='synthetic',lineage={
                'prediction_rows_sha256':fingerprint(selected),'source_manifest_sha256':'b'*64,
                'split_sha256':fingerprint(fold),'pipelines':{n:fingerprint([fold,n]) for n in names}})
    return scores,plan


def rehash(report):report['report_sha256']=fingerprint({k:v for k,v in report.items() if k!='report_sha256'})


def shortlist(scores,plan):return module.shortlist_development(scores,plan,source_manifest_sha256='b'*64)


def test_exact_declared_ranking_equal_fold_weight_and_pairs():
    scores,plan=inputs();before=deepcopy(scores)
    result=shortlist(scores,plan)
    assert result['selected_candidate']=='enhanced_context_isotonic'
    assert len(result['all_candidates'])==9 and len(result['constant_baselines']['fold1'])==2
    first=result['eligible_ranking'][0]
    assert first['mean_fold_log_loss']==sum(scores[f]['enhanced']['overall']['models'][first['candidate']]['metrics']['log_loss_clipped']['value']/2 for f in scores)
    assert len(result['selected_paired_comparisons']['fold1'])==6
    assert result['subgroup_review']['status']=='not_accepted' and not result['publishable']
    assert scores==before
    assert result['receipt_sha256']==fingerprint({k:v for k,v in result.items() if k!='receipt_sha256'})


def test_one_bad_fold_excludes_candidate_even_if_other_fold_better():
    scores,plan=inputs(bad_second=True);result=shortlist(scores,plan)
    candidate=next(r for r in result['all_candidates'] if r['candidate']=='enhanced_context_isotonic')
    assert not candidate['eligible'] and {f['fold'] for f in candidate['guard_failures']}=={'fold2'}
    assert result['selected_candidate']!='enhanced_context_isotonic'


def test_exact_tie_uses_fixed_complexity_not_mapping_order():
    scores,plan=inputs(tie=True)
    scores=dict(reversed(list(scores.items())))
    for fold in scores:scores[fold]=dict(reversed(list(scores[fold].items())))
    result=shortlist(scores,plan)
    assert result['selected_candidate']=='geometry_raw'
    assert [r['candidate'] for r in result['eligible_ranking']]==module.CANDIDATES


def test_repeating_one_validation_fold_twice_is_rejected():
    scores,plan=inputs();scores['fold2']=deepcopy(scores['fold1'])
    with pytest.raises(ValueError,match='overlap'):shortlist(scores,plan)


@pytest.mark.parametrize('bad',['hash','population','source','split','pipeline','overlap','missing_model','missing_batch','missing_pair','interval','loss','subgroup'])
def test_detached_or_inconsistent_reports_rejected(bad):
    scores,plan=inputs();report=scores['fold1']['enhanced']
    if bad=='hash':report['report_sha256']='f'*64
    elif bad=='population':report['overall']['goals']-=1
    elif bad=='source':report['lineage']['source_manifest_sha256']='f'*64
    elif bad=='split':report['lineage']['split_sha256']='f'*64
    elif bad=='pipeline':report['lineage']['pipelines']['geometry_raw']='f'*64
    elif bad=='overlap':report['overall']['models']['geometry_raw']['expected_goals']+=1
    elif bad=='missing_model':del report['overall']['models']['geometry_raw']
    elif bad=='missing_batch':del scores['fold1']['base']
    elif bad=='missing_pair':report['overall']['paired_differences'].pop()
    elif bad=='interval':report['overall']['models']['enhanced_context_raw']['metrics']['brier']['interval']['lower']=None
    elif bad=='loss':report['overall']['models']['enhanced_context_raw']['metrics']['brier']['value']=None
    else:report['subgroups'].pop()
    if bad!='hash':rehash(report)
    with pytest.raises((ValueError,KeyError)):shortlist(scores,plan)


@pytest.mark.parametrize('bad',['guard','tie','later','fold','tolerance'])
def test_plan_selection_cannot_be_changed(bad):
    scores,plan=inputs()
    if bad=='guard':plan['selection']['guard']='just AUC'
    elif bad=='tie':plan['selection']['tie_order'].reverse()
    elif bad=='later':plan['selection']['later_2025_observed_test_used_for_ranking']=True
    elif bad=='fold':plan['folds']['fold2']['validation']['end']='2025-06-30'
    else:plan['selection']['guard_tolerance']=.1
    with pytest.raises(ValueError):shortlist(scores,plan)


@pytest.mark.parametrize('value',[float('nan'),float('inf'),True,-.1])
def test_nonfinite_boolean_or_invalid_loss_rejected(value):
    scores,plan=inputs();report=scores['fold1']['enhanced']
    report['overall']['models']['enhanced_context_raw']['metrics']['brier']['value']=value
    if isinstance(value,float) and (value!=value or value==float('inf')):
        with pytest.raises(ValueError):shortlist(scores,plan)
    else:
        rehash(report)
        with pytest.raises(ValueError):shortlist(scores,plan)


def test_source_manifest_pin_is_distinct_from_schedule_digest():
    scores,plan=inputs()
    result=shortlist(scores,plan)
    assert result['source_manifest_sha256']=='b'*64 and plan['source_schedule_sha256']=='a'*64
    with pytest.raises(ValueError,match='export source'):
        module.shortlist_development(scores,plan,source_manifest_sha256=plan['source_schedule_sha256'])


def test_boolean_zero_selection_policy_is_not_equivalent():
    scores,plan=inputs();plan['selection']['automatic_acceptance_or_serving_promotion']=0
    with pytest.raises(ValueError):shortlist(scores,plan)
