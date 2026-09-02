/**
 * Pure helpers behind `Mug` — kept out of Mug.tsx because a module that
 * exports a component AND plain values breaks react-refresh (see the note
 * in positionChip.ts), and because the row tests want to assert on them
 * without rendering.
 */

/**
 * The minimum a row knows about a player that is enough to draw a face:
 * a name (initials), a headshot URL, and a team (crest). Structural on
 * purpose — `HockeyPlayer` (roster) and `MatchupPlayer` (matchup) both
 * satisfy it without a mapping step.
 */
export interface MugPlayer {
  name: string;
  image?: string | null;
  team?: string | null;
  teamAbbreviation?: string | null;
}

/**
 * The player-directory shape (`Player` in PlayerService: `full_name`,
 * `headshot_url`) → the face's minimum. The Free Agents, Players and draft
 * lists all carry this shape; one adapter so none of them grows a private
 * <img> with its own fallback again (2026-09-01 — Free Agents had one that
 * hid itself on error, reflowing the row and showing no face at all).
 */
export function mugFromDirectory(p: {
  full_name: string;
  headshot_url?: string | null;
  team?: string | null;
}): MugPlayer {
  return { name: p.full_name, image: p.headshot_url ?? null, team: p.team ?? null };
}

export function teamCrestUrl(abbr: string): string {
  return `https://assets.nhle.com/logos/nhl/svg/${abbr}_light.svg`;
}

/**
 * The team abbreviation a crest URL can be built from, or null. Only a
 * 2–4 letter code qualifies: the roster's `team` is sometimes a full name
 * ("Toronto Maple Leafs"), and guessing three letters from it produces a
 * URL that 404s — a request wasted on the way to the same initials.
 */
export function mugTeamAbbrev(p: MugPlayer): string | null {
  const raw = (p.teamAbbreviation || p.team || '').trim().toUpperCase();
  return /^[A-Z]{2,4}$/.test(raw) ? raw : null;
}

/** "Connor McDavid" → "CM"; a single word gives one letter; empty stays empty. */
export function mugInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}
