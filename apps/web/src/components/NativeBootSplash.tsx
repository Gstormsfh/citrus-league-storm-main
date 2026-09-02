/**
 * NativeBootSplash — the app-open moment for the iOS / Android shell.
 *
 * The native launch screen is a flat #0F1F15 sheet (capacitor.config
 * backgroundColor). This overlay continues that sheet seamlessly inside
 * the web view, assembles the Citrus logo with a short scale/fade, and
 * dissolves into the app — so a cold start reads as one branded motion
 * instead of a flat sheet popping into a half-hydrated page.
 *
 * Ground rules (Apple HIG + splash research, 2026-09-01):
 * - Under ~1.6s total; no artificial waits beyond masking first paint.
 * - Purposeful, subtle motion only; prefers-reduced-motion gets a plain
 *   crossfade with no scale.
 * - Web browsers never see it (isNativeApp() false) — the web app is
 *   untouched.
 * - Built entirely from the existing brand mark. No generated imagery.
 */
import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
// Direct module import (not the citrus2 barrel): the barrel drags the
// whole marketing surface — and its service imports — into the boot path.
import { CitrusLogo } from '@/components/citrus2/CitrusLogo';

const isNativeShell = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

/** One cold start per process — remounts (route changes, HMR) never replay it. */
let bootSplashPlayed = false;

const HOLD_MS = 1050; // logo assembly beat
const FADE_MS = 450; // dissolve into the app

const NativeBootSplash = () => {
  const [phase, setPhase] = useState<'hold' | 'fade' | 'done'>(
    !bootSplashPlayed && isNativeShell() ? 'hold' : 'done',
  );

  useEffect(() => {
    if (phase === 'done') return;
    bootSplashPlayed = true;
    const fadeTimer = window.setTimeout(() => setPhase('fade'), HOLD_MS);
    const doneTimer = window.setTimeout(() => setPhase('done'), HOLD_MS + FADE_MS);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(doneTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per cold start
  }, []);

  if (phase === 'done') return null;

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0F1F15] transition-opacity ease-out"
      style={{
        opacity: phase === 'fade' ? 0 : 1,
        transitionDuration: `${FADE_MS}ms`,
        pointerEvents: phase === 'fade' ? 'none' : 'auto',
      }}
    >
      {/* Soft brand halo behind the mark */}
      <div className="absolute w-[340px] h-[340px] rounded-full bg-pastel-orange/10 blur-3xl citrus-boot-halo" />
      <div className="relative flex flex-col items-center gap-3">
        <div className="citrus-boot-mark">
          <CitrusLogo className="w-20 h-20" />
        </div>
        <span className="font-calistoga text-2xl text-pastel-cream citrus-boot-word">Citrus</span>
      </div>
    </div>
  );
};

export default NativeBootSplash;
