// Owner avatars on the ScoreCard discs (2026-09-01, Sleeper parity audit
// M8). Companion to ScoreCard.ownTeam.test.tsx, which pins the initials
// when there is no picture. The disc shows the OWNER's profile picture
// when the league/teams response carries one and falls back to the team
// initial — on load failure too, never a broken image.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../WinProbabilityBar', () => ({
  WinProbabilityBar: () => null,
}));

import { ScoreCard } from '../ScoreCard';

const baseProps = {
  myTeamName: 'Storm',
  myTeamRecord: { wins: 5, losses: 2 },
  opponentTeamName: 'Kiwis',
  opponentTeamRecord: { wins: 4, losses: 3 },
  myTeamPoints: '100.0',
  opponentTeamPoints: '80.0',
};

const discs = () => screen.getAllByTestId('team-disc');

describe('ScoreCard — owner avatars on the discs', () => {
  it('without avatars every disc (mobile + desktop, both sides) is an initial', () => {
    render(<ScoreCard {...baseProps} isOwnTeam />);
    expect(discs()).toHaveLength(4);
    for (const d of discs()) expect(d).toHaveAttribute('data-disc-state', 'initials');
    expect(screen.getAllByText('S')).toHaveLength(2);
    expect(screen.getAllByText('K')).toHaveLength(2);
  });

  it('with avatars the discs show the picture (both layouts) and the initials go away', () => {
    render(<ScoreCard {...baseProps} isOwnTeam myTeamAvatarUrl="https://cdn/s.png" opponentTeamAvatarUrl="https://cdn/k.png" />);
    const imgs = discs().map((d) => d.querySelector('img'));
    expect(imgs.every(Boolean)).toBe(true);
    expect(imgs.filter((i) => i!.getAttribute('src') === 'https://cdn/s.png')).toHaveLength(2);
    expect(imgs.filter((i) => i!.getAttribute('src') === 'https://cdn/k.png')).toHaveLength(2);
    expect(screen.queryAllByText('S')).toHaveLength(0);
    expect(screen.queryAllByText('K')).toHaveLength(0);
    // Team names still stand beside the discs; the image is decorative.
    for (const i of imgs) expect(i).toHaveAttribute('alt', '');
  });

  it('the own-side disc keeps the orange identity shell with a picture in it', () => {
    render(<ScoreCard {...baseProps} isOwnTeam myTeamAvatarUrl="https://cdn/s.png" opponentTeamAvatarUrl="https://cdn/k.png" />);
    const own = discs().filter((d) => d.querySelector('img')?.getAttribute('src') === 'https://cdn/s.png');
    const theirs = discs().filter((d) => d.querySelector('img')?.getAttribute('src') === 'https://cdn/k.png');
    for (const d of own) expect(d.className).toMatch(/ring-pastel-orange/);
    for (const d of theirs) expect(d.className).not.toMatch(/orange/);
  });

  it('a picture that fails to load is replaced by the initial', () => {
    render(<ScoreCard {...baseProps} myTeamAvatarUrl="https://cdn/gone.png" />);
    const broken = discs().filter((d) => d.querySelector('img'));
    expect(broken).toHaveLength(2);
    for (const d of broken) fireEvent.error(d.querySelector('img')!);
    expect(screen.getAllByText('S')).toHaveLength(2);
    expect(discs().every((d) => d.querySelector('img') === null)).toBe(true);
  });

  it('the score contract survives beside the picture (count, tabular-nums, sage leader)', () => {
    render(<ScoreCard {...baseProps} myTeamAvatarUrl="https://cdn/s.png" />);
    expect(screen.getAllByText('100.0')).toHaveLength(2);
    for (const node of screen.getAllByText('100.0')) {
      expect(node.className).toMatch(/tabular-nums/);
      expect(node.className).toMatch(/text-pastel-sage/);
    }
  });
});
