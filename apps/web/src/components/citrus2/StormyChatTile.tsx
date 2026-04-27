import { MascotAvatar } from './MascotAvatar';

export interface StormyExchange {
  question: string;
  answer: string;
}

/**
 * Q&A bubble pair showing a sample Stormy exchange. Always uses the real
 * Stormy mascot avatar. Pull example exchanges from `StormySection.tsx`'s
 * `demoMessages` array so the voice stays consistent.
 */
export function StormyChatTile({
  exchange,
  variant = 'default',
}: {
  exchange: StormyExchange;
  variant?: 'default' | 'compact';
}) {
  const padding = variant === 'compact' ? 'p-4' : 'p-6';
  return (
    <div className={`bg-[#1A2A20] border border-white/10 rounded-2xl ${padding} shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)]`}>
      <div className="space-y-4">
        {/* User question */}
        <div className="flex justify-end">
          <div className="bg-white/5 rounded-2xl rounded-tr-sm px-4 py-3 max-w-[85%]">
            <div className="font-jbmono text-[10px] tracking-wider uppercase text-white/45 font-bold mb-1">
              YOU
            </div>
            <div className="text-[13px] text-pastel-cream leading-snug">{exchange.question}</div>
          </div>
        </div>
        {/* Stormy answer */}
        <div className="flex items-start gap-3">
          <MascotAvatar id="stormy" size="sm" />
          <div className="bg-pastel-orange/10 ring-1 ring-pastel-orange/20 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%]">
            <div className="font-jbmono text-[10px] tracking-wider uppercase text-pastel-orange-soft font-bold mb-1.5">
              STORMY
            </div>
            <div className="text-[13px] text-pastel-cream leading-relaxed">
              {exchange.answer}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
