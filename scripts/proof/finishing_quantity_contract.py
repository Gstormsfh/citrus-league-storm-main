"""Offline quantity contract, not an estimator, source verifier or serving gate.

Never apply a forecast-rate multiplier to a shot probability or flurry credit.
Caller-declared cutoffs/hashes require independent source verification.
"""
from dataclasses import dataclass, replace
from datetime import datetime, timezone
import math
import re


def number(value, *, positive=False):
    if (type(value) not in (int, float) or not math.isfinite(value)
            or value < 0 or (positive and value == 0)):
        raise ValueError('Finite nonnegative number required')
    return value


def utc(value):
    if not isinstance(value, str) or not value.endswith('Z'):
        raise ValueError('Explicit UTC timestamp required')
    parsed = datetime.fromisoformat(value[:-1] + '+00:00')
    if parsed.tzinfo != timezone.utc:
        raise ValueError('UTC timestamp required')
    return parsed


@dataclass(frozen=True)
class Scope:
    player_id: int
    population: str
    neutral_baseline_sha256: str

    def validate(self):
        if type(self.player_id) is not int or not 1000000 <= self.player_id <= 9999999:
            raise ValueError('Canonical player identity required')
        if self.population not in ('regular_season_shots_on_goal', 'playoff_shots_on_goal',
                                   'regular_season_unblocked_attempts', 'playoff_unblocked_attempts'):
            raise ValueError('Explicit aligned goal/shot/xG population required')
        if not isinstance(self.neutral_baseline_sha256, str) or not re.fullmatch('[a-f0-9]{64}', self.neutral_baseline_sha256):
            raise ValueError('Neutral baseline identity required')


def observed_rates(*, scope, goals, shots_on_goal, xg_attempts, neutral_xg):
    """Descriptive actuals only; G/xG is not estimated persistent skill."""
    scope.validate()
    if (any(type(v) is not int for v in (goals, shots_on_goal, xg_attempts))
            or not 0 <= goals <= shots_on_goal <= xg_attempts):
        raise ValueError('Aligned integer goals and SOG required')
    if scope.population.endswith('shots_on_goal') and xg_attempts != shots_on_goal:
        raise ValueError('SOG-only baseline requires identical exposure counts')
    number(neutral_xg)
    if neutral_xg > xg_attempts:
        raise ValueError('Sum of probabilities must match declared xG exposure')
    ratio = goals / neutral_xg if neutral_xg > 0 else None
    return {'shooting_percentage': 100 * goals / shots_on_goal if shots_on_goal else None,
            'goals_over_neutral_xg_ratio': ratio,
            'finishing_above_expected_percentage': 100 * (ratio - 1) if ratio is not None else None,
            'goals_minus_neutral_xg': goals-neutral_xg,
            'estimated_talent': None, 'publishable': False}


@dataclass(frozen=True)
class TalentEstimate:
    scope: Scope
    multiplier: float
    evidence_available_before: str
    artifact_sha256: str
    quantity: str = 'goal_count_rate_multiplier'

    def validate(self, prediction_at):
        self.scope.validate()
        number(self.multiplier, positive=True)
        if self.quantity != 'goal_count_rate_multiplier':
            raise ValueError('Odds effects and observed ratios are not forecast-rate multipliers')
        if utc(self.evidence_available_before) >= utc(prediction_at):
            raise ValueError('Strictly earlier evidence required')
        if not isinstance(self.artifact_sha256, str) or not re.fullmatch('[a-f0-9]{64}', self.artifact_sha256):
            raise ValueError('Frozen talent artifact identity required')


@dataclass(frozen=True)
class GoalForecast:
    scope: Scope
    prediction_at: str
    expected_goals: float
    baseline_evidence_before: str
    quantity: str = 'neutral_goal_count_expectation'
    finishing_artifact_sha256: str | None = None
    publishable: bool = False


def apply_once(forecast, talent):
    """Apply a structurally consistent estimate; this does not validate its skill."""
    forecast.scope.validate()
    number(forecast.expected_goals)
    utc(forecast.prediction_at)
    if utc(forecast.baseline_evidence_before) >= utc(forecast.prediction_at):
        raise ValueError('Baseline evidence must also precede prediction')
    if forecast.publishable is not False:
        raise ValueError('Offline contract cannot authorize publication')
    if forecast.quantity != 'neutral_goal_count_expectation' or forecast.finishing_artifact_sha256 is not None:
        raise ValueError('Finishing must be applied exactly once to neutral count expectation')
    talent.validate(forecast.prediction_at)
    if forecast.scope != talent.scope:
        raise ValueError('Player, population and baseline must agree')
    adjusted = number(forecast.expected_goals * talent.multiplier)
    return replace(forecast, expected_goals=adjusted,
                   quantity='shooter_conditioned_goal_count_expectation',
                   finishing_artifact_sha256=talent.artifact_sha256)
