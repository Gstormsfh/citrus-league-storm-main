/**
 * The Game Day hub.
 *
 * One screen, one job: get a thumb onto a game in one tap. It shows the
 * player's running cross-game total when there is one, and says nothing
 * about accounts when there is not — the suite is anonymous-play-first, and
 * a sign-in prompt on the entry screen would undo that.
 *
 * Games that have not shipped yet are listed and visibly inert rather than
 * hidden, so the shape of the suite is legible from day one.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGameDayTheme } from '@/hooks/useGameDayTheme';
import { themeCopy } from '@/lib/gameDay/theme';
import { fetchGameDayTotals } from '@/lib/gameDay/session';

interface Entry {
  key: string;
  title: string;
  blurb: string;
  to?: string;
}

const ENTRIES: Entry[] = [
  {
    key: 'daily_player',
    title: 'Daily Player',
    blurb: 'Six guesses. One skater.',
    to: '/game-day/daily-player',
  },
  { key: 'higher_or_lower', title: 'Higher or Lower', blurb: 'Two players, one stat, endless.' },
  { key: 'constraint_grid', title: 'The Grid', blurb: 'Nine squares. Rarer is better.' },
  { key: 'find_the_hole', title: 'Find the Hole', blurb: 'Deduce the beatable zone.' },
];

export default function GameDay() {
  const { theme } = useGameDayTheme();
  const [totalPoints, setTotalPoints] = useState<number | null>(null);

  useEffect(() => {
    // Reads the ledger only if a session already exists. It never creates
    // one: opening the hub must not mint an auth row for a passer-by.
    fetchGameDayTotals().then(({ totalPoints: total, gamesPlayed }) => {
      if (gamesPlayed > 0) setTotalPoints(total);
    });
  }, []);

  return (
    <main
      style={{
        minHeight: '100dvh',
        background: 'var(--gameday-surface)',
        color: 'var(--gameday-text)',
        padding: '24px 16px 48px',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <p style={kicker}>{theme.brand.wordmark ?? 'Citrus Game Day'}</p>
        <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.03em', margin: '8px 0 4px' }}>
          {themeCopy(theme, 'shared', 'suite_title', 'Game Day')}
        </h1>
        <p style={{ color: 'var(--gameday-text-muted)', marginBottom: 24 }}>
          {themeCopy(theme, 'shared', 'suite_tagline', 'A new one every morning.')}
        </p>

        {totalPoints !== null && (
          <p style={{ ...kicker, marginBottom: 16, color: 'var(--gameday-success-soft)' }}>
            {totalPoints.toLocaleString()} points
          </p>
        )}

        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
          {ENTRIES.map((entry) => {
            const body = (
              <>
                <span style={{ fontSize: 17, fontWeight: 700 }}>{entry.title}</span>
                <span style={{ color: 'var(--gameday-text-muted)', fontSize: 13 }}>
                  {entry.to ? entry.blurb : `${entry.blurb} · soon`}
                </span>
              </>
            );
            return (
              <li key={entry.key}>
                {entry.to ? (
                  <Link to={entry.to} style={{ ...card, textDecoration: 'none' }}>
                    {body}
                  </Link>
                ) : (
                  <div style={{ ...card, opacity: 0.45 }} aria-disabled>
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
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

const card: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minHeight: 64,
  justifyContent: 'center',
  padding: '12px 16px',
  borderRadius: 16,
  background: 'var(--gameday-surface-tile)',
  border: '1px solid var(--gameday-border)',
  color: 'var(--gameday-text)',
};
