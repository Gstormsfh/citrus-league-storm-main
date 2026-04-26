import { TrendingUp, Calendar, Zap, MessageSquare, BarChart3, Activity, LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export default function PremiumFeatures() {
  return (
    <section className="bg-premium-bg-deep">
      <div className="max-w-[1400px] mx-auto px-6 py-24 lg:py-32">
        <div className="mb-16 max-w-3xl">
          <div className="flex items-center gap-2 mb-6">
            <span className="block w-1.5 h-1.5 bg-premium-orange flex-shrink-0" />
            <span className="font-caps text-[11px] tracking-[0.2em] text-premium-text-muted uppercase">
              The Edge
            </span>
          </div>
          <h2 className="font-editorial text-4xl md:text-5xl lg:text-6xl leading-[1.05] tracking-[-0.015em] text-premium-text">
            Six reasons we win where Yahoo loses.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-premium-border">
          <FeatureCard icon={TrendingUp} eyebrow="The Model" title="31-feature xG">
            Bayesian shrinkage. Pass-context adjustments. Deployment, line chemistry, zone entries — everything Yahoo's 2015-era counting stats can't see.
            <ScatterMini />
          </FeatureCard>

          <FeatureCard icon={Calendar} eyebrow="Schedule" title="Saturday Finishes">
            Your week ends with 12 games on the ice — not Sunday morning when three teams play and your opponent already won.
            <CalendarMini />
          </FeatureCard>

          <FeatureCard icon={Zap} eyebrow="Real Time" title="Live Everything">
            Goal scored. Score updates in 14 seconds. No two-hour-stale matchup view. No "wait, did that just count?"
            <LiveMini />
          </FeatureCard>

          <FeatureCard icon={MessageSquare} eyebrow="Stormy AI" title="AI you can actually use">
            Real analysis grounded in YOUR roster, YOUR scoring, YOUR matchup. Not generic "monitor the situation" garbage.
            <ChatMini />
          </FeatureCard>

          <FeatureCard icon={BarChart3} eyebrow="Advanced" title="Deployment-Aware">
            PP1, PP2, even-strength TOI splits factored in. Demoted to PP2 last night? We see it before you do.
            <DeploymentMini />
          </FeatureCard>

          <FeatureCard icon={Activity} eyebrow="Confidence" title="Monte Carlo Ranges">
            Floor to ceiling. P10 to P90. Know the upside and downside — not just a single brittle point estimate.
            <DistributionMini />
          </FeatureCard>
        </div>
      </div>
    </section>
  );
}

function FeatureCard({
  icon: Icon,
  eyebrow,
  title,
  children,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  // children is [body text, mini viz] — split them
  const items = Array.isArray(children) ? children : [children];
  const body = items.find((c) => typeof c === 'string');
  const viz = items.find((c) => typeof c !== 'string');

  return (
    <div className="bg-premium-bg p-8 md:p-10 flex flex-col gap-6 hover:bg-premium-surface transition-colors duration-300">
      <div className="h-20 flex items-end">{viz}</div>

      <div className="flex-1">
        <div className="flex items-center gap-3 mb-3">
          <Icon className="w-4 h-4 text-premium-orange" strokeWidth={1.5} />
          <span className="font-caps text-[10px] tracking-[0.2em] text-premium-text-dim uppercase">
            {eyebrow}
          </span>
        </div>
        <h3 className="font-editorial text-2xl md:text-3xl leading-tight tracking-tight text-premium-text mb-3">
          {title}
        </h3>
        <p className="font-premium-body text-sm leading-relaxed text-premium-text-muted">{body}</p>
      </div>
    </div>
  );
}

function ScatterMini() {
  const dots = [
    { x: 15, y: 70, hot: false }, { x: 25, y: 55, hot: false }, { x: 35, y: 50, hot: true },
    { x: 45, y: 40, hot: true }, { x: 55, y: 35, hot: true }, { x: 65, y: 28, hot: true },
    { x: 75, y: 22, hot: true }, { x: 85, y: 15, hot: true }, { x: 30, y: 65, hot: false },
    { x: 50, y: 30, hot: true }, { x: 70, y: 25, hot: true }, { x: 80, y: 20, hot: true },
  ];
  return (
    <svg viewBox="0 0 100 80" className="w-full h-full" aria-hidden="true">
      <line x1="10" y1="75" x2="90" y2="10" stroke="#FF6B1A" strokeWidth="0.5" strokeOpacity="0.4" strokeDasharray="2 2" />
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r="1.6" fill={d.hot ? '#FF6B1A' : '#A8B0A6'} fillOpacity="0.85" />
      ))}
    </svg>
  );
}

function CalendarMini() {
  return (
    <svg viewBox="0 0 100 80" className="w-full h-full" aria-hidden="true">
      {[...Array(4)].map((_, week) =>
        [...Array(7)].map((_, day) => (
          <rect
            key={`${week}-${day}`}
            x={5 + day * 13}
            y={8 + week * 16}
            width="11"
            height="13"
            fill={day === 6 ? '#FF6B1A' : '#262B28'}
            fillOpacity={day === 6 ? '1' : '0.55'}
          />
        )),
      )}
    </svg>
  );
}

function LiveMini() {
  return (
    <svg viewBox="0 0 100 80" className="w-full h-full" aria-hidden="true">
      <polyline points="5,60 18,55 32,50 45,45 58,38 70,30 85,18 85,75 5,75" fill="#FF6B1A" fillOpacity="0.18" stroke="none" />
      <polyline points="5,60 18,55 32,50 45,45 58,38 70,30 85,18" fill="none" stroke="#FF6B1A" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="85" cy="18" r="2.8" fill="#FF6B1A">
        <animate attributeName="r" values="2.8;3.8;2.8" dur="1.5s" repeatCount="indefinite" />
        <animate attributeName="fill-opacity" values="1;0.5;1" dur="1.5s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

function ChatMini() {
  return (
    <svg viewBox="0 0 100 80" className="w-full h-full" aria-hidden="true">
      <rect x="40" y="10" width="55" height="14" fill="#262B28" />
      <line x1="44" y1="15" x2="83" y2="15" stroke="#A8B0A6" strokeWidth="1" />
      <line x1="44" y1="19" x2="72" y2="19" stroke="#A8B0A6" strokeWidth="1" strokeOpacity="0.6" />

      <rect x="5" y="32" width="65" height="14" fill="#FF6B1A" fillOpacity="0.85" />
      <line x1="9" y1="37" x2="63" y2="37" stroke="#0F1411" strokeWidth="1" strokeOpacity="0.7" />
      <line x1="9" y1="41" x2="50" y2="41" stroke="#0F1411" strokeWidth="1" strokeOpacity="0.5" />

      <rect x="40" y="55" width="40" height="14" fill="#262B28" />
      <line x1="44" y1="60" x2="73" y2="60" stroke="#A8B0A6" strokeWidth="1" />
      <line x1="44" y1="64" x2="65" y2="64" stroke="#A8B0A6" strokeWidth="1" strokeOpacity="0.6" />
    </svg>
  );
}

function DeploymentMini() {
  const bars = [
    { pp1: 50, pp2: 25, even: 25 },
    { pp1: 35, pp2: 20, even: 45 },
    { pp1: 65, pp2: 15, even: 20 },
    { pp1: 20, pp2: 30, even: 50 },
  ];
  return (
    <svg viewBox="0 0 100 80" className="w-full h-full" aria-hidden="true">
      {bars.map((bar, i) => {
        const x = 6 + i * 23;
        const total = bar.pp1 + bar.pp2 + bar.even;
        const totalH = 60;
        const pp1H = (bar.pp1 / total) * totalH;
        const pp2H = (bar.pp2 / total) * totalH;
        const evenH = (bar.even / total) * totalH;
        const baseY = 72;
        return (
          <g key={i}>
            <rect x={x} y={baseY - evenH} width="17" height={evenH} fill="#262B28" />
            <rect x={x} y={baseY - evenH - pp2H} width="17" height={pp2H} fill="#A8B0A6" fillOpacity="0.6" />
            <rect x={x} y={baseY - evenH - pp2H - pp1H} width="17" height={pp1H} fill="#FF6B1A" />
          </g>
        );
      })}
    </svg>
  );
}

function DistributionMini() {
  return (
    <svg viewBox="0 0 100 80" className="w-full h-full" aria-hidden="true">
      <path
        d="M 5,72 Q 22,72 32,58 Q 42,18 50,12 Q 58,18 68,58 Q 78,72 95,72 Z"
        fill="#FF6B1A"
        fillOpacity="0.22"
        stroke="#FF6B1A"
        strokeWidth="1.2"
      />
      <line x1="50" y1="10" x2="50" y2="75" stroke="#FFFFFF" strokeWidth="1" strokeOpacity="0.85" />
      <line x1="28" y1="68" x2="28" y2="76" stroke="#A8B0A6" strokeWidth="1" />
      <line x1="72" y1="68" x2="72" y2="76" stroke="#A8B0A6" strokeWidth="1" />
      <text x="28" y="79" fontSize="5" fill="#6B7368" textAnchor="middle" fontFamily="Inter">P10</text>
      <text x="50" y="79" fontSize="5" fill="#FFFFFF" textAnchor="middle" fontFamily="Inter">μ</text>
      <text x="72" y="79" fontSize="5" fill="#6B7368" textAnchor="middle" fontFamily="Inter">P90</text>
    </svg>
  );
}
