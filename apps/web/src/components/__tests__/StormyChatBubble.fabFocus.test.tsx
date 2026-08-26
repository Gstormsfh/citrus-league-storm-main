/**
 * The Stormy FAB must not sit on top of a field you are typing into.
 *
 * It is position:fixed at the bottom-left with z-index 100. The 2026-08-23
 * mobile sweep moved it left on purpose — on the right it was swallowing taps
 * meant for the Free Agents "+" buttons — but that reasoning was about LIST
 * screens, where the left side only overlaps avatars. On a FORM the left edge
 * is where every input begins, and a 56px opaque circle lands on one: Profile's
 * "Confirm new password" was covered.
 *
 * Moving it back to the right would just relocate the collision, so instead it
 * yields while a field has focus. These tests pin that, and pin that it does
 * NOT yield for controls you cannot type into — otherwise every checkbox and
 * button on the page would make it flicker.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/services/StormyService', () => ({
  StormyService: { chat: vi.fn() },
  fetchLeagueContext: vi.fn(async () => ({})),
}));
vi.mock('@/contexts/LeagueContext', () => ({
  useLeague: () => ({ activeLeagueId: null, activeLeague: null, userLeagueState: 'guest' }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));
vi.mock('@/components/citrus2', () => ({
  MascotAvatar: () => null,
}));

import { StormyChatBubble } from '../StormyChatBubble';

const renderFab = () =>
  render(
    <MemoryRouter>
      <StormyChatBubble />
    </MemoryRouter>,
  );

/**
 * Queried by test id, deliberately. getByRole('button') alone matches the real
 * <button> elements two of these tests mount as focus fixtures; and querying by
 * accessible name fails the moment the FAB sets aria-hidden, because a hidden
 * element computes to an empty name — which is precisely the state most of
 * these assertions need to inspect.
 */
const fab = () => screen.getByTestId('stormy-fab');

let extra: HTMLElement[] = [];

const mount = <T extends HTMLElement>(el: T): T => {
  document.body.appendChild(el);
  extra.push(el);
  return el;
};

beforeEach(() => {
  extra = [];
});

afterEach(() => {
  extra.forEach((el) => el.remove());
});

describe('the FAB yields to a focused text field', () => {
  it('is visible and clickable with nothing focused', () => {
    renderFab();
    expect(fab().style.opacity).toBe('1');
    expect(fab().style.pointerEvents).toBe('auto');
  });

  it('gets out of the way when a text input takes focus', async () => {
    renderFab();
    const input = mount(document.createElement('input'));

    act(() => input.focus());

    await waitFor(() => expect(fab().style.opacity).toBe('0'));
    expect(fab().style.pointerEvents).toBe('none');
    expect(fab().getAttribute('aria-hidden')).toBe('true');
  });

  it('comes back on blur', async () => {
    renderFab();
    const input = mount(document.createElement('input'));

    act(() => input.focus());
    await waitFor(() => expect(fab().style.opacity).toBe('0'));

    act(() => input.blur());

    // focusout is deferred a tick on purpose, so this needs the timer to run.
    await waitFor(() => expect(fab().style.opacity).toBe('1'));
    expect(fab().style.pointerEvents).toBe('auto');
  });

  it('yields for a textarea', async () => {
    renderFab();
    const ta = mount(document.createElement('textarea'));

    act(() => ta.focus());

    await waitFor(() => expect(fab().style.opacity).toBe('0'));
  });

  it('yields for a contenteditable', async () => {
    renderFab();
    const div = mount(document.createElement('div'));
    // setAttribute, not the .contentEditable property: jsdom does not implement
    // the property, so assigning it reflects nothing and isContentEditable
    // stays false. Real browsers honour both.
    div.setAttribute('contenteditable', 'true');
    div.tabIndex = 0;

    act(() => div.focus());

    await waitFor(() => expect(fab().style.opacity).toBe('0'));
  });

  it('does NOT yield for a password field being skipped — password IS text entry', async () => {
    renderFab();
    const pw = mount(document.createElement('input'));
    pw.type = 'password';

    act(() => pw.focus());

    // The Profile case exactly: type="password" must count as text entry.
    await waitFor(() => expect(fab().style.opacity).toBe('0'));
  });

  it('does NOT yield for a checkbox', async () => {
    renderFab();
    const cb = mount(document.createElement('input'));
    cb.type = 'checkbox';

    act(() => cb.focus());

    await new Promise((r) => setTimeout(r, 10));
    expect(fab().style.opacity).toBe('1');
  });

  it('does NOT yield for a plain button', async () => {
    renderFab();
    const btn = mount(document.createElement('button'));

    act(() => btn.focus());

    await new Promise((r) => setTimeout(r, 10));
    expect(fab().style.opacity).toBe('1');
  });

  it('stays hidden while tabbing between two fields — no flicker', async () => {
    renderFab();
    const a = mount(document.createElement('input'));
    const b = mount(document.createElement('input'));

    act(() => a.focus());
    await waitFor(() => expect(fab().style.opacity).toBe('0'));

    // focusout on `a` fires before `b` receives focus; activeElement is <body>
    // in between. Without the deferred re-check the FAB flashes back here.
    act(() => b.focus());

    await new Promise((r) => setTimeout(r, 10));
    expect(fab().style.opacity).toBe('0');
  });
});
