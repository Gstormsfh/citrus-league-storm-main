import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import AccountDeleted from '../AccountDeleted';

vi.mock('@/lib/openExternal', () => ({ interceptExternal: vi.fn() }));

describe('deletion follow-up', () => {
  it('shows Apple guidance without requiring a signed-in account', () => {
    render(<MemoryRouter initialEntries={[{ pathname: '/account-deleted', state: { deleted: true } }]}><AccountDeleted /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('has been deleted');
    expect(screen.getByRole('link', { name: /Apple’s instructions/ }).getAttribute('href')).toBe('https://support.apple.com/102571');
  });
  it('does not claim deletion on an arbitrary direct visit', () => {
    render(<MemoryRouter><AccountDeleted /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('After deleting your Citrus account');
  });
});
