/**
 * The screenshot path end to end below the reader: assembled seasons through
 * the real writer into the in-memory tables, the read/confirm job lifecycle,
 * and the keeper and traded-pick carry-over onto a Citrus draft.
 */
import { describe, it, expect, vi } from 'vitest';
import { LeagueImportService } from '../../services/import/LeagueImportService';
import { ScreenshotImportService, leagueSlug } from '../../services/import/ScreenshotImportService';
import { DynastyCarryoverService } from '../../services/import/DynastyCarryoverService';
import { ScreenshotReader, ScreenshotReadError } from '../../import/screenshot/reader';
import { assembleSeasons } from '../../import/screenshot/assemble';
import { FakeSupabase } from './fakeSupabase';
import { allPages, awardsPage, championsPage, standings2023, draft2023, keepersPage, pickOwnershipPage, transactions2023 } from './screenshotFixtures';

const LEAGUE = 'league-1';
const USER = 'user-commish';
const ALICE = 'user-alice';
const BOB = 'user-bob';

function freshDb(over: Record<string, any[]> = {}) {
  return new FakeSupabase({
    leagues: [{ id: LEAGUE, name: 'Citrus League', history_locked: false, founded_season: null, imported_from: null, draft_status: 'not_started' }],
    player_directory: [
      { player_id: 8478402, season: 2025, full_name: 'Connor McDavid', team_abbrev: 'EDM', jersey_number: '97', position_code: 'C' },
      { player_id: 8480069, season: 2025, full_name: 'Cale Makar', team_abbrev: 'COL', jersey_number: '8', position_code: 'D' },
      { player_id: 8478427, season: 2025, full_name: 'Sebastian Aho', team_abbrev: 'CAR', jersey_number: '20', position_code: 'C' },
      { player_id: 8480222, season: 2025, full_name: 'Sebastian Aho', team_abbrev: 'NYI', jersey_number: '25', position_code: 'D' },
    ],
    ...over,
  });
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const opts = { platform: 'yahoo' as const, currentSeason: 2025, externalLeagueId: 'screenshots:the-puck-stops-here', leagueName: 'The Puck Stops Here' };

function fakeReader(pages = allPages, fail?: ScreenshotReadError) {
  const reader = new ScreenshotReader('key', vi.fn() as unknown as typeof fetch, 'claude-test');
  vi.spyOn(reader, 'read').mockImplementation(async () => {
    if (fail) throw fail;
    return { extraction: { pages }, raw: { pages }, usage: { inputTokens: 10, outputTokens: 5 }, model: 'claude-test' };
  });
  return reader;
}

describe('screenshot seasons through the writer', () => {
  it('writes standings, finishes, draft, trades with pick assets, keepers and pick ownership, keyed on the printed manager', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    const { seasons } = assembleSeasons(allPages, opts);
    for (const s of seasons) await svc.writeSeason(LEAGUE, 'job-1', s, { importerUserId: USER, importerExternalId: null });

    const memberOf = (key: string) => db.rows('league_member_identities').find((i) => i.external_manager_id === key)!.member_id;
    // One person across two seasons and two team names.
    expect(db.rows('league_member_identities').filter((i) => i.external_manager_id === 'name:alice')).toHaveLength(1);
    expect(db.rows('league_season_teams').filter((t) => t.member_id === memberOf('name:alice')).map((t) => t.team_name).sort()).toEqual(['Dangle Dynasty 🏒', 'Old Dangle']);
    const s2023 = db.rows('league_seasons').find((s) => s.season === 2023)!;
    expect(s2023).toMatchObject({ platform: 'yahoo', champion_member_id: memberOf('name:alice'), runner_up_member_id: memberOf('name:bob'), is_finished: true, is_verified_by_bracket: true, scoring_type: 'h2h_categories' });
    // Draft: the crosswalk placed McDavid, Makar and both Ahos by name and NHL team.
    const picks = db.rows('league_season_drafts').filter((p) => p.season === 2023).sort((a, b) => a.overall_pick - b.overall_pick);
    expect(picks.map((p) => p.nhl_player_id)).toEqual([8478402, 8478427, 8480222, 8480069]);
    expect(picks[0]).toMatchObject({ is_keeper: true, keeper_cost: 'Round 1', external_player_id: 'name:connor mcdavid|EDM', source: 'yahoo' });
    // Trades: a player row and two pick rows.
    const tx = db.rows('league_season_transactions').filter((t) => t.season === 2023 && t.type === 'trade');
    expect(tx).toHaveLength(3);
    expect(tx.find((t) => t.external_player_name === 'Connor McDavid')).toMatchObject({ member_id: memberOf('name:bob'), counterparty_member_id: memberOf('team:deke squad'), pick_round: null, nhl_player_id: 8478402 });
    expect(tx.find((t) => t.pick_round === 1)).toMatchObject({ pick_season: 2024, pick_original_member_id: memberOf('name:bob'), nhl_player_id: null, external_player_name: null });
    // Keepers as the source listed them, resolved.
    const keepers = db.rows('league_season_keepers');
    expect(keepers).toHaveLength(2);
    expect(keepers.find((k) => k.external_player_name === 'Cale Makar')).toMatchObject({ season: 2023, member_id: memberOf('name:alice'), nhl_player_id: 8480069, round: 3, round_next: 2, source: 'yahoo' });
    // Future picks that changed hands.
    const own = db.rows('league_pick_ownership');
    expect(own).toHaveLength(2);
    expect(own.find((o) => o.draft_season === 2024)).toMatchObject({ round: 1, original_member_id: memberOf('name:bob'), owner_member_id: memberOf('team:deke squad'), source: 'yahoo' });
    // Nobody is claimed on the spot: there is no account id on a screenshot.
    expect(db.rows('league_members').every((m) => m.owner_id == null)).toBe(true);
  });

  it('a champions page alone gives the room its seasons, champions, career titles and droughts', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    const { seasons } = assembleSeasons([championsPage], opts);
    for (const s of seasons) await svc.writeSeason(LEAGUE, 'job-1', s, { importerUserId: USER });
    await svc.recomputeTrophies(LEAGUE, 'job-1');
    const alice = db.rows('league_member_identities').find((i) => i.external_manager_id === 'name:alice')!.member_id;
    expect(db.rows('league_seasons').map((s) => s.season).sort()).toEqual([2020, 2021, 2023]);
    expect(db.rows('league_seasons').filter((s) => s.champion_member_id === alice).map((s) => s.season).sort()).toEqual([2020, 2023]);
    const live = db.rows('league_trophies').filter((t) => !t.retired_at);
    expect(live.filter((t) => t.trophy_key === 'champion')).toHaveLength(3);
    expect(live.find((t) => t.trophy_key === 'most_championships')).toMatchObject({ member_id: alice, value: 2 });
    expect(live.some((t) => t.trophy_key === 'founding_member')).toBe(true);
  });

  it('the league\'s own awards land as named trophies, survive a recompute, and are replaced on re-import', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    const { seasons } = assembleSeasons([championsPage, standings2023, awardsPage], opts);
    for (const s of seasons) {
      const r = await svc.writeSeason(LEAGUE, 'job-1', s, { importerUserId: USER });
      if (s.season === 2023) expect(r.awards).toBe(3);
    }
    const bob = db.rows('league_member_identities').find((i) => i.external_manager_id === 'name:bob')!.member_id;
    const awards = () => db.rows('league_trophies').filter((t) => t.trophy_key === 'custom' && !t.retired_at);
    expect(awards().map((t) => [t.display_name, t.season, t.source])).toEqual(expect.arrayContaining([['The Sacko', 2021, 'imported'], ['The Sacko', 2023, 'imported'], ['Golden Stick', 2023, 'imported'], ['Commissioner of the Decade', null, 'imported']]));
    expect(awards().find((t) => t.display_name === 'Golden Stick')).toMatchObject({ member_id: bob, detail: { award: 'Golden Stick', winner_name: 'Bob', note: 'Most goals' } });
    await svc.recomputeTrophies(LEAGUE, 'job-1');
    expect(awards()).toHaveLength(4);
    // A second import of 2023's awards replaces them, once.
    const again = assembleSeasons([standings2023, { ...awardsPage, awards: [{ season: 2023, award: 'The Sacko', winnerTeam: 'Crease Lightning' }] }], opts).seasons[0];
    await svc.writeSeason(LEAGUE, 'job-2', again, { importerUserId: USER });
    const sacko2023 = awards().filter((t) => t.display_name === 'The Sacko' && t.season === 2023);
    expect(sacko2023).toHaveLength(1);
    expect(awards().filter((t) => t.season === 2023)).toHaveLength(1);
    expect(awards().filter((t) => t.season === null)).toHaveLength(1);
  });

  it('re-importing a pick ownership page replaces the unapplied rows for those drafts and keeps applied ones', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    const first = assembleSeasons([standings2023, pickOwnershipPage], opts).seasons[0];
    await svc.writeSeason(LEAGUE, 'job-1', first, { importerUserId: USER });
    const applied = db.rows('league_pick_ownership').find((o) => o.draft_season === 2025)!;
    applied.applied_at = '2026-01-01T00:00:00.000Z';
    const again = assembleSeasons([standings2023, { ...pickOwnershipPage, pickOwnership: [{ draftSeason: 2024, round: 3, originalTeamName: 'Crease Lightning', ownerTeamName: 'Bench Bosses' }, { draftSeason: 2025, round: 1, originalTeamName: 'Crease Lightning', ownerTeamName: 'Dangle Dynasty 🏒' }] }], opts).seasons[0];
    const res = await svc.writeSeason(LEAGUE, 'job-2', again, { importerUserId: USER });
    expect(res.pick_ownership).toBe(2);
    const rows = db.rows('league_pick_ownership');
    expect(rows.map((r) => [r.draft_season, r.round])).toEqual(expect.arrayContaining([[2024, 3], [2025, 1]]));
    expect(rows.find((r) => r.draft_season === 2024 && r.round === 1)).toBeUndefined();
    expect(rows.find((r) => r.draft_season === 2025)!.applied_at).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('ScreenshotImportService', () => {
  it('read: creates a screenshot job, stores the reading (never the images), returns the pages, and parks the job as queued', async () => {
    const db = freshDb();
    const imports = new LeagueImportService(db as any, db as any);
    const svc = new ScreenshotImportService(imports, fakeReader());
    const images = [{ data: Buffer.from('a-real-image').toString('base64'), mediaType: 'image/jpeg' as const }];
    const out = await svc.read({ leagueId: LEAGUE, requestedBy: USER, images, platform: 'yahoo', leagueName: 'The Puck Stops Here', season: null });
    expect(out.pages).toHaveLength(allPages.length);
    expect(out.job).toMatchObject({ status: 'queued', method: 'screenshot', platform: 'yahoo', external_league_id: 'screenshots:the-puck-stops-here', seasons_discovered: [2022, 2023] });
    expect(out.job.progress).toMatchObject({ reading: { images: 1, kinds: { standings: 2, draft: 1 } } });
    const raw = db.rows('import_raw_payloads');
    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({ job_id: out.job.id, platform: 'yahoo', endpoint: 'vision:record_league_pages' });
    expect(JSON.stringify(raw[0].payload)).not.toContain(images[0].data);
    expect(db.rows('league_seasons')).toHaveLength(0);
  });

  it('read: a reader refusal fails the job with the reader\'s words and status', async () => {
    const db = freshDb();
    const imports = new LeagueImportService(db as any, db as any);
    const svc = new ScreenshotImportService(imports, fakeReader(allPages, new ScreenshotReadError('The reader is busy right now. Try again in a minute.', 429)));
    const err = await svc.read({ leagueId: LEAGUE, requestedBy: USER, images: [{ data: 'x', mediaType: 'image/png' }], platform: 'manual' }).catch((e) => e);
    expect(err).toMatchObject({ status: 429, message: 'The reader is busy right now. Try again in a minute.' });
    expect(db.rows('import_jobs')[0]).toMatchObject({ status: 'failed', error: { code: 'READ_FAILED' } });
  });

  it('read: refuses when the reader is not configured, creating no job', async () => {
    const db = freshDb();
    const svc = new ScreenshotImportService(new LeagueImportService(db as any, db as any), new ScreenshotReader(undefined, vi.fn() as unknown as typeof fetch));
    await expect(svc.read({ leagueId: LEAGUE, requestedBy: USER, images: [{ data: 'x', mediaType: 'image/png' }], platform: 'yahoo' })).rejects.toMatchObject({ status: 503 });
    expect(db.rows('import_jobs')).toHaveLength(0);
  });

  it('confirm: writes the reviewed pages in the background, computes trophies, stamps the league, and finishes done', async () => {
    const db = freshDb();
    const imports = new LeagueImportService(db as any, db as any);
    const svc = new ScreenshotImportService(imports, fakeReader());
    const { job } = await svc.read({ leagueId: LEAGUE, requestedBy: USER, images: [{ data: 'x', mediaType: 'image/png' }], platform: 'yahoo', leagueName: 'The Puck Stops Here' });
    // The commissioner fixed a name on the review screen.
    const pages = allPages.map((p) => (p.kind === 'standings' && p.season === 2023 ? { ...p, standings: p.standings!.map((r) => (r.teamName === 'Deke Squad' ? { ...r, managerName: 'Dee' } : r)) } : p));
    const started = await svc.confirm({ leagueId: LEAGUE, jobId: job.id, requestedBy: USER, pages, platform: 'yahoo', leagueName: 'The Puck Stops Here', currentSeason: 2025 });
    expect(started.status).toBe('importing');
    for (let i = 0; i < 40 && (await imports.getJob(job.id))!.status !== 'done'; i++) await settle();
    const done = (await imports.getJob(job.id))!;
    expect(done).toMatchObject({ status: 'done', seasons_imported: [2022, 2023] });
    expect((done.progress as { seasons: Array<{ season: number }> }).seasons.map((s) => s.season)).toEqual([2022, 2023]);
    expect(db.rows('league_member_identities').some((i) => i.external_manager_id === 'name:dee')).toBe(true);
    expect(db.rows('league_trophies').length).toBeGreaterThan(0);
    expect(db.rows('leagues')[0]).toMatchObject({ imported_from: 'yahoo', founded_season: 2022 });
  });

  it('confirm: refuses a page with no season, a job from another league, a job already imported, and an empty reading', async () => {
    const db = freshDb();
    const imports = new LeagueImportService(db as any, db as any);
    const svc = new ScreenshotImportService(imports, fakeReader());
    const { job } = await svc.read({ leagueId: LEAGUE, requestedBy: USER, images: [{ data: 'x', mediaType: 'image/png' }], platform: 'yahoo' });
    await expect(svc.confirm({ leagueId: LEAGUE, jobId: job.id, requestedBy: USER, pages: [{ ...draft2023, season: null }], platform: 'yahoo', currentSeason: 2025 })).rejects.toMatchObject({ status: 400, message: /Image 3: No season on the page/ });
    await expect(svc.confirm({ leagueId: 'league-2', jobId: job.id, requestedBy: USER, pages: [standings2023], platform: 'yahoo', currentSeason: 2025 })).rejects.toMatchObject({ status: 404 });
    await expect(svc.confirm({ leagueId: LEAGUE, jobId: job.id, requestedBy: USER, pages: [{ ...standings2023, kind: 'other' }], platform: 'yahoo', currentSeason: 2025 })).rejects.toMatchObject({ status: 400, message: /Nothing to import/ });
    await imports.updateJob(job.id, { status: 'done' });
    await expect(svc.confirm({ leagueId: LEAGUE, jobId: job.id, requestedBy: USER, pages: [standings2023], platform: 'yahoo', currentSeason: 2025 })).rejects.toMatchObject({ status: 409, message: /already been imported/ });
  });

  it('confirm: a write failure marks the job failed with the reason and keeps what landed', async () => {
    const db = freshDb();
    const imports = new LeagueImportService(db as any, db as any);
    const svc = new ScreenshotImportService(imports, fakeReader());
    const { job } = await svc.read({ leagueId: LEAGUE, requestedBy: USER, images: [{ data: 'x', mediaType: 'image/png' }], platform: 'yahoo' });
    db.failNext = { table: 'league_season_drafts', op: 'upsert', error: { message: 'disk full' } };
    await svc.confirm({ leagueId: LEAGUE, jobId: job.id, requestedBy: USER, pages: allPages, platform: 'yahoo', currentSeason: 2025 });
    for (let i = 0; i < 40 && !['done', 'failed'].includes((await imports.getJob(job.id))!.status); i++) await settle();
    const failed = (await imports.getJob(job.id))!;
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatchObject({ code: 'IMPORT_FAILED', message: /league_season_drafts upsert failed: disk full/ });
    expect(failed.seasons_imported).toEqual([2022]);
  });

  it('leagueSlug is stable, short and safe', () => {
    expect(leagueSlug('The Puck Stops Here!')).toBe('screenshots:the-puck-stops-here');
    expect(leagueSlug(null)).toBe('screenshots');
    expect(leagueSlug('x'.repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe('DynastyCarryoverService', () => {
  /** After an import and two claims: Alice and Bob own Citrus teams; Cy and Deke Squad have not claimed. */
  async function importedLeague() {
    const db = freshDb({
      teams: [{ id: 't-alice', league_id: LEAGUE, team_name: 'Alice FC', owner_id: ALICE }, { id: 't-bob', league_id: LEAGUE, team_name: 'Bob FC', owner_id: BOB }],
      draft_order: [
        { id: 'o1', league_id: LEAGUE, round_number: 1, team_order: ['t-alice', 't-bob'] },
        { id: 'o2', league_id: LEAGUE, round_number: 2, team_order: ['t-bob', 't-alice'] },
      ],
    });
    const svc = new LeagueImportService(db as any, db as any);
    const season = assembleSeasons([standings2023, keepersPage, { ...pickOwnershipPage, pickOwnership: [
      { draftSeason: 2026, round: 1, originalTeamName: 'Bench Bosses', ownerTeamName: 'Dangle Dynasty 🏒' },
      { draftSeason: 2026, round: 2, originalTeamName: 'Crease Lightning', ownerTeamName: 'Bench Bosses' },
      { draftSeason: 2027, round: 1, originalTeamName: 'Dangle Dynasty 🏒', ownerTeamName: 'Bench Bosses' },
    ] }], opts).seasons[0];
    await svc.writeSeason(LEAGUE, 'job-1', season, { importerUserId: USER });
    const alice = db.rows('league_member_identities').find((i) => i.external_manager_id === 'name:alice')!.member_id;
    const bob = db.rows('league_member_identities').find((i) => i.external_manager_id === 'name:bob')!.member_id;
    db.rows('league_members').find((m) => m.id === alice)!.owner_id = ALICE;
    db.rows('league_members').find((m) => m.id === bob)!.owner_id = BOB;
    return { db, alice, bob };
  }

  it('keeperPlan names what can land and what blocks the rest', async () => {
    const { db } = await importedLeague();
    const plan = await new DynastyCarryoverService(db as any).keeperPlan(LEAGUE, 2026);
    expect(plan).toMatchObject({ season: 2023, seasonYear: 2026, ready: 2, blocked: 0 });
    expect(plan.rows.map((r) => [r.memberName, r.playerName, r.teamId, r.round, r.blocker])).toEqual([
      ['Alice', 'Cale Makar', 't-alice', 3, null],
      ['Bob', 'Connor McDavid', 't-bob', 1, null],
    ]);
    // Unclaim Bob and unmatch Makar: both rows block with their own reason.
    db.rows('league_members').find((m) => m.owner_id === BOB)!.owner_id = null;
    db.rows('league_season_keepers').find((k) => k.external_player_name === 'Cale Makar')!.nhl_player_id = null;
    const again = await new DynastyCarryoverService(db as any).keeperPlan(LEAGUE, 2026);
    expect(again.rows.map((r) => r.blocker)).toEqual(['unmatched', 'unclaimed']);
    expect(again).toMatchObject({ ready: 0, blocked: 2 });
  });

  it('keeperPlan with nothing imported is empty, not an error', async () => {
    const plan = await new DynastyCarryoverService(freshDb() as any).keeperPlan(LEAGUE, 2026);
    expect(plan).toEqual({ season: null, seasonYear: 2026, rows: [], ready: 0, blocked: 0 });
  });

  it('applyKeepers hands the ready rows to the SECURITY DEFINER prefill and reports the rest', async () => {
    const { db } = await importedLeague();
    db.rows('league_season_keepers').find((k) => k.external_player_name === 'Cale Makar')!.nhl_player_id = null;
    const calls: unknown[] = [];
    db.rpcHandlers.citrus_apply_imported_keepers = (args) => { calls.push(args); return [{ written: 1, skipped_locked: 0 }]; };
    const res = await new DynastyCarryoverService(db as any).applyKeepers(LEAGUE, 2026);
    expect(res).toEqual({ written: 1, skippedLocked: 0, blocked: 1 });
    expect(calls[0]).toEqual({ p_league_id: LEAGUE, p_season_year: 2026, p_rows: [{ team_id: 't-bob', player_id: '8478402', original_draft_round: 1, years_kept: 1 }] });
  });

  it('applyKeepers surfaces the function\'s refusal as a 400', async () => {
    const { db } = await importedLeague();
    db.rpcHandlers.citrus_apply_imported_keepers = () => { throw new Error('Only the commissioner of this league can apply imported keepers.'); };
    await expect(new DynastyCarryoverService(db as any).applyKeepers(LEAGUE, 2026)).rejects.toMatchObject({ status: 400, message: /Only the commissioner/ });
  });

  it('pickOwnership lists every traded pick with who can land and who is waiting on a claim', async () => {
    const { db } = await importedLeague();
    const rows = await new DynastyCarryoverService(db as any).pickOwnership(LEAGUE);
    expect(rows.map((r) => [r.draftSeason, r.round, r.originalName, r.ownerName, r.blocker])).toEqual([
      [2026, 1, 'Bob', 'Alice', null],
      [2026, 2, 'Cy', 'Bob', 'unclaimed'],
      [2027, 1, 'Alice', 'Bob', null],
    ]);
  });

  it('applyPickOwnership rewrites the round\'s order, stamps the rows, skips the unclaimed, and is idempotent', async () => {
    const { db } = await importedLeague();
    const svc = new DynastyCarryoverService(db as any);
    const res = await svc.applyPickOwnership(LEAGUE, 2026);
    expect(res).toEqual({ applied: 1, alreadyApplied: 0, skipped: [{ round: 2, reason: 'Cy or Bob has not claimed a team yet.' }] });
    // Alice now drafts twice in round 1; Bob not at all. Round 2 untouched.
    expect(db.rows('draft_order').find((o) => o.round_number === 1)!.team_order).toEqual(['t-alice', 't-alice']);
    expect(db.rows('draft_order').find((o) => o.round_number === 2)!.team_order).toEqual(['t-bob', 't-alice']);
    const own = db.rows('league_pick_ownership');
    expect(own.find((o) => o.draft_season === 2026 && o.round === 1)!.applied_at).toBeTruthy();
    expect(own.find((o) => o.draft_season === 2026 && o.round === 2)!.applied_at ?? null).toBeNull();
    expect(own.find((o) => o.draft_season === 2027)!.applied_at ?? null).toBeNull();
    const again = await svc.applyPickOwnership(LEAGUE, 2026);
    expect(again).toMatchObject({ applied: 0, alreadyApplied: 1 });
    expect(db.rows('draft_order').find((o) => o.round_number === 1)!.team_order).toEqual(['t-alice', 't-alice']);
  });

  it('applyPickOwnership refuses once the draft has started and before an order exists', async () => {
    const { db } = await importedLeague();
    db.rows('leagues')[0].draft_status = 'in_progress';
    await expect(new DynastyCarryoverService(db as any).applyPickOwnership(LEAGUE, 2026)).rejects.toMatchObject({ status: 409, message: /The draft is in_progress/ });
    db.rows('leagues')[0].draft_status = 'not_started';
    db.tables.draft_order = [];
    await expect(new DynastyCarryoverService(db as any).applyPickOwnership(LEAGUE, 2026)).rejects.toMatchObject({ status: 409, message: /Set the draft order first/ });
  });
});
