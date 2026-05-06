// CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
// CATEGORY: UTILITY
// Purpose: Inventory tables touched by data-pipeline scripts (analysis tool)
// Invoked: manual run; useful for onboarding
// Reads:   (static analysis of data-pipeline/)
// Writes:  stdout
// ────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./env";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

type TableCheck = {
  table: string;
  expectedColumns: string[];
};

const CHECKS: TableCheck[] = [
  {
    table: "raw_nhl_data",
    expectedColumns: ["game_id", "game_date", "raw_json", "processed", "stats_extracted"],
  },
  {
    table: "player_directory",
    expectedColumns: ["season", "player_id", "full_name", "team_abbrev", "position_code", "is_goalie"],
  },
  {
    table: "player_game_stats",
    expectedColumns: ["season", "game_id", "game_date", "player_id", "goals", "shots_on_goal", "pim", "ppp", "shp", "plus_minus"],
  },
  {
    table: "player_season_stats",
    expectedColumns: ["season", "player_id", "games_played", "goals", "shots_on_goal", "pim", "ppp", "shp", "plus_minus"],
  },
  {
    table: "player_season_plus_minus",
    expectedColumns: ["season", "player_id", "plus_minus"],
  },
  {
    table: "player_shifts_official",
    expectedColumns: ["shift_id", "game_id", "player_id", "team_id", "period", "shift_start_time_seconds", "shift_end_time_seconds"],
  },
];

async function tableExistsAndCount(table: string) {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true });
  if (error) return { exists: false, count: null as number | null, error: error.message };
  return { exists: true, count: count ?? null, error: null as string | null };
}

async function columnsExist(table: string, cols: string[]) {
  // Use head:true to avoid transferring data. If a column doesn't exist, PostgREST errors.
  const sel = cols.join(", ");
  const { error } = await supabase.from(table).select(sel, { head: true, count: "exact" }).limit(1);
  if (error) return { ok: false, error: error.message };
  return { ok: true, error: null as string | null };
}

async function main() {
  console.log("Supabase URL:", SUPABASE_URL);
  console.log("Scanning pipeline tables (read-only)...");
  console.log("------------------------------------------------------------");

  for (const c of CHECKS) {
    const base = await tableExistsAndCount(c.table);
    if (!base.exists) {
      console.log(`❌ ${c.table}: MISSING/INACCESSIBLE (${base.error})`);
      continue;
    }
    console.log(`✅ ${c.table}: exists, row_count=${base.count ?? "?"}`);

    const colCheck = await columnsExist(c.table, c.expectedColumns);
    if (!colCheck.ok) {
      console.log(`   ⚠️ columns mismatch: ${colCheck.error}`);
    } else {
      console.log(`   ✅ columns ok: ${c.expectedColumns.join(", ")}`);
    }
  }

  console.log("------------------------------------------------------------");
  console.log("Done.");
}

main().catch((e) => {
  console.error("Scan failed:", e);
  process.exit(1);
});









