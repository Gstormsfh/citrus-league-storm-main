import { MASCOTS, type MascotId } from '@/constants/mascots';
import { ACCENT_CLASSES, type AccentName } from './tokens';
import { MascotPortrait } from './MascotAvatar';

/**
 * Card for the "Roll Call" / Citrus Squad lineup grid. Reads mascot data from
 * the central mascots library so the squad stays consistent everywhere.
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
    <article className="bg-[#1A2A20] border border-white/10 rounded-2xl p-5 hover:border-pastel-orange/40 hover:-translate-y-1 transition-all overflow-hidden">
      <MascotPortrait id={id} className={`mb-4 ring-1 ${a.ring}`} />
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
  );
}
