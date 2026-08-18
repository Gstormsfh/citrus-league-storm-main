/**
 * The full Citrus 2.0 homepage composition. Used by both `pages/Index.tsx`
 * (production /) and `pages/PreviewClone.tsx` (design canon /preview-clone).
 *
 * Edit copy / structure here once and both routes update together.
 */

import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Navbar from '@/components/Navbar';
import { MASCOT_LIST } from '@/constants/mascots';
import {
  DarkLayout,
  HockeyFooter,
  RotatingHero,
  SectionHeader,
  CtaBanner,
  Faq,
  GameModeCard,
  OnboardingCard,
  FeatureCard,
  MascotCard,
  HeroCardStack,
  StormyChatTile,
  StormyHeroTile,
  PickemTile,
  SurvivorTile,
  BracketTile,
  MascotAvatar,
  // Real hockey iconography — replaces generic lucide
  CupIcon,
  PickemIcon,
  SurvivorIcon,
  BracketIcon,
  DraftIcon,
  CrossedSticksIcon,
  XGModelIcon,
  SlateIcon,
  ShiftIcon,
  ScoreboardIcon,
  RangeIcon,
  type HeroSlide,
  type FaqEntry,
  type AccentName,
} from '@/components/citrus2';

// =============================================================================
// HERO SLIDES — playoffs front and center, fantasy as off-season tease
// =============================================================================

const EAST_SERIES = [
  { high: 'TOR', low: 'OTT', wins: [4, 1] as [number, number], winner: 'TOR' },
  { high: 'BOS', low: 'TBL', wins: [2, 3] as [number, number], winner: null },
  { high: 'NYR', low: 'WSH', wins: [4, 0] as [number, number], winner: 'NYR' },
  { high: 'CAR', low: 'NJD', wins: [3, 2] as [number, number], winner: null },
];

const WEST_SERIES = [
  { high: 'EDM', low: 'LAK', wins: [4, 2] as [number, number], winner: 'EDM' },
  { high: 'COL', low: 'WPG', wins: [3, 3] as [number, number], winner: null },
  { high: 'DAL', low: 'VGK', wins: [4, 3] as [number, number], winner: 'DAL' },
  { high: 'VAN', low: 'NSH', wins: [4, 1] as [number, number], winner: 'VAN' },
];

const PICKEM_GAMES = [
  { away: 'EDM', awayRec: '47-23-8', home: 'COL', homeRec: '49-22-7', picked: 'EDM' },
  { away: 'TOR', awayRec: '46-25-7', home: 'MTL', homeRec: '32-38-8', picked: 'TOR' },
  { away: 'BOS', awayRec: '44-26-8', home: 'NYR', homeRec: '45-24-9', picked: null },
];

const SURVIVOR_PICKS = [
  { week: 1, pick: 'COL', status: 'win' as const },
  { week: 2, pick: 'EDM', status: 'win' as const },
  { week: 3, pick: 'TOR', status: 'win' as const },
  { week: 4, pick: 'BOS', status: 'pending' as const },
];

const STORMY_EXCHANGE = {
  question: 'Start Pettersson or Aho at C tonight?',
  answer:
    'Aho. xGF% 58.2% last 10, 2:30 PP1 time. Pettersson dropped to 18:45 TOI after the line shuffle. Easy call.',
};


// Inline component to render a mascot action scene as a slide visual. Uses
// the same scene assets that drive the GameModeCard hero zone — mascots
// doing the thing each slide describes.
function SceneVisual({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="relative w-full aspect-square max-w-[480px] mx-auto rounded-3xl overflow-hidden ring-1 ring-white/10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)]">
      <img src={src} alt={alt} className="w-full h-full object-cover" loading="eager" />
    </div>
  );
}

// SWEEP FIX (2026-08-16): the carousel led with "Stanley Cup Playoffs ·
// Live now" — in August, months after the Cup was lifted. The season-long
// fantasy slide (the actual live product, drafts open) now leads; the
// brackets slide is seasonal-honest and moved to the back. Opening-night
// date corrected to the ingested 2026-27 schedule (Sep 29, not Oct 8).
function getHeroSlides(): HeroSlide[] {
  return [
    {
      id: 'fantasy',
      eyebrow: 'Fantasy Hockey 2026 · Drafts open · Puck drops Sep 29',
      headline: { lead: 'Fantasy Hockey', accent: '2026' },
      sub: 'A 31-feature xG model. Live shift-level scoring. Snake, auction, or salary-cap drafts. Built by hockey heads, for hockey heads. Lock in founders pricing now.',
      primary: { label: 'Drop the Puck', to: '/create-league' },
      secondary: { label: 'Try a mock draft →', to: '/draft' },
      visual: <SceneVisual src="/mascots/scene-squad.webp" alt="The Citrus Squad on the bench" />,
    },
    {
      id: 'pickem',
      eyebrow: 'Pickem · Daily · Free',
      headline: { lead: 'Pick tonight.', accent: 'Pick every night.' },
      sub: 'Pick the winner of every NHL game on the slate. Straight up — no spreads, no over-unders. Locks at puck drop, settled at the final horn. Climb the league leaderboard.',
      primary: { label: 'Drop In', to: '/pool/pickem' },
      secondary: { label: "Tonight's slate →", to: '/pool/pickem' },
      visual: <SceneVisual src="/mascots/scene-pickem.webp" alt="Lemon picking between EDM and COL" />,
    },
    {
      id: 'survivor',
      eyebrow: 'Survivor · Weekly · Free',
      headline: { lead: 'One pick a week.', accent: "Don't lose" },
      sub: "Pick one team to win each week. Use any team only once all season. Lose your pick and you're in the sin bin — eliminated. Last manager standing takes the pool.",
      primary: { label: 'Last One Standing', to: '/pool/survivor' },
      secondary: { label: 'How it works →', to: '/pool/survivor' },
      visual: <SceneVisual src="/mascots/scene-survivor.webp" alt="Kiwi alone in the spotlight" />,
    },
    {
      id: 'stormy',
      eyebrow: 'Stormy · Assistant GM · Free during launch',
      // SWEEP FIX (2026-08-16): "An assistant GM who" overflowed the
      // viewport edge at tablet widths — shorter lead line wraps cleanly.
      headline: { lead: 'An assistant GM', accent: 'who knows hockey' },
      sub: 'Stormy is plugged into your roster, scoring, and matchup. She cites xGF%, TOI, PP1 share, save% — never generic boilerplate. The AI assistant GM you wish your team had.',
      primary: { label: 'Talk to Stormy', to: '/gm-office/stormy' },
      secondary: { label: 'See an example →', to: '#stormy' },
      visual: <SceneVisual src="/mascots/scene-stormy-ai.webp" alt="Stormy with coach playbook and lineup board" />,
    },
    {
      id: 'brackets',
      eyebrow: '🏒 Stanley Cup Playoff Brackets · Returns in April',
      headline: { lead: 'Lift the', accent: 'Cup' },
      sub: 'Predict the entire Stanley Cup playoffs round-by-round — First Round, Second Round, Conference Finals, Cup Final. Live bracket updates every 60 seconds when the field is set.',
      primary: { label: 'See How Brackets Work', to: '/nhl/playoffs' },
      secondary: { label: 'Last season’s bracket →', to: '/nhl/playoffs' },
      visual: <SceneVisual src="/mascots/scene-cup.webp" alt="Pineapple lifting the Stanley Cup" />,
    },
  ];
}

// =============================================================================
// SECTION DATA
// =============================================================================

const GAME_MODES: Array<{
  label: string;
  sub: string;
  badge: string;
  accent: AccentName;
  icon: React.ComponentType<{ className?: string }>;
  to: string;
  scene?: string;
}> = [
  {
    label: 'Fantasy Hockey',
    scene: '/mascots/scene-squad.webp',
    sub: 'Snake, auction, or salary cap. Custom scoring, commish tools, live draft rooms.',
    badge: 'Free',
    accent: 'orange',
    icon: CrossedSticksIcon,
    to: '/create-league',
  },
  {
    label: 'Daily Pickem',
    scene: '/mascots/scene-pickem.webp',
    sub: "Pick tonight's winners. Settled when the final horn sounds.",
    badge: 'Daily',
    accent: 'sage',
    icon: PickemIcon,
    to: '/pool/pickem',
  },
  {
    label: 'Survivor Pool',
    scene: '/mascots/scene-survivor.webp',
    sub: "One pick a week. Win or you're in the sin bin. Last manager standing takes it.",
    badge: 'Weekly',
    accent: 'butter',
    icon: SurvivorIcon,
    to: '/pool/survivor',
  },
  {
    label: 'Confidence Pool',
    scene: '/mascots/scene-confidence.webp',
    sub: 'Weighted weekly picks. Rank your confidence, multiply your edge.',
    badge: 'Weekly',
    accent: 'peach',
    icon: ScoreboardIcon,
    to: '/pool/confidence',
  },
  {
    label: 'Stanley Cup Brackets',
    scene: '/mascots/scene-cup.webp',
    sub: 'Predict the entire playoff run. Confidence-weighted scoring all the way to the Cup.',
    badge: 'Apr–Jun',
    accent: 'orange',
    icon: CupIcon,
    to: '/nhl/playoffs',
  },
  {
    label: 'Mock Draft',
    scene: '/mascots/scene-draft.webp',
    sub: 'Spin up a 12-team mock against AI managers. No signup, instant draft room.',
    badge: 'Anytime',
    accent: 'sage',
    icon: DraftIcon,
    to: '/draft',
  },
];

const ONBOARDING_CARDS: Array<{
  title: string;
  body: string;
  cta: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: AccentName;
  to: string;
  mascotPeek?: 'stormy' | 'lemon' | 'kiwi' | 'pineapple';
}> = [
  {
    title: 'Drop the Puck',
    body: 'Snake, auction, or salary cap. Pick your scoring, drop the invite in the group chat, draft this weekend.',
    cta: 'Start a league',
    icon: CrossedSticksIcon,
    accent: 'orange',
    to: '/create-league',
    mascotPeek: 'lemon',
  },
  {
    title: 'Run a Mock',
    body: 'A 12-team mock against AI managers. No signup, instant draft room — see the projections rip live.',
    cta: 'Mock now',
    icon: DraftIcon,
    accent: 'sage',
    to: '/draft',
    mascotPeek: 'kiwi',
  },
  {
    title: 'Chirp at Stormy',
    body: 'Ask the assistant GM anything — a roster move, a matchup edge, a trade. She cites xGF%, Corsi, TOI before answering.',
    cta: 'Open Stormy',
    icon: ShiftIcon,
    accent: 'butter',
    to: '/gm-office/stormy',
    mascotPeek: 'stormy',
  },
];

const REAL_FEATURES: Array<{
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: AccentName;
  scene?: string;
}> = [
  {
    label: '31-Feature xG Model',
    scene: '/mascots/scene-xg-model.webp',
    desc: 'XGBoost projections using xGF%, deployment, line chemistry, and Bayesian shrinkage.',
    icon: XGModelIcon,
    accent: 'orange',
  },
  {
    label: 'Saturday Slate',
    desc: 'Sun–Sat weeks. Your matchup ends with 12 games on the ice, not Sunday morning when 3 teams play.',
    icon: SlateIcon,
    accent: 'sage',
  },
  {
    label: 'Live Shift Scoring',
    scene: '/mascots/scene-livescoring.webp',
    desc: 'Every goal, apple, hit, block updates your matchup in real time as the play unfolds.',
    icon: ShiftIcon,
    accent: 'butter',
  },
  {
    label: 'Stormy · Assistant GM',
    scene: '/mascots/scene-stormy-ai.webp',
    desc: 'Plugged into your roster, scoring, and matchup. Real hockey advice, not generic boilerplate.',
    icon: ScoreboardIcon,
    accent: 'peach',
  },
  {
    label: 'Advanced Metrics',
    desc: 'xGF%, Corsi, PP1 share, deployment splits, zone entry rates — built in, no extra subscription.',
    icon: XGModelIcon,
    accent: 'sage',
  },
  {
    label: 'Monte Carlo Ranges',
    desc: 'Floor / median / ceiling per skater per night. See the upside, not just a single number.',
    icon: RangeIcon,
    accent: 'orange',
  },
];

const MASCOT_ACCENTS: AccentName[] = ['orange', 'butter', 'sage', 'peach'];

const FAQ: FaqEntry[] = [
  {
    q: 'How does Citrus work?',
    a: "Create or join a fantasy hockey league. Draft your roster — snake, auction, or salary cap. Set your lineup before puck drop each day. Live shift-level scoring updates your matchup in real time. Stormy, your AI assistant GM, answers questions about your roster, matchup, or trades.",
  },
  {
    q: 'Is Citrus free?',
    a: "Yes — leagues, mock drafts, projections, Stormy are all free during launch. We're building a Stormy Pro tier and advanced commish tools for power managers later this year, but anyone who joins now gets founders pricing locked in.",
  },
  {
    q: 'What makes your projections different?',
    a: "A 31-feature XGBoost xG model with Bayesian shrinkage for low-sample players. xGF%, deployment patterns, line combos, PP1 time, zone entry rates. Each projection is a Monte Carlo distribution — floor, median, and ceiling for every skater, every night.",
  },
  {
    q: 'What league formats do you support?',
    a: "Snake, linear, auction, salary cap, and autopick drafts. Head-to-head points, head-to-head categories, roto, total points, points-per-game, and best-ball scoring. Plus pickem, survivor, confidence pools, and Stanley Cup brackets.",
  },
  {
    q: "How does Stormy actually help? Isn't AI just hot air?",
    a: "Stormy is plugged into your league — your roster, your scoring settings, your matchup. Ask start/sit, trade analysis, waiver targets. She cites real metrics (xGF%, TOI, PP1 time, save%) rather than 'monitor the situation' boilerplate. She's the assistant GM you'd want.",
  },
  {
    q: 'Where is Citrus available?',
    a: 'Web app, anywhere with a browser. Mobile-optimized — works great on a phone, no install required.',
  },
];

// =============================================================================
// HOMEPAGE COMPOSITION
// =============================================================================

export function Homepage() {
  const slides = getHeroSlides();

  return (
    <DarkLayout>
      {/* Legacy Navbar — preserves league switcher, notifications, profile dropdown,
          and playoff bracket access. Sits above the dark page. */}
      <Navbar />

      {/* Promo banner below the nav */}
      <div className="relative z-10 bg-gradient-to-r from-pastel-orange/15 via-pastel-orange/25 to-pastel-orange/15 border-y border-pastel-orange/30">
        <div className="max-w-[1280px] mx-auto px-6 py-2 text-center">
          <span className="font-jbmono text-[11px] tracking-[0.18em] uppercase text-pastel-orange-soft font-bold">
            🍊 Free during launch · Founders pricing locked in for early users
          </span>
        </div>
      </div>

      <RotatingHero slides={slides} />

      {/* Trust strip — what's real about Citrus, no fake numbers */}
      <section className="relative max-w-[1280px] mx-auto px-6 pb-16">
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/45 border-t border-white/5 pt-6">
          <span className="text-pastel-sage-soft">31 model features</span>
          <span className="text-white/20">·</span>
          <span className="text-pastel-sage-soft">Sun–Sat weeks</span>
          <span className="text-white/20">·</span>
          <span className="text-pastel-sage-soft">Live shift scoring</span>
          <span className="text-white/20">·</span>
          <span className="text-pastel-sage-soft">Stormy assistant GM</span>
          <span className="text-white/20">·</span>
          <span className="text-pastel-sage-soft">Founders pricing</span>
        </div>
      </section>

      {/* Game Modes — horizontal carousel of all available formats */}
      <section className="relative max-w-[1280px] mx-auto px-6 pb-24">
        <div className="flex items-baseline justify-between mb-8 gap-4 flex-wrap">
          <div>
            <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-2 font-bold">
              ✦ Game Modes
            </div>
            <h2 className="font-sans font-black text-[2.25rem] md:text-[2.75rem] tracking-[-0.025em] text-pastel-cream leading-tight">
              Every way to play hockey.
            </h2>
          </div>
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/40">
            Scroll for more →
          </span>
        </div>
        <div className="flex gap-4 overflow-x-auto pb-4 -mx-6 px-6 snap-x snap-mandatory">
          {GAME_MODES.map((g) => (
            <GameModeCard key={g.label} {...g} />
          ))}
        </div>
      </section>

      {/* Three Ways In */}
      <section className="relative max-w-[1280px] mx-auto px-6 pb-24">
        <SectionHeader
          eyebrow="Three Ways In"
          title="Pick where to start."
          align="center"
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {ONBOARDING_CARDS.map((c) => (
            <OnboardingCard key={c.title} {...c} ctaLabel={c.cta} />
          ))}
        </div>
      </section>

      {/* What You Get — real product features */}
      <section className="relative max-w-[1280px] mx-auto px-6 pb-24">
        <SectionHeader
          eyebrow="What You Get"
          title="The data that wins championships."
          sub="Every feature below ships free during launch. Stormy Pro and advanced league tools are in the works — early users get founders pricing for life."
          align="center"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {REAL_FEATURES.map((f) => (
            <FeatureCard key={f.label} {...f} />
          ))}
        </div>
      </section>

      {/* Roll Call — The Citrus Squad */}
      <section className="relative max-w-[1280px] mx-auto px-6 pb-24">
        <SectionHeader
          eyebrow="Roll Call"
          title="The Citrus Squad."
          sub="Four characters who live inside the app. Stormy runs the bench; Lemon, Kiwi, and Pineapple show up in drafts, matchups, and the league chat."
          align="center"
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {MASCOT_LIST.map((m, i) => (
            <MascotCard key={m.id} id={m.id} accent={MASCOT_ACCENTS[i]} />
          ))}
        </div>
      </section>

      {/* Stormy deep dive */}
      <section id="stormy" className="relative max-w-[1280px] mx-auto px-6 pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-5">
            <div className="flex items-center gap-3 mb-4">
              <MascotAvatar id="stormy" size="md" />
              <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold">
                Stormy AI
              </div>
            </div>
            <h2 className="font-sans font-black text-[2.25rem] md:text-[2.75rem] tracking-[-0.025em] text-pastel-cream leading-tight mb-5">
              An AI assistant GM<br />who actually knows hockey.
            </h2>
            <p className="text-[15px] text-white/60 leading-relaxed mb-5">
              Stormy is plugged into your league — your roster, your scoring settings, your matchup.
              Every answer cites real metrics: xGF%, TOI, PP1 share, save%, line combos.
            </p>
            <p className="text-[15px] text-white/60 leading-relaxed mb-7">
              No generic "monitor the situation" boilerplate. Just real hockey advice grounded in
              your actual team.
            </p>
            <Link
              to="/gm-office/stormy"
              className="inline-flex items-center gap-2 bg-pastel-orange text-[#581E00] text-[14px] font-bold px-5 h-11 rounded-md hover:bg-pastel-orange-soft transition-colors"
            >
              Try Stormy <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
            </Link>
          </div>
          <div className="lg:col-span-7">
            <StormyChatTile
              exchange={{
                question: 'Is this trade fair? I give Matthews, get MacKinnon plus a 3rd round pick.',
                answer:
                  "Take it. MacKinnon's xGF% is 61.4% vs Matthews' 54.8%. MacKinnon also gets 3+ minutes more TOI per game and his line has better zone entry rates. The 3rd rounder is gravy. Our projections have MacKinnon finishing 8–12 points higher ROS. Plus, Matthews' shooting% is unsustainable at 18.2% — regression coming.",
              }}
            />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="relative max-w-[860px] mx-auto px-6 pb-24">
        <SectionHeader eyebrow="FAQ" title="Questions, answered." align="center" />
        <Faq entries={FAQ} />
      </section>

      {/* Final CTA */}
      <CtaBanner
        eyebrow="7 Games Tonight · Puck drops 7pm ET"
        eyebrowPulse
        title={
          <>
            Your league is <span className="text-pastel-orange">waiting</span>.
          </>
        }
        sub="Free during launch · Founders pricing locked in for early users"
        ctaLabel="Create your league"
        ctaHref="/create-league"
      />

      <HockeyFooter />
    </DarkLayout>
  );
}
