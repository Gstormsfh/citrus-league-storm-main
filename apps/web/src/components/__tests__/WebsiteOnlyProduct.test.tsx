import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
const native = vi.hoisted(() => vi.fn());
vi.mock('@/lib/nativeAuth', () => ({ isNativeShell: native }));
import { WebsiteOnlyProduct } from '../WebsiteOnlyProduct';

describe('website purchase exclusion', () => {
  beforeEach(() => native.mockReturnValue(false));
  it('renders purchase content in a browser without imposing a phone-width gate', () => {
    render(<MemoryRouter><WebsiteOnlyProduct><p>Website purchase</p></WebsiteOnlyProduct></MemoryRouter>);
    expect(screen.getByText('Website purchase')).toBeInTheDocument();
  });
  it('redirects native shells away from purchase content', () => {
    native.mockReturnValue(true);
    render(<MemoryRouter initialEntries={['/draft-kit/buy']}><Routes>
      <Route path="/draft-kit/buy" element={<WebsiteOnlyProduct><p>Website purchase</p></WebsiteOnlyProduct>} />
      <Route path="/" element={<p>Home</p>} />
    </Routes></MemoryRouter>);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.queryByText('Website purchase')).toBeNull();
  });
});
