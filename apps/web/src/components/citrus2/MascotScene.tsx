import { MASCOTS } from '@/constants/mascots';
import { LivePulse } from './LivePulse';

/**
 * MascotScene — full hero compositions, NOT corner peeks.
 *
 * Each scene uses a SINGLE pre-rendered hero illustration where the mascot
 * is integrated into a designed environment — character, stat panels,
 * lighting, props all baked into one image. We do NOT layer floating chips
 * or speech bubbles on top of an isolated mascot avatar (that's the lazy
 * sticker pattern). The illustration carries the visual weight; the React
 * component is just a tasteful frame around it.
 *
 * Hero assets live in /public/mascots/scene-*.webp and are sized to fit
 * comfortably under our 5 MB gzipped CI budget (~45 KB each).
 */

type SceneSize = 'md' | 'lg' | 'xl';

const SIZE: Record<SceneSize, { container: string; minHeight: string }> = {
  md: { container: 'aspect-[4/3]', minHeight: 'min-h-[320px] sm:min-h-[400px]' },
  lg: { container: 'aspect-[4/3]', minHeight: 'min-h-[420px] sm:min-h-[520px]' },
  xl: { container: 'aspect-[4/3]', minHeight: 'min-h-[480px] sm:min-h-[600px] lg:min-h-[640px]' },
};

interface SceneProps {
  size?: SceneSize;
  className?: string;
}

/* ──────────────────────────────────────────────────────────────────────
 * SCENE: STORMY WELCOME
 * Hero asset: /mascots/scene-stormy-welcome.webp
 * Stormy floats in a deep forest scene with volumetric orange spotlight,
 * holographic stat panels, and a hockey rink overlay. All baked into the
 * image — this component is just the frame + overlay tagline.
 * ────────────────────────────────────────────────────────────────────── */

export function StormyWelcomeScene({ size = 'lg', className = '' }: SceneProps) {
  const sz = SIZE[size];
  return (
    <div
      className={`relative overflow-hidden bg-pastel-surface rounded-3xl ring-1 ring-white/10 ${sz.container} ${sz.minHeight} ${className}`}
      role="img"
      aria-label="Stormy the narwhal floats among holographic stat panels in a dark hockey arena, welcoming you to Citrus."
    >
      {/* Hero illustration — the entire scene is one image */}
      <img
        src="/mascots/scene-stormy-welcome.webp"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        loading="eager"
      />

      {/* Subtle dark gradient at top + bottom for text legibility on overlays */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(to bottom, rgba(15,31,21,0.55) 0%, transparent 18%, transparent 70%, rgba(15,31,21,0.85) 100%)',
        }}
      />

      {/* Top-left eyebrow */}
      <div className="absolute top-5 left-5 sm:top-6 sm:left-6 z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-pastel-surface/70 ring-1 ring-pastel-orange/40 backdrop-blur-md">
          <LivePulse size="xs" />
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft font-bold">
            Stormy · Assistant GM
          </span>
        </div>
      </div>

      {/* Top-right tagline */}
      <div className="absolute top-5 right-5 sm:top-6 sm:right-6 z-10 hidden sm:block">
        <div className="px-3 py-1.5 rounded-md bg-pastel-surface/70 ring-1 ring-white/15 backdrop-blur-md">
          <span className="font-jbmono text-[9px] tracking-[0.22em] uppercase text-white/65 font-bold">
            The Citrus Squad
          </span>
        </div>
      </div>

      {/* Bottom signature */}
      <div className="absolute bottom-5 left-5 sm:bottom-6 sm:left-6 z-10">
        <div className="font-calistoga text-[24px] sm:text-[28px] text-pastel-cream leading-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
          Stormy
        </div>
        <div className="font-jbmono text-[9px] sm:text-[10px] uppercase tracking-[0.32em] text-white/70 mt-1.5">
          Reads every shift · Welcomes you aboard
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * SCENE: PINEAPPLE STANDBY (legacy frame — to be replaced with generated hero)
 * ────────────────────────────────────────────────────────────────────── */

export function PineappleStandbyScene({ size = 'md', className = '', message }: SceneProps & { message?: string }) {
  const sz = SIZE[size];
  return (
    <div className={`relative overflow-hidden bg-[#152821] rounded-3xl ring-1 ring-white/10 ${sz.container} ${sz.minHeight} ${className}`}>
      <div className="absolute top-6 left-6 z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-pastel-sage/15 ring-1 ring-pastel-sage/40 backdrop-blur-md">
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-sage-soft font-bold">
            In the Crease · Standby
          </span>
        </div>
      </div>

      <div className="absolute inset-0 flex items-center justify-center">
        <img
          src={MASCOTS.pineapple.image}
          alt="Pineapple the goaltender, ready in the crease"
          className="w-[60%] max-w-[280px] object-contain drop-shadow-[0_24px_48px_rgba(0,0,0,0.5)]"
        />
      </div>

      {message && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 max-w-sm text-center px-4">
          <div className="font-jbmono text-[10px] uppercase tracking-[0.32em] text-pastel-sage-soft font-bold mb-1.5">
            ✦ Quiet Right Now
          </div>
          <p className="font-sans font-bold text-[16px] text-pastel-cream leading-snug">{message}</p>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * SCENE: LEMON ON THE BOARDS (legacy frame — to be replaced with generated hero)
 * ────────────────────────────────────────────────────────────────────── */

export function LemonOnTheBoardsScene({ size = 'lg', className = '', message }: SceneProps & { message?: string }) {
  const sz = SIZE[size];
  return (
    <div className={`relative overflow-hidden bg-[#152821] rounded-3xl ring-1 ring-white/10 ${sz.container} ${sz.minHeight} ${className}`}>
      <div className="absolute top-6 left-6 z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-pastel-orange/15 ring-1 ring-pastel-orange/40 backdrop-blur-md">
          <LivePulse size="xs" />
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft font-bold">
            Lemon · Center · #9
          </span>
        </div>
      </div>

      <div className="absolute inset-0 flex items-center justify-center">
        <img
          src={MASCOTS.lemon.image}
          alt="Lemon the center, top-line forward"
          className="w-[60%] max-w-[280px] object-contain drop-shadow-[0_24px_48px_rgba(0,0,0,0.5)]"
        />
      </div>

      {message && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 max-w-sm text-center px-4">
          <p className="font-sans font-bold text-[16px] text-pastel-cream leading-snug">{message}</p>
        </div>
      )}
    </div>
  );
}

