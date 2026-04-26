import { Link } from 'react-router-dom';
import {
  ArrowRight,
  TrendingUp,
  Calendar,
  Zap,
  MessageSquare,
  BarChart,
  FileText,
  Trophy,
  Activity,
  Sparkles,
  Flame,
} from 'lucide-react';
import {
  DarkLayout,
  HockeyNav,
  HockeyFooter,
  SectionHeader,
  CtaBanner,
  FeatureCard,
  GameModeCard,
  MascotAvatar,
  type AccentName,
} from '@/components/citrus2';

const CORE_FEATURES = [
  {
    label: '31-Feature xG Model',
    desc: 'XGBoost projections using xGF%, deployment patterns, line chemistry, PP1 share, zone entry rates, and Bayesian shrinkage for low-sample players. The most accurate fantasy hockey projections on the planet.',
    icon: TrendingUp,
  },
  {
    label: 'Saturday Slate',
    desc: 'Fantasy weeks run Sunday through Saturday. Your matchup ends with 12 games on the ice — not Sunday morning when 3 teams are playing and your opponent already won. Drama where it should be.',
    icon: Calendar,
  },
  {
    label: 'Live Shift Scoring',
    desc: 'Every goal, apple, hit, block, and save updates your matchup in real time as the play unfolds. Shift-level precision, not minute-by-minute polling.',
    icon: Zap,
  },
  {
    label: 'Stormy · Assistant GM',
    desc: 'Plugged into your roster, scoring, and matchup. Cites real metrics (xGF%, TOI, PP1 share, save%) instead of "monitor the situation" boilerplate. The assistant GM you wish your team had.',
    icon: MessageSquare,
  },
  {
    label: 'Advanced Metrics Built In',
    desc: 'xGF%, Corsi, PP1 share, deployment splits, zone entry rates, line combo data — all built into player pages. No subscription to a separate site, no spreadsheet exports.',
    icon: BarChart,
  },
  {
    label: 'Monte Carlo Ranges',
    desc: 'Floor / median / ceiling projections per skater per night. Visualized as range bars so you see the upside, not just a single number. Know who has the highest ceiling and who has the safest floor.',
    icon: FileText,
  },
];

const FORMATS: Array<{
  label: string;
  sub: string;
  badge: string;
  accent: AccentName;
  icon: typeof Trophy;
}> = [
  {
    label: 'Snake / Auction / Salary',
    sub: 'Run any league format. Custom scoring, commish tools, live draft rooms.',
    badge: 'Fantasy',
    accent: 'orange',
    icon: Trophy,
  },
  {
    label: 'Daily Pickem',
    sub: 'Pick the winner of every NHL game. Straight up — no spreads, no over-unders.',
    badge: 'Daily',
    accent: 'sage',
    icon: Flame,
  },
  {
    label: 'Survivor Pool',
    sub: 'One pick a week, can\'t reuse teams. Lose once and you\'re in the sin bin.',
    badge: 'Weekly',
    accent: 'butter',
    icon: Activity,
  },
  {
    label: 'Stanley Cup Brackets',
    sub: 'Predict the entire playoff run. Confidence-weighted scoring all the way to the Cup.',
    badge: 'Apr–Jun',
    accent: 'peach',
    icon: Sparkles,
  },
];

export default function Features() {
  return (
    <DarkLayout>
      <HockeyNav promo="🍊 Free during launch · Founders pricing locked in for early users" />

      <main>
        {/* Hero */}
        <section className="relative max-w-[1280px] mx-auto px-6 pt-20 pb-16 text-center">
          <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-4 font-bold">
            Features
          </div>
          <h1 className="font-sans font-black text-[3rem] md:text-[4.5rem] leading-[0.98] tracking-[-0.035em] text-pastel-cream mb-6 max-w-3xl mx-auto">
            Every tool a hockey head{' '}
            <span className="text-pastel-orange">actually wants</span>.
          </h1>
          <p className="text-[16px] md:text-[18px] leading-relaxed text-white/65 max-w-xl mx-auto mb-10">
            Citrus is built for people who watch every game, refresh every box score, and care
            about xGF%. Here's everything that ships in the platform — no upsells, no premium
            tier you have to unlock.
          </p>
          <Link
            to="/create-league"
            className="group inline-flex items-center gap-2 bg-pastel-orange text-white text-[15px] font-bold px-7 rounded-md hover:bg-pastel-orange-deep hover:-translate-y-0.5 transition-all duration-200 shadow-[0_8px_24px_-8px_rgba(255,107,26,0.5)]"
            style={{ height: '52px' }}
          >
            <span>Drop the Puck</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
          </Link>
        </section>

        {/* Core platform features */}
        <section className="relative max-w-[1280px] mx-auto px-6 pb-24">
          <SectionHeader
            eyebrow="Core platform"
            title="The data that wins championships."
            sub="Six things every fantasy hockey manager needs. All free during launch."
            align="center"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CORE_FEATURES.map((f) => (
              <FeatureCard key={f.label} {...f} />
            ))}
          </div>
        </section>

        {/* League formats */}
        <section className="relative max-w-[1280px] mx-auto px-6 pb-24">
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
        <section className="relative max-w-[1280px] mx-auto px-6 pb-24">
          <div className="bg-[#1A2A20] border border-white/10 rounded-3xl p-10 md:p-14 grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-8 items-center">
            <div className="flex justify-center lg:justify-start">
              <MascotAvatar id="stormy" size="xl" />
            </div>
            <div>
              <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-2 font-bold">
                Stormy · Assistant GM
              </div>
              <h2 className="font-sans font-black text-[2rem] md:text-[2.5rem] tracking-[-0.025em] text-pastel-cream leading-tight mb-4">
                Your AI assistant GM, in every league.
              </h2>
              <p className="text-[15px] text-white/65 leading-relaxed mb-6 max-w-2xl">
                Stormy is plugged into your roster, your scoring settings, and your matchup. Ask
                start/sit, trade analysis, waiver targets — she answers in real hockey advanced
                stats: xGF%, Corsi, TOI, PP1 share, save%. Trained on every shift since 2007.
              </p>
              <Link
                to="/gm-office/stormy"
                className="inline-flex items-center gap-2 bg-pastel-orange text-white text-[14px] font-bold px-5 h-11 rounded-md hover:bg-pastel-orange-deep transition-colors"
              >
                Try Stormy <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
              </Link>
            </div>
          </div>
        </section>

        <CtaBanner
          eyebrow="🏒 Stanley Cup Playoffs · Live now"
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
