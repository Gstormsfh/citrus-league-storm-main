import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { LeagueHistory, Trophy, UnclaimedMember } from '@/api/imports';
import { TrophyRoom } from '../TrophyRoom';
import { ClaimCard } from '../ClaimCard';

const trophy = (over: Partial<Trophy>): Trophy => ({
  id: Math.random().toString(36).slice(2), season: null, member_id: 'A', trophy_key: 'champion', rank: null, value: null, detail: {}, source: 'imported', display_name: null, icon_key: null, is_hidden: false, ...over,
});

const history: LeagueHistory = {
  league: { id: 'l', name: 'The Puck Stops Here', founded_season: 2019, imported_from: 'espn', history_locked: false },
  seasons: [
    { season: 2019, platform: 'espn', team_count: 4, champion: 'Alice', runner_up: 'Bob', regular_season_winner: 'Alice' },
    { season: 2020, platform: 'espn', team_count: 4, champion: 'Bob', runner_up: 'Alice', regular_season_winner: 'Alice' },
  ],
  standings: [
    { season: 2020, member_id: 'B', team_name: 'Bench Bosses', rank: 1, wins: 12, losses: 8, ties: 0, points_for: 1000, points_against: 900, made_playoffs: true, playoff_finish: 1, playoff_seed: 2, category_record: null },
    { season: 2020, member_id: 'A', team_name: 'Dangle Dynasty', rank: 2, wins: 14, losses: 6, ties: 0, points_for: 1100, points_against: 800, made_playoffs: true, playoff_finish: 2, playoff_seed: 1, category_record: null },
    { season: 2019, member_id: 'A', team_name: 'Dangle Dynasty', rank: 1, wins: 15, losses: 5, ties: 0, points_for: 1200, points_against: 800, made_playoffs: true, playoff_finish: 1, playoff_seed: 1, category_record: null },
  ],
  members: [
    { member_id: 'A', display_name: 'Alice', owner_id: 'user-alice', first_season: 2019, last_season: 2020, seasons_played: 2, titles: 1, finals_lost: 1, playoff_seasons: 2, best_finish: 1, career_wins: 29, career_losses: 11, career_ties: 0 },
    { member_id: 'B', display_name: 'Bob', owner_id: null, first_season: 2019, last_season: 2020, seasons_played: 2, titles: 1, finals_lost: 1, playoff_seasons: 2, best_finish: 1, career_wins: 20, career_losses: 20, career_ties: 0 },
  ],
  trophies: [
    trophy({ trophy_key: 'champion', season: 2019, member_id: 'A', rank: 1, detail: { team_name: 'Dangle Dynasty', verified_by_bracket: true } }),
    trophy({ trophy_key: 'champion', season: 2020, member_id: 'B', rank: 1, detail: { team_name: 'Bench Bosses', verified_by_bracket: false } }),
    trophy({ trophy_key: 'highest_week', member_id: 'A', value: 187.5, source: 'computed', detail: { season: 2019, week: 3, opponent_member_id: 'B' } }),
    trophy({ trophy_key: 'founding_member', member_id: 'A', value: 2019, source: 'computed' }),
    trophy({ trophy_key: 'founding_member', member_id: 'B', value: 2019, source: 'computed' }),
    trophy({ trophy_key: 'championship_drought', member_id: 'A', value: 1, source: 'computed', detail: { last_title: 2019 } }),
    trophy({ trophy_key: 'lowest_week', member_id: 'B', value: 40, source: 'computed', is_hidden: true }),
  ],
  sources: [{ platform: 'espn', externalLeagueId: '777', season: 2020, isPublicSource: true }],
  importedSettings: null,
  unmatchedPlayers: [],
};

describe('TrophyRoom', () => {
  it('lists seasons newest first with the champion, flags a disputed one, and opens the standings', () => {
    render(<TrophyRoom history={history} currentUserId="user-alice" />);
    const seasons = screen.getByTestId('history-seasons');
    expect(seasons.textContent).toMatch(/2020-21.*2019-20/s);
    expect(seasons.textContent).toContain('Bob');
    expect(seasons.textContent).toContain('standings and bracket disagree');
    fireEvent.click(screen.getByRole('button', { name: /2020-21/ }));
    const list = screen.getByRole('list', { name: '2020-21 standings' });
    expect(list.textContent).toContain('Bench Bosses');
    expect(list.textContent).toContain('12-8');
    expect(list.textContent).toContain('Champ');
  });

  it('marks the signed-in manager, the unclaimed one, and says which records Citrus computed', () => {
    render(<TrophyRoom history={history} currentUserId="user-alice" />);
    const managers = screen.getByTestId('history-managers');
    expect(managers.textContent).toContain('You');
    expect(managers.textContent).toContain('Unclaimed');
    expect(managers.textContent).toContain('1 title · 2 seasons · 2 playoff runs');
    const records = screen.getByTestId('history-records');
    expect(records.textContent).toContain('Highest week');
    expect(records.textContent).toContain('Citrus computed');
    expect(records.textContent).toContain('187.5 points vs Bob, 2019-20, week 3');
    expect(records.textContent).not.toContain('Lowest week'); // hidden by the commissioner
  });
});

describe('ClaimCard', () => {
  const members: UnclaimedMember[] = [
    { id: 'B', display_name: 'Bob', first_season: 2019, last_season: 2020, titles: 1, seasons_played: 2, playoff_seasons: 2, best_finish: 1 },
    { id: 'C', display_name: 'Cy', first_season: 2020, last_season: 2020, titles: 0, seasons_played: 1, playoff_seasons: 0, best_finish: 4 },
  ];

  it('renders nothing with nobody to claim', () => {
    const { container } = render(<ClaimCard members={[]} onClaim={async () => undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('a pick enables the claim and the callback gets the member', async () => {
    const onClaim = vi.fn(async () => undefined);
    render(<ClaimCard members={members} onClaim={onClaim} />);
    const button = screen.getByRole('button', { name: 'This is me' });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /Bob/ }));
    expect(screen.getByRole('radio', { name: /Bob/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(button);
    await waitFor(() => expect(onClaim).toHaveBeenCalledWith('B'));
    expect(screen.getByTestId('claim-card').textContent).toContain('2019-20 to 2020-21 · 1 title · 2 seasons · 2 playoff runs');
  });

  it('a refused claim shows the server\'s words and keeps the card open', async () => {
    const onClaim = vi.fn(async () => { throw new Error('That member is already claimed.'); });
    render(<ClaimCard members={members} onClaim={onClaim} />);
    fireEvent.click(screen.getByRole('radio', { name: /Cy/ }));
    fireEvent.click(screen.getByRole('button', { name: 'This is me' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('That member is already claimed.'));
    expect(screen.getByTestId('claim-card')).toBeInTheDocument();
  });
});
