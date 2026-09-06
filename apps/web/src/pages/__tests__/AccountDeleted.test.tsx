import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AccountDeleted from '../AccountDeleted';

vi.mock('@/lib/openExternal', () => ({ interceptExternal: vi.fn() }));
const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ signOut }) }));

beforeEach(() => { signOut.mockReset().mockResolvedValue(undefined); });

function confirmedPage() {
  return render(<StrictMode><MemoryRouter initialEntries={[{ pathname: '/account-deleted', state: { deleted: true } }]}><AccountDeleted /></MemoryRouter></StrictMode>);
}

describe('deletion follow-up', () => {
  it('shows Apple guidance without requiring a signed-in account', async () => {
    confirmedPage();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('has been deleted');
    expect(screen.getByRole('link', { name: /Apple’s instructions/ }).getAttribute('href')).toBe('https://support.apple.com/102571');
    await screen.findByText('You are signed out of Citrus.');
    expect(signOut).toHaveBeenCalledTimes(1);
  });
  it('does not claim deletion on an arbitrary direct visit', () => {
    render(<MemoryRouter><AccountDeleted /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('After deleting your Citrus account');
    expect(signOut).not.toHaveBeenCalled();
  });
  it('keeps confirmation visible while local sign-out is still pending', async () => {
    let finish!: () => void;
    signOut.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    confirmedPage();
    expect(screen.getByText('Finishing sign-out on this device…')).toBeTruthy();
    expect(screen.queryByText('You are signed out of Citrus.')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('has been deleted');
    await act(async () => { finish(); });
    expect(screen.getByText('You are signed out of Citrus.')).toBeTruthy();
  });
  it('offers a cleanup retry without falsely reporting deletion failure', async () => {
    signOut.mockRejectedValueOnce(new Error('Local cleanup failed'));
    confirmedPage();
    const retry = await screen.findByRole('button', { name: 'Retry sign-out' });
    expect(screen.queryByText('You are signed out of Citrus.')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('has been deleted');
    fireEvent.click(retry);
    await screen.findByText('You are signed out of Citrus.');
    expect(signOut).toHaveBeenCalledTimes(2);
  });
});
