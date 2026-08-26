// CONTACT PAGE (2026-08-26) — reported from an iPhone as "'contact' page gets off".
//
// It was not a layout bug. Both cards on that page carried `animated-element`,
// which is `opacity: 0` until an IntersectionObserver adds `.animate`. Only
// Profile.tsx and Standings.tsx install that observer. Contact never did — so
// the form, all four fields, the send button and the support email rendered,
// laid out, occupied 846px of the page, and painted nothing. Between the header
// and the footer there was a screenful of empty green.
//
// The class is off that page now. But the deeper problem is a utility whose
// DEFAULT state is invisible and whose visible state depends on every consumer
// remembering to wire up a scroll observer. That fails silently, it fails
// completely, and nothing in the build notices — which is why it survived to a
// device. It now reveals itself on a delay if no script ever does, so the worst
// case is a late fade rather than content nobody can see.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(fileURLToPath(import.meta.url), '..', '..');
const INDEX_CSS = readFileSync(resolve(SRC, 'index.css'), 'utf8');
const APP_CSS = readFileSync(resolve(SRC, 'App.css'), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!['node_modules', '__tests__', 'dist'].includes(entry)) walk(full, out);
    } else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('.animated-element fails visible', () => {
  it('has a fallback reveal in both stylesheets that define it', () => {
    // Without this, "no observer" means "invisible forever".
    expect(INDEX_CSS).toMatch(/\.animated-element\s*\{[^}]*citrus-reveal-fallback/s);
    expect(APP_CSS).toMatch(/\.animated-element\s*\{[^}]*citrus-reveal-fallback/s);
  });

  it('defines the fallback keyframe it references', () => {
    expect(INDEX_CSS).toMatch(/@keyframes citrus-reveal-fallback\s*\{[\s\S]*?opacity:\s*1/);
  });

  it('lets a scripted reveal win over the fallback', () => {
    // .animate must beat the delayed fallback, or the intended fade is replaced
    // by a 1.2s pause on pages that DO wire the observer up.
    expect(INDEX_CSS).toMatch(/\.animated-element\.animate\s*\{[^}]*animation-delay:\s*0s/s);
  });

  it('is only used by pages that also reveal it', () => {
    // Belt and braces on top of the CSS fallback: if you hide content behind a
    // scroll observer, install the scroll observer in the same file.
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      // Strip comments: the note on Contact.tsx explaining what was removed
      // mentions the class by name, and a guard that trips on its own
      // post-mortem is a guard somebody deletes.
      const body = readFileSync(file, 'utf8')
        .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      if (!/animated-element/.test(body)) continue;
      if (!body.includes("classList.add('animate')")) {
        offenders.push(file.slice(SRC.length + 1));
      }
    }
    expect(offenders, 'uses animated-element without an IntersectionObserver to reveal it').toEqual([]);
  });

  it('the Contact page no longer hides itself', () => {
    const contact = readFileSync(resolve(SRC, 'pages', 'Contact.tsx'), 'utf8');
    expect(contact).not.toMatch(/className="animated-element"/);
    // and still actually has the form it was hiding
    expect(contact).toContain('Send a Message');
  });
});
