// Entry 41 P0 test lock (architect-authored during terminal takeover,
// AUTHORED-UNRUN until the terminal's first vitest pass — adjust harness
// details to house conventions if needed, keep the four assertions).
//
// Locks the redirect-preservation contract the twelve's onboarding
// depends on: the auth wall must carry pathname + query through to
// /auth?redirect=..., and Auth.tsx must keep its startsWith('/')
// open-redirect guard (the fix's safety depends on it).
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';

const mockUseAuth = vi.fn();
const mockUseProfile = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));
vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => mockUseProfile(),
}));
vi.mock('@/components/citrus2', () => ({
  StormyLoading: ({ message }: { message?: string }) => <div data-testid="stormy-loading">{message}</div>,
}));

import { ProtectedRoute } from '../ProtectedRoute';

function AuthProbe() {
  const location = useLocation();
  return <div data-testid="auth-probe">{location.search}</div>;
}

function renderAt(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/create-league"
          element={
            <ProtectedRoute>
              <div data-testid="protected-child">PROTECTED</div>
            </ProtectedRoute>
          }
        />
        <Route path="/auth" element={<AuthProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ProtectedRoute — Entry 41 P0 redirect preservation', () => {
  it('unauthenticated: preserves path + query as encoded ?redirect=', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });
    mockUseProfile.mockReturnValue({ data: null, isPending: false, isError: false, refetch: vi.fn() });

    renderAt('/create-league?code=ABC123');

    const probe = screen.getByTestId('auth-probe');
    expect(probe.textContent).toBe(
      `?redirect=${encodeURIComponent('/create-league?code=ABC123')}`
    );
  });

  it('the encoded redirect round-trips to the original path + query', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });
    mockUseProfile.mockReturnValue({ data: null, isPending: false, isError: false, refetch: vi.fn() });

    renderAt('/create-league?code=ABC123');

    const search = screen.getByTestId('auth-probe').textContent ?? '';
    const param = new URLSearchParams(search).get('redirect');
    expect(param).toBe('/create-league?code=ABC123');
    expect(param!.startsWith('/')).toBe(true);
  });

  it('authenticated: renders children (no redirect)', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1' }, loading: false });
    mockUseProfile.mockReturnValue({ data: { username: 'garrett' }, isPending: false, isError: false, refetch: vi.fn() });

    renderAt('/create-league?code=ABC123');

    expect(screen.getByTestId('protected-child')).toBeTruthy();
    expect(screen.queryByTestId('auth-probe')).toBeNull();
  });

  it("Auth.tsx keeps the startsWith('/') open-redirect guard this fix depends on", () => {
    const authSource = fs.readFileSync(
      path.resolve(__dirname, '../../pages/Auth.tsx'),
      'utf-8'
    );
    const guardCount = (authSource.match(/redirect\.startsWith\('\/'\)/g) ?? []).length;
    expect(guardCount).toBeGreaterThanOrEqual(2); // sign-in + sign-up paths
  });
});
