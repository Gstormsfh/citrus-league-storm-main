"""Synthetic contract tests only: no fitted models or external hockey data."""
from dataclasses import replace
import math
import random

import pytest

from projections.sequence_value import (
    GOAL, NEXT_GOAL_GIVEN_REBOUND, REBOUND_GIVEN_NO_GOAL,
    Lineage, Probability, Shot, creation_credit, rebound_creation,
    survival_weighted_flurry,
)


LINEAGE = Lineage('synthetic-source', 'synthetic-model', 'synthetic-features',
                  'synthetic-calibrator')


def probability(value, conditioning=GOAL, lineage=LINEAGE):
    return Probability(value, conditioning, lineage)


def shot(index, value, **changes):
    return replace(Shot(f'shot-{index}', 'game', 'team', 1, index, False,
                        probability(value)), **changes)


def flurry(shots, **kwargs):
    return survival_weighted_flurry(shots, sequence_verified=True,
                                   verification_receipt='synthetic-chain-receipt', **kwargs)


def rebound_inputs(p=0.2, q=0.5, next_goal=0.25):
    return (probability(p), probability(q, REBOUND_GIVEN_NO_GOAL),
            probability(next_goal, NEXT_GOAL_GIVEN_REBOUND))


def test_flurry_exact_hand_calculation_and_labels():
    result = flurry([shot(1, 0.25), shot(2, 0.5), shot(3, 0.5, goal=True)])
    assert result.contributions == (0.25, 0.375, 0.1875)
    assert result.cumulative == (0.25, 0.625, 0.8125)
    assert result.survival == 0.1875
    assert result.lineage == LINEAGE
    assert result.shot_ids == ('shot-1', 'shot-2', 'shot-3')
    assert result.semantics == 'retrospective-observed-sequence-accounting'


@pytest.mark.parametrize('values', [(0,), (1,), (0, 0, 0), (0, 1, 0.8), (1, 1)])
def test_exact_zero_and_one_are_measured_probabilities(values):
    result = flurry([shot(i, p) for i, p in enumerate(values)])
    assert result.cumulative[-1] == 1 - math.prod(1-p for p in values)
    assert all(0 <= value <= p for value, p in zip(result.contributions, values))


@pytest.mark.parametrize('invalid', [None, True, False, '0.2', float('nan'),
                                    float('inf'), -float('inf'), -0.01, 1.01])
def test_unknown_or_invalid_probabilities_reject_instead_of_becoming_zero(invalid):
    with pytest.raises(ValueError, match='Probability'):
        probability(invalid)


@pytest.mark.parametrize('field', ['source_receipt', 'model', 'features', 'calibrator'])
def test_missing_lineage_rejected(field):
    with pytest.raises(ValueError):
        replace(LINEAGE, **{field: ''})


@pytest.mark.parametrize('field,value', [('shot_id', ''), ('game_id', ''), ('team_id', ''),
                                       ('period', 0), ('period', True), ('order', -1),
                                       ('order', 1.5), ('goal', None), ('goal', 1)])
def test_shot_metadata_must_be_explicit(field, value):
    with pytest.raises(ValueError):
        shot(1, 0.2, **{field: value})


@pytest.mark.parametrize('change', [dict(shot_id='shot-1'), dict(game_id='other'),
                                   dict(team_id='other'), dict(period=2), dict(order=1),
                                   dict(order=0)])
def test_mixed_duplicate_or_unordered_sequence_rejects(change):
    with pytest.raises(ValueError):
        flurry([shot(1, 0.2), shot(2, 0.3, **change)])


@pytest.mark.parametrize('field', ['source_receipt', 'model', 'features', 'calibrator'])
def test_flurry_rejects_mixed_probability_provenance(field):
    with pytest.raises(ValueError, match='Mixed'):
        flurry([shot(1, 0.2), shot(2, 0.3, probability=probability(
            0.3, lineage=replace(LINEAGE, **{field: 'other'})))])


def test_observed_goal_terminates_chain_but_does_not_replace_probability():
    assert flurry([shot(1, 0, goal=True)]).cumulative == (0,)
    with pytest.raises(ValueError, match='after observed goal'):
        flurry([shot(1, 0.2, goal=True), shot(2, 0.3)])


@pytest.mark.parametrize('verified', [False, None, 1, 'verified'])
def test_explicit_verification_required(verified):
    with pytest.raises(ValueError):
        survival_weighted_flurry([shot(1, 0.2)], sequence_verified=verified,
                                verification_receipt='receipt')


def test_empty_sequence_missing_receipt_and_wrong_conditioning_reject():
    with pytest.raises(ValueError):
        flurry([])
    with pytest.raises(ValueError):
        survival_weighted_flurry([shot(1, 0.2)], sequence_verified=True,
                                verification_receipt='')
    with pytest.raises(ValueError, match='conditioning'):
        shot(1, 0.2, probability=probability(0.2, REBOUND_GIVEN_NO_GOAL))


def test_seeded_flurry_properties_without_fitted_parameters():
    random_values = random.Random(746)
    for size in (1, 2, 8, 100, 2000):
        values = [random_values.random() for _ in range(size)]
        result = flurry([shot(i, p) for i, p in enumerate(values)])
        assert all(0 <= c <= p for c, p in zip(result.contributions, values))
        assert all(a <= b <= 1 for a, b in zip((0,) + result.cumulative,
                                              result.cumulative))
        assert math.fsum(result.contributions) == pytest.approx(result.cumulative[-1])
        assert result.cumulative[-1] == pytest.approx(1-math.prod(1-p for p in values))
        reversed_result = flurry([shot(i, p) for i, p in enumerate(reversed(values))])
        assert reversed_result.cumulative[-1] == pytest.approx(result.cumulative[-1])


def test_tiny_probabilities_remain_nonzero_contributions():
    result = flurry([shot(1, 1e-20), shot(2, 1e-20)])
    assert all(c > 0 for c in result.contributions)
    assert result.cumulative == (1e-20, 2e-20)


def test_rebound_creation_explicit_conditioning_and_one_hop():
    result = rebound_creation(*rebound_inputs())
    assert result.rebound_probability == pytest.approx(0.4)
    assert result.expected_future_goals == pytest.approx(0.1)
    assert result.conditional_rebound.conditioning == REBOUND_GIVEN_NO_GOAL
    assert result.conditional_next_goal.conditioning == NEXT_GOAL_GIVEN_REBOUND
    assert 'not-recursive' in result.semantics


@pytest.mark.parametrize('p', [0, 0.2, 1])
@pytest.mark.parametrize('q', [0, 0.4, 1])
@pytest.mark.parametrize('next_goal', [0, 0.6, 1])
def test_rebound_and_creation_coherence_boundaries(p, q, next_goal):
    inputs = rebound_inputs(p, q, next_goal)
    result = rebound_creation(*inputs)
    assert 0 <= result.expected_future_goals <= result.rebound_probability <= 1-p
    assert result.rebound_probability == (1-p)*q
    for is_rebound in (False, True):
        credit = creation_credit(*inputs, is_rebound=is_rebound,
                                 classification_receipt='synthetic-rebound-classification')
        assert credit.direct_credit == (0 if is_rebound else p)
        assert credit.expected_rebound_credit == result.expected_future_goals
        assert credit.total_credit == credit.direct_credit + credit.expected_rebound_credit
        assert 0 <= credit.total_credit <= 1
        assert credit.semantics == 'creation-allocation-not-flurry-or-team-goal-probability'


def test_rebound_models_can_differ_but_source_context_cannot():
    p, q, n = rebound_inputs()
    q = replace(q, lineage=replace(q.lineage, model='rebound-model', calibrator='rebound-calibrator'))
    assert rebound_creation(p, q, n).rebound_probability == pytest.approx(0.4)
    for field in ('source_receipt', 'features'):
        with pytest.raises(ValueError, match='source/context'):
            rebound_creation(p, replace(q, lineage=replace(q.lineage, **{field: 'other'})), n)


def test_rebound_conditioning_and_classification_cannot_be_assumed():
    p, q, n = rebound_inputs()
    with pytest.raises(ValueError, match='conditioning'):
        rebound_creation(p, n, q)
    with pytest.raises(ValueError, match='conditioning'):
        rebound_creation(p, probability(0.5, 'P(rebound)'), n)
    with pytest.raises(ValueError):
        creation_credit(p, q, n, is_rebound=None, classification_receipt='receipt')
    with pytest.raises(ValueError):
        creation_credit(p, q, n, is_rebound=False, classification_receipt='')


def test_rebound_shot_can_create_future_credit_without_its_own_direct_xg():
    inputs = rebound_inputs()
    nonrebound = creation_credit(*inputs, is_rebound=False, classification_receipt='receipt')
    rebound = creation_credit(*inputs, is_rebound=True, classification_receipt='receipt')
    assert nonrebound.total_credit == pytest.approx(0.3)
    assert rebound.total_credit == pytest.approx(0.1)
    assert nonrebound.total_credit - rebound.total_credit == pytest.approx(inputs[0].value)
