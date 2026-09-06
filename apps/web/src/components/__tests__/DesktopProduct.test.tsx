import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
const mocks = vi.hoisted(() => ({ native: vi.fn(), mobile: vi.fn() }));
vi.mock('@/lib/nativeAuth', () => ({ isNativeShell: mocks.native }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: mocks.mobile }));
import { DesktopProduct } from '../DesktopProduct';
beforeEach(() => { mocks.native.mockReturnValue(false); mocks.mobile.mockReturnValue(false); });
describe('desktop product exclusion', () => {
  it.each([[true, false], [false, true], [true, true]])('does not mount product content for native=%s mobile=%s', (native, mobile) => {
    mocks.native.mockReturnValue(native); mocks.mobile.mockReturnValue(mobile);
    const product = vi.fn(() => <p>Restricted product</p>);
    const Product = product;
    render(<MemoryRouter initialEntries={['/draft-kit?tab=pricing']}><Routes>
      <Route path="/draft-kit" element={<DesktopProduct route><Product /></DesktopProduct>} />
      <Route path="/" element={<p>League home</p>} />
    </Routes></MemoryRouter>);
    expect(screen.getByText('League home')).toBeInTheDocument();
    expect(product).not.toHaveBeenCalled();
  });
  it('retains the desktop web preview', () => {
    render(<DesktopProduct><p>Desktop preview</p></DesktopProduct>);
    expect(screen.getByText('Desktop preview')).toBeInTheDocument();
  });
  it('omits mobile navigation entries', () => {
    mocks.native.mockReturnValue(true);
    render(<DesktopProduct><a href="/draft-kit">Draft Kit</a></DesktopProduct>);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
