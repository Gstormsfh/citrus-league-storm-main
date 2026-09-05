/**
 * THE BOOT SPLASH (PR3, 2026-09-04). `boot.html?pct=55&stage=1` draws the
 * app loading screen the native shell shows on a cold start, outside the
 * shell, at a chosen progress. `stage=1` shows the stage name under the bar
 * (the >4s case); `fade=1` the dissolve.
 */
import { createRoot } from 'react-dom/client';
import '../src/pressboxFonts';
import '../src/index.css';
import { BootSplashView } from '../src/components/NativeBootSplash';

const q = new URLSearchParams(location.search);
const pct = Number(q.get('pct') ?? 55);
const stage = q.get('stage') === '1' ? 'Loading your leagues' : null;

createRoot(document.getElementById('root')!).render(
  <BootSplashView
    pct={pct}
    tip="Stormy: the best pickup is the one whose team plays four times this week."
    stageName={stage}
    fading={q.get('fade') === '1'}
  />,
);
