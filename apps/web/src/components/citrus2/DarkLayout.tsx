import type { ReactNode } from 'react';

/**
 * Page wrapper for the citrus2 (dark forest) design system. Includes the deep
 * forest background, atmospheric color glows, and a top-level container that
 * children render inside.
 */
export function DarkLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0F1F15] text-pastel-cream relative overflow-x-hidden">
      {/* Atmospheric glow accents — purely decorative */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 -right-40 w-[700px] h-[700px] rounded-full opacity-25 blur-3xl"
        style={{ background: 'radial-gradient(circle, #FF6B1A 0%, transparent 70%)' }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[35%] -left-40 w-[600px] h-[600px] rounded-full opacity-15 blur-3xl"
        style={{ background: 'radial-gradient(circle, #84A57D 0%, transparent 70%)' }}
      />
      {children}
    </div>
  );
}
