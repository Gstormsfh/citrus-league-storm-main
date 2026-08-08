// KI-042 / task #61 (2026-08-08 third-shift T5) — domain-safe player_id
// utilities for the mixed-domain `draft_picks.player_id` column.
//
// PROBLEM (KI-042 canonical statement, REGISTRY.md):
//   `draft_picks.player_id` stores numeric NHL-id strings for real
//   leagues (e.g., "8478000") and uuid strings for demo leagues
//   (e.g., "550e8400-e29b-41d4-a716-446655440000"). Downstream
//   consumers that assume one form silently fail on the other:
//   `Number("<uuid>")` → `NaN` → later RPC calls fail cryptically.
//
// SITES FLAGGED (S6 audit + T9 audit):
//   - server/src/draft/autopickStrategy.ts (autopick candidate pool)
//   - apps/web/src/services/DraftService.ts (draft board renderer)
//   - apps/web/src/services/MatchupService.ts (matchup roster reader)
//   - server/src/services/WaiverService.ts (waiver claim writer)
//   - server/src/routes/waivers.ts (waiver route handler)
//
// THIS MODULE provides three domain-aware helpers so those sites can
// reject demo-domain inputs cleanly (with actionable errors) OR
// coerce numeric-string inputs to number cleanly (with fail-loud on
// unexpected shape).

/**
 * Wire shape of `draft_picks.player_id` — either a numeric NHL-id
 * string (real league) OR a uuid string (demo league).
 */
export type PlayerIdRaw = string | number;

/**
 * Coerced numeric NHL-id. Populated only for real-league domain.
 */
export type NumericPlayerId = number;

/**
 * Result of a domain-classification check.
 */
export type PlayerIdDomain = 'numeric' | 'uuid' | 'invalid';

/**
 * Regex for uuid v4/generic format. Matches xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 * (hex + dashes). Lenient — accepts any v-hex; not v4-strict.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Regex for numeric string — any leading-digit form, no dashes,
 * fits Number() coercion.
 */
const NUMERIC_STRING_RE = /^\d+$/;

/**
 * Classify a raw player_id value's domain.
 *
 * @returns 'numeric' if numeric NHL-id (int or numeric string),
 *          'uuid' if demo-domain uuid string,
 *          'invalid' otherwise.
 */
export function classifyPlayerId(raw: PlayerIdRaw | null | undefined): PlayerIdDomain {
  if (raw === null || raw === undefined) return 'invalid';
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? 'numeric' : 'invalid';
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return 'invalid';
  if (UUID_RE.test(trimmed)) return 'uuid';
  if (NUMERIC_STRING_RE.test(trimmed)) return 'numeric';
  return 'invalid';
}

/**
 * Coerce a raw player_id to a numeric NHL-id, or return null if the
 * input is NOT numeric-domain. Never throws.
 *
 * Use this at reader sites that MUST work on real-league data but
 * can gracefully ignore demo-league rows. Returns null → caller
 * filters the row out silently.
 */
export function coerceToNumericPlayerId(
  raw: PlayerIdRaw | null | undefined,
): NumericPlayerId | null {
  const domain = classifyPlayerId(raw);
  if (domain !== 'numeric') return null;
  return typeof raw === 'number' ? raw : Number(raw);
}

/**
 * Coerce a raw player_id to a numeric NHL-id, or throw with an
 * informative error tying the failure to the caller's context.
 *
 * Use this at reader sites that MUST work on real-league data AND
 * should fail loudly on demo-league rows (e.g., API routes where
 * accepting a demo id is a client bug that deserves a 400).
 *
 * @param raw — the raw player_id value from wire or DB
 * @param context — caller-specific context string for the error
 *   message (e.g., 'submitWaiverClaim.playerId', 'autopick.candidate')
 * @throws Error with `[KI-042] ${context}: ${reason}` shape
 */
export function assertNumericPlayerId(
  raw: PlayerIdRaw | null | undefined,
  context: string,
): NumericPlayerId {
  const domain = classifyPlayerId(raw);
  if (domain === 'numeric') {
    return typeof raw === 'number' ? raw : Number(raw);
  }
  const shape =
    raw === null ? 'null'
    : raw === undefined ? 'undefined'
    : `${typeof raw}("${String(raw).slice(0, 40)}")`;
  throw new Error(
    `[KI-042] ${context}: expected numeric NHL player_id, got ${domain}-domain ${shape}`,
  );
}

/**
 * Batch classifier: partition an array of raw player_ids into
 * numeric-domain (int values) vs demo-domain (uuid strings) vs
 * invalid. Useful for reader sites that process a row-set and
 * want to silently drop the wrong-domain rows while surfacing
 * invalid ones.
 */
export function partitionPlayerIds(
  raws: ReadonlyArray<PlayerIdRaw | null | undefined>,
): {
  numeric: NumericPlayerId[];
  uuid: string[];
  invalid: Array<PlayerIdRaw | null | undefined>;
} {
  const numeric: NumericPlayerId[] = [];
  const uuid: string[] = [];
  const invalid: Array<PlayerIdRaw | null | undefined> = [];
  for (const raw of raws) {
    const domain = classifyPlayerId(raw);
    if (domain === 'numeric') {
      numeric.push(typeof raw === 'number' ? raw : Number(raw));
    } else if (domain === 'uuid') {
      uuid.push(raw as string);
    } else {
      invalid.push(raw);
    }
  }
  return { numeric, uuid, invalid };
}
