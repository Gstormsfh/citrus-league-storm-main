import type { MascotId } from '@/constants/mascots';
import { MascotAvatar } from './MascotAvatar';

/**
 * Standard section heading pattern: small-caps eyebrow, big title, optional sub.
 *
 * Optional `mascot` prop adds a small mascot avatar in line with the eyebrow
 * — anchors the section to a Squad character (Stormy for AI sections,
 * Lemon for forward stats, Kiwi for analytics, Pineapple for goalie).
 *
 * Mobile-tuned: title scales 2rem → 2.75rem across breakpoints, sub text
 * scales 14px → 15px, eyebrow slightly smaller on mobile.
 */
export function SectionHeader({
  eyebrow,
  title,
  sub,
  align = 'left',
  mascot,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  sub?: string;
  align?: 'left' | 'center';
  /** Optional Squad mascot accent next to eyebrow */
  mascot?: MascotId;
}) {
  const alignClass = align === 'center' ? 'text-center items-center' : 'items-start';
  const eyebrowJustify = align === 'center' ? 'justify-center' : 'justify-start';
  return (
    <div className={`mb-8 md:mb-10 flex flex-col ${alignClass}`}>
      {(eyebrow || mascot) && (
        <div className={`flex items-center gap-2 mb-2 ${eyebrowJustify}`}>
          {mascot && <MascotAvatar id={mascot} size="xs" ring={false} />}
          {eyebrow && (
            <div className="font-plex font-semibold text-[11px] tracking-[0.18em] uppercase text-pressbox-orange-soft">
              {eyebrow}
            </div>
          )}
        </div>
      )}
      <h2 className="font-condensed font-extrabold uppercase text-[2.25rem] sm:text-[2.75rem] md:text-[3.25rem] tracking-[-0.01em] text-pressbox-text leading-[0.95]">
        {title}
      </h2>
      {sub && (
        <p
          className={`font-barlow font-normal text-[16px] md:text-[17px] text-pressbox-text/70 leading-relaxed mt-3 md:mt-4 ${
            align === 'center' ? 'max-w-xl mx-auto' : 'max-w-2xl'
          }`}
        >
          {sub}
        </p>
      )}
    </div>
  );
}
