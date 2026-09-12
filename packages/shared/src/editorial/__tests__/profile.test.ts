import { describe, expect, it } from 'vitest';
import fixtures from '../../../../../docs/editorial-evaluation/nhl-2025-26-examples.json';
import { generatePlayerWriteup, type WriteupPlayer } from '../../playerWriteup';
import { profileWriteup } from '../profile';
import { editorialScoringCategories, editorialScoringWeights, type EditorialNewsEvidence } from '../index';
const player = (stats: WriteupPlayer['stats'], name = 'Sample Forward', position = 'C'): WriteupPlayer => ({ id: 1, name, position, statsSeason: 2025, stats });
const sample = { gamesPlayed: 80, goals: 35, assists: 55, points: 90, shots: 320, powerPlayPoints: 25, toi: '21:00' };
const extras = { projectionSeason: 2026 };
const real = (name: string) => fixtures.find(p => p.name === name)!;
const evidence = (kind: EditorialNewsEvidence['kind'], publishedAt = '2026-09-12T09:00:00Z'): EditorialNewsEvidence => ({ kind, source: 'example.com', url: 'https://example.com/fixture', publishedAt, report: 'Synthetic test report', implication: 'GENERIC IMPLICATION MUST NOT BE COPIED' });

describe('Citrus evidence-driven editorial profiles', () => {
  it('explains distinct interactions for the six frozen NHL evidence fixtures', () => {
    const outputs = fixtures.map(p => profileWriteup(p, extras));
    const [mcdavid, mackinnon, kucherov, draisaitl, makar, hellebuyck] = outputs;
    expect(mcdavid.summary).toMatch(/90 assists.*3.7 shots.*2025-26.*23 minutes/);
    expect(mcdavid.analysis).toContain('comparable workload');
    expect(mackinnon.summary).toMatch(/4.4 shots.*53 goals.*15.1%/);
    expect(mackinnon.analysis).toContain('maintaining conversion');
    expect(kucherov.summary).toMatch(/44 goals.*19%.*3 shots.*86 assists/);
    expect(kucherov.analysis).toContain('same shot volume');
    expect(draisaitl.summary).toContain('42 of his 97 points on the power play');
    expect(draisaitl.analysis).toContain('Reduced special-teams time');
    expect(makar.summary).toContain('50 came outside the power play');
    expect(makar.analysis).toContain('defence slot');
    expect(hellebuyck.summary).toMatch(/57 appearances.*23.*.895.*2.86/);
    expect(hellebuyck.analysis).toContain('performance and a larger workload are separate');
    for (let i = 0; i < outputs.length; i++) {
      const prose = `${outputs[i].summary} ${outputs[i].analysis}`;
      expect(prose.split(fixtures[i].name)).toHaveLength(2);
      expect(prose).not.toContain('historical baseline');
      expect(prose).not.toMatch(/teammate to finish|even-strength points|coach trusts|guaranteed regression/);
      expect(prose.split(/\s+/).length).toBeLessThan(100);
    }
  });

  it('changing conversion at fixed games and shots changes the argument, not just the goal number', () => {
    const efficient = real('Nikita Kucherov');
    const lower = { ...efficient, stats: { ...efficient.stats, goals: 25, points: 111 } };
    const high = profileWriteup(efficient, extras);
    const low = profileWriteup(lower, extras);
    expect(high.headline).toBe('Finishing and playmaking');
    expect(low.headline).toBe('Volume shooter');
    expect(high.analysis).toContain('conversion to hold');
    expect(low.analysis).toContain('volume still contributes');
    expect(high.analysis).not.toMatch(/will decline|must regress|sell high/);
  });

  it('changing power-play dependence changes the recommendation while holding total points fixed', () => {
    const p = real('Leon Draisaitl');
    const pp = profileWriteup(p, extras);
    const lessPP = profileWriteup({ ...p, stats: { ...p.stats, powerPlayPoints: 10 } }, extras);
    expect(pp.analysis).toContain('Reduced special-teams time');
    expect(lessPP.analysis).not.toContain('Reduced special-teams time');
    expect(pp.headline).not.toBe(lessPP.headline);
  });

  it('uses minutes only when they change the supported assessment', () => {
    const p = real('Connor McDavid');
    const known = profileWriteup(p, extras);
    const unknown = profileWriteup({ ...p, stats: { ...p.stats, toi: undefined } }, extras);
    expect(known.analysis).toContain('comparable workload');
    expect(unknown.summary).not.toContain('minutes');
    expect(unknown.analysis).not.toContain('comparable workload');
    const limited = profileWriteup(player({ gamesPlayed: 40, goals: 3, assists: 5, points: 8, shots: 20, toi: '9:30' }), extras);
    expect(limited.summary).toContain('9.5 minutes');
    expect(limited.analysis).toContain('more minutes or more scoring per minute');
    expect(limited.summary).not.toMatch(/fourth.line|bottom.six|sheltered/);
  });

  it('supports one known peripheral category without fabricating the missing one', () => {
    const out = profileWriteup(player({ gamesPlayed: 80, points: 20, goals: 5, assists: 15, hits: 300 }), extras);
    expect(out.headline).toBe('Peripheral specialist');
    expect(out.summary).toContain('3.8 hits');
    expect(out.summary).not.toMatch(/0 blocks|NaN/);
  });

  it('excluded hits cannot compensate for weak scoring in a blocks-only setup', () => {
    const p = player({ gamesPlayed: 80, goals: 5, assists: 15, points: 20, hits: 300, blockedShots: 10 });
    const hits = profileWriteup(p, { ...extras, scoringCategories: ['hits'] });
    const blocks = profileWriteup(p, { ...extras, scoringCategories: ['blocks'] });
    expect(hits.tags).toContainEqual({ label: 'Peripheral value', tone: 'positive' });
    expect(blocks.tags).not.toContainEqual({ label: 'Peripheral value', tone: 'positive' });
    expect(blocks.analysis).toContain('outside the rewarded categories');
  });

  it('shot scoring and assists scoring alter the actual recommendation', () => {
    const p = real('Connor McDavid');
    const assists = profileWriteup(p, { ...extras, scoringCategories: ['assists'] });
    const goals = profileWriteup(p, { ...extras, scoringCategories: ['goals'] });
    expect(assists.analysis).toContain('assist return carries more');
    expect(goals.analysis).toContain('assist total is not directly rewarded');
    const shooter = profileWriteup(real('Nathan MacKinnon'), { ...extras, scoringCategories: ['goals'] });
    expect(shooter.analysis).toContain('Shots are not rewarded directly');
    expect(assists.summary).toBe(goals.summary);
  });

  it('keeps a defender non-PP scoring split distinct from even-strength or role evidence', () => {
    const p = real('Cale Makar');
    const all = profileWriteup(p, extras);
    const ppOnly = profileWriteup(p, { ...extras, scoringCategories: ['power_play_points'] });
    expect(all.summary).toContain('50 came outside the power play');
    expect(all.analysis).toContain('defence slot');
    expect(ppOnly.analysis).toContain('does not earn a power-play bonus');
    expect(`${all.summary} ${all.analysis}`).not.toMatch(/even.strength|PP1|first.unit|top.pair/);
  });

  it('distinguishes wins, save percentage and GAA scoring for the same goalie', () => {
    const p = player({ gamesPlayed: 50, wins: 35, losses: 10, savePct: .899, gaa: 3.1 }, 'Sample Goalie', 'G');
    const wins = profileWriteup(p, { ...extras, scoringCategories: ['wins'] });
    const ratios = profileWriteup(p, { ...extras, scoringCategories: ['save_pct'] });
    const gaa = profileWriteup(p, { ...extras, scoringCategories: ['gaa'] });
    expect(wins.analysis).toContain('setup rewards wins');
    expect(ratios.analysis).toContain('Wins do not add direct scoring value');
    expect(gaa.analysis).toContain('GAA as the ratio benchmark');
    expect(gaa.analysis).not.toContain('at that save rate');
    for (const w of [wins, ratios, gaa]) expect(w.analysis).not.toMatch(/secure|true starter|weekly starter/);
  });

  it('current health evidence replaces the statistical recommendation rather than appending boilerplate', () => {
    const p = real('Connor McDavid');
    const baseline = profileWriteup(p, extras);
    const practice = profileWriteup(p, { ...extras, selectedNews: [evidence('practice')] });
    const out = profileWriteup(p, { ...extras, selectedNews: [evidence('out')] });
    expect(practice.summary).toBe(baseline.summary);
    expect(practice.analysis).toContain('assist and shot contribution');
    expect(practice.analysis).toContain('neither game clearance');
    expect(practice.analysis).not.toContain(baseline.analysis);
    expect(out.analysis).toContain('access to games');
    expect(out.analysis).not.toContain('GENERIC IMPLICATION');
  });

  it('the same PP news carries a different implication for PP-dependent and diversified scoring', () => {
    const pp = profileWriteup(real('Leon Draisaitl'), { ...extras, selectedNews: [evidence('power-play')] });
    const mixed = profileWriteup(real('Nathan MacKinnon'), { ...extras, selectedNews: [evidence('power-play')] });
    expect(pp.analysis).toContain('preserves a major source');
    expect(mixed.analysis).toContain('before treating it as additional offence');
    expect(pp.analysis).not.toBe(mixed.analysis);
    expect(pp.analysis).not.toMatch(/raise.*projection|guarantee/);
  });

  it('verified availability takes priority only over older health reporting', () => {
    const p = real('Nikita Kucherov');
    const context = { status: 'out', authority: 'verified' as const, asOf: '2026-09-12T10:00:00Z' };
    const newerCanonical = profileWriteup(p, { ...extras, selectedNews: [evidence('cleared')], selectedAvailability: context });
    expect(newerCanonical.analysis).toContain('dated absence');
    const newerNews = profileWriteup(p, { ...extras, selectedNews: [evidence('cleared', '2026-09-12T11:00:00Z')], selectedAvailability: context });
    expect(newerNews.analysis).toContain('question shifts');
    expect(newerNews.analysis).not.toContain('dated absence');
  });

  it('imported scenarios remain conditional and active designation is not clearance', () => {
    const p = real('Nikita Kucherov');
    const imported = profileWriteup(p, { ...extras, selectedAvailability: { status: 'out', authority: 'imported_scenario', asOf: '2026-09-12' } });
    expect(imported.analysis).toMatch(/^If the imported availability scenario still applies/);
    expect(imported.analysis).not.toContain('dated absence');
    const active = profileWriteup(p, { ...extras, selectedAvailability: { status: 'active', authority: 'verified', asOf: '2026-09-12' } });
    expect(active.analysis).toContain('not medical clearance');
  });

  it('missing appearances remain unknown; partial stats do not become a short sample', () => {
    const missing = profileWriteup(player({ points: 80 }), extras);
    expect(missing.summary).toContain('does not include a usable appearance count');
    expect(missing.summary).not.toContain('no NHL appearances');
    expect(missing.cardNote).toContain('GP unavailable');
    expect(missing.hasEnoughData).toBe(false);
    const partial = profileWriteup(player({ gamesPlayed: 80 }), extras);
    expect(partial.headline).toBe('Incomplete rate data');
    expect(partial.summary).not.toContain('too small');
    const short = profileWriteup(player({ gamesPlayed: 2, goals: 2, assists: 1, points: 3 }), extras);
    expect(short.hasEnoughData).toBe(false);
    expect(short.summary).not.toContain('1.5 points per game');
  });

  it('keeps source season and neutral unknown-season wording without stock baseline tails', () => {
    const historical = profileWriteup(player(sample), { projectionSeason: 2027 });
    const unknown = profileWriteup({ ...player(sample), statsSeason: undefined }, { projectionSeason: 2027 });
    expect(historical.summary).toContain('in 2025-26');
    expect(historical.summary).not.toContain('2027-28');
    expect(unknown.summary).toContain('in the available stat record');
    expect(unknown.summary).not.toMatch(/this season|2025-26|2027-28/);
    expect(historical.cardNote).toBe('2025-26 · 1.13 P/GP');
  });

  it('uses attributed model evidence conditionally and does not change projection inputs', () => {
    const p = player({ ...sample, xGoals: 20 });
    const w = profileWriteup(p, extras);
    expect(w.analysis).toContain('15 goals above the 20 Citrus expected goals estimate');
    expect(w.analysis).toContain('A repeat needs');
    expect(w.analysis).not.toMatch(/will regress|proof of luck|sell high|buy low/);
    const gp = player({ gamesPlayed: 50, savePct: .92 }, 'Sample Goalie', 'G');
    const settings = Object.freeze({ ...extras, projGp: 58, projFp: 400, projectionLabel: 'for 2026-27' });
    expect(generatePlayerWriteup(gp, settings).analysis).toContain('400 fantasy points over 58 starts for 2026-27');
    expect(gp.stats?.gamesPlayed).toBe(50);
  });

  it('renaming identical evidence cannot change the analytical conclusion', () => {
    const p = real('Nathan MacKinnon');
    expect(profileWriteup(p, extras).analysis).toBe(profileWriteup({ ...p, id: 999, name: 'Another Player' }, extras).analysis);
  });

  it('extracts only configured nonzero weights and keeps no-settings unknown', () => {
    expect(editorialScoringCategories(null)).toBeNull();
    expect(editorialScoringWeights(null)).toBeNull();
    expect(editorialScoringWeights({ skater: { hits: -1, shots_on_goal: .2, goals: 0 }, goalie: { goals_against: -2 } })).toEqual({ hits: -1, shots: .2, goals: 0, goals_against: -2 });
    expect(editorialScoringCategories({ skater: { hits: 0, shots_on_goal: .2, goals: 4 }, goalie: { goals_against: -2 } })).toEqual(['shots', 'goals', 'goals_against']);
  });
});

describe('actual scoring weights', () => {
  it('the four frozen forwards retain different hockey mechanisms under the same league weights', () => {
    const scoringWeights = { goals: 3, assists: 2, shots: .2, power_play_points: 1, hits: .1, blocks: .2 };
    const outputs = fixtures.slice(0, 4).map(p => profileWriteup(p, { ...extras, scoringWeights }));
    expect(outputs[0].analysis).toContain('comparable workload');
    expect(outputs[1].analysis).toContain('larger goal return depends on conversion');
    expect(outputs[2].analysis).toContain('assist weighting reduces how much');
    expect(outputs[3].analysis).toContain('losing power-play time can affect');
    for (const out of outputs) {
      expect(out.analysis).not.toContain('That weighting determines');
      expect(`${out.summary} ${out.analysis}`.split(/\s+/).length).toBeLessThanOrEqual(100);
    }
  });

  it('the same Kucherov evidence gets a different decision when goal/assist weights reverse', () => {
    const p = real('Nikita Kucherov');
    const goals = profileWriteup(p, { ...extras, scoringWeights: { goals: 8, assists: 1, shots: 0 } });
    const assists = profileWriteup(p, { ...extras, scoringWeights: { goals: 1, assists: 8, shots: 0 } });
    expect(goals.summary).toBe(assists.summary);
    expect(goals.analysis).toContain('Goals contributed 352 scoring points versus 86 from assists');
    expect(goals.analysis).toContain('comparable conversion');
    expect(assists.analysis).toContain('Assists contributed 688 scoring points versus 44 from goals');
    expect(assists.analysis).toContain('reduces how much the roster decision depends on repeating the shooting percentage');
  });

  it('negative hits are a scoring penalty, even when categories still list hits', () => {
    const p = player({ gamesPlayed: 80, goals: 5, assists: 15, points: 20, hits: 300, blockedShots: 20 });
    const reward = profileWriteup(p, { ...extras, scoringCategories: ['hits'], scoringWeights: { hits: 1 } });
    const penalty = profileWriteup(p, { ...extras, scoringCategories: ['hits'], scoringWeights: { hits: -1 } });
    expect(reward.analysis).toContain('Hits and blocks supplied 300 scoring points');
    expect(penalty.analysis).toContain('Hits cost 300 scoring points');
    expect(penalty.analysis).toContain('more of that production would hurt');
    expect(penalty.tags).not.toContainEqual({ label: 'Peripheral value', tone: 'positive' });
    expect(penalty.cardTone).not.toBe('positive');
  });

  it('tiny positive physical weights do not imply they outweigh scoring contributions', () => {
    const p = player({ gamesPlayed: 80, goals: 5, assists: 15, points: 20, hits: 300 });
    const low = profileWriteup(p, { ...extras, scoringWeights: { hits: .01, goals: 6, assists: 4 } });
    const high = profileWriteup(p, { ...extras, scoringWeights: { hits: 1, goals: 6, assists: 4 } });
    expect(low.analysis).toContain('Hits and blocks supplied 3 scoring points against 90');
    expect(low.tags).not.toContainEqual({ label: 'Peripheral value', tone: 'positive' });
    expect(high.analysis).toContain('Hits and blocks supplied 300 scoring points against 90');
    expect(high.tags).toContainEqual({ label: 'Peripheral value', tone: 'positive' });
  });

  it('uses goal-against penalty and win weight without fabricating a save total', () => {
    const p = real('Connor Hellebuyck');
    const a = profileWriteup(p, { ...extras, scoringWeights: { wins: 4, saves: .2, goals_against: -2 } });
    const b = profileWriteup(p, { ...extras, scoringWeights: { wins: 8, saves: .2, goals_against: -1 } });
    expect(a.analysis).toContain('each goal allowed costs 2 points');
    expect(a.analysis).toContain('offsetting 2 goals allowed');
    expect(b.analysis).toContain('offsetting 8 goals allowed');
    expect(a.analysis).not.toMatch(/\d+ saves|\d+ goals allowed in/);
  });

  it('inverted ratio weights cannot receive conventional ratio advice', () => {
    const p = real('Connor Hellebuyck');
    const reverse = profileWriteup(p, { ...extras, scoringWeights: { gaa: 1, save_pct: -1 } });
    expect(reverse.analysis).toContain('reward a higher GAA and a lower save percentage');
    expect(reverse.analysis).not.toContain('ratio recovery');
    const negativeWins = profileWriteup(p, { ...extras, scoringWeights: { wins: -3 } });
    expect(negativeWins.analysis).toContain('each win costs 3 points');
    expect(negativeWins.analysis).not.toMatch(/wins contributed|each win adds/);
  });

  it('missing settings keep save-rate value conditional, and zero weights do not imply default rewards', () => {
    const p = player({ gamesPlayed: 50, savePct: .92 }, 'Sample Goalie', 'G');
    expect(profileWriteup(p, extras).analysis).toContain('If save percentage counts');
    const zero = profileWriteup(player(sample), { ...extras, scoringWeights: { goals: 0, assists: 0 } });
    expect(zero.analysis).toContain('no nonzero contribution under these weights');
    expect(zero.cardTone).not.toBe('positive');
  });

  it('PP news cannot turn penalties-only scoring into a positive opportunity recommendation', () => {
    const out = profileWriteup(real('Leon Draisaitl'), { ...extras, scoringWeights: { goals: -1, assists: -1, power_play_points: -1 }, selectedNews: [evidence('power-play')] });
    expect(out.analysis).toContain('no positive reward');
    expect(out.analysis).not.toContain('preserves a major source');
  });
});
