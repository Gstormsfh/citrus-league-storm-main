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

import { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';

export type WriteupTone = 'positive' | 'neutral' | 'caution';

export interface WriteupTag {
  label: string;
  tone: WriteupTone;
}

export interface PlayerWriteup {
  /** Short role label, e.g. "Top-line producer". */
  headline: string;
  /** Two or three sentences of plain scouting prose. */
  summary: string;
  /** Short badges for skimming. */
  tags: WriteupTag[];
  /** False when the sample is too small to characterise the player. */
  hasEnoughData: boolean;
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
    };
  }

  let headline: string;
  if (savePct >= 0.92) {
    headline = 'Starting-calibre goalie';
    tags.push({ label: 'Elite save rate', tone: 'positive' });
  } else if (savePct >= 0.91) {
    headline = 'Steady starter';
    tags.push({ label: 'Reliable', tone: 'positive' });
  } else if (savePct >= 0.9) {
    headline = 'Streaky netminder';
    tags.push({ label: 'Matchup-dependent', tone: 'neutral' });
  } else {
    headline = 'Struggling in net';
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

  return { headline, summary: parts.join(' '), tags, hasEnoughData: true };
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
  if (defenceman) {
    if (ppg >= 0.75) {
      headline = 'Elite offensive defenceman';
      tags.push({ label: 'Point producer', tone: 'positive' });
    } else if (ppg >= 0.5) {
      headline = 'Top-pair contributor';
      tags.push({ label: 'Steady offence', tone: 'positive' });
    } else if (ppg >= 0.3) {
      headline = 'Two-way blueliner';
    } else {
      headline = 'Defensive specialist';
    }
  } else {
    if (ppg >= 1.0) {
      headline = 'Star forward';
      tags.push({ label: 'Elite producer', tone: 'positive' });
    } else if (ppg >= 0.75) {
      headline = 'Top-line producer';
      tags.push({ label: 'Reliable scorer', tone: 'positive' });
    } else if (ppg >= 0.5) {
      headline = 'Middle-six contributor';
    } else if (ppg >= 0.3) {
      headline = 'Depth forward';
    } else {
      headline = 'Bottom-six role player';
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

  // Peripherals matter enormously in leagues that count them, and are the
  // whole case for rostering a lot of otherwise unremarkable players.
  const bangers = hitsPerGame + blocksPerGame;
  if (bangers >= 3.5) {
    parts.push(
      `He chips in ${fmt(hitsPerGame)} hits and ${fmt(blocksPerGame)} blocks a game, which carries real weight in peripheral leagues.`,
    );
    tags.push({ label: 'Peripheral value', tone: 'positive' });
  }

  // Power-play dependence is a risk flag: it evaporates the moment the
  // coach changes units, so a user deciding whether to hold should see it.
  if (points > 0 && ppPoints / points >= 0.4 && ppPoints >= 5) {
    parts.push(`${Math.round((ppPoints / points) * 100)}% of his production comes on the power play, so his value is tied to that unit.`);
    tags.push({ label: 'PP-dependent', tone: 'caution' });
  } else if (ppPoints >= 10) {
    tags.push({ label: 'Power-play role', tone: 'positive' });
  }

  return { headline, summary: parts.join(' '), tags, hasEnoughData: true };
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
      tags: [],
      hasEnoughData: false,
    };
  }

  const writeup = isGoalie(player.position) ? buildGoalieWriteup(player) : buildSkaterWriteup(player);

  // Injury status outranks anything the stat line says: a 1.2 PPG winger on IR
  // is a bench decision tonight regardless of how good the season has been.
  if (player.status === 'IR') {
    return {
      ...writeup,
      tags: [{ label: 'Injured reserve', tone: 'caution' }, ...writeup.tags],
      summary: `Currently on injured reserve. ${writeup.summary}`,
    };
  }
  if (player.status === 'GTD') {
    return {
      ...writeup,
      tags: [{ label: 'Game-time decision', tone: 'caution' }, ...writeup.tags],
      summary: `Listed as a game-time decision — check status before puck drop. ${writeup.summary}`,
    };
  }
  if (player.status === 'SUSP') {
    return {
      ...writeup,
      tags: [{ label: 'Suspended', tone: 'caution' }, ...writeup.tags],
      summary: `Currently suspended and unavailable. ${writeup.summary}`,
    };
  }

  return writeup;
}
