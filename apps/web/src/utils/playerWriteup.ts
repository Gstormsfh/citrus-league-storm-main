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
          ? `${name} has only ${gp} appearance${gp === 1 ? '' : 's'} on the season — too small a sample to read anything into the numbers.`
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

  const parts: string[] = [];
  parts.push(
    `${name} is carrying a ${fmtSavePct(savePct)} save percentage${
      gaa !== null ? ` and a ${fmt(gaa, 2)} goals-against average` : ''
    } across ${gp} appearance${gp === 1 ? '' : 's'}.`,
  );

  const wins = s.wins ?? 0;
  const losses = s.losses ?? 0;
  if (wins + losses > 0) {
    parts.push(`He's ${wins}-${losses} in decisions${s.shutouts ? ` with ${s.shutouts} shutout${s.shutouts === 1 ? '' : 's'}` : ''}.`);
  }

  const gsax = s.goalsSavedAboveExpected;
  if (Number.isFinite(gsax as number) && Math.abs(gsax as number) >= 1) {
    if ((gsax as number) > 0) {
      parts.push(`He's stopped ${fmt(gsax as number)} goals more than an average goalie would have on the same shots.`);
      tags.push({ label: 'Beating expected', tone: 'positive' });
    } else {
      parts.push(`He's conceded ${fmt(Math.abs(gsax as number))} goals more than the shot quality suggests he should have.`);
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
      `The job looks secure — at this save rate the workload usually follows, and he's a weekly starter in every format.`,
    );
  } else if (savePct >= 0.9) {
    analysis.push(
      `Goalie wins are the most volatile category in fantasy hockey, and at this save rate he lives and dies with the team in front of him. Stream him on soft matchups rather than starting him blind.`,
    );
  } else {
    analysis.push(
      `A save rate this far below league average puts the starts themselves at risk — a hot backup is usually all it takes for a crease to become a committee.`,
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
          ? `${name} has ${points} point${points === 1 ? '' : 's'} in ${gp} game${gp === 1 ? '' : 's'} — too small a sample to call a trend either way.`
          : `${name} hasn't played yet this season, so there's no production to judge.`,
      tags: [{ label: 'Limited sample', tone: 'neutral' }],
      hasEnoughData: false,
      analysis:
        'Too early to draw conclusions in either direction. Watch the ice time over the next handful of games — where a coach deploys him will say more than the box score does at this sample size.',
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

  const parts: string[] = [];
  parts.push(
    `${name} has ${points} point${points === 1 ? '' : 's'} (${goals}G, ${assists}A) in ${gp} games — ${fmt(ppg, 2)} per game.`,
  );

  // Usage. Ice time is the single best predictor of opportunity, which is what
  // a lineup decision actually turns on.
  if (toiMinutes !== null) {
    const heavy = defenceman ? toiMinutes >= 22 : toiMinutes >= 19;
    const light = defenceman ? toiMinutes < 17 : toiMinutes < 13;
    if (heavy) {
      parts.push(`He's playing ${fmt(toiMinutes)} minutes a night, genuine top-of-the-lineup usage.`);
      tags.push({ label: 'Heavy minutes', tone: 'positive' });
    } else if (light) {
      parts.push(`At ${fmt(toiMinutes)} minutes a night, the opportunity just isn't there yet.`);
      tags.push({ label: 'Limited ice time', tone: 'caution' });
    } else {
      parts.push(`He's seeing ${fmt(toiMinutes)} minutes a night.`);
    }
  }

  // Shot volume — the floor under a scorer's production.
  if (shotsPerGame >= 3.0) {
    parts.push(`The ${fmt(shotsPerGame)} shots a game give him a high floor even in a cold stretch.`);
    tags.push({ label: 'Shot volume', tone: 'positive' });
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
        `The ice time is the part that matters most: coaches don't hand ${fmt(toiMinutes)} minutes a night to players they intend to scratch, so the role is about as secure as it gets.`,
      );
    } else if (light) {
      analysis.push(
        `There's a hard ceiling here until the deployment changes — production can't outrun opportunity, and ${fmt(toiMinutes)} minutes a night isn't enough of it.`,
      );
    }
  }

  if (ppDependent) {
    analysis.push(
      `Watch the power play closely: ${Math.round(ppShare * 100)}% of his points come with the man advantage, so a bump off the top unit would take most of his fantasy value with it.`,
    );
  }

  // Finishing luck. Comparing goals to expected goals is the single most
  // useful regression signal available in this data, and it is exactly the
  // kind of call a real analyst blurb makes.
  const xg = s.xGoals;
  if (Number.isFinite(xg as number) && (xg as number) >= 5) {
    const expected = xg as number;
    if (goals >= expected * 1.3) {
      analysis.push(
        `He's buried ${goals} goals on ${fmt(expected)} expected — finishing well above the quality of his chances, which historically doesn't hold across a full season. Sell-high territory if someone in your league is paying for the goal total.`,
      );
    } else if (goals <= expected * 0.7) {
      analysis.push(
        `He's got ${goals} goals on ${fmt(expected)} expected — the chances are there and the finishing hasn't been. That gap usually closes, which makes him a buy-low rather than a drop.`,
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
        ? `Nothing in the profile suggests a role change coming — a steady weekly starter in most formats.`
        : `Better as a matchup-based streamer or depth piece than a set-and-forget starter.`,
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
      summary: `Listed as a game-time decision — check status before puck drop. ${writeup.summary}`,
      cardNote: 'Game-time decision',
      cardTone: 'caution',
    };
  }
  if (player.status === 'SUSP') {
    return {
      ...writeup,
      tags: [{ label: 'Suspended', tone: 'caution' }, ...writeup.tags],
      summary: `Currently suspended and unavailable. ${writeup.summary}`,
      cardNote: 'Suspended — unavailable',
      cardTone: 'caution',
    };
  }

  return writeup;
}
