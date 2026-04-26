import { Narwhal } from '@/components/icons/Narwhal';
import { ArrowRight, Send } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function PremiumStormy() {
  return (
    <section className="bg-premium-bg border-t border-premium-border">
      <div className="max-w-[1400px] mx-auto px-6 py-24 lg:py-32">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-20 items-start">
          <div className="lg:col-span-5">
            <Narwhal className="w-16 h-16 text-premium-orange mb-8" strokeWidth={1.5} />

            <div className="flex items-center gap-2 mb-6">
              <span className="block w-1.5 h-1.5 bg-premium-orange flex-shrink-0" />
              <span className="font-caps text-[11px] tracking-[0.2em] text-premium-text-muted uppercase">
                Stormy AI
              </span>
            </div>

            <h2 className="font-editorial text-4xl md:text-5xl lg:text-6xl leading-[1.05] tracking-[-0.015em] text-premium-text mb-6">
              Your AI GM, plugged in.
            </h2>

            <p className="font-premium-body text-lg leading-relaxed text-premium-text-muted max-w-md mb-8">
              Ask Stormy anything. Start or sit decisions. Trade analysis. Waiver claims. Every answer grounded in your league's actual scoring, your roster, your matchup.
            </p>

            <ul className="space-y-3 mb-10">
              {[
                'Knows your league scoring settings cold',
                'Reads your full roster + opponent\'s before answering',
                'Cites real data — xGF%, TOI, PP deployment, Corsi',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="block w-1 h-1 bg-premium-orange flex-shrink-0 mt-2.5" />
                  <span className="font-premium-body text-sm text-premium-text-muted">{item}</span>
                </li>
              ))}
            </ul>

            <Link
              to="/gm-office/stormy"
              className="group inline-flex items-center gap-2 bg-premium-orange text-premium-orange-deep font-caps text-[13px] tracking-[0.15em] px-6 h-12 hover:bg-premium-orange-soft transition-colors"
            >
              <span>TRY STORMY</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
            </Link>
          </div>

          <div className="lg:col-span-7">
            <div className="bg-premium-surface border border-premium-border">
              <div className="flex items-center justify-between px-5 py-4 border-b border-premium-border">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 bg-premium-orange/15 flex items-center justify-center">
                    <Narwhal className="w-4 h-4 text-premium-orange" strokeWidth={2} />
                  </div>
                  <div>
                    <div className="font-caps text-[12px] tracking-[0.15em] text-premium-text uppercase">Stormy</div>
                    <div className="font-premium-body text-[10px] text-premium-text-dim">Your AI GM</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="relative flex w-1.5 h-1.5">
                    <span className="absolute inline-flex w-full h-full bg-premium-orange opacity-75 animate-ping" />
                    <span className="relative inline-flex w-1.5 h-1.5 bg-premium-orange" />
                  </span>
                  <span className="font-caps text-[10px] tracking-widest text-premium-orange">ONLINE</span>
                </div>
              </div>

              <div className="p-6 space-y-5 min-h-[320px]">
                <div className="flex justify-end">
                  <div className="bg-premium-surface-higher px-4 py-3 max-w-[80%]">
                    <p className="font-premium-body text-sm text-premium-text leading-relaxed">
                      Should I start Pettersson or Aho this week?
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="w-7 h-7 bg-premium-orange/15 flex items-center justify-center flex-shrink-0">
                    <Narwhal className="w-4 h-4 text-premium-orange" strokeWidth={2} />
                  </div>
                  <div className="flex-1 max-w-[88%]">
                    <p className="font-premium-body text-sm text-premium-text leading-relaxed">
                      Start <span className="text-premium-orange font-semibold">Aho</span>. His xGF% is <span className="font-mono text-premium-text">58.2%</span> over the last 10. PP1 time <span className="font-mono text-premium-text">2:30/g</span>.
                    </p>
                    <p className="font-premium-body text-sm text-premium-text-muted leading-relaxed mt-3">
                      Pettersson dropped to PP2 after the coaching change — only <span className="font-mono">18:45 TOI</span> last week. Aho/Jarvis line is <span className="font-mono">62% Corsi</span> together. Rangers are giving up <span className="font-mono">3.1 G/game</span> on the road. Easy call.
                    </p>
                  </div>
                </div>
              </div>

              <div className="px-4 py-3 border-t border-premium-border flex items-center gap-3">
                <input
                  type="text"
                  placeholder="Ask Stormy about your fantasy hockey team..."
                  className="flex-1 bg-transparent border-none outline-none font-premium-body text-sm text-premium-text placeholder:text-premium-text-dim"
                  disabled
                />
                <button className="w-8 h-8 bg-premium-orange flex items-center justify-center" aria-label="Send" disabled>
                  <Send className="w-4 h-4 text-premium-orange-deep" strokeWidth={2} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
