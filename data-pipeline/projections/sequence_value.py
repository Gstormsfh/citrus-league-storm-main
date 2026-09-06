"""Offline mathematical contracts, not trained models or publication approval.

Conceptual attribution: https://moneypuck.com/about.htm (flurry discounting,
expected rebounds, and creation credit). This is an independent implementation;
no external fitted parameters, predictions, data, or accuracy claims are used.

Chain membership must be established upstream from verified source events. This
module never infers possession, rebound status, or a time-window threshold.
Lineage and verification receipts are explicit caller attestations, not proof
that this module independently authenticated sources or calibrated a model.
"""
from dataclasses import dataclass
import math
from typing import Sequence


GOAL = 'P(goal|shot-context)'
REBOUND_GIVEN_NO_GOAL = 'P(rebound|no-goal,shot-context)'
NEXT_GOAL_GIVEN_REBOUND = 'E[next-shot-goal|rebound,shot-context]'


def _text(value, field):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f'{field} must identify explicit evidence')


@dataclass(frozen=True)
class Lineage:
    source_receipt: str
    model: str
    features: str
    calibrator: str

    def __post_init__(self):
        for field in ('source_receipt', 'model', 'features', 'calibrator'):
            _text(getattr(self, field), field)


@dataclass(frozen=True)
class Probability:
    value: float
    conditioning: str
    lineage: Lineage

    def __post_init__(self):
        if (type(self.value) not in (int, float) or not math.isfinite(self.value)
                or not 0 <= self.value <= 1):
            raise ValueError('Probability must be known, finite, and in [0, 1]')
        _text(self.conditioning, 'conditioning')
        if not isinstance(self.lineage, Lineage):
            raise ValueError('Explicit probability lineage is required')


def _condition(estimate, conditioning):
    if not isinstance(estimate, Probability) or estimate.conditioning != conditioning:
        raise ValueError(f'Expected conditioning: {conditioning}')


@dataclass(frozen=True)
class Shot:
    shot_id: str
    game_id: str
    team_id: str
    period: int
    order: int
    goal: bool
    probability: Probability

    def __post_init__(self):
        for field in ('shot_id', 'game_id', 'team_id'):
            _text(getattr(self, field), field)
        if type(self.period) is not int or self.period < 1:
            raise ValueError('Period must be a positive integer')
        if type(self.order) is not int or self.order < 0:
            raise ValueError('Order must be a nonnegative source event ordinal')
        if type(self.goal) is not bool:
            raise ValueError('Observed goal status must be known')
        _condition(self.probability, GOAL)


@dataclass(frozen=True)
class FlurryValue:
    shot_ids: tuple[str, ...]
    contributions: tuple[float, ...]
    cumulative: tuple[float, ...]
    survival: float
    lineage: Lineage
    verification_receipt: str
    semantics: str = 'retrospective-observed-sequence-accounting'


def survival_weighted_flurry(shots: Sequence[Shot], *, sequence_verified: bool,
                            verification_receipt: str) -> FlurryValue:
    """Discount p_i by prior non-goal survival; never boost any input shot.

    Computes p_i * product(1-p_j) for j < i on a caller-verified chain. This
    observed-sequence accounting is NOT a prospective possession prediction:
    the existence/quality of later observed shots is not forecast here. A
    conditional-hazard interpretation would require independently validated
    conditional probabilities and a prospective continuation model.

    Invalid or unknown inputs reject the entire calculation, even following
    p=1. An observed goal may terminate the chain but cannot be followed by a
    further shot in it. Probability 1 is not an observed-goal flag.
    """
    if sequence_verified is not True:
        raise ValueError('Sequence must be explicitly source-verified')
    _text(verification_receipt, 'verification_receipt')
    shots = tuple(shots)
    if not shots or any(not isinstance(shot, Shot) for shot in shots):
        raise ValueError('A nonempty explicit shot sequence is required')
    first = shots[0]
    seen = set()
    previous = None
    for shot in shots:
        if shot.shot_id in seen:
            raise ValueError('Duplicate shot identity')
        seen.add(shot.shot_id)
        if (shot.game_id, shot.team_id, shot.period, shot.probability.lineage) != (
                first.game_id, first.team_id, first.period, first.probability.lineage):
            raise ValueError('Mixed game, team, period, or probability lineage')
        if previous is not None and (shot.order <= previous.order or previous.goal):
            raise ValueError('Nonmonotone sequence or shot after observed goal')
        previous = shot
    survival = 1.0
    total, compensation = 0.0, 0.0
    contributions, cumulative = [], []
    for shot in shots:
        contribution = survival * shot.probability.value
        contributions.append(contribution)
        survival *= 1 - shot.probability.value
        # Compensated accumulation retains tiny positive probabilities that
        # 1-survival would cancel to zero. Cap only floating-point overshoot;
        # input probabilities and individual contributions are never clipped.
        corrected = contribution - compensation
        updated = total + corrected
        compensation = (updated - total) - corrected
        total = updated
        cumulative.append(min(1.0, total))
    return FlurryValue(tuple(s.shot_id for s in shots), tuple(contributions),
                       tuple(cumulative), survival, first.probability.lineage,
                       verification_receipt)


@dataclass(frozen=True)
class ReboundValue:
    base: Probability
    conditional_rebound: Probability
    conditional_next_goal: Probability
    rebound_probability: float
    expected_future_goals: float
    semantics: str = 'one-hop-expected-rebound-value-not-recursive-possession-value'


def rebound_creation(base: Probability, conditional_rebound: Probability,
                     conditional_next_goal: Probability) -> ReboundValue:
    """r=(1-p)*q; one-hop future value=r*E[next-shot goal|rebound].

    Here rebound means a same-team next-shot opportunity after this shot does
    not score. All estimates must describe that same originating shot/context
    via the same source receipt and feature lineage; separate trained model and
    calibrator identifiers are allowed for the distinct conditional targets.
    No actual rebound occurrence is required and no recursive credit is added.
    """
    _condition(base, GOAL)
    _condition(conditional_rebound, REBOUND_GIVEN_NO_GOAL)
    _condition(conditional_next_goal, NEXT_GOAL_GIVEN_REBOUND)
    for estimate in (conditional_rebound, conditional_next_goal):
        if (estimate.lineage.source_receipt, estimate.lineage.features) != (
                base.lineage.source_receipt, base.lineage.features):
            raise ValueError('Rebound estimates must share originating source/context lineage')
    rebound_probability = (1 - base.value) * conditional_rebound.value
    return ReboundValue(base, conditional_rebound, conditional_next_goal,
                        rebound_probability, rebound_probability * conditional_next_goal.value)


@dataclass(frozen=True)
class CreationCredit:
    direct_credit: float
    expected_rebound_credit: float
    total_credit: float
    is_rebound: bool
    classification_receipt: str
    rebound_value: ReboundValue
    semantics: str = 'creation-allocation-not-flurry-or-team-goal-probability'


def creation_credit(base: Probability, conditional_rebound: Probability,
                    conditional_next_goal: Probability, *, is_rebound: bool,
                    classification_receipt: str) -> CreationCredit:
    """Non-rebound direct xG plus expected rebound value, per originating shot.

    A rebound shot gets NO direct credit here; it can create a further rebound.
    Do not add its direct xG back, or add this allocation to flurry accounting.
    Rebound classification is an explicit upstream source attestation.
    """
    if type(is_rebound) is not bool:
        raise ValueError('Rebound classification must be explicitly known')
    _text(classification_receipt, 'classification_receipt')
    rebound = rebound_creation(base, conditional_rebound, conditional_next_goal)
    direct = 0.0 if is_rebound else base.value
    return CreationCredit(direct, rebound.expected_future_goals,
                          direct + rebound.expected_future_goals, is_rebound,
                          classification_receipt, rebound)
