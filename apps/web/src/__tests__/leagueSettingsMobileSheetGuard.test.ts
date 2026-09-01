/**
 * LEAGUE SETTINGS MOBILE SHEET (2026-09-01) — iOS: "league settings is
 * still Desktop." The commissioner settings dialog rendered as the
 * centered 700px desktop modal on phones, cramming eight settings tabs
 * into a floating box. Below sm it must present as a full-height bottom
 * sheet: pinned to the screen edges, top under the status bar, safe-area
 * padding at the foot, with the desktop modal untouched at sm+.
 *
 * jsdom has no layout engine; this is a source contract on the settings
 * DialogContent in LeagueDashboard.tsx.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const HQ = readFileSync(resolve(here, '../pages/LeagueDashboard.tsx'), 'utf-8');

// The settings dialog is the DialogContent that carries the desktop
// 700px cap. Slice its className string.
function settingsDialogClasses(): string {
  const anchor = HQ.indexOf('sm:max-w-[700px]');
  expect(anchor, 'settings DialogContent (700px modal) not found').toBeGreaterThan(-1);
  const start = HQ.lastIndexOf('className="', anchor);
  const end = HQ.indexOf('"', start + 'className="'.length);
  return HQ.slice(start, end);
}

describe('the league settings dialog presents as a sheet on phones', () => {
  const cls = settingsDialogClasses();

  it.each([
    ['max-sm:inset-x-0'],
    ['max-sm:bottom-0'],
    ['max-sm:translate-x-0'],
    ['max-sm:translate-y-0'],
    ['max-sm:max-w-none'],
    ['max-sm:max-h-none'],
    ['max-sm:rounded-t-2xl'],
    ['safe-area-inset-bottom'],
  ])('pins %s on the settings dialog', (token) => {
    expect(cls).toContain(token);
  });

  it('keeps the desktop modal cap at sm+', () => {
    expect(cls).toContain('sm:max-w-[700px]');
  });
});
