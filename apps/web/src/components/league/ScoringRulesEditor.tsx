/**
 * ScoringRulesEditor — commissioner control for league scoring weights.
 *
 * Replaces the twelve categories that were hardcoded in plpgsql
 * (calculate_daily_matchup_scores) with the full 35-stat catalog. Twenty-three
 * of those became scoreable on 2026-08-11: every one was already populated in
 * player_game_stats and simply unreachable by the old engine — plus/minus,
 * power-play and short-handed goals/assists split out, game-winning goals,
 * overtime goals, faceoffs, takeaways, giveaways, time on ice, goalie OT losses
 * and saves by strength.
 *
 * Only CHANGED rows are sent. Unknown stat keys are rejected server-side rather
 * than stored as a rule that could never score anything.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  LeagueSettingsService,
  type ScoringCatalogEntry,
} from '@/services/LeagueSettingsService';
import { logger } from '@/utils/logger';

interface ScoringRulesEditorProps {
  leagueId: string;
  /** Commissioners can edit; everyone else sees the same table read-only. */
  canEdit: boolean;
}

export function ScoringRulesEditor({ leagueId, canEdit }: ScoringRulesEditorProps) {
  const { toast } = useToast();
  const [catalog, setCatalog] = useState<ScoringCatalogEntry[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const { stats, error } = await LeagueSettingsService.getScoringRules(leagueId);
      if (cancelled) return;
      if (error) {
        toast({
          title: 'Could not load scoring rules',
          description: 'Please refresh and try again.',
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

  /** Rows whose value differs from what the server returned. */
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

  /** Any edit that is not a finite number — blocks save rather than sending NaN. */
  const invalid = useMemo(
    () => Object.values(edits).some((v) => v.trim() !== '' && !Number.isFinite(Number(v))),
    [edits],
  );

  const handleSave = useCallback(async () => {
    if (changed.length === 0 || invalid) return;
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
      return;
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
  }, [changed, invalid, leagueId, toast]);

  const renderRows = (rows: ScoringCatalogEntry[]) =>
    rows.map((stat) => {
      const value = edits[stat.stat_key] ?? String(stat.multiplier);
      const isOff = Number(value) === 0;
      return (
        <TableRow key={stat.stat_key} className={isOff ? 'opacity-60' : undefined}>
          <TableCell className="font-medium">
            {stat.display_name}
            {!stat.is_core && (
              <Badge variant="secondary" className="ml-2 align-middle text-xs">
                New
              </Badge>
            )}
          </TableCell>
          <TableCell className="text-muted-foreground hidden sm:table-cell">
            <code className="text-xs">{stat.stat_key}</code>
          </TableCell>
          <TableCell className="w-32 text-right">
            <Input
              type="number"
              step="0.1"
              inputMode="decimal"
              aria-label={stat.display_name + ' points'}
              className="text-right"
              disabled={!canEdit || saving}
              value={value}
              onChange={(e) => setEdits((prev) => ({ ...prev, [stat.stat_key]: e.target.value }))}
            />
          </TableCell>
        </TableRow>
      );
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scoring</CardTitle>
        <CardDescription>
          Points awarded per stat. Set a category to <strong>0</strong> to turn it off.
          Categories marked <em>New</em> were previously unavailable: the data was always
          there, the scoring engine just could not reach it.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading scoring rules…</p>
        ) : catalog.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No scoring catalog found for this league.
          </p>
        ) : (
          <>
            <Tabs defaultValue="skater">
              <TabsList className="mb-4">
                <TabsTrigger value="skater">Skaters ({skaters.length})</TabsTrigger>
                <TabsTrigger value="goalie">Goalies ({goalies.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="skater">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="hidden sm:table-cell">Key</TableHead>
                      <TableHead className="text-right">Points</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{renderRows(skaters)}</TableBody>
                </Table>
              </TabsContent>

              <TabsContent value="goalie">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="hidden sm:table-cell">Key</TableHead>
                      <TableHead className="text-right">Points</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{renderRows(goalies)}</TableBody>
                </Table>
              </TabsContent>
            </Tabs>

            {canEdit && (
              <div className="flex items-center justify-between gap-4 pt-4 border-t mt-4">
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  {invalid
                    ? 'One or more values is not a number.'
                    : changed.length === 0
                      ? 'No unsaved changes.'
                      : changed.length === 1
                        ? '1 unsaved change.'
                        : changed.length + ' unsaved changes.'}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => setEdits({})}
                    disabled={changed.length === 0 || saving}
                  >
                    Reset
                  </Button>
                  <Button onClick={handleSave} disabled={changed.length === 0 || invalid || saving}>
                    {saving ? 'Saving…' : 'Save scoring'}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default ScoringRulesEditor;
