/**
 * LEAGUE SETTINGS ON A PHONE.
 *
 * 2026-09-01 — iOS: "league settings is still Desktop." The commissioner
 * dialog rendered as the centred 700px desktop modal on phones. The first
 * answer pinned that dialog as a bottom sheet below `sm` with a dropdown
 * for its eight sections.
 *
 * 2026-09-04 (PRESS BOX) — the phone gets its own screen instead:
 * `LeagueSettingsPhone`, artboard 1a's commissioner screen, mounted by
 * LeagueDashboard in place of the desktop dialog whenever `useIsMobile()`
 * says so. A responsive class cannot hide a portal, so the swap is in the
 * `open` props, and both must agree or a phone shows two dialogs, or none.
 * The old `max-sm:` sheet classes and the dropdown were removed from the
 * desktop dialog rather than kept as dead code: it no longer opens on any
 * viewport where they applied.
 *
 * jsdom has no layout engine; this is a source contract on
 * LeagueDashboard.tsx, LeagueSettingsPhone.tsx and pressbox/Sheet.tsx.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, p), 'utf-8');
const HQ = read('../pages/LeagueDashboard.tsx');
const PHONE = read('../components/league/LeagueSettingsPhone.tsx');
const SHEET = read('../components/pressbox/Sheet.tsx');
const SECTIONS = read('../components/league/leagueSettingsSections.ts');

describe('one settings surface per viewport', () => {
  it('the desktop dialog opens only off the phone, and the phone screen only on it', () => {
    expect(HQ).toContain('<Dialog open={settingsOpen && !isMobile} onOpenChange={setSettingsOpen}>');
    expect(HQ).toContain('open={settingsOpen && isMobile}');
    expect(HQ).toContain('const isMobile = useIsMobile();');
  });

  it('the phone screen is mounted for the commissioner with the dashboard state and save', () => {
    const at = HQ.indexOf('<LeagueSettingsPhone');
    expect(at).toBeGreaterThan(-1);
    const block = HQ.slice(at, HQ.indexOf('/>', at));
    expect(block).toContain('sections={buildLeagueSettingsSections({');
    expect(block).toContain('activeKey={activeSettingsTab}');
    expect(block).toContain('onSectionChange={setActiveSettingsTab}');
    expect(block).toContain('onSave={handleSaveSettings}');
    expect(HQ.slice(at - 200, at)).toContain('isCommissioner &&');
  });

  it('the desktop dialog carries no phone sheet classes and no phone dropdown any more', () => {
    const anchor = HQ.indexOf('sm:max-w-[700px]');
    expect(anchor).toBeGreaterThan(-1);
    const start = HQ.lastIndexOf('className="', anchor);
    const cls = HQ.slice(start, HQ.indexOf('"', start + 'className="'.length));
    expect(cls).not.toContain('max-sm:');
    expect(HQ).not.toContain('MOBILE SECTION PICKER');
  });
});

describe('the phone screen is the artboard', () => {
  it('is a full sheet under the status bar with the save bar over the home indicator', () => {
    expect(SHEET).toContain("shape === 'full'");
    expect(SHEET).toContain('inset-0 pt-[env(safe-area-inset-top)]');
    expect(SHEET).toContain('z-sheet');
    expect(PHONE).toContain('shape="full"');
    expect(PHONE).toContain('pb-[max(env(safe-area-inset-bottom),22px)]');
  });

  it('navigates by a chip row that keeps the active section on screen', () => {
    // 09-01: "hard to use and navigate on mobile" — eight tabs in a strip
    // hid half the sections past the edge. The chips scroll, and the active
    // one is scrolled into view whenever the section changes.
    expect(PHONE).toContain('label="Settings section"');
    expect(PHONE).toContain("scrollIntoView?.({ inline: 'nearest', block: 'nearest' })");
  });

  it('offers the desktop dialog\'s sections in the same order, under the same keys', () => {
    const desktop = HQ.match(/\(\['waivers', 'scoring', 'draft', 'trades', 'keeper', 'rosterslots', 'playoffs', 'rosters'\] as const\)/);
    expect(desktop).not.toBeNull();
    const ret = SECTIONS.slice(SECTIONS.lastIndexOf('return ['));
    expect(ret.replace(/\s+/g, ' ')).toContain(
      'return [ waivers, input.isCategoryLeague ? categories : scoring, draftSection, trades, keepers, rosterSlots, playoffs, rosters, ];',
    );
  });

  it('every value row opens a picker; nothing saves on tap', () => {
    expect(PHONE).toContain("setPicker({ kind: 'select', key: f.key })");
    expect(PHONE).toContain("setPicker({ kind: 'number', key: f.key })");
    expect(PHONE).toContain("saveLabel={(section.saving ?? saving) ? 'SAVING…' : 'SAVE & NOTIFY LEAGUE'}");
  });
});
