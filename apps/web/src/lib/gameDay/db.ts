/**
 * A typed view of the Game Day tables.
 *
 * WHY THIS FILE EXISTS, AND WHEN TO DELETE IT.
 * `apps/web/src/integrations/supabase/types.ts` is generated from the live
 * database, so it cannot know about tables whose migration has not been
 * applied yet. Until `20260906120000_game_day_suite_foundation.sql` is on the
 * database and the types are regenerated, `supabase.from('game_day_themes')`
 * is a type error and `.rpc('game_day_submit_daily_player')` is `never`.
 *
 * The alternative was an `any` cast at each call site, which the standards
 * forbid in new code and which would also hide a genuine mistake — a typo in
 * a column name would compile happily. So the schema is declared here once,
 * by hand, exactly as the migration writes it, and every Game Day query goes
 * through `gameDayDb()` and is fully checked against it.
 *
 * TO REMOVE: after the migration is applied, regenerate
 * `integrations/supabase/types.ts`, then delete this module and import
 * `supabase` directly. `apps/web/src/lib/gameDay/__tests__/db.test.ts` pins
 * this declaration against the migration's own SQL, so the two cannot drift
 * while it lives.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type GameDayThemeRow = {
  key: string;
  label: string;
  is_default: boolean;
  requires_feature_flag: boolean;
  palette: Record<string, string>;
  brand: Record<string, string | null>;
  copy: Record<string, Record<string, string>>;
  prize_rules: Record<string, Json>;
  created_at: string;
  updated_at: string;
};

export type GameDayPlayRow = {
  user_id: string;
  game: string;
  puzzle_date: string;
  puzzle_id: string;
  outcome: 'won' | 'lost';
  attempts: number;
  points: number;
  detail: Json;
  completed_at: string;
};

export type GameDayPointsRow = {
  id: string;
  user_id: string;
  game: string;
  puzzle_date: string | null;
  reason: string;
  points: number;
  created_at: string;
};

/** The row shape `game_day_submit_daily_player` returns. */
export type GameDaySubmitResult = {
  outcome: 'won' | 'lost';
  attempts: number;
  points: number;
  total_points: number;
};

/**
 * Only the tables and functions the suite touches. Nothing here is writable
 * from the client by policy — `game_day_themes`, `game_day_plays` and
 * `game_day_points_ledger` all have SELECT policies and no write policies at
 * all — so every Insert and Update shape is `Record<string, never>`. Any
 * property in a write payload is then a type error, which turns "RLS will
 * reject this at runtime" into "this does not compile". It has to be a
 * Record rather than a bare `never`: postgrest-js constrains each table to
 * `{ Row; Insert; Update; Relationships }` of `Record<string, unknown>`, and
 * a `never` there fails the constraint, silently collapsing the whole schema
 * to `never` and taking `.from()` and `.rpc()` down with it.
 */
export type GameDayDatabase = {
  public: {
    Tables: {
      game_day_themes: {
        Row: GameDayThemeRow;
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      game_day_plays: {
        Row: GameDayPlayRow;
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      game_day_points_ledger: {
        Row: GameDayPointsRow;
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      game_day_submit_daily_player: {
        Args: { p_puzzle_date: string; p_guesses: number[] };
        Returns: GameDaySubmitResult[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

/**
 * The one cast in the suite, isolated here so it is reviewable in a single
 * place instead of scattered across three call sites.
 *
 * NOTE FOR THE NEXT EDITOR: every row shape above is a `type`, not an
 * `interface`, and that is load-bearing. postgrest-js constrains a table's
 * Row to `Record<string, unknown>`, and a TypeScript interface is not
 * assignable to that -- interfaces get no implicit index signature. Switch
 * one back to `interface` and the schema quietly fails its constraint,
 * `Schema` resolves to `never`, and every `.from()` and `.rpc()` in the
 * suite becomes an unhelpful "not assignable to parameter of type never".
 */
export function gameDayDb(): SupabaseClient<GameDayDatabase> {
  return supabase as unknown as SupabaseClient<GameDayDatabase>;
}
