"""Independent identity experiment audits and fail-closed boundary regressions."""
from copy import deepcopy
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_identity_probability as run
from projections import identity_probability as candidate
from projections.analytics_publication import fingerprint


def rows(later=False, n=60):
    return [{'game_id':2022020001 if later else 2021020001,'event_id':i,
             'game_date':'2022-10-01' if later else '2021-10-01','probability':.1,
             'shooter_id':8470001+i%2,'goalie_id':8480001+i//2%2} for i in range(n)]


def yy(n=60): return [int(i%9==0) for i in range(n)]


def rehash(model):
    model['model_sha256'] = fingerprint({k:v for k,v in model.items() if k != 'model_sha256'})
    return model


@pytest.mark.parametrize('mode',candidate.MODES)
def test_independent_audit_matches_fit_and_every_prediction(mode):
    model = candidate.fit(rows(), yy(), mode=mode)
    prediction = candidate.predict(model, rows(True))
    result = run.audit_fit(rows(), yy(), model, rows(True), prediction)
    assert result['max_prediction_absolute_error'] < 1e-12
    assert result['fit_validation_games_disjoint'] is True
    assert result['publishable'] is False


@pytest.mark.parametrize('tamper',['fit_probability','fit_target','coefficient','support','prediction','missing_prediction','date','role_vocabulary'])
def test_independent_audit_rejects_tampering(tamper):
    fit_rows = rows(); targets = yy(); validation = rows(True)
    model = candidate.fit(fit_rows, targets, mode='joint')
    prediction = candidate.predict(model,validation)
    if tamper == 'fit_probability': fit_rows[0]['probability'] += .01
    elif tamper == 'fit_target': targets[0] = 1-targets[0]
    elif tamper == 'coefficient': model['intercept'] += .01; rehash(model)
    elif tamper == 'support': model['effects']['shooter'][0]['fit_events'] += 1; rehash(model)
    elif tamper == 'prediction': prediction[0] += .01
    elif tamper == 'missing_prediction': prediction.pop()
    elif tamper == 'date': validation = rows()
    elif tamper == 'role_vocabulary': model['effects']['shooter'][0]['player_id'] -= 1; rehash(model)
    with pytest.raises(ValueError): run.audit_fit(fit_rows,targets,model,validation,prediction)


def test_actor_unavailability_unseen_and_goals_remain_counted():
    fit = [{**r,'target':y} for r,y in zip(rows(),yy())]
    validation = [{**r,'target':y} for r,y in zip(rows(True),yy())]
    validation[0].update(shooter_id=None,goalie_id=None)
    validation[1].update(shooter_id=8499998,goalie_id=8499999)
    result = run.actor_support(validation,fit)
    for role in ('shooter','goalie'):
        assert result[role]['missing']['events'] == 1
        assert result[role]['unseen_in_fit']['events'] == 1
        assert sum(g['events'] for g in result[role].values()) == 60
        assert sum(g['goals'] for g in result[role].values()) == sum(yy())


def test_future_outcomes_and_source_metadata_never_enter_prediction_input():
    records = [{**r,'target':y,'source_event_sha256':'a'*64,'event_type':'goal' if y else 'missed-shot'}
               for r,y in zip(rows(True),yy())]
    before = run.prediction_inputs(records)
    for record in records:
        record['target'] = 1-record['target']; record['event_type'] = 'different'
    assert run.prediction_inputs(records) == before
    assert all(set(r) == candidate.FIELDS for r in before)


def test_monthly_scores_keep_all_models_and_rows():
    rr = [{**r,'target':y} for r,y in zip(rows(True),yy())]
    pp = {name:[.1]*60 for name in run.NAMES}
    monthly = run.monthly_scores(rr,pp)
    assert len(monthly) == 1 and monthly[0]['events'] == 60
    assert set(monthly[0]['models']) == set(run.NAMES)
    assert monthly[0]['models']['joint']['expected_goals'] == pytest.approx(6)


@pytest.mark.parametrize('field,value',[('primary_candidate','shooter'),('settings',{}),('baseline','new'),
                                       ('publishable',True),('declared_at','2099-01-01T00:00:00Z')])
def test_declaration_rejects_posthoc_modes_settings_or_future_time(field,value):
    plan = run.strict_json((run.ROOT/run.PLAN).read_bytes()); plan[field] = value
    with pytest.raises(ValueError): run.validate_plan(plan,'2026-09-06T18:00:00+00:00')


def test_current_plan_and_output_scope():
    run.validate_plan(run.strict_json((run.ROOT/run.PLAN).read_bytes()),'2026-09-06T18:00:00+00:00')
    with pytest.raises(ValueError,match='scoped'): run.run('/private/tmp/not-the-experiment')


def test_missing_plan_retains_failed_attempt_and_refuses_reuse(tmp_path,monkeypatch):
    monkeypatch.setattr(run,'ROOT',tmp_path)
    (tmp_path/'scripts/proof/results').mkdir(parents=True)
    output = tmp_path/'scripts/proof/results/official-identity-probability-test'
    with pytest.raises(ValueError): run.run(output)
    failure = run.strict_json((output/'failure.json').read_bytes())
    assert failure['partial_evidence_preserved'] is True and failure['completed_folds'] == []
    assert (output/'attempt-started.json').exists()
    before = (output/'failure.json').read_bytes()
    with pytest.raises(FileExistsError): run.run(output)
    assert (output/'failure.json').read_bytes() == before
