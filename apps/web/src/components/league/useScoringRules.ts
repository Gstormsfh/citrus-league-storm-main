/**
 * THE SCORING RULES, AS A HOOK (2026-09-04).
 *
 * The data half of ScoringRulesEditor, lifted out so the Press Box
 * settings screen can draw the same catalog as rows without a second copy
 * of the fetch, the diff, or the save. One path: the catalog comes from
 * `LeagueSettingsService.getScoringRules`, edits are kept as the strings
 * the user typed (so a half-typed `-0.` survives a render), `changed` is
 * the rows whose number differs from the server's, and `save` sends only
 * those — unknown stat keys are rejected server-side rather than stored
 * as a rule that could never score anything.
 *
 * `leagueId` may be null: the hook then fetches nothing and reports an
 * empty catalog, so a screen can mount it before it knows whether the
 * scoring section will ever open.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { LeagueSettingsService, type ScoringCatalogEntry } from '@/services/LeagueSettingsService';
import { logger } from '@/utils/logger';

export interface ScoringRules {
  catalog: ScoringCatalogEntry[];
  skaters: ScoringCatalogEntry[];
  goalies: ScoringCatalogEntry[];
  /** stat_key → the text in its field, only for rows that have been touched. */
  edits: Record<string, string>;
  setEdit: (statKey: string, value: string) => void;
  reset: () => void;
  /** The current text (or the server's figure) for a row. */
  valueOf: (stat: ScoringCatalogEntry) => string;
  changed: Array<{ stat_key: string; multiplier: number }>;
  invalid: boolean;
  loading: boolean;
  saving: boolean;
  /** Resolves true when the changed rows were written. */
  save: () => Promise<boolean>;
}

export function useScoringRules(leagueId: string | null): ScoringRules {
  const { toast } = useToast();
  const [catalog, setCatalog] = useState<ScoringCatalogEntry[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(!!leagueId);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!leagueId) {
      setCatalog([]);
      setEdits({});
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const { stats, error } = await LeagueSettingsService.getScoringRules(leagueId);
      if (cancelled) return;
      if (error) {
        toast({
          title: "Scoring Rules Didn't Load",
          description: "Refresh and we'll pull them again.",
          variant: 'destructive',
        });
      }
      setCatalog(stats);
      setEdits({});
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, toast]);

  const skaters = useMemo(() => catalog.filter((s) => s.applies_to === 'skater'), [catalog]);
  const goalies = useMemo(() => catalog.filter((s) => s.applies_to === 'goalie'), [catalog]);

  const changed = useMemo(() => {
    const out: Array<{ stat_key: string; multiplier: number }> = [];
    for (const stat of catalog) {
      const raw = edits[stat.stat_key];
      if (raw === undefined) continue;
      const next = Number(raw);
      if (!Number.isFinite(next)) continue;
      if (next !== Number(stat.multiplier)) out.push({ stat_key: stat.stat_key, multiplier: next });
    }
    return out;
  }, [catalog, edits]);

  const invalid = useMemo(
    () => Object.values(edits).some((v) => v.trim() !== '' && !Number.isFinite(Number(v))),
    [edits],
  );

  const save = useCallback(async () => {
    if (!leagueId || changed.length === 0 || invalid) return false;
    setSaving(true);
    const { success, error } = await LeagueSettingsService.updateScoringRules(leagueId, changed);
    setSaving(false);

    if (!success) {
      logger.error('Failed to save scoring rules', error);
      toast({
        title: 'Scoring rules not saved',
        description: 'Nothing was changed. Please try again.',
        variant: 'destructive',
      });
      return false;
    }

    setCatalog((prev) =>
      prev.map((s) => {
        const hit = changed.find((c) => c.stat_key === s.stat_key);
        return hit ? { ...s, multiplier: hit.multiplier } : s;
      }),
    );
    setEdits({});
    toast({
      title: 'Scoring updated',
      description:
        changed.length === 1
          ? '1 category saved. New scores apply from the next scoring run.'
          : changed.length + ' categories saved. New scores apply from the next scoring run.',
    });
    return true;
  }, [changed, invalid, leagueId, toast]);

  const setEdit = useCallback((statKey: string, value: string) => {
    setEdits((prev) => ({ ...prev, [statKey]: value }));
  }, []);
  const reset = useCallback(() => setEdits({}), []);
  const valueOf = useCallback(
    (stat: ScoringCatalogEntry) => edits[stat.stat_key] ?? String(stat.multiplier),
    [edits],
  );

  return { catalog, skaters, goalies, edits, setEdit, reset, valueOf, changed, invalid, loading, saving, save };
}
