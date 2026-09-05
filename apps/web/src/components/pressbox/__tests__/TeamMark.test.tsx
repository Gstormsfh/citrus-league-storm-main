/**
 * The team's mark on a Scores row (2026-09-05). See TeamMark.tsx.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PressBoxTeamMark } from '../TeamMark';
import { teamCrestUrl } from '@/components/roster/headshot';

describe('PressBoxTeamMark', () => {
  it('draws the NHL crest for a dark ground, named for assistive tech', () => {
    render(<PressBoxTeamMark abbrev="tor" label="Toronto Maple Leafs" />);
    const mark = screen.getByRole('img', { name: 'Toronto Maple Leafs' });
    expect(mark.getAttribute('data-mark-state')).toBe('crest');
    const img = mark.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(teamCrestUrl('TOR'));
    expect(img.getAttribute('src')).toContain('_dark.svg');
    expect(img.getAttribute('loading')).toBe('lazy');
  });

  it('a crest that fails is replaced by the abbreviation on a tile -- no circle, no broken glyph', () => {
    render(<PressBoxTeamMark abbrev="EDM" />);
    const mark = screen.getByRole('img', { name: 'EDM' });
    fireEvent.error(mark.querySelector('img') as HTMLImageElement);
    expect(mark.querySelector('img')).toBeNull();
    expect(mark.getAttribute('data-mark-state')).toBe('text');
    expect(mark.textContent).toBe('EDM');
    expect(mark.querySelector('.rounded-full')).toBeNull();
  });

  it('a code that is not a team abbreviation goes straight to text', () => {
    render(<PressBoxTeamMark abbrev="Toronto" />);
    const mark = screen.getByRole('img', { name: 'TORONTO' });
    expect(mark.getAttribute('data-mark-state')).toBe('text');
    expect(mark.textContent).toBe('TOR');
  });
});
