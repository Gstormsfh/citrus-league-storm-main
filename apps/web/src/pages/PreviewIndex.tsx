import { Link } from 'react-router-dom';
import { Activity, Trophy, Sparkles } from 'lucide-react';

const VARIANTS = [
  {
    slug: 'clone',
    title: 'Clone',
    tag: 'Direct Sleeper Port · Citrus Colors',
    desc:
      "Section-by-section port of sleeper.com: top promo banner, year-stamped hero with floating UI card stack, horizontal game-mode carousel with player-count badges, Get-Started promos, Pick-Your-Way 4-col grid, testimonials, FAQ, multi-column footer with download CTAs.",
    accent: '#FF6B1A',
    bg: 'from-pastel-surface to-pastel-surface-tile',
    icon: Trophy,
  },
  {
    slug: 'arena',
    title: 'Arena',
    tag: 'Dark Sleeper · Standings Hero',
    desc:
      "Sleeper.com structure on dark forest. Hero shows actual inline live game tile + league standings card (no projections). Horizontal carousel of game modes.",
    accent: '#FF8A3D',
    bg: 'from-pastel-surface to-pastel-surface-tile',
    icon: Activity,
  },
  {
    slug: 'rink',
    title: 'Rink',
    tag: 'Hockey Arena · Iconography Forward',
    desc:
      "Massive hand-drawn SVG hockey goal centerpiece. Faceoff-dot pattern background. Rink-yellow safety stripes top and bottom. Centered bold typography. \"Drop the Puck\" CTA.",
    accent: '#F4C430',
    bg: 'from-[#0A1A10] to-[#142420]',
    icon: Sparkles,
  },
  {
    slug: 'boards',
    title: 'Boards',
    tag: 'Dark Hero + Cream Dashboard',
    desc:
      "Dark forest hero on top (sport identity), cream dashboard tiles below (Stormy AI chat + league standings). Joined by a literal rink-board divider.",
    accent: '#84A57D',
    bg: 'from-pastel-surface via-pastel-surface to-pastel-cream',
    icon: Activity,
  },
];

const PRIOR = [
  { slug: 'stadium', title: 'Stadium (cream Sleeper)' },
  { slug: 'pulse', title: 'Pulse (cream live)' },
  { slug: 'squad', title: 'Squad (cream chat)' },
  { slug: 'almanac', title: 'Orchard Almanac' },
  { slug: 'sunlight', title: 'Sunlight' },
  { slug: 'press', title: 'Citrus Press' },
  { slug: 'redesign', title: 'Pastel Sage Sports' },
];

export default function PreviewIndex() {
  return (
    <div className="min-h-screen bg-pastel-surface text-pastel-cream relative overflow-x-hidden">
      {/* Atmospheric glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full opacity-25 blur-3xl"
        style={{ background: 'radial-gradient(ellipse, #FF6B1A 0%, transparent 60%)' }}
      />

      <header className="relative max-w-[1200px] mx-auto px-6 pt-16 pb-12 text-center">
        <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-4 font-bold">
          Citrus · Design Previews · Dark Sleeper-Esque · 2026
        </div>
        <h1 className="font-sans font-black text-[3rem] md:text-[4.5rem] leading-[0.98] tracking-[-0.03em] text-pastel-cream mb-5">
          Three dark takes,<br />
          <span className="text-pastel-orange">one Citrus brand</span>.
        </h1>
        <p className="text-[16px] md:text-[17px] text-white/60 max-w-2xl mx-auto leading-relaxed">
          Three Sleeper-inspired marketing pages on dark forest backgrounds. No fake phone mockups
          this round — real inline product UI, hockey iconography drawn in code, vibrant orange
          punch. Pick the one that reads sports.
        </p>
      </header>

      <section className="relative max-w-[1240px] mx-auto px-6 pb-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {VARIANTS.map((v) => {
          const Icon = v.icon;
          return (
            <Link
              to={`/preview-${v.slug}`}
              key={v.slug}
              className="group block bg-pastel-surface-tile ring-1 ring-white/10 rounded-[24px] p-5 hover:-translate-y-1 hover:ring-pastel-orange/40 transition-all"
            >
              <div
                className={`aspect-[4/3] rounded-[18px] mb-5 bg-gradient-to-br ${v.bg} ring-1 ring-white/10 flex items-center justify-center relative overflow-hidden`}
              >
                <div
                  aria-hidden="true"
                  className="absolute inset-0 opacity-30 blur-2xl"
                  style={{ background: `radial-gradient(circle at 50% 50%, ${v.accent} 0%, transparent 60%)` }}
                />
                <Icon
                  className="relative w-16 h-16"
                  style={{ color: v.accent }}
                  strokeWidth={1.25}
                />
              </div>
              <div
                className="font-jbmono text-[10px] tracking-[0.32em] uppercase mb-2 font-bold"
                style={{ color: v.accent }}
              >
                {v.tag}
              </div>
              <h3 className="font-sans font-black text-[26px] text-pastel-cream mb-2 leading-tight">
                {v.title}
              </h3>
              <p className="text-[14px] text-white/55 leading-relaxed">{v.desc}</p>
              <div className="mt-5 inline-flex items-center gap-1.5 font-bold text-[14px] text-pastel-cream group-hover:text-pastel-orange-soft transition-colors">
                View this direction
                <span className="group-hover:translate-x-0.5 transition-transform">→</span>
              </div>
            </Link>
          );
        })}
      </section>

      {/* Prior variants */}
      <section className="relative max-w-[1200px] mx-auto px-6 pb-16">
        <details className="bg-white/[0.03] backdrop-blur-md ring-1 ring-white/10 rounded-2xl p-5">
          <summary className="cursor-pointer font-jbmono text-[10px] tracking-[0.32em] uppercase text-white/55 hover:text-pastel-cream font-bold">
            Prior directions (kept for reference) →
          </summary>
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            {PRIOR.map((p) => (
              <Link
                key={p.slug}
                to={`/preview-${p.slug}`}
                className="text-[13px] text-white/55 hover:text-pastel-orange-soft underline underline-offset-4 decoration-1"
              >
                {p.title} →
              </Link>
            ))}
          </div>
        </details>
      </section>

      <footer className="relative max-w-[1200px] mx-auto px-6 pb-12 text-center">
        <p className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/55">
          All three are wired to <code className="font-jbmono not-italic">/preview-*</code> routes · Hidden from production · Reference: sleeper.com (dark)
        </p>
      </footer>
    </div>
  );
}
