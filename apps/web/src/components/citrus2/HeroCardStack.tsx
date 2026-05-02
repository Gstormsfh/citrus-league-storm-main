import { Trophy } from 'lucide-react';
import { TeamChip } from './TeamChip';
import { MascotAvatar } from './MascotAvatar';
import { LivePulse } from './LivePulse';

/**
 * The Linear-style hero composition: three product UI cards floating at slight
 * angles in a stacked layout. Used as the visual for the "Fantasy Hockey 2026"
 * hero slide.
 *
 * Mobile-tuned: cards scale down to ~85% of viewport width on mobile to
 * prevent overflow, with adjusted absolute positioning so the stack still
 * reads as a cohesive composition. Desktop keeps the original 280-320px
 * widths with rotate offsets.
 */
export function HeroCardStack() {
  return (
    <div className="relative w-full max-w-[480px] mx-auto h-[440px] sm:h-[480px]">
      {/* Back card — sage — League standings preview */}
      <div
        className="absolute top-2 right-0 sm:top-4 sm:-right-2 w-[240px] sm:w-[280px] bg-pastel-surface-tile border border-pastel-sage/30 rounded-2xl p-4 sm:p-5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)] rotate-[6deg] origin-bottom-left"
        aria-hidden="true"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-pastel-sage/20 ring-1 ring-pastel-sage/40 flex items-center justify-center text-pastel-sage-soft">
            <Trophy className="w-5 h-5" strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/45 font-bold">
              Your League
            </div>
            <div className="font-sans font-bold text-[14px] text-pastel-cream truncate">
              Week 12 standings
            </div>
          </div>
        </div>
        <div className="space-y-2.5">
          {[
            { rank: 1, team: 'Puckmasters', rec: '14-4' },
            { rank: 2, team: 'Ice Wizards', rec: '13-5' },
            { rank: 3, team: 'Hat Trick', rec: '12-6' },
          ].map((t) => (
            <div key={t.team} className="flex items-center gap-2.5 text-[13px]">
              <span className={`font-sans font-black w-4 ${t.rank === 1 ? 'text-pastel-orange' : 'text-white/45'}`}>
                {t.rank}
              </span>
              <span className="flex-1 text-pastel-cream font-medium truncate">{t.team}</span>
              <span className="font-jbmono text-[11px] text-white/45 tabular-nums">{t.rec}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Middle card — butter — Stormy AI with real Stormy voice */}
      <div
        className="absolute top-16 left-0 sm:top-20 sm:-left-4 w-[260px] sm:w-[300px] bg-pastel-surface-tile border border-pastel-butter/30 rounded-2xl p-4 sm:p-5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)] -rotate-[5deg]"
        aria-hidden="true"
      >
        <div className="flex items-center gap-3 mb-4">
          <MascotAvatar id="stormy" size="md" ring={false} className="ring-1 ring-pastel-orange/40 rounded-xl !rounded-xl" />
          <div className="flex-1 min-w-0">
            <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/45 font-bold">
              Stormy AI
            </div>
            <div className="font-sans font-bold text-[14px] text-pastel-cream truncate">
              Knows your roster
            </div>
          </div>
        </div>
        <div className="bg-white/5 rounded-xl p-3 mb-3">
          <div className="font-jbmono text-[10px] text-white/45 mb-1.5">YOU</div>
          <div className="text-[12px] text-pastel-cream leading-snug">
            Start Pettersson or Aho at C tonight?
          </div>
        </div>
        <div className="bg-pastel-orange/10 ring-1 ring-pastel-orange/20 rounded-xl p-3">
          <div className="font-jbmono text-[10px] text-pastel-orange-soft mb-1.5">STORMY</div>
          <div className="text-[12px] text-pastel-cream leading-snug">
            Aho. xGF% 58.2% last 10, 2:30 PP1. Pettersson down to 18:45 TOI. Easy call.
          </div>
        </div>
      </div>

      {/* Front card — orange — Live game with real team colors */}
      <div className="absolute bottom-0 right-0 w-[280px] sm:w-[320px] bg-pastel-surface-tile border border-pastel-orange/40 rounded-2xl p-4 sm:p-5 shadow-[0_30px_70px_-20px_rgba(255,107,26,0.25),0_24px_60px_-20px_rgba(0,0,0,0.6)] rotate-[2deg]">
        <div className="flex items-center justify-between mb-4">
          <span className="flex items-center gap-1.5">
            <LivePulse size="xs" />
            <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft font-bold">
              Live · 3rd Period
            </span>
          </span>
          <span className="font-jbmono text-[10px] text-white/40 tabular-nums">12:43</span>
        </div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <TeamChip abbrev="EDM" size="md" />
            <div className="font-jbmono text-[9px] text-white/45 tracking-wider uppercase hidden sm:block">Away</div>
          </div>
          <div className="font-sans font-black text-[1.75rem] sm:text-[2.25rem] text-pastel-cream tabular-nums leading-none">
            4<span className="text-white/30 mx-1">·</span>3
          </div>
          <div className="flex items-center gap-2">
            <div className="font-jbmono text-[9px] text-white/45 tracking-wider uppercase hidden sm:block">Home</div>
            <TeamChip abbrev="COL" size="md" />
          </div>
        </div>
        <div className="h-1 bg-white/10 rounded-full overflow-hidden mb-4">
          <div className="h-full bg-pastel-orange rounded-full" style={{ width: '78%' }} />
        </div>
        <div className="flex items-center justify-between">
          <span className="font-jbmono text-[10px] text-white/45">McDavid +6.4 tonight</span>
          <span className="font-jbmono text-[10px] text-pastel-orange-soft font-bold">→</span>
        </div>
      </div>
    </div>
  );
}
