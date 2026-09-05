/**
 * NativeBootSplash — the app-open moment for the iOS / Android shell.
 *
 * PRESS BOX (PR3, 2026-09-04): motion board 2a. The native launch screen is
 * a flat #0C1811 sheet (capacitor.config backgroundColor); this overlay
 * continues it inside the web view: the puck bobs and slowly spins over an
 * orange glow, CITRUS in Barlow Condensed, a 200×3 progress bar driven by
 * REAL boot stages (lib/bootStages.ts), a rotating tip, and Stormy's footer.
 *
 * The bar never fake-completes. It reads 25% when auth answers, 55% when
 * the league context has loaded, 100% when the first route has painted,
 * and the splash dissolves then — after at least MIN_MS so a fast boot
 * still reads as one motion, and at CEILING_MS regardless so a stalled
 * stage can never hold the app hostage. Past STAGE_NAME_AFTER_MS with a
 * stage still pending, the stage's name appears under the bar.
 *
 * Ground rules (Apple HIG + splash research, 2026-09-01) still hold:
 * purposeful motion only; prefers-reduced-motion keeps the colour and
 * drops the transforms and the loops; web browsers never see it
 * (isNativeApp() false); built from the existing brand mark.
 */
import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
// Direct module import (not the citrus2 barrel): the barrel drags the
// whole marketing surface — and its service imports — into the boot path.
import { CitrusLogo } from '@/components/citrus2/CitrusLogo';
import { useBootProgress } from '@/lib/bootStages';

const isNativeShell = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

/** One cold start per process — remounts (route changes, HMR) never replay it. */
let bootSplashPlayed = false;

/** The floor: a boot faster than this still shows one full motion. */
const MIN_MS = 600;
/** The ceiling: past this the app shows whatever it has, stalled stage or not. */
const CEILING_MS = 6000;
/** A stage still pending after this names itself under the bar. */
const STAGE_NAME_AFTER_MS = 4000;
const FADE_MS = 300;
const TIP_MS = 2800;

/**
 * Three lines, rotating. A Stormy tip and two facts about how the app
 * works — none of them a figure, because nothing is loaded yet to source
 * one from. (Board 2a's live line, "9 games · 27 of your players dressed",
 * needs the schedule and the roster, which are what the bar is waiting on.)
 */
const TIPS = [
  'Stormy: the best pickup is the one whose team plays four times this week.',
  'Waivers run overnight. A claim placed before the run clears with it.',
  'Your lineup locks a player at his puck drop, not at the first game of the night.',
];

const NativeBootSplash = () => {
  const [phase, setPhase] = useState<'hold' | 'fade' | 'done'>(
    !bootSplashPlayed && isNativeShell() ? 'hold' : 'done',
  );
  const [startedAt] = useState(() => Date.now());
  const [tick, setTick] = useState(0);
  const progress = useBootProgress();

  useEffect(() => {
    if (phase !== 'hold') return;
    bootSplashPlayed = true;
    // A once-a-second tick for the floor, the ceiling, the stage name and
    // the tip rotation; the stages themselves arrive through the store.
    const id = window.setInterval(() => setTick((t) => t + 1), 200);
    return () => window.clearInterval(id);
  }, [phase]);

  const elapsed = Date.now() - startedAt;
  const shouldDismiss = phase === 'hold' && elapsed >= MIN_MS && (progress.complete || elapsed >= CEILING_MS);

  useEffect(() => {
    if (!shouldDismiss) return;
    setPhase('fade');
    const t = window.setTimeout(() => setPhase('done'), FADE_MS);
    return () => window.clearTimeout(t);
  }, [shouldDismiss]);

  if (phase === 'done') return null;

  const tip = TIPS[Math.floor(elapsed / TIP_MS) % TIPS.length];
  const stageName = progress.pending && elapsed >= STAGE_NAME_AFTER_MS ? progress.pending.label : null;
  void tick;

  return <BootSplashView pct={progress.pct} tip={tip} stageName={stageName} fading={phase === 'fade'} />;
};

export interface BootSplashViewProps {
  pct: number;
  tip: string;
  stageName: string | null;
  fading: boolean;
}

/** The screen itself, stateless, so the harness can draw it outside the shell. */
export function BootSplashView({ pct, tip, stageName, fading }: BootSplashViewProps) {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-overlay flex flex-col items-center justify-center bg-pressbox-surface transition-opacity ease-out overflow-hidden"
      style={{
        opacity: fading ? 0 : 1,
        transitionDuration: `${FADE_MS}ms`,
        pointerEvents: fading ? 'none' : 'auto',
      }}
      data-testid="native-boot-splash"
    >
      {/* The orange glow behind the puck, then the light band sweeping down. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 70% 45% at 50% 38%, rgba(255,107,26,.16), transparent 70%)' }}
      />
      <div className="absolute inset-x-0 h-[140px] pointer-events-none citrus-boot-sweep" />

      <div className="relative flex flex-col items-center">
        <div className="citrus-boot-puck" style={{ filter: 'drop-shadow(0 12px 24px rgba(255,107,26,.35))' }}>
          <div className="citrus-boot-spin">
            <CitrusLogo className="w-24 h-24" />
          </div>
        </div>
        <div className="citrus-boot-ground mt-3 w-[70px] h-[10px] rounded-full bg-black/60" style={{ filter: 'blur(6px)' }} />

        <p className="mt-6 font-condensed font-extrabold text-[30px] tracking-[0.06em] text-pressbox-text leading-none">CITRUS</p>
        <p className="mt-1.5 font-plex font-semibold text-[10px] tracking-[0.3em] text-pressbox-orange-soft">FANTASY HOCKEY</p>

        <div className="mt-7 w-[200px] h-[3px] rounded-full bg-white/[0.08] overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div
            className="h-full rounded-full transition-[width] duration-[320ms] ease-out"
            style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#FF6B1A,#FF9F66)' }}
          />
        </div>
        <p className="mt-2 h-4 font-plex font-medium text-[9px] tracking-[0.12em] uppercase text-pressbox-text/45">
          {stageName ?? ''}
        </p>

        <p key={tip} className="mt-5 max-w-[300px] px-4 text-center font-barlow text-[12px] leading-[1.45] text-pressbox-text/60 citrus-boot-tip">
          {tip}
        </p>
      </div>

      <div className="absolute bottom-[max(env(safe-area-inset-bottom),24px)] left-0 right-0 flex items-center justify-center gap-3">
        <img
          src="/mascots/mascot-stormy.webp"
          alt=""
          className="w-11 h-11 rounded-full object-cover ring-2 ring-pressbox-orange-soft/60"
        />
        <span className="font-plex font-semibold text-[9px] tracking-[0.2em] text-pressbox-text/70">LIVE xG SCORING</span>
        <span className="flex items-center gap-1" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-[3px] h-[3px] rounded-full bg-pressbox-orange-soft citrus-boot-dot"
              style={{ animationDelay: `${i * 200}ms` }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

export default NativeBootSplash;
