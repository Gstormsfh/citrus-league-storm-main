"""Pure, explicit units and identity contract for a local draft-kit export.

This module does not train, fetch, persist, or claim to role-condition forecasts.
Workbook stored counts and the legacy override ``rates_per_game`` object contain
season counts. Their baseline exposure must be supplied; destination exposure is
applied exactly once. Roster probability remains metadata, not a GP multiplier.
"""
from dataclasses import dataclass
from math import isfinite
from typing import Iterable, Mapping, Optional


class ContractError(ValueError):
    """An input is ambiguous or would silently change projection meaning."""


def _number(value, label):
    if isinstance(value, bool):
        raise ContractError(f"{label} must be a finite number")
    try:
        value = float(value)
    except (ValueError, TypeError) as exc:
        raise ContractError(f"{label} must be a finite number") from exc
    if not isfinite(value):
        raise ContractError(f"{label} must be a finite number")
    return value


@dataclass(frozen=True)
class RoleContext:
    even_strength_line: Optional[str] = None
    power_play_unit: Optional[str] = None
    goalie_role: Optional[str] = None
    source: Optional[str] = None
    conditioned: bool = False
    not_conditioned_reason: Optional[str] = None

    def __post_init__(self):
        if self.conditioned:
            if not self.source or not any((self.even_strength_line,
                                           self.power_play_unit, self.goalie_role)):
                raise ContractError("Conditioned role requires explicit role and source")
        elif not self.not_conditioned_reason:
            raise ContractError("Unconditioned role requires a reason")


@dataclass(frozen=True)
class Projection:
    player_id: str
    team: str
    provenance: str
    rates_per_game: Mapping[str, float]
    baseline_gp: float
    gp_used: float
    roster_probability: float
    role_context: RoleContext
    source: str
    override_reason: Optional[str] = None


def skater_from_workbook(*, player_id, team, season_counts, baseline_gp,
                         gp_used, provenance, role_context, source,
                         roster_probability=1.0, override_reason=None,
                         scheduled_games=84, model_gp_ceiling=83):
    """Normalize season counts to rates without changing intentional GP choices.

    Probability uses [0, 1], so callers must explicitly convert workbook percent
    units. The 2026-27 MODEL ceiling is deliberately 83, not 84. A zero baseline
    is unidentifiable even when every count is zero and is therefore rejected.
    Signed counts are allowed (e.g. plus/minus); exposures cannot be negative.
    """
    baseline = _number(baseline_gp, "baseline_gp")
    used = _number(gp_used, "gp_used")
    schedule = _number(scheduled_games, "scheduled_games")
    ceiling = _number(model_gp_ceiling, "model_gp_ceiling")
    probability = _number(roster_probability, "roster_probability")
    if baseline <= 0:
        raise ContractError("Positive baseline_gp required to infer rates")
    if schedule <= 0 or not 0 <= used <= schedule:
        raise ContractError("gp_used must lie within the team schedule")
    if not 0 <= ceiling <= schedule:
        raise ContractError("MODEL ceiling must lie within the team schedule")
    if provenance not in {"MODEL", "MANUAL", "DEFAULT"}:
        raise ContractError("Unknown provenance")
    if provenance == "MODEL" and used > ceiling:
        raise ContractError(f"MODEL gp_used exceeds intentional {ceiling:g} ceiling")
    if not 0 <= probability <= 1:
        raise ContractError("roster_probability must use [0, 1] units")
    if not isinstance(role_context, RoleContext):
        raise ContractError("Explicit RoleContext required")
    if not player_id or not team or not source:
        raise ContractError("Exact player_id, team and source are required")
    if provenance in {"MANUAL", "DEFAULT"} and not override_reason:
        raise ContractError("MANUAL/DEFAULT projections require an explanatory reason")
    if not season_counts:
        raise ContractError("At least one supported season count is required")
    rates = {stat: _number(value, stat) / baseline
             for stat, value in season_counts.items()}
    return Projection(str(player_id), team, provenance, rates, baseline, used,
                      probability, role_context, source, override_reason)


def skater_from_override(*, rates_per_game, baseline_gp=None, **kwargs):
    """Import the legacy JSON field as COUNTS, requiring its explicit GP basis.

    No key-name guessing or implicit schedule denominator is permitted. This is
    the legacy season-count adapter; actual rates should not pass through it.
    """
    if baseline_gp is None:
        raise ContractError("Legacy rates_per_game contains counts; baseline_gp required")
    return skater_from_workbook(season_counts=rates_per_game,
                               baseline_gp=baseline_gp, **kwargs)


def project_counts(projection):
    """Final volume multiplication. Probability is intentionally not applied."""
    return {stat: rate * projection.gp_used
            for stat, rate in projection.rates_per_game.items()}


def exact_identity_index(players: Iterable[Mapping]):
    """Build exact ID/name maps; reject duplicates/ambiguous names, no fuzzy join.

    IDs are canonical nonempty strings. Names retain punctuation and case. Any
    aliases must be supplied by an independently verified identity mapping.
    """
    by_id, by_name = {}, {}
    for player in players:
        pid, name = player.get("player_id"), player.get("name")
        if not isinstance(pid, str) or not pid or not isinstance(name, str) or not name:
            raise ContractError("Canonical nonempty string player_id and name required")
        if pid in by_id:
            raise ContractError(f"Duplicate player_id: {pid}")
        if name in by_name:
            raise ContractError(f"Duplicate or ambiguous exact name: {name}")
        by_id[pid], by_name[name] = dict(player), pid
    return by_id, by_name


def resolve_identity(index, *, player_id=None, name=None):
    by_id, by_name = index
    if player_id is not None:
        if player_id not in by_id:
            raise ContractError(f"Unknown exact player_id: {player_id}")
        if name is not None and by_id[player_id]["name"] != name:
            raise ContractError("Player ID/name mismatch")
        return player_id
    if name not in by_name:
        raise ContractError(f"Unknown exact name: {name}")
    return by_name[name]


def audit_crease(depth_rows, projected_player_ids, scheduled_games, tolerance=1e-8):
    """Audit explicit crease allocations against schedules and projection coverage.

    Rows require team/player_id/starts. Return every issue instead of filling
    missing players with invented performance. Conservation uses starts, not GP.
    Projected IDs declare rows with forecasts, not merely an identity catalog.
    """
    projected = list(projected_player_ids)
    if len(projected) != len(set(projected)):
        raise ContractError("Duplicate projected goalie IDs")
    projected = set(projected)
    totals = {team: 0.0 for team in scheduled_games}
    schedules = {team: _number(games, f"{team} schedule")
                 for team, games in scheduled_games.items()}
    if any(games <= 0 for games in schedules.values()):
        raise ContractError("Team schedules must be positive")
    seen, missing, issues = set(), [], []
    for row in depth_rows:
        team, pid = row["team"], row["player_id"]
        starts = _number(row["starts"], "starts")
        if not pid or not team or starts < 0:
            raise ContractError("Crease rows need identities and nonnegative starts")
        if pid in seen:
            raise ContractError(f"Duplicate crease player_id: {pid}")
        seen.add(pid)
        if team not in totals:
            raise ContractError(f"Missing schedule for team: {team}")
        totals[team] += starts
        if pid not in projected:
            missing.append(dict(row))
    for team, total in totals.items():
        if abs(total - schedules[team]) > tolerance:
            issues.append({"code": "STARTS_NOT_CONSERVED", "team": team,
                           "starts": total, "scheduled_games": schedules[team]})
    if missing:
        issues.append({"code": "MISSING_GOALIE_PROJECTIONS", "count": len(missing),
                       "starts": sum(float(row["starts"]) for row in missing)})
    return {"ok": not issues, "team_starts": totals, "issues": issues,
            "missing_projected_rows": missing,
            "missing_projected_starts": sum(float(row["starts"]) for row in missing)}
