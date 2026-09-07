/** Development-only points-league FPAR. No serving export, I/O or forecast generation. */
import { ScoringCalculator, type ScoringSettings } from './scoring';

type Position = 'C' | 'LW' | 'RW' | 'D' | 'G';
type Scope = { leagueId: string; teamId: string; season: number; horizon: { start: string; end: string }; asOf: string };
type Slot = { slotId: string; eligiblePositions: Position[] };
type Player = {
  playerId: number; scope: Scope; kind: 'skater' | 'goalie'; eligiblePositions: Position[];
  availability: 'owned' | 'available' | 'unavailable'; status: 'active' | 'ir';
  forecast: { status: 'verified'; stats: Record<string, number>; units: Record<string, string> };
};
export interface FparFoundationInput {
  contract: 'citrus-fpar-foundation-v1'; scoringMode: 'points'; scope: Scope;
  scoring: ScoringSettings; expectedPlayerIds: number[]; players: Player[]; slots: Slot[];
  rosterPlayerIds: number[]; lineup: { slotId: string; playerId: number }[];
  move: { dropPlayerId: number; addPlayerId: number } | null;
  evidence: { kind: 'real' | 'synthetic'; status: 'verified'; foundationSha256: string;
    forecastManifestSha256: string; leagueSnapshotSha256: string; eligibilityManifestSha256: string };
}
export interface FparVerificationBinding {
  inputSha256: string; scopeSha256: string; scoringSha256: string;
  forecastSha256: string; eligibilitySha256: string; rosterSha256: string;
  evidence: FparFoundationInput['evidence'];
}
export interface FparVerifierReceipt { status: 'verified'; binding: FparVerificationBinding }
export type FparEvidenceVerifier = (binding: Readonly<FparVerificationBinding>) => Promise<FparVerifierReceipt>;

export const FPAR_LIMITS = { players: 1000, slots: 32, rosterPlayers: 64 } as const;
const SKATER = ['goals', 'assists', 'power_play_points', 'short_handed_points', 'shots_on_goal', 'blocks', 'hits', 'penalty_minutes', 'plus_minus'];
const GOALIE = ['wins', 'shutouts', 'saves', 'goals_against'];
const POSITIONS: Position[] = ['C', 'LW', 'RW', 'D', 'G'];

function ensure(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(`FPAR unavailable: ${reason}`);
}
function object(value: unknown): Record<string, unknown> {
  ensure(value !== null && typeof value === 'object' && !Array.isArray(value), 'object required');
  return value as Record<string, unknown>;
}
function exact(value: unknown, names: readonly string[]) {
  const obj = object(value);
  ensure(Object.keys(obj).length === names.length && names.every(k => Object.prototype.hasOwnProperty.call(obj, k)), 'exact fields required');
}
function finite(value: unknown): number { ensure(typeof value === 'number' && Number.isFinite(value), 'finite number required'); return value; }
function id(value: unknown): number { const n = finite(value); ensure(Number.isSafeInteger(n) && n > 0, 'positive player ID required'); return n; }
function text(value: unknown) { ensure(typeof value === 'string' && value.trim().length > 0 && value.length <= 128, 'bounded identity required'); }
function positions(value: unknown): asserts value is Position[] {
  ensure(Array.isArray(value) && value.length > 0 && value.length <= 5 && new Set(value).size === value.length
    && value.every(p => POSITIONS.includes(p)), 'explicit unique physical position eligibility required');
}
function day(value: unknown): string {
  ensure(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'ISO date required');
  const time = Date.parse(value + 'T00:00:00Z');
  ensure(Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value, 'valid calendar date required'); return value;
}
function clock(value: unknown): number {
  ensure(typeof value === 'string' && value.length <= 64 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value), 'aware timestamp required');
  day(value.slice(0, 10)); const time = Date.parse(value); ensure(Number.isFinite(time), 'valid timestamp required'); return time;
}
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return JSON.stringify(finite(value));
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const obj = object(value); return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
}
async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value));
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2, '0')).join('');
}
function unit(name: string) {
  return name === 'penalty_minutes' ? 'expected_penalty_minutes_over_horizon'
    : name === 'plus_minus' ? 'expected_goal_differential_over_horizon' : 'expected_count_over_horizon';
}
type Scored = Player & { points: number };
type Assignment = { slotId: string; playerId: number; points: number };
const eligible = (slot: Slot, player: Player) => player.status === 'active' && slot.eligiblePositions.some(p => player.eligiblePositions.includes(p));

/** Rectangular Hungarian assignment: unique candidates, exact slot capacity, no greedy reuse. */
function allocate(slots: Slot[], input: Scored[]): { assignment: Assignment[]; total: number } {
  const candidates = [...input].sort((a, b) => a.playerId - b.playerId), n = slots.length, m = candidates.length;
  ensure(m >= n, 'insufficient jointly feasible candidates');
  const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0), p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0; const min = new Array(m + 1).fill(Infinity), used = new Array(m + 1).fill(false);
    do {
      used[j0] = true; const i0 = p[j0]; let delta = Infinity, j1 = 0;
      for (let j = 1; j <= m; j++) if (!used[j]) {
        const cost = eligible(slots[i0 - 1], candidates[j - 1]) ? -candidates[j - 1].points - u[i0] - v[j] : Infinity;
        if (cost < min[j]) { min[j] = cost; way[j] = j0; }
        if (min[j] < delta) { delta = min[j]; j1 = j; }
      }
      ensure(Number.isFinite(delta), 'infeasible position/availability allocation');
      for (let j = 0; j <= m; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else min[j] -= delta; }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0 !== 0);
  }
  const assignment = new Array<Assignment>(n);
  for (let j = 1; j <= m; j++) if (p[j]) assignment[p[j] - 1] = { slotId: slots[p[j] - 1].slotId, playerId: candidates[j - 1].playerId, points: candidates[j - 1].points };
  return { assignment, total: finite(assignment.reduce((sum, a) => sum + a.points, 0)) };
}

export async function calculateFparFoundation(input: FparFoundationInput, options: { now: string; verifyEvidence: FparEvidenceVerifier }) {
  // Validate before scoring; ScoringCalculator's permissive zero/default paths must be unreachable.
  exact(input, ['contract', 'scoringMode', 'scope', 'scoring', 'expectedPlayerIds', 'players', 'slots', 'rosterPlayerIds', 'lineup', 'move', 'evidence']);
  ensure(input.contract === 'citrus-fpar-foundation-v1' && input.scoringMode === 'points', 'points-only development contract required');
  ensure(options && typeof options.verifyEvidence === 'function', 'upstream evidence verifier required');
  const verifyEvidence = options.verifyEvidence;
  exact(input.scope, ['leagueId', 'teamId', 'season', 'horizon', 'asOf']); text(input.scope.leagueId); text(input.scope.teamId);
  const season = finite(input.scope.season); ensure(Number.isInteger(season) && season >= 1900 && season <= 9998, 'explicit season required');
  exact(input.scope.horizon, ['start', 'end']); const { start, end } = input.scope.horizon; day(start); day(end);
  ensure(start <= end && [start, end].every(d => [season, season + 1].includes(Number(d.slice(0, 4)))), 'common season horizon required');
  const asOf = clock(input.scope.asOf);
  ensure(asOf <= clock(options.now) && new Date(asOf).toISOString().slice(0, 10) <= start, 'future/stale horizon as-of mismatch');
  exact(input.scoring, ['skater', 'goalie']); exact(input.scoring.skater, SKATER); exact(input.scoring.goalie, GOALIE);
  [...Object.values(input.scoring.skater), ...Object.values(input.scoring.goalie)].forEach(finite);
  exact(input.evidence, ['kind', 'status', 'foundationSha256', 'forecastManifestSha256', 'leagueSnapshotSha256', 'eligibilityManifestSha256']);
  ensure(['real', 'synthetic'].includes(input.evidence.kind) && input.evidence.status === 'verified', 'unavailable foundation provenance');
  for (const key of ['foundationSha256', 'forecastManifestSha256', 'leagueSnapshotSha256', 'eligibilityManifestSha256'] as const) ensure(typeof input.evidence[key] === 'string' && /^[0-9a-f]{64}$/.test(input.evidence[key]), 'explicit receipt SHA256 required');
  ensure(Array.isArray(input.players) && input.players.length > 0 && input.players.length <= FPAR_LIMITS.players, 'bounded complete forecast pool required');
  ensure(Array.isArray(input.expectedPlayerIds) && input.expectedPlayerIds.length === input.players.length, 'complete expected player membership required');
  const expected = new Set(input.expectedPlayerIds.map(id)); ensure(expected.size === input.players.length, 'duplicate expected player');
  const observed = new Set<number>();
  for (const player of input.players) {
    exact(player, ['playerId', 'scope', 'kind', 'eligiblePositions', 'availability', 'status', 'forecast']);
    id(player.playerId); ensure(expected.has(player.playerId) && !observed.has(player.playerId), 'duplicate/unexpected forecast player'); observed.add(player.playerId);
    exact(player.scope, ['leagueId', 'teamId', 'season', 'horizon', 'asOf']);
    exact(player.scope.horizon, ['start', 'end']);
    ensure(player.scope.leagueId === input.scope.leagueId && player.scope.teamId === input.scope.teamId
      && player.scope.season === input.scope.season && player.scope.asOf === input.scope.asOf
      && player.scope.horizon.start === start && player.scope.horizon.end === end, 'league/scoring horizon/as-of mismatch');
    positions(player.eligiblePositions);
    ensure(['skater', 'goalie'].includes(player.kind) && (player.kind === 'goalie' ? player.eligiblePositions.length === 1 && player.eligiblePositions[0] === 'G' : !player.eligiblePositions.includes('G')), 'kind/position mismatch');
    ensure(['owned', 'available', 'unavailable'].includes(player.availability) && ['active', 'ir'].includes(player.status), 'unknown ownership/IR state');
    exact(player.forecast, ['status', 'stats', 'units']); ensure(player.forecast.status === 'verified', 'unavailable physical forecast');
    const names = player.kind === 'goalie' ? GOALIE : SKATER;
    exact(player.forecast.stats, names); exact(player.forecast.units, names);
    for (const name of names) {
      const value = finite(player.forecast.stats[name]); ensure(name === 'plus_minus' || value >= 0, 'negative physical-stat forecast');
      ensure(player.forecast.units[name] === unit(name), 'missing/mismatched physical forecast units');
    }
    if (player.kind === 'skater') {
      const s = player.forecast.stats;
      ensure(s.goals <= s.shots_on_goal, 'goals exceed on-goal forecast population');
      ensure(s.power_play_points + s.short_handed_points <= s.goals + s.assists, 'inconsistent physical-stat forecast totals');
    }
  }
  ensure(Array.isArray(input.slots) && input.slots.length > 0 && input.slots.length <= FPAR_LIMITS.slots, 'bounded explicit scoring slots required');
  const slotIds = new Set<string>();
  for (const slot of input.slots) { exact(slot, ['slotId', 'eligiblePositions']); text(slot.slotId); positions(slot.eligiblePositions); ensure(!slotIds.has(slot.slotId), 'duplicate slot'); slotIds.add(slot.slotId); }
  ensure(Array.isArray(input.rosterPlayerIds) && input.rosterPlayerIds.length <= FPAR_LIMITS.rosterPlayers, 'bounded explicit owned roster required');
  const roster = new Set(input.rosterPlayerIds.map(id));
  ensure(roster.size === input.rosterPlayerIds.length && input.players.every(p => roster.has(p.playerId) === (p.availability === 'owned')) && [...roster].every(p => observed.has(p)), 'duplicate or ownership-mismatched roster');
  ensure(Array.isArray(input.lineup) && input.lineup.length === input.slots.length, 'complete supplied lineup required');
  const assignedPlayers = new Set<number>(), assignedSlots = new Set<string>();
  for (const entry of input.lineup) {
    exact(entry, ['slotId', 'playerId']); const slot = input.slots.find(s => s.slotId === entry.slotId), player = input.players.find(p => p.playerId === entry.playerId);
    ensure(slot && player && roster.has(player.playerId) && eligible(slot, player) && !assignedSlots.has(entry.slotId) && !assignedPlayers.has(entry.playerId), 'duplicate/infeasible supplied lineup');
    assignedSlots.add(entry.slotId); assignedPlayers.add(entry.playerId);
  }
  if (input.move !== null) {
    exact(input.move, ['dropPlayerId', 'addPlayerId']); id(input.move.dropPlayerId); id(input.move.addPlayerId);
    ensure(roster.has(input.move.dropPlayerId) && input.players.some(p => p.playerId === input.move.addPlayerId && p.availability === 'available' && p.status === 'active'), 'ineligible explicit roster move');
  }
  // Copy all validated inputs before awaiting an external verifier.
  const frozen = JSON.parse(canonical(input)) as FparFoundationInput;
  const binding: FparVerificationBinding = {
    inputSha256: await digest(frozen), scopeSha256: await digest(frozen.scope), scoringSha256: await digest(frozen.scoring),
    forecastSha256: await digest(frozen.players.map(p => ({ playerId: p.playerId, scope: p.scope, forecast: p.forecast }))),
    eligibilitySha256: await digest(frozen.players.map(p => ({ playerId: p.playerId, kind: p.kind, positions: p.eligiblePositions, availability: p.availability, status: p.status }))),
    rosterSha256: await digest({ slots: frozen.slots, roster: frozen.rosterPlayerIds, lineup: frozen.lineup }), evidence: frozen.evidence,
  };
  const receipt = await verifyEvidence(JSON.parse(canonical(binding)));
  exact(receipt, ['status', 'binding']); ensure(receipt.status === 'verified' && canonical(receipt.binding) === canonical(binding), 'missing or detached exact upstream verification');
  const scorer = new ScoringCalculator(frozen.scoring);
  const scored: Scored[] = frozen.players.map(player => ({ ...player, points: finite(scorer.calculatePoints(player.forecast.stats, player.kind === 'goalie')) }));
  const slots = [...frozen.slots].sort((a, b) => a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0);
  const baseline = allocate(slots, scored.filter(p => p.availability === 'available' && p.status === 'active'));
  const byId = new Map(scored.map(p => [p.playerId, p]));
  const playerFpar = slots.map((slot, index) => {
    const playerId = frozen.lineup.find(l => l.slotId === slot.slotId)!.playerId;
    return { slotId: slot.slotId, playerId, projectedPoints: byId.get(playerId)!.points, replacementPlayerId: baseline.assignment[index].playerId,
      replacementPoints: baseline.assignment[index].points, fpar: finite(byId.get(playerId)!.points - baseline.assignment[index].points) };
  });
  const owned = scored.filter(p => p.availability === 'owned' && p.status === 'active');
  const before = allocate(slots, owned);
  const after = frozen.move === null ? null : allocate(slots, [...owned.filter(p => p.playerId !== frozen.move!.dropPlayerId), byId.get(frozen.move.addPlayerId)!]);
  const result = { contract: 'citrus-fpar-foundation-result-v1', status: 'computed_development_only', publishable: false,
    evidenceKind: frozen.evidence.kind, scope: frozen.scope, verification: 'caller_attested_exact_binding_not_independent_authentication', binding,
    replacementAllocation: baseline, playerFpar, additiveLineupFpar: finite(playerFpar.reduce((sum, row) => sum + row.fpar, 0)),
    replacementPolicy: 'maximum_total_points_unique_available_player_per_supplied_slot_v1',
    attributionPolicy: 'fixed_deterministic_slot_matching_not_intrinsic_player_scalar',
    additiveScope: 'fixed supplied lineup minus one jointly feasible available-player replacement lineup',
    rosterMove: after === null ? null : { move: frozen.move, before, after, opportunityValue: finite(after.total - before.total), additive: false },
    excludedPlayers: scored.filter(p => p.status !== 'active' || p.availability === 'unavailable').map(p => ({ playerId: p.playerId, status: p.status, availability: p.availability })),
    limits: FPAR_LIMITS,
  };
  return { ...result, receiptSha256: await digest(result) };
}
