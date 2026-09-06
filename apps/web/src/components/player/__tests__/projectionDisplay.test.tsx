import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PressBoxGameLog, PressBoxStatTiles } from '@/components/pressbox/PlayerCard';

describe('projected game display', () => {
  it('hides points and their range while keeping the raw stat row', () => {
    render(<PressBoxGameLog showPoints={false} showTail={false} pointsHeading="PROJ" tail={{ heading: 'RANGE', width: 64 }} statHeadings={['G', 'A']} rows={[{ key: 'one', date: '10/1', opponent: 'BOS', points: 99, cells: ['0.42', '0.61'], toi: '1–9' }]} />);
    expect(screen.queryByText('PROJ')).toBeNull();
    expect(screen.queryByText('RANGE')).toBeNull();
    expect(screen.queryByText('99.0')).toBeNull();
    expect(screen.getByText('0.42')).toBeTruthy();
  });
  it('opens the total breakdown with an accessible button', () => {
    const open = vi.fn();
    render(<PressBoxStatTiles tiles={[{ key: 'szn', label: 'SZN PROJ', value: '240', onClick: open }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'SZN PROJ breakdown' }));
    expect(open).toHaveBeenCalledTimes(1);
  });
});
