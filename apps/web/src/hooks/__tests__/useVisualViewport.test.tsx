/**
 * THE PAGE PIN IS OPT-IN (2026-09-15), found on device during the App
 * Review resubmission recording: the sign-up form jumped between two scroll
 * positions on every keystroke and the password field ended up under the
 * keyboard. useVisualViewport pinned the page to the top on every visual
 * viewport event by default, and StormyChatBubble calls it on every route,
 * so WebKit's scroll-the-field-into-view and the pin fought on every text
 * field in the app. Two locks: the hook never scrolls unless asked, and the
 * app-wide caller asks only for the open phone sheet.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useVisualViewport } from '../useVisualViewport';

const HERE = resolve(fileURLToPath(import.meta.url), '..');

type Listener = () => void;
let listeners: Record<string, Listener[]>;
let vv: { height: number; offsetTop: number; addEventListener: (e: string, l: Listener) => void; removeEventListener: (e: string, l: Listener) => void };

beforeEach(() => {
  listeners = {};
  vv = {
    height: 800,
    offsetTop: 0,
    addEventListener: (e, l) => { (listeners[e] ??= []).push(l); },
    removeEventListener: (e, l) => { listeners[e] = (listeners[e] ?? []).filter((x) => x !== l); },
  };
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  window.scrollTo = vi.fn();
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).visualViewport;
});

/** iOS raises the keyboard: the visible area shrinks and WebKit scrolls the page. */
function raiseKeyboard() {
  vv.height = 420;
  vv.offsetTop = 260;
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 260 });
  act(() => { listeners.resize?.forEach((l) => l()); listeners.scroll?.forEach((l) => l()); });
}

describe('useVisualViewport', () => {
  it('reports the keyboard and, by default, leaves the page scroll alone', () => {
    const { result } = renderHook(() => useVisualViewport());
    raiseKeyboard();
    expect(result.current.keyboardOpen).toBe(true);
    expect(result.current.height).toBe(420);
    expect(result.current.offsetTop).toBe(260);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('pins the page to the top only when asked, for a fixed layer sized to the visible area', () => {
    renderHook(() => useVisualViewport(true));
    raiseKeyboard();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('does not pin while the keyboard is closed even when asked', () => {
    renderHook(() => useVisualViewport(true));
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 300 });
    act(() => { listeners.scroll?.forEach((l) => l()); });
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});

describe('the app-wide caller', () => {
  it('StormyChatBubble asks for the pin only for the open phone sheet, never unconditionally', () => {
    const src = readFileSync(resolve(HERE, '..', '..', 'components', 'StormyChatBubble.tsx'), 'utf8');
    expect(src).not.toMatch(/useVisualViewport\(\s*\)/);
    expect(src).not.toMatch(/useVisualViewport\(\s*true\s*\)/);
    expect(src).toMatch(/useVisualViewport\(\s*isOpen\s*&&\s*isMobile\s*\)/);
  });
});
