/**
 * The full Citrus 2.0 homepage composition. Used by both `pages/Index.tsx`
 * (production /) and `pages/PreviewClone.tsx` (design canon /preview-clone).
 *
 * Edit copy / structure here once and both routes update together.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Navbar from '@/components/Navbar';
// Siblings are imported by module, not through '@/components/citrus2'. The
// barrel (index.ts) re-exports this file, so importing the barrel from here
// makes Homepage <-> index a cycle. Rollup reported it as a cyclic cross-chunk
// re-export whenever a lazily loaded page reached Homepage through the barrel,
// and warned that execution order may break. Direct imports keep the barrel
// one-way.
import { DarkLayout } from './DarkLayout';
import { HockeyFooter } from './HockeyFooter';
import { RotatingHero, type HeroSlide } from './RotatingHero';
import { SectionHeader } from './SectionHeader';
import { CtaBanner } from './CtaBanner';
import { Faq, type FaqEntry } from './Faq';
import { GameModeCard } from './GameModeCard';
import { FeatureCard } from './FeatureCard';
import { StormyChatTile } from './StormyChatTile';
import { MascotAvatar } from './MascotAvatar';
// Real hockey iconography, replacing generic lucide
import {
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
} from './HockeyIcons';
import type { AccentName } from './tokens';

// =============================================================================
// HERO
// =============================================================================

// The storefront leads with the product, not a character. These are captures
// of real shipped mobile components running against the local fixture harness:
// public NHL identity where available, generated demo values, and no league or
// account data. They show the product in use, not a fabricated dashboard.
function ProductVisual() {
  const [screen, setScreen] = useState<'overview' | 'breakdown'>('overview');
  const isOverview = screen === 'overview';
  const activeScreen = isOverview
    ? {
        src: '/product-demo/player-dashboard-demo-390.png',
        alt: 'Citrus player dashboard on mobile, showing a player decision view, expected-goals context, and shot profile.',
        label: 'Player decision view',
        detail: 'See the context behind a start-or-sit call.',
      }
    : {
        src: '/product-demo/player-analysis-demo-390.png',
        alt: 'Citrus player analysis on mobile, showing expected goals, finishing context, and a shot breakdown.',
        label: 'Shot breakdown',
        detail: 'Turn a box score into the shots that created it.',
      };

  return (
    <figure className="relative mx-auto h-[470px] w-full max-w-[520px] overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_75%_12%,rgba(255,107,26,0.25),transparent_38%),linear-gradient(135deg,#101c14,#07110b)] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)] sm:h-[500px]">
      <div className="absolute left-5 top-5 z-10 rounded-md border border-white/10 bg-black/45 px-3 py-2 backdrop-blur-sm">
        <p className="font-plex text-[10px] font-semibold uppercase tracking-[0.16em] text-pressbox-orange-soft">Actual product screens</p>
        <p className="mt-0.5 font-barlow text-xs text-pressbox-text/70">Demo data · mobile layout</p>
      </div>
      <div className={`absolute left-1/2 top-[92px] w-[250px] -translate-x-1/2 overflow-hidden rounded-[25px] border-[5px] border-[#07110b] bg-[#07110b] shadow-[0_24px_36px_-12px_rgba(0,0,0,0.8)] transition-transform duration-300 motion-reduce:transition-none sm:top-[96px] sm:w-[276px] ${
        isOverview ? '' : 'pt-20'
      }`}>
        <img
          key={activeScreen.src}
          src={activeScreen.src}
          alt={activeScreen.alt}
          width="390"
          height="844"
          className="block h-auto w-full object-top animate-fade-in motion-reduce:animate-none"
          fetchPriority="high"
        />
      </div>
      <div className="absolute bottom-4 left-1/2 z-10 w-[calc(100%-2.5rem)] -translate-x-1/2 rounded-xl border border-white/10 bg-[#0a150d]/90 p-2.5 backdrop-blur-sm sm:w-[calc(100%-3rem)]">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-white/[0.06] p-1" role="tablist" aria-label="Explore Citrus player screens">
          {([
            ['overview', 'Player view'],
            ['breakdown', 'Shot breakdown'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={screen === value}
              aria-controls="product-screen-preview"
              onClick={() => setScreen(value)}
              className={`rounded-md px-2 py-2 font-plex text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors motion-reduce:transition-none ${
                screen === value
                  ? 'bg-pressbox-orange text-pressbox-orange-ink'
                  : 'text-pressbox-text/65 hover:bg-white/[0.08] hover:text-pressbox-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p id="product-screen-preview" className="mt-2 px-1 font-barlow text-xs text-pressbox-text/70">
          <span className="font-semibold text-pressbox-text">{activeScreen.label}.</span> {activeScreen.detail}{' '}
          <span className="text-pressbox-orange-soft/80">Demo data.</span>
        </p>
      </div>
    </figure>
  );
}

// SITE REWRITE (2026-09-09). One static hero instead of a five-slide carousel.
// A carousel hides the pitch behind a timer, the game modes it cycled through
// are the grid two sections down, and every slide's sub-line was a stack of
// fragments. The copy is house voice, one thought per
// sentence, first person where it is his story, and no counts we have not
// verified (the "31-feature" claim is gone until the model artifact confirms
// it). Opening night is the first scheduled row in `nhl_games` as of
// 2026-09-09: 2026-09-29, five games.
function getHeroSlides(): HeroSlide[] {
  return [
    {
      id: 'fantasy',
      eyebrow: '',
      headline: { lead: 'Fantasy hockey', accent: 'for people who watch hockey.' },
      sub: 'Set up a season-long league with your friends, make lineup decisions with expected-goals context, and follow the scores as games unfold. There are no entry fees and no payouts. It is just hockey.',
      primary: { label: 'Create a league', to: '/create-league' },
      secondary: { label: 'Try a mock draft first', to: '/armchair-gm?tab=mockdraft' },
      visual: <ProductVisual />,
    },
  ];
}

// =============================================================================
// SECTION DATA
// =============================================================================

const FACT_STRIP = ['Snake, auction and salary-cap drafts', 'Custom scoring', 'No card, no fees'];

const GAME_MODES: Array<{
  label: string;
  sub: string;
  badge: string;
  accent: AccentName;
  icon: React.ComponentType<{ className?: string }>;
  to: string;
  ctaLabel: string;
}> = [
  {
    label: 'Fantasy Hockey',
    sub: 'Snake, auction or salary-cap draft, your own scoring, and a live draft room. This is the main event.',
    badge: 'Season',
    accent: 'orange',
    icon: CrossedSticksIcon,
    to: '/create-league',
    ctaLabel: 'Create a league',
  },
  {
    label: 'Daily Pickem',
    sub: "Pick the winner of every game on tonight's slate. It locks at puck drop and settles at the final horn.",
    badge: 'Daily',
    accent: 'sage',
    icon: PickemIcon,
    to: '/pool/pickem',
    ctaLabel: 'Make picks',
  },
  {
    label: 'Survivor Pool',
    sub: "One team a week, and you can only use each team once. Lose and you're out. The last manager standing takes it.",
    badge: 'Weekly',
    accent: 'butter',
    icon: SurvivorIcon,
    to: '/pool/survivor',
    ctaLabel: 'Start a pool',
  },
  {
    label: 'Confidence Pool',
    sub: 'Rank your weekly picks by how sure you are. The ones you are most confident in are worth the most.',
    badge: 'Weekly',
    accent: 'peach',
    icon: ScoreboardIcon,
    to: '/pool/confidence',
    ctaLabel: 'Start a pool',
  },
  {
    label: 'Stanley Cup Brackets',
    sub: 'Fill in the whole bracket before the first round starts and score it round by round through the Cup Final.',
    badge: 'Apr–Jun',
    accent: 'orange',
    icon: CupIcon,
    to: '/nhl/playoffs',
    ctaLabel: 'Fill a bracket',
  },
  {
    label: 'Mock Draft',
    sub: 'A 12-team mock against AI managers, no account needed. Good for testing a strategy before the real draft.',
    badge: 'Anytime',
    accent: 'sage',
    icon: DraftIcon,
    to: '/armchair-gm?tab=mockdraft',
    ctaLabel: 'Start a mock',
  },
];

const REAL_FEATURES: Array<{
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: AccentName;
}> = [
  {
    label: 'An expected-goals model',
    desc: 'Every shot gets an expected-goal value from a gradient-boosted model trained on shot location, shot type and the passing sequence before the shot. Player projections start there, not at last season\'s point totals.',
    icon: XGModelIcon,
    accent: 'orange',
  },
  {
    label: 'A range, not a number',
    desc: 'Where a simulation is available, the projection view gives you a floor, a middle and a ceiling instead of one average. That is the context a start-or-sit call needs.',
    icon: RangeIcon,
    accent: 'sage',
  },
  {
    label: 'Live scoring on every shift',
    desc: 'Goals, assists, hits and blocks update your matchup during the game, rather than waiting for a next-day recap.',
    icon: ShiftIcon,
    accent: 'butter',
  },
  {
    label: 'Stormy, the assistant GM',
    desc: 'Stormy knows your roster and your scoring settings before you ask, and he quotes the number he is leaning on when he answers.',
    icon: ScoreboardIcon,
    accent: 'peach',
  },
  {
    label: 'The stats the pros look at',
    desc: 'Player pages bring together xGF%, Corsi, power-play usage and deployment context when the underlying data is available.',
    icon: XGModelIcon,
    accent: 'sage',
  },
  {
    label: 'Weeks that end on Saturday',
    desc: 'Matchup weeks run Sunday to Saturday, so your week ends on the biggest slate of the schedule instead of a three-game Sunday morning.',
    icon: SlateIcon,
    accent: 'orange',
  },
];

const FAQ: FaqEntry[] = [
  {
    q: 'How does Citrus work?',
    a: 'You create a league, send your friends the invite link, and draft. From there you set your lineup before puck drop each day, your matchup updates live during the games, and Stormy is there when you want a second opinion.',
  },
  {
    q: 'Is it free?',
    a: 'Yes. There is nothing to pay and no card to enter. Stormy has a weekly question limit while we are in launch.',
  },
  {
    q: 'Is this a gambling app?',
    a: 'No. Citrus does not take entry fees and does not pay anything out. It is season-long fantasy with your friends, and that is the whole business.',
  },
  {
    q: 'What is different about the projections?',
    a: 'They come from an expected-goals model built for the NHL and retrained through the season, and every projection is a range with a floor and a ceiling rather than one average. The Features page has the details.',
  },
  {
    q: 'What formats do you support?',
    a: 'Snake, linear, auction, salary-cap and autopick drafts. Head-to-head points, head-to-head categories, roto, total points, points-per-game and best-ball scoring. Pickem, survivor and confidence pools, and a Stanley Cup bracket in the spring.',
  },
  {
    q: 'Can I bring my existing league over?',
    a: 'Yes. Tell us your league\'s format and scoring on the Bring Your League page and we will set it up to match.',
  },
  {
    q: 'Where can I use it?',
    a: 'In any browser, on a laptop or a phone. An iPhone app is on the way.',
  },
];

const STORMY_EXAMPLE = {
  question: "I'm offered a second-line winger and a 3rd-round pick for my top defenceman. Take it?",
  answer:
    "I wouldn't. He is your only defenceman on a first power-play unit and your scoring pays for power-play points. The winger they are offering is on his team's second unit and would slot behind two of your current wingers. If they will add their PP1 defenceman instead of the pick, that is a different conversation.",
};

// =============================================================================
// HOMEPAGE COMPOSITION
// =============================================================================

const SECTION = 'relative max-w-[1280px] mx-auto px-6 pb-24';
const BODY = 'font-barlow font-normal text-[17px] leading-relaxed text-pressbox-text/75';
const PRIMARY_LINK =
  'inline-flex items-center gap-2 bg-pressbox-orange text-pressbox-orange-ink font-condensed font-bold uppercase tracking-[0.06em] text-[16px] px-6 h-12 rounded-md hover:bg-pastel-orange-soft transition-colors';
const GHOST_LINK =
  'inline-flex items-center gap-2 font-condensed font-bold uppercase tracking-[0.06em] text-[16px] text-pressbox-text hover:text-pressbox-orange-soft transition-colors px-5 h-12 rounded-md ring-1 ring-white/15 hover:ring-white/30';

export function Homepage() {
  const slides = getHeroSlides();

  return (
    <DarkLayout>
      {/* Legacy Navbar — preserves league switcher, notifications, profile dropdown,
          and playoff bracket access. Sits above the dark page. */}
      <Navbar />

      <RotatingHero slides={slides} />

      {/* Fact strip. Every item is a fact about the product today, none of them a stat. */}
      <section className="relative max-w-[1280px] mx-auto px-6 pb-20">
        <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 font-plex font-semibold text-[11px] tracking-[0.16em] uppercase text-pressbox-sage-soft border-t border-white/5 pt-6">
          {FACT_STRIP.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      {/* Game modes */}
      <section className={SECTION}>
        <SectionHeader
          eyebrow="Ways to play"
          title="Pick your format."
          sub="Season-long leagues are the main event. The pools are there for the friends who will not commit to a draft."
        />
        <div className="flex gap-4 overflow-x-auto pb-4 -mx-6 px-6 snap-x snap-mandatory">
          {GAME_MODES.map((g) => (
            <GameModeCard key={g.label} {...g} landingCta />
          ))}
        </div>
      </section>

      {/* The numbers */}
      <section className={SECTION}>
        <SectionHeader
          eyebrow="The numbers"
          title="Projections that show their work."
          sub="Most fantasy sites hand you one number per player and never say where it came from. This is what is under the hood here."
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {REAL_FEATURES.map((f) => (
            <FeatureCard key={f.label} {...f} />
          ))}
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/features" className={GHOST_LINK}>
            How the model works <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
          </Link>
          <Link to="/armchair-gm?tab=mockdraft" className={GHOST_LINK}>
            See it in a mock draft
          </Link>
        </div>
      </section>

      {/* Stormy */}
      <section id="stormy" className={SECTION}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-5">
            <div className="flex items-center gap-3 mb-4">
              <MascotAvatar id="stormy" size="md" />
              <div className="font-plex font-semibold text-[11px] tracking-[0.18em] uppercase text-pressbox-orange-soft">
                Stormy · Assistant GM
              </div>
            </div>
            <h2 className="font-condensed font-extrabold uppercase text-[2.25rem] md:text-[3.25rem] leading-[0.95] tracking-[-0.01em] text-pressbox-text mb-5">
              An assistant GM who has read your roster.
            </h2>
            <p className={`${BODY} mb-5`}>
              Stormy is plugged into your league. He knows your scoring settings, your roster and this
              week's matchup before you type anything, and when he answers he tells you which number he
              is leaning on.
            </p>
            <p className={`${BODY} mb-7`}>
              Ask him a start-or-sit, a trade, or who to grab off waivers. He is free while we are in
              launch, with a weekly question limit.
            </p>
            <Link to="/gm-office/stormy" className={PRIMARY_LINK}>
              Talk to Stormy <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
            </Link>
          </div>
          <div className="lg:col-span-7">
            <StormyChatTile exchange={STORMY_EXAMPLE} />
            <p className="mt-3 font-plex text-[11px] tracking-[0.1em] uppercase text-pressbox-text/55 text-right">
              An example. In your league he reads your actual roster and settings.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="relative max-w-[860px] mx-auto px-6 pb-24">
        <SectionHeader eyebrow="FAQ" title="Fair questions." align="center" />
        <Faq entries={FAQ} />
      </section>

      {/* Final CTA */}
      <CtaBanner
        title={
          <>
            Start the league. <span className="text-pressbox-orange">Send the link.</span>
          </>
        }
        sub="Free to play. Set your rules, send the invite, and make the league yours."
        ctaLabel="Create your league"
        ctaHref="/create-league"
      />

      <HockeyFooter showSquad={false} />
    </DarkLayout>
  );
}
