import { MASCOTS } from '@/constants/mascots';

/**
 * Loading state with animated Stormy mascot.
 *
 * Use for any "checking in," "thinking," "loading the slate" moment.
 * Stormy bobs with a subtle float animation, surrounded by a pulsing
 * orange ambient glow. Much more on-brand than a generic spinner.
 */
export function StormyLoading({
  message = 'Loading...',
  className = '',
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-5 py-16 ${className}`}>
      <div className="relative">
        {/* Pulsing ambient glow */}
        <div
          aria-hidden="true"
          className="absolute inset-0 -m-6 rounded-full opacity-60 blur-2xl animate-pulse"
          style={{ background: 'radial-gradient(circle, #FF6B1A 0%, transparent 70%)' }}
        />
        {/* Stormy bobbing */}
        <img
          src={MASCOTS.stormy.image}
          alt="Stormy is loading"
          className="relative w-24 h-24 rounded-full ring-4 ring-pastel-orange/30 object-cover animate-float-slow"
          loading="eager"
        />
        {/* Outer ring pulse */}
        <div
          aria-hidden="true"
          className="absolute inset-0 rounded-full ring-2 ring-pastel-orange/30 animate-ping"
        />
      </div>
      <div className="text-center">
        <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-1 font-bold">
          Stormy is on it
        </div>
        <div className="text-pastel-cream text-[14px]">{message}</div>
      </div>
    </div>
  );
}
