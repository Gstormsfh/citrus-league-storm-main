import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePlayerAvailability } from '@citrus/shared';
import { PlayerAvailabilityBadge } from '@/components/player/PlayerAvailabilityBadge';
import { TableCell } from '@/components/ui/table';

// Render the actual desktop identity cell without mounting unrelated league,
// waiver and schedule services. Keeping the JSX from the page means restoring
// its old raw-status span makes these behavioral assertions fail.
const page = readFileSync(resolve(fileURLToPath(import.meta.url), '../../FreeAgents.tsx'), 'utf8');
const rows = page.indexOf('{visiblePlayers.map((player) =>');
const start = page.indexOf('<TableCell', rows);
const end = page.indexOf('</TableCell>', start) + '</TableCell>'.length;
if (rows < 0 || start < 0 || end <= start) throw new Error('Available-player identity cell not found');
const compiled = ts.transpileModule(`const renderCell = (player) => (${page.slice(start, end)});`, {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
}).outputText;
const renderCell = new Function('React', 'TableCell', 'Mug', 'mugFromDirectory', 'handlePlayerClick', 'PlayerAvailabilityBadge',
  `${compiled}; return renderCell;`)(React, TableCell, () => null, () => ({}), () => {}, PlayerAvailabilityBadge);
const now = Date.parse('2026-09-12T12:00:00Z');
const evidence = resolvePlayerAvailability({ roster_status: 'OUT', roster_status_source: 'espn-injuries', roster_status_updated_at: '2026-09-12T00:00:00Z' }, now);
const renderPlayer = (availability = evidence) => render(<table><tbody><tr>{renderCell({
  id: '8477942', full_name: 'Kevin Fiala', status: 'active', availability,
})}</tr></tbody></table>);
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Free Agents available-player row current availability', () => {
  it('shows dated OUT instead of the legacy active flag, with the same eligibility distinction as the modal', () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    renderPlayer();
    expect(screen.getByText('OUT').getAttribute('aria-label')).toContain('not an IR eligibility decision');
    expect(screen.queryByText(/^active$/i)).toBeNull();
    expect(screen.getByText('Kevin Fiala')).toBeTruthy();
  });
  it('shows Unknown for absent evidence and for a cached report after expiry', () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const view = renderPlayer(resolvePlayerAvailability({}, now));
    expect(screen.getByText('Unknown')).toBeTruthy();
    expect(screen.queryByText(/^active$/i)).toBeNull();
    view.unmount();
    vi.setSystemTime(new Date('2026-09-14T00:00:00Z'));
    renderPlayer();
    expect(screen.getByText('Unknown')).toBeTruthy();
    expect(screen.queryByText('OUT')).toBeNull();
  });
});
