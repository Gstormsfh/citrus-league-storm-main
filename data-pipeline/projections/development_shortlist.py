"""Pure declared earlier-fold shortlist, never source/serving acceptance."""
from copy import deepcopy
from itertools import combinations
import math
import re

from projections.analytics_publication import fingerprint

VERSION='citrus-development-probability-shortlist-v1'
CANDIDATES=[family+'_'+kind for family in ('geometry','base_context','enhanced_context') for kind in ('raw','sigmoid','isotonic')]
CONSTANTS=['prevalence_raw','prevalence_calibrated']
BATCHES={'base':CONSTANTS+CANDIDATES[:6], 'enhanced':CONSTANTS+CANDIDATES[:3]+CANDIDATES[6:],
         'context_ablation':CANDIDATES[3:]}
FOLDS={'fold1':{'train':{'start':'2019-07-01','end':'2021-06-30'},'calibration':{'start':'2021-07-01','end':'2022-06-30'},'validation':{'start':'2022-07-01','end':'2023-06-30'}},
       'fold2':{'train':{'start':'2019-07-01','end':'2022-06-30'},'calibration':{'start':'2022-07-01','end':'2023-06-30'},'validation':{'start':'2023-07-01','end':'2024-06-30'}}}
SELECTION={'version':'equal_fold_probability_shortlist-v1',
    'purpose':'development_shortlist_only_not_serving_or_prospective_acceptance',
    'eligible_families':['geometry','base_context','enhanced_context'],
    'guard':'Brier_and_log_loss_no_worse_than_geometry_raw_in_each_fold','guard_tolerance':1e-12,
    'ranking':['mean_fold_log_loss_equal_fold_weight','mean_fold_Brier_equal_fold_weight','fixed_complexity_tie_order'],
    'tie_order':CANDIDATES,
    'uncertainty':'paired_whole_game_bootstrap_intervals_conditional_on_fixed_candidates_not_multiplicity_adjusted',
    'subgroup_review':'retain_all_declared_groups_and_reliability_bins; aggregate_shortlist_is_not_subgroup_acceptance',
    'later_2025_observed_test_used_for_ranking':False,'automatic_acceptance_or_serving_promotion':False}


def _sha(value):
    if not isinstance(value,str) or re.fullmatch('[0-9a-f]{64}',value) is None:raise ValueError('Explicit SHA256 required')
    return value


def _loss(model,name):
    value=model['metrics'][name]['value']
    if type(value) not in (int,float) or not math.isfinite(value) or value<0 or (name=='brier' and value>1):
        raise ValueError('Finite available probability loss required')
    return value


def _population(statistics):
    values=tuple(statistics[k] for k in ('events','games','goals'))
    if any(type(v) is not int for v in values) or not 0<=values[2]<=values[0]<=1_000_000 or not 0<=values[1]<=values[0]:
        raise ValueError('Invalid population counts')
    if statistics['status'] not in ('measured','descriptive_only_sparse_cohort'):raise ValueError('Unavailable scorecard cohort')
    return (*values,statistics['status'])


def _pairs(statistics,names):
    result={}
    for pair in statistics['paired_differences']:
        key=(pair['left'],pair['right'])
        if key in result or pair['direction']!='left_minus_right':raise ValueError('Duplicate or wrong-direction paired interval')
        result[key]=pair
    if set(result)!=set(combinations(sorted(names),2)):raise ValueError('Complete paired model comparisons required')
    return result


def _metrics(metrics,resamples):
    for metric in metrics.values():
        value=metric['value'];interval=metric['interval']
        if value is not None and (type(value) not in (int,float) or not math.isfinite(value)):raise ValueError('Nonfinite or Boolean metric')
        counts=[interval[k] for k in ('valid_resamples','invalid_resamples','not_computed_resamples')]
        if any(type(n) is not int or n<0 for n in counts) or sum(counts)!=resamples:raise ValueError('Invalid interval resample accounting')
        if interval['status']=='estimated':
            lower,upper=interval['lower'],interval['upper']
            if (value is None or counts[0]==0 or any(type(v) not in (int,float) or not math.isfinite(v) for v in (lower,upper)) or lower>upper):raise ValueError('Fabricated estimated interval')
        elif interval['status']=='insufficient_evidence':
            if interval['lower'] is not None or interval['upper'] is not None:raise ValueError('Unavailable interval must remain null')
        else:raise ValueError('Unknown interval status')


def shortlist_development(scorecards,plan,*,source_manifest_sha256):
    """Requires caller-verified outer artifacts and plan; hashes are not proof.

    Six bounded report objects only. No data paths, future readers, models or
    refitting; same-event membership is a checked lineage declaration here.
    """
    _sha(source_manifest_sha256)
    if (not isinstance(plan,dict) or plan.get('contract')!='citrus-earlier-development-ablation-plan-v1'
            or plan.get('publishable') is not False or fingerprint(plan.get('selection'))!=fingerprint(SELECTION)
            or plan.get('predictors')!=CONSTANTS+CANDIDATES or plan.get('folds')!=FOLDS
            or plan.get('source_seasons')!=[2019,2020,2021,2022,2023]
            or plan.get('untouched_test_claim') is not False):raise ValueError('Exact frozen shortlist declaration required')
    if not isinstance(scorecards,dict) or set(scorecards)!={'fold1','fold2'}:raise ValueError('Exactly two development folds required')
    merged={};hashes={};pair_maps={};subgroup_counts={};fold_populations={}
    for fold,batches in scorecards.items():
        if not isinstance(batches,dict) or set(batches)!=set(BATCHES):raise ValueError('Exactly three declared batches required')
        models={};pipelines={};pairs={};subgroups={};common=None
        hashes[fold]={}
        for batch,report in batches.items():
            if (report['contract']!='citrus-probability-scorecard-v1' or report['status']!='measured_not_model_acceptance'
                    or report['publishable'] is not False or report['config']!=plan['config']['scorecard']
                    or report['source_authenticity_verified'] is not False or report['fit_or_split_execution_verified'] is not False
                    or report['evidence_kind'] not in ('real','synthetic')):raise ValueError('Wrong or unverified scorecard status/config')
            if not isinstance(report['subgroups'],list) or len(report['subgroups'])>1024:raise ValueError('Bounded subgroup inventory required')
            if _sha(report['report_sha256'])!=fingerprint({k:v for k,v in report.items() if k!='report_sha256'}):raise ValueError('Detached scorecard hash')
            hashes[fold][batch]=report['report_sha256']
            names=set(BATCHES[batch]);overall=report['overall'];lineage=report['lineage']
            if set(overall['models'])!=names or set(lineage['pipelines'])!=names:raise ValueError('Exact 8/8/6 batch identities required')
            game_ids=report['resampling']['game_ids']
            if (not isinstance(game_ids,list) or not game_ids or any(type(g) is not int for g in game_ids)
                    or game_ids!=sorted(set(game_ids)) or len(game_ids)!=overall['games']):raise ValueError('Exact validation game population required')
            for key in ('source_manifest_sha256','split_sha256','prediction_rows_sha256'):_sha(lineage[key])
            if lineage['source_manifest_sha256']!=source_manifest_sha256:raise ValueError('Detached caller-pinned export source lineage')
            identity=(_population(overall),game_ids,lineage['source_manifest_sha256'],lineage['split_sha256'],report['evidence_kind'],report['resampling'])
            if common is not None and identity!=common:raise ValueError('Batch validation populations or source/split lineage differ')
            common=identity
            for name,model in overall['models'].items():
                _loss(model,'brier');_loss(model,'log_loss_clipped');_sha(lineage['pipelines'][name])
                _metrics(model['metrics'],report['config']['resamples'])
                if name in models and (model!=models[name] or lineage['pipelines'][name]!=pipelines[name]):raise ValueError('Overlapping predictor metrics or pipeline identity differ')
                models[name]=model;pipelines[name]=lineage['pipelines'][name]
            for key,pair in _pairs(overall,names).items():
                _metrics(pair['metrics'],report['config']['resamples'])
                if key in pairs and pairs[key]!=pair:raise ValueError('Overlapping paired evidence differs')
                pairs[key]=pair
            seen_groups=set()
            for entry in report['subgroups']:
                key=(entry['dimension'],entry['value'])
                if key in seen_groups or entry['dimension'] not in plan['groups'] or (entry['value'] is not None and not isinstance(entry['value'],str)):
                    raise ValueError('Invalid subgroup identity')
                seen_groups.add(key);stats=entry['statistics']
                if set(stats['models'])!=names:raise ValueError('Incomplete subgroup predictor inventory')
                record=subgroups.setdefault(key,{'population':_population(stats),'models':{},'pairs':{}})
                if record['population']!=_population(stats):raise ValueError('Subgroup populations differ')
                for name,model in stats['models'].items():
                    _metrics(model['metrics'],report['config']['resamples'])
                    if name in record['models'] and model!=record['models'][name]:raise ValueError('Overlapping subgroup metrics differ')
                    record['models'][name]=model
                for key_pair,pair in _pairs(stats,names).items():
                    _metrics(pair['metrics'],report['config']['resamples'])
                    if key_pair in record['pairs'] and record['pairs'][key_pair]!=pair:raise ValueError('Overlapping subgroup paired evidence differs')
                    record['pairs'][key_pair]=pair
            if batch!='base':
                # Compare by complete membership, independent of mapping iteration order.
                first_groups={(e['dimension'],e['value']) for e in batches['base']['subgroups']}
                if seen_groups!=first_groups:raise ValueError('Missing subgroup population')
        for dimension in plan['groups']:
            if sum(v['population'][0] for k,v in subgroups.items() if k[0]==dimension)!=common[0][0]:raise ValueError('Incomplete subgroup event denominator')
        merged[fold]=models;pair_maps[fold]=pairs;subgroup_counts[fold]=len(subgroups)
        fold_populations[fold]={'game_ids':common[1],'split_sha256':common[3]}
    if (set(fold_populations['fold1']['game_ids'])&set(fold_populations['fold2']['game_ids'])
            or fold_populations['fold1']['split_sha256']==fold_populations['fold2']['split_sha256']):
        raise ValueError('Development validation folds overlap or repeat split lineage')
    ranking=[]
    for name in CANDIDATES:
        losses={fold:{metric:_loss(models[name],metric) for metric in ('brier','log_loss_clipped')} for fold,models in merged.items()}
        failures=[{'fold':fold,'metric':metric,'value':losses[fold][metric],'reference':_loss(merged[fold]['geometry_raw'],metric)}
            for fold in merged for metric in ('brier','log_loss_clipped')
            if losses[fold][metric]>_loss(merged[fold]['geometry_raw'],metric)+1e-12]
        ranking.append({'candidate':name,'eligible':not failures,'guard_failures':failures,'fold_losses':losses,
            'mean_fold_log_loss':sum(v['log_loss_clipped']/2 for v in losses.values()),
            'mean_fold_brier':sum(v['brier']/2 for v in losses.values())})
    eligible=sorted((r for r in ranking if r['eligible']),key=lambda r:(r['mean_fold_log_loss'],r['mean_fold_brier'],CANDIDATES.index(r['candidate'])))
    selected=eligible[0]['candidate'] if eligible else None
    comparisons={}
    if selected is not None:
        for fold,pairs in pair_maps.items():
            comparisons[fold]={}
            for reference in CANDIDATES[:6]:
                if reference==selected:continue
                key=tuple(sorted((selected,reference)))
                pair=deepcopy(pairs[key])
                comparisons[fold][reference]={'paired_evidence':pair,'selected_is_left':pair['left']==selected}
    result={'contract':VERSION,'status':'development_shortlist_not_accepted','publishable':False,
        'selected_candidate':selected,'eligible_ranking':eligible,'all_candidates':ranking,
        'constant_baselines':{fold:{name:deepcopy(models[name]) for name in CONSTANTS} for fold,models in merged.items()},
        'selected_paired_comparisons':comparisons,'plan_sha256':fingerprint(plan),'scorecard_sha256':hashes,
        'source_manifest_sha256':source_manifest_sha256,
        'validation_population':fold_populations,
        'subgroup_review':{'status':'not_accepted','group_counts':subgroup_counts,'full_reliability_and_groups':'caller_must_retain_bound_full_scorecards'},
        'limitations':['Outer completion/artifact and frozen-plan binding verification is required from caller.',
            'Semantic hashes and matching lineage do not authenticate source or prove event membership.',
            'Intervals are fixed-candidate paired whole-game summaries, not multiplicity-adjusted selection uncertainty.',
            'Shortlisting is not subgroup, prospective, quality or serving acceptance.']}
    return {**result,'receipt_sha256':fingerprint(result)}
