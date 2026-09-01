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

describe('settings navigate by dropdown on phones', () => {
  // SETTINGS SECTIONS (2026-09-01): "hard to use and navigate on
  // mobile... utilize drop down menus." One full-width Select replaces
  // the eight-tab horizontal strip below sm; the strip returns at sm+.
  it('the mobile section picker is a Select bound to the active section', () => {
    const pickerAt = HQ.indexOf('MOBILE SECTION PICKER');
    expect(pickerAt).toBeGreaterThan(-1);
    const picker = HQ.slice(pickerAt, pickerAt + 1200);
    expect(picker).toContain('<Select value={activeSettingsTab} onValueChange={setActiveSettingsTab}>');
    expect(picker).toContain('settingsSections.map');
  });

  it('the tab strip is desktop-only; the dropdown is phone-only', () => {
    const pickerAt = HQ.indexOf('MOBILE SECTION PICKER');
    const region = HQ.slice(pickerAt, pickerAt + 2600);
    expect(region).toContain('"sm:hidden"');
    expect(region).toContain('hidden sm:block overflow-x-auto');
  });

  it('the sheet cannot scroll sideways and its header clears the close button', () => {
    expect(HQ).toContain('max-sm:overflow-x-hidden');
    expect(HQ).toContain('<DialogHeader className="text-left pr-8 max-w-full">');
  });
});
