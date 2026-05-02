import { Link } from 'react-router-dom';
import Navbar from '@/components/Navbar';
import { ArrowRight, Check, Sparkles, Crown } from 'lucide-react';
import {
  DarkLayout,
  HockeyFooter,
  SectionHeader,
  CtaBanner,
  Faq,
  GlowCard,
  type FaqEntry,
} from '@/components/citrus2';

const FREE_FEATURES = [
  'Unlimited fantasy leagues',
  'Snake, auction, and salary cap drafts',
  'Live shift-level scoring',
  '31-feature xG projections',
  'Stormy AI assistant GM',
  'Pickem, Survivor, Confidence pools',
  'Stanley Cup brackets',
  'Mock drafts (12-team vs AI)',
  'League chat',
  'Trade analyzer',
  'No ads, no paywalls',
];

const PRO_TEASE = [
  'Everything in Free',
  'Stormy Pro — priority answers, deeper analysis',
  'Custom scoring presets',
  'Advanced commish tools',
  'Multi-league dashboard',
  'Early access to new features',
];

const FAQ: FaqEntry[] = [
  {
    q: 'Is it really free during launch?',
    a: "Yes. Every feature on Citrus today is free — no credit card, no trial expiration, no upsell. We're building the brand and the user base first. Monetization comes later.",
  },
  {
    q: 'What does "founders pricing locked in" mean?',
    a: "Anyone who creates an account during the free launch period gets a permanent discount on whatever paid tiers we eventually launch. If Stormy Pro ends up at $5/mo for new users, founders will pay less for life. Exact discount TBD but always favorable.",
  },
  {
    q: "What's coming in the paid tiers?",
    a: "We're working on Stormy Pro (faster, deeper AI answers), advanced commish tools (custom rules, branded leagues, deeper standings analytics), and a multi-league dashboard for managers in 5+ leagues. None of these are launched yet — just teasing what's on the roadmap.",
  },
  {
    q: 'Will the free tier get worse when paid launches?',
    a: "No. Everything that ships free today stays free forever. Paid tiers add new things, they don't remove existing ones. We hate the bait-and-switch playbook as much as you do.",
  },
];

export default function Pricing() {
  return (
    <DarkLayout>

      <Navbar />

      <main>
        {/* Hero */}
        <section className="relative max-w-[1280px] mx-auto px-6 pt-28 pb-16 text-center">
          <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-4 font-bold">
            Pricing
          </div>
          <h1 className="font-sans font-black text-[3rem] md:text-[4.5rem] leading-[0.98] tracking-[-0.035em] text-pastel-cream mb-6 max-w-3xl mx-auto">
            Free during launch.<br />
            <span className="text-pastel-orange">Founders pricing for life.</span>
          </h1>
          <p className="text-[16px] md:text-[18px] leading-relaxed text-white/65 max-w-xl mx-auto">
            Every feature on Citrus is free today. Sign up now and you'll lock in founders pricing
            on whatever paid tiers launch later — for as long as you keep your account.
          </p>
        </section>

        {/* Two-card pricing — with mascot anchors per Sleeper brand layering */}
        <section className="relative max-w-[1100px] mx-auto px-6 pb-20 grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Free / Launch tier — Lemon (the scorer) anchors this one */}
          <GlowCard accent="orange">
            <article className="relative overflow-hidden">
              <div className="relative w-full aspect-[16/9] overflow-hidden">
                <img src="/mascots/scene-squad.webp" alt="The Citrus Squad on the bench" className="w-full h-full object-cover scale-105 group-hover:scale-110 transition-transform duration-500" loading="lazy" />
                <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-16 pointer-events-none" style={{ background: 'linear-gradient(to bottom, transparent 0%, #1A2A20 100%)' }} />
                <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-pastel-orange text-white font-jbmono text-[10px] tracking-[0.22em] uppercase font-bold ring-1 ring-pastel-orange/40 backdrop-blur-md">
                  Available Now
                </div>
              </div>
              <div className="p-6 sm:p-8">
              <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-2 font-bold relative z-10">
                Launch Tier
              </div>
              <h2 className="font-sans font-black text-[2.5rem] text-pastel-cream leading-none mb-1 relative z-10">
                Free
              </h2>
              <div className="font-jbmono text-[11px] text-white/45 mb-6 relative z-10">
                Forever for founding managers
              </div>
              <p className="text-[14px] text-white/65 leading-relaxed mb-6 relative z-10">
                Everything Citrus ships today, no paywall. Lock in founders pricing on future paid
                tiers by signing up now.
              </p>
              <ul className="space-y-2.5 mb-8 relative z-10">
                {FREE_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <Check className="w-4 h-4 text-pastel-sage flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                    <span className="text-[14px] text-pastel-cream leading-snug">{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                to="/create-league"
                className="w-full inline-flex items-center justify-center gap-2 bg-pastel-orange text-white text-[14px] font-bold px-5 rounded-md hover:bg-pastel-orange-deep hover:-translate-y-0.5 transition-all duration-200 active:scale-95 shadow-[0_4px_16px_-4px_rgba(255,107,26,0.5)] relative z-10"
                style={{ height: '48px' }}
              >
                Drop the Puck <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
              </Link>
              </div>
            </article>
          </GlowCard>

          {/* Pro tease — Stormy anchors this one (her Pro tier) */}
          <GlowCard accent="sage">
            <article className="relative overflow-hidden">
              <div className="relative w-full aspect-[16/9] overflow-hidden">
                <img src="/mascots/scene-stormy-ai.webp" alt="Stormy with coach playbook and lineup board" className="w-full h-full object-cover scale-105 group-hover:scale-110 transition-transform duration-500" loading="lazy" />
                <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-16 pointer-events-none" style={{ background: 'linear-gradient(to bottom, transparent 0%, #1A2A20 100%)' }} />
                <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-white/10 text-white/65 font-jbmono text-[10px] tracking-[0.22em] uppercase font-bold ring-1 ring-white/15 backdrop-blur-md">
                  Coming Soon
                </div>
              </div>
              <div className="p-6 sm:p-8">
              <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-sage-soft mb-2 font-bold flex items-center gap-2 relative z-10">
                <Crown className="w-3 h-3" strokeWidth={2.5} /> Stormy Pro + Commish
              </div>
              <h2 className="font-sans font-black text-[2.5rem] text-pastel-cream/85 leading-none mb-1 relative z-10">
                TBD
              </h2>
              <div className="font-jbmono text-[11px] text-white/45 mb-6 relative z-10">
                Founders pricing locked in
              </div>
              <p className="text-[14px] text-white/65 leading-relaxed mb-6 relative z-10">
                Power-user tier launching later this year. Founders get a permanent discount —
                exact pricing not set yet, but always favorable for early users.
              </p>
              <ul className="space-y-2.5 mb-8 relative z-10">
                {PRO_TEASE.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <Sparkles className="w-4 h-4 text-pastel-orange-soft flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                    <span className="text-[14px] text-pastel-cream/80 leading-snug">{f}</span>
                  </li>
                ))}
              </ul>
              <button
                disabled
                className="w-full inline-flex items-center justify-center gap-2 bg-white/5 text-white/55 text-[14px] font-bold px-5 rounded-md cursor-not-allowed ring-1 ring-white/10 relative z-10"
                style={{ height: '48px' }}
              >
                Coming soon — sign up to lock in
              </button>
              </div>
            </article>
          </GlowCard>
        </section>

        {/* FAQ */}
        <section className="relative max-w-[860px] mx-auto px-6 pb-24">
          <SectionHeader eyebrow="FAQ" title="Pricing, answered." align="center" />
          <Faq entries={FAQ} />
        </section>

        <CtaBanner
          title={
            <>
              Free today. <span className="text-pastel-orange">Founders forever.</span>
            </>
          }
          sub="No credit card · No trial expiration · No bait and switch"
          ctaLabel="Create your account"
          ctaHref="/auth"
        />
      </main>

      <HockeyFooter />
    </DarkLayout>
  );
}
