import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function PremiumCTA() {
  return (
    <section className="bg-gradient-to-b from-premium-bg to-premium-bg-deep border-t border-premium-border">
      <div className="max-w-[1100px] mx-auto px-6 py-32 lg:py-40 text-center">
        <div className="flex items-center gap-2 justify-center mb-8">
          <span className="block w-1.5 h-1.5 bg-premium-orange flex-shrink-0" />
          <span className="font-caps text-[11px] tracking-[0.2em] text-premium-text-muted uppercase">
            Championship Ready
          </span>
        </div>

        <h2 className="font-editorial text-5xl md:text-6xl lg:text-7xl leading-[1.02] tracking-[-0.02em] text-premium-text mb-8">
          Built for people who actually watch hockey.
        </h2>

        <p className="font-premium-body text-lg leading-relaxed text-premium-text-muted max-w-xl mx-auto mb-14">
          No microtransactions. No tiered "Pro" features. No fluff. The smartest projection system in fantasy hockey, free during beta.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-14 max-w-3xl mx-auto pb-14 border-b border-premium-border">
          {[
            { value: '1.2M', label: 'Plays Nightly' },
            { value: '31', label: 'Model Features' },
            { value: '2.4%', label: 'Mean Error' },
            { value: '100%', label: 'Live Data' },
          ].map((m) => (
            <div key={m.label}>
              <div className="font-caps text-3xl md:text-4xl tracking-wider text-premium-text mb-1 leading-none">
                {m.value}
              </div>
              <div className="font-caps text-[10px] tracking-[0.18em] text-premium-text-dim uppercase">
                {m.label}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <Link
            to="/create-league"
            className="group inline-flex items-center gap-2 bg-premium-orange text-premium-orange-deep font-caps text-[13px] tracking-[0.15em] px-8 h-14 hover:bg-premium-orange-soft transition-colors"
          >
            <span>START A TEST LEAGUE</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
          </Link>
          <Link
            to="/auth"
            className="font-premium-body text-sm text-premium-text-muted hover:text-premium-text transition-colors"
          >
            Already have an account? <span className="text-premium-orange">Sign in →</span>
          </Link>
        </div>

        <p className="font-premium-body text-[11px] text-premium-text-dim mt-10">
          No credit card · 8 minutes to first lineup · Free during beta
        </p>
      </div>
    </section>
  );
}
