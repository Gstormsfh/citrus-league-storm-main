import { MascotAvatar } from './MascotAvatar';
import { LivePulse } from './LivePulse';
import type { StormyExchange } from './StormyChatTile';

/**
 * Hero-specific Stormy composition: Stormy IS the chat persona at the top
 * of one unified card, with his portrait peeking slightly above the edge for
 * visual lift. Replaces the previous "floating Stormy + separate chat" pattern
 * which read as two disconnected islands.
 */
export function StormyHeroTile({ exchange }: { exchange: StormyExchange }) {
  return (
    <div className="relative w-full max-w-[480px] mx-auto pt-10">
      {/* Atmospheric glow */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -m-8 rounded-full opacity-50 blur-3xl"
        style={{ background: 'radial-gradient(circle, #FF6B1A 0%, transparent 60%)' }}
      />

      {/* Unified card */}
      <div className="relative bg-pastel-surface-tile border border-white/10 rounded-2xl shadow-[0_30px_70px_-20px_rgba(0,0,0,0.6)]">
        {/* Stormy persona header — portrait peeks above the card edge */}
        <div className="flex items-center gap-4 px-5 pt-5 pb-4 border-b border-white/10 bg-gradient-to-b from-pastel-orange/8 to-transparent">
          <div className="relative -mt-12 flex-shrink-0">
            <div className="rounded-full ring-4 ring-pastel-surface-tile shadow-[0_12px_32px_-8px_rgba(255,107,26,0.4)]">
              <MascotAvatar id="stormy" size="lg" ring={false} className="ring-2 ring-pastel-orange/40" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-sans font-bold text-[17px] text-pastel-cream">Stormy</span>
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-pastel-sage/20 ring-1 ring-pastel-sage/30">
                <LivePulse size="xs" tone="sage" />
                <span className="font-jbmono text-[9px] text-pastel-sage-soft uppercase tracking-[0.18em] font-bold leading-none">
                  Online
                </span>
              </span>
            </div>
            <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/45 font-bold">
              Assistant GM · 31-Feature xG
            </div>
          </div>
        </div>

        {/* Q&A thread */}
        <div className="p-5 space-y-4">
          {/* User question */}
          <div className="flex justify-end">
            <div className="bg-white/5 rounded-2xl rounded-tr-sm px-4 py-3 max-w-[85%]">
              <div className="font-jbmono text-[10px] tracking-wider uppercase text-white/45 font-bold mb-1">
                YOU
              </div>
              <div className="text-[13px] text-pastel-cream leading-snug">{exchange.question}</div>
            </div>
          </div>

          {/* Stormy answer — typing-indicator style */}
          <div className="flex items-start gap-2.5">
            <MascotAvatar id="stormy" size="sm" />
            <div className="bg-pastel-orange/10 ring-1 ring-pastel-orange/20 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%]">
              <div className="text-[13px] text-pastel-cream leading-relaxed">
                {exchange.answer}
              </div>
            </div>
          </div>

          {/* "Stormy is online" footer */}
          <div className="flex items-center justify-between pt-2 border-t border-white/5">
            <span className="font-jbmono text-[10px] text-white/35 tracking-wider">
              Powered by your league data
            </span>
            <span className="font-jbmono text-[10px] text-pastel-orange-soft tracking-wider font-bold">
              Ask anything →
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
