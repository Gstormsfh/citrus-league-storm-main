import { Link } from 'react-router-dom';
import { usePageMeta } from '@/lib/pageMeta';
import { ArrowRight, Shield } from 'lucide-react';
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
    label: 'Stormy, the assistant GM',
    scene: '/mascots/scene-stormy-ai.webp',
    desc: 'Stormy knows your roster, your scoring settings and this week\'s matchup before you ask. Give him a start-or-sit, a trade or a waiver question and he answers with the number he is leaning on.',
    icon: ScoreboardIcon,
    accent: 'orange',
  },
  {
    label: 'Live scoring',
    scene: '/mascots/scene-livescoring.webp',
    desc: 'Goals, assists, hits and blocks land in your matchup as they happen during the game. You watch the matchup move with the play instead of waiting for the box score.',
    icon: ShiftIcon,
    accent: 'sage',
  },
  {
    label: 'Your league, your rules',
    desc: 'Snake, linear, auction, salary-cap or autopick drafts. Head-to-head points or categories, roto, total points, points-per-game or best-ball scoring. Roster sizes and playoff weeks are yours to set.',
    icon: CrossedSticksIcon,
    accent: 'butter',
  },
  {
    label: 'Projections with a range',
    desc: 'Every skater gets a floor, a middle and a ceiling for the night from a simulation built on an expected-goals model made for the NHL. You see how wide the range is before you decide.',
    icon: Shield,
    accent: 'peach',
  },
  {
    label: 'Player pages with the real stats',
    scene: '/mascots/scene-cup.webp',
    desc: 'xGF%, Corsi, power-play unit share, deployment and zone entries are on every player\'s page, next to the projection. None of it is behind an upgrade.',
    icon: CupIcon,
    accent: 'orange',
  },
  {
    label: 'A draft room that holds up',
    scene: '/mascots/scene-draft.webp',
    desc: 'A live draft room with a clock, a chat and the projections on the board, plus a 12-team mock against AI managers you can run any time without an account.',
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
    sub: 'Snake, auction or salary-cap draft, your own scoring, and a live draft room. This is the main event.',
    badge: 'Fantasy',
    accent: 'orange',
    icon: CrossedSticksIcon,
    to: '/create-league',
  },
  {
    label: 'Daily Pickem',
    scene: '/mascots/scene-pickem.webp',
    sub: "Pick the winner of every game on tonight's slate. It locks at puck drop and settles at the final horn.",
    badge: 'Daily',
    accent: 'sage',
    icon: PickemIcon,
    to: '/pool/pickem',
  },
  {
    label: 'Survivor Pool',
    scene: '/mascots/scene-survivor.webp',
    sub: "One team a week, and you can only use each team once. Lose and you're out. The last manager standing takes it.",
    badge: 'Weekly',
    accent: 'butter',
    icon: SurvivorIcon,
    to: '/pool/survivor',
  },
  {
    label: 'Stanley Cup Brackets',
    scene: '/mascots/scene-cup.webp',
    sub: 'Fill in the whole bracket before the first round starts and score it round by round through the Cup Final.',
    badge: 'Apr–Jun',
    accent: 'peach',
    icon: CupIcon,
    to: '/nhl/playoffs',
  },
];

export default function Features() {
  usePageMeta({ title: 'Features', description: 'Live draft room, Stormy AI assistant GM, expected-goals player analytics, custom scoring, keepers, waivers and trades. See what a Citrus league gets.', path: '/features' });
  return (
    <DarkLayout>
      <Navbar />

      <main>
        {/* Hero */}
        <section className="relative max-w-[1280px] mx-auto px-6 pt-12 pb-12 md:pt-28 md:pb-16 text-center">
          <div className="font-plex font-semibold text-[11px] tracking-[0.18em] uppercase text-pressbox-orange-soft mb-4">
            Features
          </div>
          <h1 className="font-condensed font-extrabold uppercase text-[3rem] sm:text-[3.75rem] md:text-[5.5rem] leading-[0.92] tracking-[-0.01em] text-pressbox-text mb-6 max-w-3xl mx-auto">
            What you get, and 
            <span className="text-pressbox-orange">where it comes from</span>.
          </h1>
          <p className="font-barlow font-normal text-[17px] text-pressbox-text/75 leading-relaxed md:text-[18px] max-w-xl mx-auto mb-8 md:mb-10 px-4">
            This page is the plain version of what Citrus does. Nothing on it is coming soon,
            and nothing on it costs money.
          </p>
          <Link
            to="/create-league"
            className="group inline-flex items-center gap-2 bg-pressbox-orange text-pressbox-orange-ink font-condensed font-bold uppercase tracking-[0.06em] text-[17px] px-7 rounded-md hover:bg-pastel-orange-soft hover:-translate-y-0.5 transition-all duration-200 shadow-[0_8px_24px_-8px_rgba(255,107,26,0.5)]"
            style={{ height: '52px' }}
          >
            <span>Create a league</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
          </Link>
        </section>

        {/* Core platform features */}
        <section className="relative max-w-[1280px] mx-auto px-6 pb-16 md:pb-24">
          <SectionHeader
            eyebrow="The app"
            title="Six things it does well."
            sub="Free to use, no card, no entry fee."
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
            eyebrow="Formats"
            title="Pick your format."
            sub="Season-long leagues are the main event. The pools are there for the friends who will not commit to a draft."
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
          <div className="bg-pressbox-tile border border-white/10 rounded-3xl p-6 md:p-10 lg:p-14 grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-6 lg:gap-8 items-center">
            <div className="flex justify-center lg:justify-start">
              <MascotAvatar id="stormy" size="xl" />
            </div>
            <div>
              <div className="font-plex font-semibold text-[11px] tracking-[0.18em] uppercase text-pressbox-orange-soft mb-2">
                Stormy · Assistant GM
              </div>
              <h2 className="font-condensed font-extrabold uppercase text-[2.25rem] md:text-[3rem] tracking-[-0.01em] text-pressbox-text leading-[0.95] mb-4">
                An assistant GM who has read your roster.
              </h2>
              <p className="font-barlow font-normal text-[17px] text-pressbox-text/75 leading-relaxed mb-6 max-w-2xl">
                Stormy is plugged into your league. He knows your scoring settings, your roster and
                this week's matchup before you type anything, and when he answers he tells you
                which number he is leaning on. He is free while we are in launch, with a weekly
                question limit.
              </p>
              <Link
                to="/gm-office/stormy"
                className="inline-flex items-center gap-2 bg-pressbox-orange text-pressbox-orange-ink font-condensed font-bold uppercase tracking-[0.06em] text-[16px] px-5 h-11 rounded-md hover:bg-pastel-orange-soft transition-colors"
              >
                Talk to Stormy <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
              </Link>
            </div>
          </div>
        </section>

        <CtaBanner
          eyebrow="Drafts are open"
          title={
            <>
              Start the league. <span className="text-pressbox-orange">Send the link.</span>
            </>
          }
          sub="Free to play. Drafts are open now and the season starts Sep 29."
          ctaLabel="Create your league"
          ctaHref="/create-league"
        />
      </main>

      <HockeyFooter />
    </DarkLayout>
  );
}
