/**
 * ONE SET OF WEIGHTS, TWO HOMES (2026-09-05).
 *
 * league_scoring_rules is the scorer's source of truth (the SQL scorer reads
 * it through get_effective_scoring_rules). leagues.scoring_settings is the
 * JSONB every TypeScript reader still opens: ScoresService, TeamAnalytics,
 * the client's ScoringCalculator, the settings screens. A trigger syncs the
 * JSONB INTO the rules on write, but nothing ran the other way, so a
 * commissioner's edit through PUT /scoring-rules changed the matchup scorer
 * and left every other surface on the old numbers.
 *
 * This is the other way: fold the effective rules back into the JSONB under
 * the catalog's `applies_to` group (`skater` / `goalie`), keeping anything
 * else the document holds. Writing the result fires the trigger, which
 * upserts the same multipliers it just read: idempotent by construction.
 */
export interface CatalogGroup {
  stat_key: string;
  applies_to: string;
}

export interface EffectiveRule {
  stat_key: string;
  multiplier: number | string;
}

export type ScoringSettingsDoc = Record<string, unknown>;

export function mirrorRulesIntoSettings(
  existing: unknown,
  catalog: readonly CatalogGroup[],
  effective: readonly EffectiveRule[],
): ScoringSettingsDoc {
  const base: ScoringSettingsDoc =
    existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...(existing as ScoringSettingsDoc) } : {};
  const groupOf = new Map(catalog.map((c) => [c.stat_key, c.applies_to]));
  for (const rule of effective) {
    const group = groupOf.get(rule.stat_key);
    if (!group) continue;
    const m = Number(rule.multiplier);
    if (!Number.isFinite(m)) continue;
    const current = base[group];
    const next: Record<string, unknown> =
      current && typeof current === 'object' && !Array.isArray(current) ? { ...(current as Record<string, unknown>) } : {};
    next[rule.stat_key] = m;
    base[group] = next;
  }
  return base;
}

/** True when the mirror would change the stored document (so a no-op write, and its trigger, can be skipped). */
export function settingsDiffer(a: unknown, b: unknown): boolean {
  return stable(a) !== stable(b);
}

function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(',')}}`;
}
