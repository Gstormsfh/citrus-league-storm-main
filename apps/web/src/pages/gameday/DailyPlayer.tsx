/**
 * Game 1 — the daily player guess.
 *
 * Six attempts at one skater, per-attribute feedback, a spoiler-free share
 * grid. Playable in under sixty seconds, no tutorial, and no login before
 * the first play: the anonymous session is created when a run FINISHES, not
 * when the page opens.
 *
 * Everything on screen comes from the emitted artifact. This component holds
 * no puzzle logic — grading is `gradeDailyPlayerGuess` in @citrus/shared, the
 * same function the generator's tests pin — and it makes exactly one network
 * request to play: a cached GET of a static JSON file from a CDN edge.
 *
 * COLOURS COME FROM THE THEME RECORD, as `--gameday-*` custom properties. No
 * hex literal belongs in this file.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DAILY_PLAYER_ATTRIBUTE_ORDER,
  dailyPlayerShareText,
  decodeGameDayAnswer,
  gradeDailyPlayerGuess,
  type DailyPlayerAnswer,
  type DailyPlayerGuessFeedback,
  type DailyPlayerPayload,
  type GameDayArtifact,
  type GameDayVerdict,
} from '@citrus/shared';
import { logger } from '@/utils/logger';
import { gameDayDb } from '@/lib/gameDay/db';
import { useGameDayTheme } from '@/hooks/useGameDayTheme';
import { themeCopy } from '@/lib/gameDay/theme';
import { GameDayArtifactMissing, loadGameDayArtifact } from '@/lib/gameDay/artifacts';
import { loadRun, pruneOldRuns, saveRun } from '@/lib/gameDay/progress';
import { ensureGameDaySession } from '@/lib/gameDay/session';

type Artifact = GameDayArtifact<'daily_player', DailyPlayerPayload>;

const ATTRIBUTE_LABELS: Record<(typeof DAILY_PLAYER_ATTRIBUTE_ORDER)[number], string> = {
  team: 'Team',
  position: 'Pos',
  hand: 'Hand',
  draft_year: 'Draft',
  point_band: 'Points',
};

/** Accent-insensitive, so "stutzle" finds "Stützle" on a phone keyboard. */
function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function verdictColour(verdict: GameDayVerdict): string {
  switch (verdict) {
    case 'exact':
      return 'var(--gameday-success)';
    case 'close':
      return 'var(--gameday-near)';
    case 'unknown':
      return 'var(--gameday-border)';
    default:
      return 'var(--gameday-surface-tile)';
  }
}

function directionArrow(direction: 'higher' | 'lower' | null): string {
  if (direction === 'higher') return ' ↑';
  if (direction === 'lower') return ' ↓';
  return '';
}

export default function DailyPlayer() {
  const { theme } = useGameDayTheme();

  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [isFallbackDate, setIsFallbackDate] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [guesses, setGuesses] = useState<number[]>([]);
  const [finished, setFinished] = useState(false);
  const [won, setWon] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [awarded, setAwarded] = useState<number | null>(null);

  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Load the puzzle ────────────────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();
    loadGameDayArtifact<DailyPlayerPayload>('daily_player', { signal: controller.signal })
      .then(({ artifact: loaded, isFallback }) => {
        setArtifact(loaded as Artifact);
        setIsFallbackDate(isFallback);
        pruneOldRuns(loaded.puzzle_date);

        const stored = loadRun(loaded.puzzle_id);
        if (stored) {
          setGuesses(stored.guesses);
          setFinished(stored.finished);
          setWon(stored.won);
          setSubmitted(stored.submitted);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        logger.error('Game Day: could not load the daily player puzzle', err);
        setLoadError(
          err instanceof GameDayArtifactMissing
            ? "Today's puzzle is still warming up. Try again in a few minutes."
            : 'We could not reach the puzzle. Check your connection and retry.',
        );
      });
    return () => controller.abort();
  }, []);

  const payload = artifact?.payload;
  const roster = payload?.roster;
  const dictionary = payload?.dictionary;
  const maxAttempts = payload?.max_attempts ?? 6;

  const answer = useMemo<DailyPlayerAnswer | null>(() => {
    if (!artifact || !payload) return null;
    try {
      return decodeGameDayAnswer<DailyPlayerAnswer>(payload.answer, artifact.puzzle_id);
    } catch (err) {
      logger.error('Game Day: the answer would not decode', err);
      return null;
    }
  }, [artifact, payload]);

  const feedback = useMemo<DailyPlayerGuessFeedback[]>(() => {
    if (!roster || !dictionary || !answer) return [];
    return guesses.map((index) => gradeDailyPlayerGuess(index, roster, answer, dictionary));
  }, [guesses, roster, dictionary, answer]);

  // ── Search over the roster ─────────────────────────────────────────────
  const searchIndex = useMemo(() => {
    if (!roster) return [] as { index: number; needle: string }[];
    return roster.n.map((name, index) => ({ index, needle: normalise(name) }));
  }, [roster]);

  const suggestions = useMemo(() => {
    if (!roster || query.trim().length < 2) return [];
    const needle = normalise(query.trim());
    const already = new Set(guesses);
    const starts: number[] = [];
    const contains: number[] = [];
    for (const entry of searchIndex) {
      if (already.has(entry.index)) continue;
      const at = entry.needle.indexOf(needle);
      if (at === 0) starts.push(entry.index);
      else if (at > 0) contains.push(entry.index);
      if (starts.length >= 8) break;
    }
    // Prefix matches first: typing "mcd" should offer McDavid before anyone
    // with "mcd" buried mid-name.
    return [...starts, ...contains].slice(0, 8);
  }, [query, searchIndex, roster, guesses]);

  // ── Submitting a finished run ──────────────────────────────────────────
  const submitRun = useCallback(
    async (finalGuesses: number[], didWin: boolean) => {
      if (!artifact || !roster) return;
      // Only a completed run is worth an identity. This is the first moment
      // the suite creates an anonymous user, and it never happens on load.
      const userId = await ensureGameDaySession();
      if (!userId) return;

      const playerIds = finalGuesses.map((index) => roster.id[index]);
      const { data, error } = await gameDayDb().rpc('game_day_submit_daily_player', {
        p_puzzle_date: artifact.puzzle_date,
        p_guesses: playerIds,
      });

      if (error) {
        // A failed submit costs the player their points, not their game. The
        // run stays on screen and shareable; only the ledger row is missing.
        logger.error('Game Day: submitting the run failed', error);
        return;
      }

      // The function returns a single-row table, so `data` is an array.
      const row = data?.[0];
      setAwarded(row?.points ?? null);
      setSubmitted(true);
      saveRun({
        puzzle_id: artifact.puzzle_id,
        guesses: finalGuesses,
        finished: true,
        won: didWin,
        submitted: true,
      });
    },
    [artifact, roster],
  );

  const commitGuess = useCallback(
    (rosterIndex: number) => {
      if (!artifact || !roster || !answer || finished) return;
      if (guesses.includes(rosterIndex)) return;

      const next = [...guesses, rosterIndex];
      const didWin = roster.id[rosterIndex] === answer.player_id;
      const isOver = didWin || next.length >= maxAttempts;

      setGuesses(next);
      setQuery('');
      setHighlight(0);
      setFinished(isOver);
      setWon(didWin);

      saveRun({
        puzzle_id: artifact.puzzle_id,
        guesses: next,
        finished: isOver,
        won: didWin,
        submitted: false,
      });

      if (isOver) void submitRun(next, didWin);
    },
    [artifact, roster, answer, finished, guesses, maxAttempts, submitRun],
  );

  const onShare = useCallback(async () => {
    if (!artifact) return;
    const text = dailyPlayerShareText(
      artifact.puzzle_date,
      feedback,
      maxAttempts,
      won,
      theme.brand.wordmark ?? 'Citrus Game Day',
    );
    try {
      if (navigator.share) await navigator.share({ text });
      else await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // A cancelled share sheet is not an error worth showing anyone.
    }
  }, [artifact, feedback, maxAttempts, won, theme.brand.wordmark]);

  // ── Render ─────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <Shell wordmark={theme.brand.wordmark}>
        <p style={{ color: 'var(--gameday-text-muted)', textAlign: 'center', padding: '32px 0' }}>
          {loadError}
        </p>
      </Shell>
    );
  }

  if (!artifact || !roster || !dictionary || !answer) {
    return (
      <Shell wordmark={theme.brand.wordmark}>
        <div
          aria-label="Loading today's puzzle"
          role="status"
          style={{
            height: 220,
            borderRadius: 16,
            background: 'var(--gameday-surface-tile)',
            animation: 'citrus-shimmer 1.6s ease-in-out infinite',
          }}
        />
      </Shell>
    );
  }

  const attemptsLeft = maxAttempts - guesses.length;

  return (
    <Shell wordmark={theme.brand.wordmark}>
      <header style={{ marginBottom: 20 }}>
        <p style={kicker}>{artifact.puzzle_date}{isFallbackDate ? " · yesterday's" : ''}</p>
        <h1 style={title}>{themeCopy(theme, 'daily_player', 'title', 'Daily Player')}</h1>
        <p style={{ ...muted, marginTop: 4 }}>
          {themeCopy(theme, 'daily_player', 'tagline', 'Six guesses. One skater.')}
          {' · NHL skaters only'}
        </p>
      </header>

      {!finished && (
        <div style={{ position: 'relative', marginBottom: 16 }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlight((h) => Math.max(h - 1, 0));
              } else if (e.key === 'Enter' && suggestions[highlight] !== undefined) {
                e.preventDefault();
                commitGuess(suggestions[highlight]);
              }
            }}
            placeholder={`Name a skater · ${attemptsLeft} left`}
            aria-label="Guess a player"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            style={input}
          />
          {suggestions.length > 0 && (
            <ul style={dropdown} role="listbox">
              {suggestions.map((index, position) => (
                <li key={roster.id[index]}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={position === highlight}
                    onMouseEnter={() => setHighlight(position)}
                    onClick={() => commitGuess(index)}
                    style={{
                      ...suggestionRow,
                      background:
                        position === highlight ? 'var(--gameday-border)' : 'transparent',
                    }}
                  >
                    <span>{roster.n[index]}</span>
                    <span style={{ ...muted, fontSize: 12 }}>
                      {roster.t[index] >= 0 ? dictionary.teams[roster.t[index]].code : '?'}
                      {' · '}
                      {dictionary.positions[roster.p[index]]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ ...columnHeader }}>
          <span />
          {DAILY_PLAYER_ATTRIBUTE_ORDER.map((attribute) => (
            <span key={attribute} style={{ ...kicker, textAlign: 'center' }}>
              {ATTRIBUTE_LABELS[attribute]}
            </span>
          ))}
        </div>

        {feedback.map((row, i) => {
          const rosterIndex = guesses[i];
          return (
            <div key={row.player_id} style={guessRow}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{row.name}</span>
              {DAILY_PLAYER_ATTRIBUTE_ORDER.map((attribute) => {
                const cell = row[attribute];
                const value =
                  attribute === 'team'
                    ? roster.t[rosterIndex] >= 0
                      ? dictionary.teams[roster.t[rosterIndex]].code
                      : '?'
                    : attribute === 'position'
                      ? dictionary.positions[roster.p[rosterIndex]]
                      : attribute === 'hand'
                        ? roster.h[rosterIndex] >= 0
                          ? dictionary.hands[roster.h[rosterIndex]]
                          : '?'
                        : attribute === 'draft_year'
                          ? roster.d[rosterIndex] || '?'
                          : dictionary.point_bands[roster.b[rosterIndex]];
                return (
                  <span
                    key={attribute}
                    style={{ ...cellStyle, background: verdictColour(cell.verdict) }}
                  >
                    {value}
                    {directionArrow(cell.direction)}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>

      {finished && (
        <section style={resultCard}>
          <p style={{ ...kicker, color: 'var(--gameday-accent-soft)' }}>
            {won
              ? themeCopy(theme, 'daily_player', 'win', 'Got him.')
              : themeCopy(theme, 'daily_player', 'loss', 'Tomorrow, then.')}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '10px 0 14px' }}>
            {answer.headshot_url && (
              <img
                src={answer.headshot_url}
                alt=""
                width={56}
                height={56}
                style={{ borderRadius: 12, background: 'var(--gameday-surface-tile)' }}
              />
            )}
            <div>
              <p style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.03em' }}>
                {answer.name}
              </p>
              <p style={{ ...muted, fontSize: 13 }}>
                {answer.team >= 0 ? dictionary.teams[answer.team].code : 'No club'}
                {' · '}
                {dictionary.positions[answer.position]}
                {' · '}
                {answer.points} pts in {answer.games_played} GP ({dictionary.attribute_season}
                {'-'}
                {String(dictionary.attribute_season + 1).slice(2)})
              </p>
            </div>
          </div>

          {awarded !== null && (
            <p style={{ ...muted, fontSize: 13, marginBottom: 10 }}>
              +{awarded} points{submitted ? '' : ' (pending)'}
            </p>
          )}

          <button type="button" onClick={onShare} style={primaryButton}>
            {copied ? 'Copied' : 'Share result'}
          </button>
          <Link to="/game-day" style={{ ...muted, fontSize: 13, display: 'block', marginTop: 12 }}>
            Back to Game Day
          </Link>
        </section>
      )}
    </Shell>
  );
}

// ── Presentation ─────────────────────────────────────────────────────────
// Every colour is a `--gameday-*` custom property set from the theme record.

function Shell({ children, wordmark }: { children: React.ReactNode; wordmark?: string }) {
  return (
    <main
      style={{
        minHeight: '100dvh',
        background: 'var(--gameday-surface)',
        color: 'var(--gameday-text)',
        padding: '20px 16px 48px',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <Link to="/game-day" style={{ ...kicker, textDecoration: 'none', display: 'block' }}>
          {wordmark ?? 'Citrus Game Day'}
        </Link>
        {children}
      </div>
    </main>
  );
}

const kicker: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--gameday-text-muted)',
  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
};

const title: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 800,
  letterSpacing: '-0.03em',
  margin: '6px 0 0',
};

const muted: React.CSSProperties = { color: 'var(--gameday-text-muted)' };

const input: React.CSSProperties = {
  width: '100%',
  minHeight: 48,
  padding: '0 14px',
  borderRadius: 12,
  border: '1px solid var(--gameday-border)',
  background: 'var(--gameday-surface-tile)',
  color: 'var(--gameday-text)',
  fontSize: 16, // 16px or iOS zooms the viewport on focus
};

const dropdown: React.CSSProperties = {
  position: 'absolute',
  zIndex: 20,
  top: 52,
  left: 0,
  right: 0,
  margin: 0,
  padding: 4,
  listStyle: 'none',
  borderRadius: 12,
  border: '1px solid var(--gameday-border)',
  background: 'var(--gameday-surface-tile)',
};

const suggestionRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  minHeight: 44,
  padding: '0 10px',
  border: 'none',
  borderRadius: 8,
  color: 'var(--gameday-text)',
  fontSize: 15,
  textAlign: 'left',
  cursor: 'pointer',
};

const gridColumns = '1.4fr repeat(5, 1fr)';

const columnHeader: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: gridColumns,
  gap: 4,
  alignItems: 'center',
};

const guessRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: gridColumns,
  gap: 4,
  alignItems: 'center',
  minHeight: 44,
};

const cellStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 40,
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'center',
};

const resultCard: React.CSSProperties = {
  marginTop: 24,
  padding: 16,
  borderRadius: 16,
  background: 'var(--gameday-surface-tile)',
  border: '1px solid var(--gameday-border)',
};

const primaryButton: React.CSSProperties = {
  width: '100%',
  minHeight: 48,
  border: 'none',
  borderRadius: 12,
  background: 'var(--gameday-accent)',
  color: 'var(--gameday-on-accent)',
  fontSize: 16,
  fontWeight: 700,
  cursor: 'pointer',
};
