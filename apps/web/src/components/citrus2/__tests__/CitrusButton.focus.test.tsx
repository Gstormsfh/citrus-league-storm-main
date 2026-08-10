// Entry 25 U3 (2026-08-09) — CitrusButton focus-ring guard.
//
// DESIGN_DIRECTION.md rule 4: "Focus ring: peach family, 2px offset 2,
// never suppressed." This test locks in the class-level expression of
// that rule so a future edit can't silently drop it.
//
// U3 also standardizes transition-duration on the "citrus-normal"
// (200ms) tier for the primary state-change tier — asserted here so a
// wholesale sweep to another duration is caught in CI.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CitrusButton } from '../CitrusButton';

describe('CitrusButton — focus ring (Entry 25 U3)', () => {
  it('emits the peach-deep focus ring per DESIGN_DIRECTION.md rule 4', () => {
    const { container } = render(<CitrusButton>Save</CitrusButton>);
    const btn = container.querySelector('button');
    expect(btn).toBeTruthy();
    const cls = btn!.className;
    expect(cls).toMatch(/focus-visible:outline-none/);
    expect(cls).toMatch(/focus-visible:ring-2/);
    expect(cls).toMatch(/focus-visible:ring-pastel-peach-deep/);
    expect(cls).toMatch(/focus-visible:ring-offset-2/);
    // Offset color pins to citrus2 page bg so the ring never fades into
    // a surrounding surface — see DESIGN_DIRECTION.md tokens table.
    expect(cls).toMatch(/focus-visible:ring-offset-pastel-surface/);
  });

  it('uses the "citrus-normal" (200ms) duration tier per U3 tokens', () => {
    const { container } = render(<CitrusButton>Save</CitrusButton>);
    const btn = container.querySelector('button');
    expect(btn!.className).toMatch(/duration-citrus-normal/);
    expect(btn!.className).toMatch(/transition-all/);
  });

  it('preserves the focus ring on the Link variant (react-router)', () => {
    const { container } = render(
      <MemoryRouter>
        <CitrusButton to="/somewhere">Go</CitrusButton>
      </MemoryRouter>,
    );
    const link = container.querySelector('a');
    expect(link).toBeTruthy();
    expect(link!.className).toMatch(/focus-visible:ring-pastel-peach-deep/);
    expect(link!.className).toMatch(/focus-visible:ring-offset-pastel-surface/);
  });

  it('preserves the focus ring on the external anchor variant', () => {
    const { container } = render(
      <CitrusButton href="https://citrus.example">Docs</CitrusButton>,
    );
    const link = container.querySelector('a');
    expect(link).toBeTruthy();
    expect(link!.className).toMatch(/focus-visible:ring-pastel-peach-deep/);
  });
});
