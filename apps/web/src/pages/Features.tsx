import { Link } from 'react-router-dom';
import { ArrowRight, Shield, Users, CheckCircle } from 'lucide-react';
import Navbar from '@/components/Navbar';
import {
  DarkLayout,
  HockeyFooter,
  SectionHeader,
  CtaBanner,
  FeatureCard,
  GameModeCard,
  MascotAvatar,
  // Hockey iconography — replaces generic lucide
  ScoreboardIcon,
  ShiftIcon,
  CrossedSticksIcon,
  CupIcon,
  DraftIcon,
  PickemIcon,
  SurvivorIcon,
  type AccentName,
} from '@/components/citrus2';

/**
 * Original 6 features from legacy Features.tsx — preserved verbatim per
 * "nothing changes structurally" rule. Just given the citrus2 visual treatment
 * with custom hockey iconography instead of generic lucide.
 */
const CORE_FEATURES: Array<{
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: AccentName;
  scene?: string;
}> = [
  {
    label: 'Stormy AI Assistant',
    scene: '/mascots/scene-stormy-ai.webp',
    desc: 'Data-driven draft advice, trade analysis, and lineup optimization powered by advanced AI and industry-leading projections. Plugged into your roster, scoring, and matchup.',
    icon: ScoreboardIcon,
    accent: 'orange',
  },
  {
    label: 'Live Scoring Updates',
    scene: '/mascots/scene-livescoring.webp',
    desc: 'Real-time scoring updates with live stats and advanced metrics during games. Watch your matchup shift with every shot, hit, block, and save.',
    icon: ShiftIcon,
    accent: 'sage',
  },
  {
    label: 'League Customization',
    desc: 'Deep customization options for scoring, rosters, and playoffs to match your league\'s style. Snake, auction, salary cap. All formats supported.',
    icon: CrossedSticksIcon,
    accent: 'butter',
  },
  {
    label: 'Secure & Reliable',
    desc: 'Enterprise-grade security ensures your league data and personal information are always safe. Row-level security on every table, audit logs on every action.',
    icon: Shield,
    accent: 'peach',
  },
  {
    label: 'Dynasty Support',
    scene: '/mascots/scene-cup.webp',
    desc: 'Built-in tools for keeper and dynasty leagues, including future draft pick trading, contract years, and prospect rankings.',
    icon: CupIcon,
    accent: 'orange',
  },
  {
    label: 'Draft Tools',
    scene: '/mascots/scene-draft.webp',
    desc: 'Mock drafts against AI managers, cheat sheets, ADP rankings, and live draft rooms with chat. Build your championship team with confidence.',
    icon: DraftIcon,
    accent: 'sage',
  },
];

const FORMATS: Array<{
  label: string;
  sub: string;
  badge: string;
  accent: AccentName;
  icon: React.ComponentType<{ className?: string }>;
  to: string;
  scene?: string;
}> = [
  {
    label: 'Snake / Auction / Salary',
    scene: '/mascots/scene-squad.webp',
    sub: 'Run any league format. Custom scoring, commish tools, live draft rooms.',
    badge: 'Fantasy',
    accent: 'orange',
    icon: CrossedSticksIcon,
    to: '/create-league',
  },
  {
    label: 'Daily Pickem',
    scene: '/mascots/scene-pickem.webp',
    sub: 'Pick the winner of every NHL game. Straight up. No spreads, no over-unders.',
    badge: 'Daily',
    accent: 'sage',
    icon: PickemIcon,
    to: '/pool/pickem',
  },
  {
    label: 'Survivor Pool',
    scene: '/mascots/scene-survivor.webp',
    sub: "One pick a week, can't reuse teams. Lose once and you're in the sin bin.",
    badge: 'Weekly',
    accent: 'butter',
    icon: SurvivorIcon,
    to: '/pool/survivor',
  },
  {
    label: 'Stanley Cup Brackets',
    scene: '/mascots/scene-cup.webp',
    sub: 'Predict the entire playoff run. Confidence-weighted scoring all the way to the Cup.',
    badge: 'Apr–Jun',
    accent: 'peach',
    icon: CupIcon,
    to: '/nhl/playoffs',
  },
];

export default function Features() {
  return (
    <DarkLayout>
      <Navbar />

      <main>
        {/* Hero */}
        <section className="relative max-w-[1280px] mx-auto px-6 pt-12 pb-12 md:pt-28 md:pb-16 text-center">
          <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-4 font-bold">
            Features
          </div>
          <h1 className="font-sans font-black text-[2.5rem] sm:text-[3rem] md:text-[4.5rem] leading-[0.98] tracking-[-0.035em] text-pastel-cream mb-6 max-w-3xl mx-auto">
            Every tool a hockey head{' '}
            <span className="text-pastel-orange">actually wants</span>.
          </h1>
          <p className="text-[15px] md:text-[18px] leading-relaxed text-white/65 max-w-xl mx-auto mb-8 md:mb-10 px-4">
            Citrus is built for people who watch every game, refresh every box score, and care
            about xGF%. Here's everything that ships in the platform. No upsells, and no premium
            tier held back behind a paywall.
          </p>
          <Link
            to="/create-league"
            className="group inline-flex items-center gap-2 bg-pastel-orange text-[#581E00] text-[15px] font-bold px-7 rounded-md hover:bg-pastel-orange-soft hover:-translate-y-0.5 transition-all duration-200 shadow-[0_8px_24px_-8px_rgba(255,107,26,0.5)]"
            style={{ height: '52px' }}
          >
            <span>Drop the Puck</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
          </Link>
        </section>

        {/* Core platform features */}
        <section className="relative max-w-[1280px] mx-auto px-6 pb-16 md:pb-24">
          <SectionHeader
            eyebrow="Core platform"
            title="The data that wins championships."
            sub="Six pillars of the Citrus platform. All free during launch, founders pricing locked in for early users."
            align="center"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CORE_FEATURES.map((f) => (
              <FeatureCard key={f.label} {...f} />
            ))}
          </div>
        </section>

        {/* League formats */}
        <section className="relative max-w-[1280px] mx-auto px-6 pb-16 md:pb-24">
          <SectionHeader
            eyebrow="League Formats"
            title="Every way to play hockey."
            sub="Pick the format that fits your group. Spin one up in 30 seconds."
            align="center"
          />
          <div className="flex gap-4 overflow-x-auto pb-4 -mx-6 px-6 snap-x snap-mandatory">
            {FORMATS.map((g) => (
              <GameModeCard key={g.label} {...g} />
            ))}
          </div>
        </section>

        {/* Stormy callout */}
        <section className="relative max-w-[1280px] mx-auto px-6 pb-16 md:pb-24">
          <div className="bg-pastel-surface-tile border border-white/10 rounded-3xl p-6 md:p-10 lg:p-14 grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-6 lg:gap-8 items-center">
            <div className="flex justify-center lg:justify-start">
              <MascotAvatar id="stormy" size="xl" />
            </div>
            <div>
              <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-2 font-bold">
                Stormy · Assistant GM
              </div>
              <h2 className="font-sans font-black text-[1.75rem] md:text-[2.5rem] tracking-[-0.025em] text-pastel-cream leading-tight mb-4">
                Your AI assistant GM, in every league.
              </h2>
              <p className="text-[14px] md:text-[15px] text-white/65 leading-relaxed mb-6 max-w-2xl">
                Stormy is plugged into your roster, your scoring settings, and your matchup. Ask
                start/sit, trade analysis, waiver targets. He answers in real hockey advanced
                stats: xGF%, Corsi, TOI, PP1 share, save%, and he names the source of every one.
              </p>
              <Link
                to="/gm-office/stormy"
                className="inline-flex items-center gap-2 bg-pastel-orange text-[#581E00] text-[14px] font-bold px-5 h-11 rounded-md hover:bg-pastel-orange-soft transition-colors"
              >
                Try Stormy <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
              </Link>
            </div>
          </div>
        </section>

        <CtaBanner
          eyebrow="🏒 Stanley Cup Playoffs · Live now"
          eyebrowPulse
          title={
            <>
              Get on the ice <span className="text-pastel-orange">tonight</span>.
            </>
          }
          sub="Free during launch · Founders pricing locked in for early users"
          ctaLabel="Create your league"
          ctaHref="/create-league"
        />
      </main>

      <HockeyFooter />
    </DarkLayout>
  );
}
