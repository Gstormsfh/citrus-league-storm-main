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

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { type ScoringCatalogEntry } from '@/services/LeagueSettingsService';
import { useScoringRules } from './useScoringRules';

interface ScoringRulesEditorProps {
  leagueId: string;
  /** Commissioners can edit; everyone else sees the same table read-only. */
  canEdit: boolean;
}

export function ScoringRulesEditor({ leagueId, canEdit }: ScoringRulesEditorProps) {
  // The fetch, the diff and the save live in useScoringRules (2026-09-04),
  // shared with the Press Box settings screen; this file is the table.
  const { catalog, skaters, goalies, setEdit, reset, valueOf, changed, invalid, loading, saving, save } =
    useScoringRules(leagueId);

  const renderRows = (rows: ScoringCatalogEntry[]) =>
    rows.map((stat) => {
      const value = valueOf(stat);
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
              onChange={(e) => setEdit(stat.stat_key, e.target.value)}
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
            This league hasn't set its scoring yet.
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
                    onClick={reset}
                    disabled={changed.length === 0 || saving}
                  >
                    Reset
                  </Button>
                  <Button onClick={() => void save()} disabled={changed.length === 0 || invalid || saving}>
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
