import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CampaignRedirect } from '../CampaignRedirect';

function Landing() {
  const location = useLocation();
  return <div data-testid="landing">{location.pathname}{location.search}</div>;
}

describe('campaign links served as SPA documents', () => {
  it.each([
    ['/go/sdpn', '/?ref=sdpn'],
    ['/go/SDPN/', '/?ref=sdpn'],
    ['/go/sdpn?utm_medium=podcast', '/?utm_medium=podcast&ref=sdpn'],
    ['/go', '/'],
    ['/go/https%3A%2F%2Fevil.example', '/'],
  ])('resolves %s to the local landing page', (entry, destination) => {
    render(<MemoryRouter initialEntries={[entry]}><Routes>
      <Route path="/go/:handle" element={<CampaignRedirect />} />
      <Route path="/go" element={<CampaignRedirect />} />
      <Route path="/" element={<Landing />} />
    </Routes></MemoryRouter>);
    expect(screen.getByTestId('landing').textContent).toBe(destination);
  });
});
