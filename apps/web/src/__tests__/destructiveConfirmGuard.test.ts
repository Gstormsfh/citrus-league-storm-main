/**
 * DESTRUCTIVE CONFIRMATION vs ERROR (2026-09-02).
 *
 * The app had one red vocabulary and two meanings for it:
 *
 *   ERROR    something went wrong. Already happened, not chosen by you.
 *   CONFIRM  nothing has happened. You asked for something permanent and
 *            are being asked to confirm it. It is a QUESTION.
 *
 * Painted the same, the second reads as the first: opening "Reset Bracket"
 * and being met with `<Alert variant="destructive">` and a red triangle
 * tells a commissioner, in the only language the interface has, that the
 * bracket is already gone.
 *
 * Six surfaces did it. All six are pinned below, each by NAME, because a
 * whole-codebase regex would have to guess which red things are questions:
 *
 *   PlayoffBracket   the reset-bracket consequence ....... <Alert destructive>
 *   DraftLobby       the Remove Team dialog title ........ text-destructive
 *   DraftRoom        both Delete Draft dialogs ........... plain body copy
 *   DraftRoom        the generic confirm dialog .......... plain body copy
 *   Profile          the reset-draft notice .............. bg-red-400/10
 *   Profile          the delete-account dialog + panel ... ring-red-400/40
 *
 * THE RULE, stated once in `components/confirm/destructiveConfirm.ts`:
 *
 *   RED BELONGS TO THE BUTTON YOU ARE ABOUT TO PRESS, NOT TO THE PANEL
 *   THAT ASKS.
 *
 * So this guard has to bite in BOTH directions. A test that only banned red
 * from confirmations would be satisfied by deleting red from the app
 * entirely — which would lose the error treatment, and with it the thing
 * the confirmations were being mistaken for. Three claims:
 *
 *   1. the confirmations wear the confirmation treatment;
 *   2. they still wear a red ACTION button;
 *   3. the error surfaces still wear the error treatment, and every
 *      surviving `<Alert variant="destructive">` in the app is reporting an
 *      error variable rather than asking a question.
 *
 * A source contract, in the idiom this repo already uses
 * (`matchupMobileRowsGuard`, `mobileSweepGuard`, `darkThemeContrastGuard`):
 * these pages cannot be mounted cheaply in jsdom, and jsdom has no cascade,
 * so what is checkable is the source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const SRC = resolve(HERE, '..');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');
/** Strip comments so prose about the old treatment is not read as code. */
const code = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => {
      const i = l.indexOf('//');
      return i === -1 ? l : l.slice(0, i);
    })
    .join('\n');

const DOCTRINE = read('components/confirm/destructiveConfirm.ts');
const PANEL = read('components/confirm/DestructiveConsequence.tsx');

/** The six confirmation surfaces, by the file that owns each. */
const CONFIRMATION_FILES = [
  'pages/PlayoffBracket.tsx',
  'components/draft/DraftLobby.tsx',
  'pages/DraftRoom.tsx',
  'pages/Profile.tsx',
] as const;

// ── 1. The doctrine is written down, once ────────────────────────────────

describe('the distinction is stated in one place', () => {
  it('destructiveConfirm.ts names both meanings and the rule that separates them', () => {
    expect(DOCTRINE).toMatch(/RED BELONGS TO THE BUTTON YOU ARE ABOUT TO PRESS/);
    expect(DOCTRINE).toMatch(/ERROR\s/);
    expect(DOCTRINE).toMatch(/CONFIRM\s/);
  });

  it('the confirmation treatment is caution, not the error red', () => {
    // Every exported class string EXCEPT the action button, which is the one
    // thing in the file that is meant to be red.
    const surfaces = code(DOCTRINE)
      .split(/export const /)
      .filter((chunk) => chunk.startsWith('CONFIRM_') && !chunk.startsWith('CONFIRM_ACTION_BUTTON'));
    expect(surfaces.length).toBe(5);
    for (const chunk of surfaces) {
      const decl = chunk.slice(0, chunk.indexOf(';'));
      // Orange is the app's "attention" (notificationKind.STATUS_TONE_CLASSES);
      // the grapefruit red is its "bad". A confirmation is attention.
      expect(decl, decl).not.toMatch(/destructive/);
      expect(decl, decl).not.toMatch(/fantasy-grapefruit-red/);
      expect(decl, decl).not.toMatch(/red-\d{2,3}/);
    }
    expect(code(DOCTRINE)).toMatch(/pastel-orange/);
  });

  it('and the confirming BUTTON is still the destructive token', () => {
    // The other half of the rule. Without this the module would read as
    // "make destructive actions look safe", which is the opposite defect.
    expect(DOCTRINE).toContain('CONFIRM_ACTION_BUTTON');
    expect(code(DOCTRINE)).toContain('bg-destructive text-destructive-foreground');
  });

  it('the panel is not an alert, and is not the error component', () => {
    const body = code(PANEL);
    expect(body).toContain('TriangleAlert');
    // CircleAlert is KIND_ICON.error in notificationKind — the failure mark.
    expect(body).not.toContain('CircleAlert');
    // An alert interrupts. A question inside a dialog does not.
    expect(body).not.toMatch(/role=["']alert["']/);
    expect(body).not.toMatch(/from ['"]@\/components\/ui\/alert['"]/);
  });
});

// ── 2. Every confirmation surface wears it ───────────────────────────────

describe('the six confirmation surfaces ask rather than report', () => {
  it.each(CONFIRMATION_FILES)('%s states its consequence in the shared panel', (rel) => {
    const src = code(read(rel));
    expect(src).toContain('<DestructiveConsequence');
    expect(src).toMatch(
      /import \{ DestructiveConsequence \} from ['"]@\/components\/confirm\/DestructiveConsequence['"]/,
    );
  });

  it('PlayoffBracket no longer reaches for the error Alert to ask a question', () => {
    const src = code(read('pages/PlayoffBracket.tsx'));
    expect(src).not.toContain('<Alert variant="destructive"');
    expect(src).not.toMatch(/from ['"]@\/components\/ui\/alert['"]/);
    // The red moved to the button, and is still there: both halves of the
    // rule, on the same surface.
    expect(src).toMatch(/<Button\s+variant="destructive"[\s\S]{0,200}Confirm Reset/);
  });

  it('the Remove Team dialog title is cream, not the failure colour', () => {
    const src = code(read('components/draft/DraftLobby.tsx'));
    expect(src).toContain('<DialogTitle className={CONFIRM_TITLE}>');
    expect(src).not.toMatch(/DialogTitle className="[^"]*text-destructive/);
    // ...and the button that does the removing is still destructive.
    expect(src).toMatch(/<Button variant="destructive" onClick=\{handleDeleteTeam\}>/);
  });

  it('the account-delete dialog rings in caution, and the ramp reds are gone', () => {
    const src = code(read('pages/Profile.tsx'));
    expect(src).toContain('CONFIRM_SURFACE_RING');
    // The two panels that used the raw Tailwind ramp on a dark theme.
    expect(src).not.toContain('bg-red-400/10');
    expect(src).not.toContain('text-red-300/90');
    expect(src).not.toMatch(/<strong className="text-red-300">Warning:<\/strong>/);
  });

  it('the draft-room confirmations put the consequence in the panel, not in body copy', () => {
    const src = code(read('pages/DraftRoom.tsx'));
    // Three of them: two Delete Draft dialogs and the generic confirm.
    expect(src.split('<DestructiveConsequence').length - 1).toBe(3);
    // The generic dialog's panel IS its description, so Radix still has one
    // to point aria-describedby at.
    expect(src).toContain('<AlertDialogDescription asChild>');
    // Every one of them still confirms with a red button.
    expect(src.split('bg-destructive text-destructive-foreground').length - 1).toBeGreaterThanOrEqual(3);
  });
});

// ── 3. The error treatment survives, and stays on errors ─────────────────

describe('the error treatment is still the error treatment', () => {
  /**
   * Every `<Alert variant="destructive">` left in the app. The invariant is
   * sharp: each one renders an error VARIABLE. A confirmation renders a
   * sentence about something that has not happened, so it cannot satisfy
   * this and must use the panel instead.
   */
  const ERROR_ALERTS: [string, RegExp][] = [
    ['components/draft/v2/ConnectionBanner.tsx', /data-banner-kind="fatal-auth"/],
    ['components/draft/v2/ConnectionBanner.tsx', /data-banner-kind="fatal-server"/],
    ['pages/VerifyEmail.tsx', /<AlertDescription>\{error\}<\/AlertDescription>/],
    ['pages/ResetPassword.tsx', /<AlertDescription>\{error\}<\/AlertDescription>/],
    ['pages/CreateLeague.tsx', /<AlertDescription>\{error\}<\/AlertDescription>/],
    ['pages/ProfileSetup.tsx', /<AlertDescription>\{error\}<\/AlertDescription>/],
  ];

  it.each(ERROR_ALERTS)('%s keeps its destructive Alert', (rel, marker) => {
    const src = code(read(rel));
    expect(src).toContain('<Alert variant="destructive"');
    expect(src).toMatch(marker);
  });

  it('a fatal connection banner is still announced, because it IS an alert', () => {
    const src = code(read('components/draft/v2/ConnectionBanner.tsx'));
    expect(src).toMatch(/<Alert variant="destructive" role="alert"/);
  });

  it('the toast layer still maps a destructive variant to the error kind', () => {
    // 166 call sites declared "this is a failure" in the only vocabulary the
    // old scaffold had. Nothing here reinterprets them as questions.
    const kinds = code(read('components/notifications/notificationKind.ts'));
    expect(kinds).toContain("if (variant === 'destructive') return 'error';");
  });

  it('no confirmation surface stole the error Alert back', () => {
    for (const rel of CONFIRMATION_FILES) {
      const src = code(read(rel));
      expect(src, `${rel} reintroduced the error Alert`).not.toContain('<Alert variant="destructive"');
    }
  });
});

// ── 4. Proof the detector works ──────────────────────────────────────────

describe('the guard bites', () => {
  /** The exact shape this change removed, run through the same detector. */
  const confirmationOffenders = (src: string): string[] => {
    const out: string[] = [];
    const body = code(src);
    if (/<Alert variant="destructive"/.test(body)) out.push('error Alert on a confirmation');
    if (/DialogTitle className="[^"]*text-destructive/.test(body)) out.push('error-red dialog title');
    if (/bg-red-400\/10/.test(body)) out.push('ramp red panel');
    return out;
  };

  it('catches each of the three shapes, and passes clean source', () => {
    expect(confirmationOffenders('<Alert variant="destructive"><X/></Alert>')).toEqual([
      'error Alert on a confirmation',
    ]);
    expect(confirmationOffenders('<DialogTitle className="flex gap-2 text-destructive">Remove</DialogTitle>')).toEqual([
      'error-red dialog title',
    ]);
    expect(confirmationOffenders('<div className="bg-red-400/10 p-4" />')).toEqual(['ramp red panel']);
    expect(confirmationOffenders('<DestructiveConsequence>Gone forever.</DestructiveConsequence>')).toEqual([]);
    // Comments describing the old treatment must not trip it.
    expect(confirmationOffenders('// this replaced <Alert variant="destructive">')).toEqual([]);
  });

  it('and the four confirmation files are clean under it', () => {
    for (const rel of CONFIRMATION_FILES) {
      expect(confirmationOffenders(read(rel)), rel).toEqual([]);
    }
  });
});
