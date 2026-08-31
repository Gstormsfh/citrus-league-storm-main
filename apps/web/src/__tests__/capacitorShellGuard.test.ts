/**
 * NATIVE SHELL GROUND (2026-08-31) — reported from the iOS build as "I scroll
 * up/down too far and get glimpses of white."
 *
 * The web page paints #0F1F15 from the html element down, but iOS rubber-band
 * overscroll reveals what sits BEHIND the webview: the native window and
 * scroll view, which default to white. No amount of CSS can reach that layer.
 * Capacitor's `backgroundColor` is the one knob that paints it, and the
 * config did not set it.
 *
 * The invariant: the native ground and the page ground are the same color,
 * so overscroll shows more of the same darkness instead of a white flash.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

describe('the native shell paints the same ground as the page', () => {
  const config = JSON.parse(readFileSync(resolve(here, '../../capacitor.config.json'), 'utf-8'));
  const indexHtml = readFileSync(resolve(here, '../../index.html'), 'utf-8');

  it('sets a native backgroundColor at all', () => {
    expect(config.backgroundColor).toBeTruthy();
  });

  it('matches the html element ground exactly', () => {
    const m = indexHtml.match(/<html[^>]*style="[^"]*background:\s*(#[0-9A-Fa-f]{6})/);
    expect(m, 'index.html html element must carry an inline background').toBeTruthy();
    expect(config.backgroundColor.toUpperCase()).toBe(m![1].toUpperCase());
  });
});
