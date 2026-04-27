import { MASCOTS, type MascotId } from '@/constants/mascots';
import { ACCENT_CLASSES, type AccentName } from './tokens';
import { MascotPortrait } from './MascotAvatar';
import { GlowCard } from './GlowCard';

/**
 * Card for the "Roll Call" / Citrus Squad lineup grid.
 *
 * Wrapped in GlowCard so each squad card glows in its character's signature
 * color on hover — Stormy orange, Lemon butter, Kiwi sage, Pineapple peach.
 * Portrait scales subtly on hover for that "alive" feel.
 */
export function MascotCard({
  id,
  accent = 'orange',
}: {
  id: MascotId;
  accent?: AccentName;
}) {
  const m = MASCOTS[id];
  const a = ACCENT_CLASSES[accent];
  return (
    <GlowCard accent={accent}>
      <article className="p-5 overflow-hidden">
        <MascotPortrait
          id={id}
          className={`mb-4 ring-1 ${a.ring} group-hover:scale-[1.02] transition-transform duration-300`}
        />
        <div className={`font-jbmono text-[10px] tracking-[0.22em] uppercase mb-1.5 font-bold ${a.text}`}>
          {m.position}{m.number ? ` · #${m.number}` : ''}
        </div>
        <h3 className="font-sans font-black text-[1.5rem] text-pastel-cream mb-2 leading-none">
          {m.name}
        </h3>
        <p className="text-[13px] text-white/55 leading-relaxed">
          {m.tagline}
        </p>
      </article>
    </GlowCard>
  );
}
