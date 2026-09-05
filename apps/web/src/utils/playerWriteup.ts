/**
 * Deterministic player writeups (2026-08-25).
 *
 * Roster audit item: "We need writeups for all players."
 *
 * WHY THIS IS A PURE FUNCTION AND NOT AN LLM CALL
 * ------------------------------------------------
 * Every sentence here is derived from numbers the client already holds, so a
 * writeup cannot contradict the stat line printed two inches below it, cannot
 * invent an injury or a trade, costs nothing, needs no cache invalidation, and
 * renders instantly offline. Auto-blurbs on the big fantasy sites work the
 * same way. An LLM pass belongs on top of this later — for narrative colour on
 * a player PAGE — but the per-card writeup has to be right 100% of the time,
 * and "right" is a thing arithmetic can guarantee and generation cannot.
 *
 * RATE STATS, NOT TOTALS
 * ----------------------
 * Everything keys off per-game rates. Raw totals rank a 82-game grinder above
 * a 20-game call-up who is outproducing him, which is exactly the mistake a
 * roster tool must not make when someone is deciding who to start tonight.
 *
 * HONEST ABOUT THIN DATA
 * ----------------------
 * The failure mode that would matter is confidently describing a player we
 * know nothing about. Below MIN_GAMES_FOR_RATES the writeup says so plainly
 * instead of extrapolating a 2-game hot streak into "elite producer".
 *
 * VOICE (2026-09-03)
 * ------------------
 * These sentences ship on a roster card, in the mobile roster list and in
 * the player stats modal, which makes them the most-read prose in the
 * product. They are written to the same brief as
 * `components/player/playerAdvancedMetrics.ts`: a beat writer's fantasy
 * note, not a dashboard caption.
 *
 *   * NO EM DASH. `src/__tests__/aiVoiceGuard.test.ts` fails the build on
 *     one. Twelve lines here used to hang a clause off an em dash, which is
 *     the single most recognisable AI tell in the product.
 *   * THE SOURCE IS NAMED IN THE SENTENCE wherever a Citrus number is
 *     quoted. Expected goals come from `player_season_stats.x_goals`, the
 *     xG v3 model's output, so the sentence says "Citrus xG"; the goalie
 *     equivalent says "Citrus GSAx". A number a reader cannot attribute is
 *     a number they cannot check, and every other figure on the card
 *     (points, minutes, save percentage) is an NHL.com counting stat that
 *     needs no such flag.
 *   * THE FANTASY CALL GOES LAST where the data licenses one. "Buy low" and
 *     "sell high" are the two the finishing gap actually supports, and they
 *     are the calls `playerAdvancedMetrics` and `CitrusNewsService` already
 *     make off the same number.
 *
 * `__tests__/playerWriteup.test.ts` pins all three across every branch.
 */

// `import type`, NOT a value import. HockeyPlayerCard.tsx imports
// generatePlayerWriteup from this module, so a value import here would close a
// real cycle (card -> writeup -> card). A type-only import is erased at
// compile time, so no cycle survives into the bundle — relying on esbuild to
// notice the import is unused at runtime would be a latent
// "cannot access before initialization" waiting for a production build.
import type { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';

export type WriteupTone = 'positive' | 'neutral' | 'caution';

export interface WriteupTag {
  label: string;
  tone: WriteupTone;
}

export interface PlayerWriteup {
  /** Short role label, e.g. "Top-line producer". */
  headline: string;
  /**
   * Lead paragraph — WHAT HAPPENED. Production, usage, the season to date.
   *
   * Mirrors the shape Sleeper/Yahoo/ESPN use on a player card: a news blurb
   * followed by a separate "Analysis:" paragraph. Theirs comes from a paid
   * editorial wire (Rotowire); this app has no news feed and no such table, so
   * the prose is derived from the stat line instead. Same structure, same
   * reading experience, and it cannot go stale or contradict the numbers.
   */
  summary: string;
  /**
   * Second paragraph — WHAT IT MEANS for the manager deciding to start, sit,
   * hold or drop. Rendered under an "Analysis:" lead-in, as on Sleeper.
   */
  analysis: string;
  /** Short badges for skimming. */
  tags: WriteupTag[];
  /** False when the sample is too small to characterise the player. */
  hasEnoughData: boolean;
  /**
   * ONE line for a roster card, e.g. "Star forward · 1.43 P/GP".
   *
   * Roster cards are ~134px tall and already carry a headshot, name, team,
   * position badge, a four-stat grid and a projection bar. The full `summary`
   * would double the card height and bury the stat line the user came for,
   * so the card gets this instead — the same read, compressed, the way
   * Sleeper/Yahoo/ESPN put a single note line on a player row.
   *
   * Deliberately carries the RATE, which the card's totals-based stat grid
   * (GP/G/A/SOG) does not show anywhere — so the line adds information
   * rather than restating what is already on screen.
   */
  cardNote: string;
  /** Tone for the card note's status dot. */
  cardTone: WriteupTone;
}

/**
 * Below this, per-game rates are noise. A player with 3 points in 2 games is
 * not a 1.50 PPG player, and saying so on a lineup card is worse than saying
 * nothing.
 */
const MIN_GAMES_FOR_RATES = 8;

/** "21:34" -> 21.57 minutes. Returns null for missing/garbage input. */
export function parseToiToMinutes(toi: string | undefined | null): number | null {
  if (!toi || typeof toi !== 'string') return null;
  const match = toi.trim().match(/^(\d+):(\d{1,2})$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) return null;
  return minutes + seconds / 60;
}

/**
 * Save percentage arrives as either .915 or 91.5 depending on the source.
 * Normalise to the .915 form. A goalie writeup that reads "91.5 save
 * percentage" where it means .915 is the kind of detail that costs trust.
 */
export function normalizeSavePct(raw: number | undefined | null): number | null {
  if (raw === undefined || raw === null || !Number.isFinite(raw)) return null;
  if (raw <= 0) return null;
  if (raw > 1.5) return raw / 100; // 91.5 -> 0.915
  return raw;
}

function isGoalie(position: string | undefined): boolean {
  const p = (position || '').toUpperCase();
  return p === 'G' || p.startsWith('GOAL');
}

function isDefence(position: string | undefined): boolean {
  const p = (position || '').toUpperCase();
  return p === 'D' || p.startsWith('DEF');
}

/** One decimal, no trailing ".0" noise on whole numbers. */
function fmt(n: number, decimals = 1): string {
  return Number(n.toFixed(decimals)).toString();
}

/** ".915" — leading zero dropped, the way hockey writes it. */
function fmtSavePct(n: number): string {
  return n.toFixed(3).replace(/^0/, '');
}

function firstName(fullName: string): string {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return 'This player';
  return trimmed.split(/\s+/)[0];
}

function fullName(player: HockeyPlayer): string {
  const trimmed = (player.name || '').trim();
  return trimmed || 'This player';
}

/**
 * THE VOICE ROTATES (2026-09-05). "All of the top players ALL SOUND THE
 * SAME": one template, one sentence order, one set of stock phrases, so
 * McDavid, MacKinnon and Kucherov read as the same card with the numbers
 * swapped. Each fact below now has several honest ways of being said, and
 * the player's own id and name pick which one he gets, so two cards side
 * by side differ in shape and not only in figures. Deterministic: the same
 * player reads the same way every time he is opened, which is what makes
 * it prose rather than a slot machine.
 */
function seedOf(player: HockeyPlayer): number {
  const key = `${player.id ?? ''}|${player.name ?? ''}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function pickerFor(seed: number) {
  let n = seed;
  return <T,>(options: readonly T[]): T => {
    n = (Math.imul(n, 1103515245) + 12345) >>> 0;
    return options[(n >>> 8) % options.length];
  };
}

function buildGoalieWriteup(player: HockeyPlayer): PlayerWriteup {
  const s = player.stats || {};
  const gp = s.gamesPlayed ?? 0;
  const savePct = normalizeSavePct(s.savePct);
  const gaa = Number.isFinite(s.gaa as number) ? (s.gaa as number) : null;
  const name = firstName(player.name);
  const tags: WriteupTag[] = [];

  if (gp < MIN_GAMES_FOR_RATES || savePct === null) {
    return {
      headline: 'Not enough starts yet',
      summary:
        gp > 0
          ? `${name} has only ${gp} appearance${gp === 1 ? '' : 's'} on the season. Too small a sample to read anything into the numbers.`
          : `No games played yet this season, so there's nothing to judge ${name} on beyond his role.`,
      tags: [{ label: 'Limited sample', tone: 'neutral' }],
      hasEnoughData: false,
      analysis:
        'Not enough of a track record to judge the job or the numbers. Worth watching how the crease is split over the next couple of weeks before committing a roster spot.',
      cardNote: gp > 0 ? `Only ${gp} appearance${gp === 1 ? '' : 's'}` : 'No appearances yet',
      cardTone: 'neutral',
    };
  }

  let headline: string;
  let cardTone: WriteupTone;
  if (savePct >= 0.92) {
    headline = 'Starting-calibre goalie';
    cardTone = 'positive';
    tags.push({ label: 'Elite save rate', tone: 'positive' });
  } else if (savePct >= 0.91) {
    headline = 'Steady starter';
    cardTone = 'positive';
    tags.push({ label: 'Reliable', tone: 'positive' });
  } else if (savePct >= 0.9) {
    headline = 'Streaky netminder';
    cardTone = 'neutral';
    tags.push({ label: 'Matchup-dependent', tone: 'neutral' });
  } else {
    headline = 'Struggling in net';
    cardTone = 'caution';
    tags.push({ label: 'Below league average', tone: 'caution' });
  }

  const pick = pickerFor(seedOf(player));
  const full = fullName(player);
  const gaaClause = gaa !== null ? ` and a ${fmt(gaa, 2)} goals-against average` : '';
  const apps = `${gp} appearance${gp === 1 ? '' : 's'}`;
  const parts: string[] = [];
  parts.push(
    pick([
      `${full} is carrying a ${fmtSavePct(savePct)} save percentage${gaaClause} across ${apps}.`,
      `${full} has a ${fmtSavePct(savePct)} save percentage${gaaClause} through ${apps}.`,
      `Through ${apps}, ${full} sits at a ${fmtSavePct(savePct)} save percentage${gaaClause}.`,
      `${full}: ${fmtSavePct(savePct)} save percentage${gaaClause}, ${apps} in.`,
    ]),
  );

  const wins = s.wins ?? 0;
  const losses = s.losses ?? 0;
  if (wins + losses > 0) {
    const so = s.shutouts ? ` with ${s.shutouts} shutout${s.shutouts === 1 ? '' : 's'}` : '';
    parts.push(
      pick([
        `He's ${wins}-${losses} in decisions${so}.`,
        `The record is ${wins}-${losses}${so}.`,
        `${wins} wins against ${losses} losses${so ? `,${so.replace(' with', '')}` : ''}.`,
      ]),
    );
  }

  const gsax = s.goalsSavedAboveExpected;
  if (Number.isFinite(gsax as number) && Math.abs(gsax as number) >= 1) {
    if ((gsax as number) > 0) {
      parts.push(
        `Citrus GSAx has him stopping ${fmt(gsax as number)} goals more than an average goalie would have on the same shots.`,
      );
      tags.push({ label: 'Beating expected', tone: 'positive' });
    } else {
      parts.push(
        `Citrus GSAx has him conceding ${fmt(Math.abs(gsax as number))} goals more than the shot quality says he should have.`,
      );
      tags.push({ label: 'Underperforming xG', tone: 'caution' });
    }
  }

  if (s.shutouts && s.shutouts >= 3) {
    tags.push({ label: `${s.shutouts} shutouts`, tone: 'positive' });
  }

  // ── Analysis: what a manager should do about it ──
  const analysis: string[] = [];
  if (savePct >= 0.915) {
    analysis.push(
      `The job looks secure. At this save rate the workload usually follows, and he's a weekly starter in every format.`,
    );
  } else if (savePct >= 0.9) {
    analysis.push(
      `Goalie wins are the most volatile category in fantasy hockey, and at this save rate he lives and dies with the team in front of him. Stream him on soft matchups rather than starting him blind.`,
    );
  } else {
    analysis.push(
      `A save rate this far below league average puts the starts themselves at risk. A hot backup is usually all it takes to turn a crease into a committee.`,
    );
  }

  if (gp >= 40) {
    analysis.push(`The ${gp} appearances confirm he's carrying a true starter's workload, which is most of a fantasy goalie's value.`);
  } else if (gp < 20) {
    analysis.push(`With only ${gp} appearances he hasn't been given a starter's share of the crease, so the counting stats have a low ceiling.`);
  }

  return {
    headline,
    summary: parts.join(' '),
    analysis: analysis.join(' '),
    tags,
    hasEnoughData: true,
    cardNote: `${headline} · ${fmtSavePct(savePct)} SV%`,
    cardTone,
  };
}

function buildSkaterWriteup(player: HockeyPlayer): PlayerWriteup {
  const s = player.stats || {};
  const gp = s.gamesPlayed ?? 0;
  const name = firstName(player.name);
  const tags: WriteupTag[] = [];

  const points = s.points ?? (s.goals ?? 0) + (s.assists ?? 0);

  if (gp < MIN_GAMES_FOR_RATES) {
    return {
      headline: 'Not enough games yet',
      summary:
        gp > 0
          ? `${name} has ${points} point${points === 1 ? '' : 's'} in ${gp} game${gp === 1 ? '' : 's'}. Too small a sample to call a trend either way.`
          : `${name} hasn't played yet this season, so there's no production to judge.`,
      tags: [{ label: 'Limited sample', tone: 'neutral' }],
      hasEnoughData: false,
      analysis:
        'Too early to draw conclusions in either direction. Watch the ice time over the next handful of games. Where a coach deploys him will say more than the box score does at this sample size.',
      cardNote: gp > 0 ? `Only ${gp} game${gp === 1 ? '' : 's'} played` : 'No games played yet',
      cardTone: 'neutral',
    };
  }

  const ppg = points / gp;
  const goals = s.goals ?? 0;
  const assists = s.assists ?? 0;
  const shotsPerGame = (s.shots ?? 0) / gp;
  const hitsPerGame = (s.hits ?? 0) / gp;
  const blocksPerGame = (s.blockedShots ?? 0) / gp;
  const ppPoints = s.powerPlayPoints ?? 0;
  const toiMinutes = parseToiToMinutes(s.toi);
  const defenceman = isDefence(player.position);

  // Headline band. Defencemen are judged on a lower points curve — a 0.65 PPG
  // blueliner is a genuine star, while the same rate from a winger is middle
  // six. Using one scale for both would systematically undersell every D.
  let headline: string;
  let cardTone: WriteupTone;
  if (defenceman) {
    if (ppg >= 0.75) {
      headline = 'Elite offensive defenceman';
      cardTone = 'positive';
      tags.push({ label: 'Point producer', tone: 'positive' });
    } else if (ppg >= 0.5) {
      headline = 'Top-pair contributor';
      cardTone = 'positive';
      tags.push({ label: 'Steady offence', tone: 'positive' });
    } else if (ppg >= 0.3) {
      headline = 'Two-way blueliner';
      cardTone = 'neutral';
    } else {
      headline = 'Defensive specialist';
      cardTone = 'neutral';
    }
  } else {
    if (ppg >= 1.0) {
      headline = 'Star forward';
      cardTone = 'positive';
      tags.push({ label: 'Elite producer', tone: 'positive' });
    } else if (ppg >= 0.75) {
      headline = 'Top-line producer';
      cardTone = 'positive';
      tags.push({ label: 'Reliable scorer', tone: 'positive' });
    } else if (ppg >= 0.5) {
      headline = 'Middle-six contributor';
      cardTone = 'neutral';
    } else if (ppg >= 0.3) {
      headline = 'Depth forward';
      cardTone = 'neutral';
    } else {
      headline = 'Bottom-six role player';
      cardTone = 'neutral';
    }
  }

  const pick = pickerFor(seedOf(player));
  const full = fullName(player);
  const pts = `${points} point${points === 1 ? '' : 's'}`;
  const rate = `${fmt(ppg, 2)} per game`;
  const plusMinus = s.plusMinus;
  const shots = s.shots ?? 0;
  const shootingPct = shots > 0 ? (goals / shots) * 100 : null;

  const parts: string[] = [];
  parts.push(
    pick([
      `${full} has ${pts} (${goals}G, ${assists}A) in ${gp} games, ${rate}.`,
      `${full} is at ${pts} through ${gp} games, ${goals} goals and ${assists} assists, ${rate}.`,
      `${gp} games, ${pts} for ${full}: ${goals} goals, ${assists} assists, ${rate}.`,
      `${full} has put up ${goals} goals and ${assists} assists in ${gp} games, ${pts} at ${rate}.`,
    ]),
  );

  // Usage. Ice time is the single best predictor of opportunity, which is what
  // a lineup decision actually turns on.
  if (toiMinutes !== null) {
    const heavy = defenceman ? toiMinutes >= 22 : toiMinutes >= 19;
    const light = defenceman ? toiMinutes < 17 : toiMinutes < 13;
    const mins = fmt(toiMinutes);
    if (heavy) {
      parts.push(
        pick([
          `He's playing ${mins} minutes a night, top-of-the-lineup usage.`,
          `${mins} minutes a night is a first-unit workload, and the coach keeps handing it to him.`,
          `The ${mins} minutes a night say the coaching staff trusts him in every situation.`,
        ]),
      );
      tags.push({ label: 'Heavy minutes', tone: 'positive' });
    } else if (light) {
      parts.push(
        pick([
          `At ${mins} minutes a night, the opportunity just isn't there yet.`,
          `${mins} minutes a night caps what he can produce, however well he plays them.`,
        ]),
      );
      tags.push({ label: 'Limited ice time', tone: 'caution' });
    } else {
      parts.push(pick([`He's seeing ${mins} minutes a night.`, `Ice time sits at ${mins} minutes a night.`]));
    }
  }

  // Shot volume, the floor under a scorer's production.
  if (shotsPerGame >= 3.0) {
    const spg = fmt(shotsPerGame);
    parts.push(
      pick([
        `The ${spg} shots a game give him a high floor even in a cold stretch.`,
        `He fires ${spg} shots a game, which keeps the floor high when the puck stops going in.`,
        `${spg} shots a night is volume that scores through a slump.`,
      ]),
    );
    tags.push({ label: 'Shot volume', tone: 'positive' });
  }

  // The rest of the box score, when it says something: the power play,
  // the plus-minus, the shooting percentage.
  if (ppPoints >= 10) {
    parts.push(
      pick([
        `${ppPoints} of the points came on the power play.`,
        `The power play is a real share of it: ${ppPoints} points with the man advantage.`,
      ]),
    );
  }
  if (typeof plusMinus === 'number' && Math.abs(plusMinus) >= 10) {
    parts.push(
      plusMinus > 0
        ? pick([`He's a plus-${plusMinus}.`, `The plus-minus is a plus-${plusMinus}, which the coaches notice.`])
        : pick([`He's a minus-${Math.abs(plusMinus)}, though that says as much about the team as the player.`, `The minus-${Math.abs(plusMinus)} is the one blemish on the line.`]),
    );
  }
  if (shootingPct !== null && shots >= 60 && (shootingPct >= 15 || shootingPct <= 7)) {
    parts.push(
      shootingPct >= 15
        ? pick([`He's shooting ${fmt(shootingPct)}%, hot by any standard.`, `A ${fmt(shootingPct)}% shooting percentage is well above the league line.`])
        : pick([`He's shooting ${fmt(shootingPct)}%, which is cold for the looks he gets.`, `The ${fmt(shootingPct)}% shooting is the number most likely to move.`]),
    );
  }

  const bangers = hitsPerGame + blocksPerGame;
  if (bangers >= 3.5) {
    tags.push({ label: 'Peripheral value', tone: 'positive' });
  }

  const ppShare = points > 0 ? ppPoints / points : 0;
  const ppDependent = ppShare >= 0.4 && ppPoints >= 5;
  if (ppDependent) {
    tags.push({ label: 'PP-dependent', tone: 'caution' });
  } else if (ppPoints >= 10) {
    tags.push({ label: 'Power-play role', tone: 'positive' });
  }

  // ── Analysis: what a manager should DO about it ──
  // Everything above describes the season. This paragraph is the part a
  // start/sit decision actually turns on, kept separate so the card can render
  // it under its own "Analysis:" lead-in the way Sleeper does.
  const analysis: string[] = [];

  if (toiMinutes !== null) {
    const heavy = defenceman ? toiMinutes >= 22 : toiMinutes >= 19;
    const light = defenceman ? toiMinutes < 17 : toiMinutes < 13;
    if (heavy) {
      analysis.push(
        pick([
          `The ice time is the part that matters most: coaches don't hand ${fmt(toiMinutes)} minutes a night to players they intend to scratch, so the role is about as secure as it gets.`,
          `Start him and forget him. ${fmt(toiMinutes)} minutes a night is a role that survives a cold week.`,
          `Nobody loses ${fmt(toiMinutes)} minutes a night over a slump. The deployment is the floor.`,
        ]),
      );
    } else if (light) {
      analysis.push(
        pick([
          `There's a hard ceiling here until the deployment changes. Production can't outrun opportunity, and ${fmt(toiMinutes)} minutes a night isn't enough of it.`,
          `Until the minutes move, treat the ceiling as fixed: ${fmt(toiMinutes)} a night only produces so much.`,
        ]),
      );
    }
  }

  if (ppDependent) {
    analysis.push(
      `Watch the power play closely: ${Math.round(ppShare * 100)}% of his points come with the man advantage, so a bump off the top unit would take most of his fantasy value with it.`,
    );
  }

  // Finishing luck. `stats.xGoals` is `player_season_stats.x_goals`, the
  // Citrus xG v3 model's output, so the sentence names it: comparing goals
  // to Citrus xG is the single most useful regression signal available in
  // this data, and attributing it is what separates a scouting note from a
  // number floating on a card.
  const xg = s.xGoals;
  if (Number.isFinite(xg as number) && (xg as number) >= 5) {
    const expected = xg as number;
    if (goals >= expected * 1.3) {
      analysis.push(
        `Citrus xG has him at ${goals} goals on ${fmt(expected)} expected, finishing well clear of the quality of his chances. That gap rarely holds across a full season. Sell high if someone in your league is paying for the goal total.`,
      );
    } else if (goals <= expected * 0.7) {
      analysis.push(
        `Citrus xG has him at ${goals} goals on ${fmt(expected)} expected. The chances are there and the finishing hasn't been, and that gap usually closes. Buy low rather than drop him.`,
      );
    }
  }

  if (bangers >= 3.5) {
    analysis.push(
      `In any league counting hits and blocks he's worth more than his point total suggests, at ${fmt(hitsPerGame)} hits and ${fmt(blocksPerGame)} blocks a night.`,
    );
  }

  if (analysis.length === 0) {
    analysis.push(
      ppg >= 0.5
        ? pick([
            `Nothing in the profile suggests a role change coming. He's a steady weekly starter in most formats.`,
            `A weekly starter in most formats, and the profile has no red flag in it.`,
            `Set the lineup and leave him in it. The production is steady and the role is settled.`,
          ])
        : pick([
            `Better as a matchup-based streamer or depth piece than a set-and-forget starter.`,
            `A depth piece for the right week, not a set-and-forget starter.`,
          ]),
    );
  }

  return {
    headline,
    summary: parts.join(' '),
    analysis: analysis.join(' '),
    tags,
    hasEnoughData: true,
    cardNote: `${headline} · ${fmt(ppg, 2)} P/GP`,
    cardTone,
  };
}

/**
 * Build a writeup for any player. Never throws and never returns empty prose —
 * a card that renders a blank space where a scouting note should be looks more
 * broken than one that admits the sample is thin.
 */
export function generatePlayerWriteup(player: HockeyPlayer | null | undefined): PlayerWriteup {
  if (!player) {
    return {
      headline: 'No player selected',
      summary: 'Select a player to see their scouting summary.',
      analysis: '',
      tags: [],
      hasEnoughData: false,
      cardNote: '',
      cardTone: 'neutral',
    };
  }

  const writeup = isGoalie(player.position) ? buildGoalieWriteup(player) : buildSkaterWriteup(player);

  // Injury status outranks anything the stat line says: a 1.2 PPG winger on IR
  // is a bench decision tonight regardless of how good the season has been.
  // The card has room for ONE line, so availability takes it: whether he can
  // play tonight beats how good the season has been.
  if (player.status === 'IR') {
    return {
      ...writeup,
      tags: [{ label: 'Injured reserve', tone: 'caution' }, ...writeup.tags],
      summary: `Currently on injured reserve. ${writeup.summary}`,
      cardNote: 'On injured reserve',
      cardTone: 'caution',
    };
  }
  if (player.status === 'GTD') {
    return {
      ...writeup,
      tags: [{ label: 'Game-time decision', tone: 'caution' }, ...writeup.tags],
      summary: `Listed as a game-time decision, so check his status before puck drop. ${writeup.summary}`,
      cardNote: 'Game-time decision',
      cardTone: 'caution',
    };
  }
  if (player.status === 'SUSP') {
    return {
      ...writeup,
      tags: [{ label: 'Suspended', tone: 'caution' }, ...writeup.tags],
      summary: `Currently suspended and unavailable. ${writeup.summary}`,
      cardNote: 'Suspended, unavailable',
      cardTone: 'caution',
    };
  }

  return writeup;
}
