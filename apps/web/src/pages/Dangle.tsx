/**
 * /dangle (2026-09-09). The page a Steve Dangle Podcast listener types in
 * after hearing the read. One screen, three doors, and every visit is
 * attributed: `rememberAcquisition('steve-dangle')` makes this browser's
 * first touch the podcast, which then rides along to the waitlist row, the
 * Analytics user property at sign-up, and the league that follows.
 *
 * Not in the sitemap on purpose. It is a campaign door, not a page to rank.
 */
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Navbar from '@/components/Navbar';
import { DarkLayout, HockeyFooter, MascotAvatar } from '@/components/citrus2';
import { usePageMeta } from '@/lib/pageMeta';
import { rememberAcquisition } from '@/lib/acquisition';
import { analyticsService } from '@/services/AnalyticsService';
import { OPENING_NIGHT_LABEL } from '@/lib/season';

export const DANGLE_SOURCE = 'steve-dangle';

const DOORS = [
  {
    title: 'Start a league',
    body: 'Snake, auction or salary-cap draft, your own scoring, and a live draft room. Send the invite link to the group chat and draft this weekend.',
    cta: 'Create a league',
    to: '/create-league',
    mascot: 'lemon' as const,
  },
  {
    title: "Opening night pick'em",
    body: 'Pick the winner of every game on opening night. Free, takes a minute, and you are in the listener pool with everyone else who heard the read.',
    cta: 'Make my picks',
    to: `/opening-night?ref=${DANGLE_SOURCE}`,
    mascot: 'kiwi' as const,
  },
  {
    title: 'Bring your league',
    body: 'Already running one somewhere else? Send the settings and it gets rebuilt in Citrus to match, roster slots, scoring and keepers included.',
    cta: 'Move my league',
    to: `/bring-your-league?ref=${DANGLE_SOURCE}`,
    mascot: 'pineapple' as const,
  },
];

const BUTTON =
  'inline-flex items-center gap-2 bg-pressbox-orange text-pressbox-orange-ink font-condensed font-bold uppercase tracking-[0.06em] text-[16px] px-5 h-12 rounded-md hover:bg-pastel-orange-soft transition-colors';

export default function Dangle() {
  usePageMeta({
    title: 'Citrus for Steve Dangle listeners',
    description: 'Season-long fantasy hockey with live scoring, real projections and an assistant GM. Free to play. Start a league or make your opening-night picks.',
    path: '/dangle',
  });

  useEffect(() => {
    rememberAcquisition(DANGLE_SOURCE, { campaign: 'sdp-fall-2026', medium: 'podcast', landing: '/dangle' });
    analyticsService.logEvent('campaign_landing', { campaign: DANGLE_SOURCE });
  }, []);

  return (
    <DarkLayout>
      <Navbar />
      <main className="relative pt-24 pb-20" data-testid="dangle-landing">
        <section className="max-w-[1100px] mx-auto px-6 py-12 md:py-16 text-center">
          <div className="font-plex font-semibold text-[11px] tracking-[0.18em] uppercase text-pressbox-orange-soft mb-4">
            Heard it on the Steve Dangle Podcast · Free · {OPENING_NIGHT_LABEL}
          </div>
          <h1 className="font-condensed font-extrabold uppercase text-[3rem] md:text-[5.5rem] leading-[0.92] tracking-[-0.01em] text-pressbox-text mb-5">
            Fantasy hockey<br />
            <span className="text-pressbox-orange">for people who watch hockey.</span>
          </h1>
          <p className="font-barlow font-normal text-[17px] md:text-[19px] leading-relaxed text-pressbox-text/75 max-w-2xl mx-auto">
            Season-long leagues with your buddies, live scoring on every shift, projections from an expected-goals
            model built for the NHL, and an assistant GM who has read your roster. There are no entry fees and no
            payouts. Pick a door.
          </p>
        </section>

        <section className="max-w-[1100px] mx-auto px-6 pb-16">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {DOORS.map((d) => (
              <div key={d.title} className="rounded-[20px] bg-pressbox-tile border border-white/10 p-6 flex flex-col" data-testid="dangle-door">
                <div className="flex items-center gap-3 mb-4">
                  <MascotAvatar id={d.mascot} size="md" />
                  <h2 className="font-condensed font-bold uppercase tracking-[0.04em] text-[22px] leading-none text-pressbox-text">{d.title}</h2>
                </div>
                <p className="font-barlow font-normal text-[15px] leading-relaxed text-pressbox-text/70 mb-6 flex-1">{d.body}</p>
                <Link to={d.to} className={BUTTON}>
                  {d.cta} <ArrowRight className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-8 text-center font-plex text-[11px] tracking-[0.1em] uppercase text-pressbox-text/55">
            Web today. iPhone app on the way.
          </p>
        </section>
      </main>
      <HockeyFooter />
    </DarkLayout>
  );
}
