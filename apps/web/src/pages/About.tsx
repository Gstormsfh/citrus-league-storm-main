import { Link } from 'react-router-dom';
import { usePageMeta } from '@/lib/pageMeta';
import Navbar from '@/components/Navbar';
import { ArrowRight } from 'lucide-react';
import {
  DarkLayout,
  HockeyFooter,
  SectionHeader,
  CtaBanner,
  MascotPortrait,
} from '@/components/citrus2';
import { MASCOT_LIST } from '@/constants/mascots';

export default function About() {
  usePageMeta({ title: 'About Citrus Fantasy Sports', description: 'Fantasy hockey built by a former pro and a CPA: a live draft room, Stormy the AI assistant GM, and analytics on expected goals.', path: '/about' });
  return (
    <DarkLayout>

      <Navbar />
      <main>
        {/* Hero */}
        <section className="relative max-w-[860px] mx-auto px-6 pt-28 pb-16 text-center">
          <div className="font-plex font-semibold text-[11px] tracking-[0.18em] uppercase text-pressbox-orange-soft mb-4">
            About Citrus
          </div>
          <h1 className="font-condensed font-extrabold uppercase text-[3.25rem] md:text-[5.5rem] leading-[0.92] tracking-[-0.01em] text-pressbox-text mb-6">
            A league app for people<br />
            who <span className="text-pressbox-orange">watch hockey</span>.
          </h1>
          <p className="font-barlow font-normal text-[17px] text-pressbox-text/75 leading-relaxed md:text-[19px] max-w-xl mx-auto">
            Citrus is a season-long fantasy hockey app built in Edmonton. It exists because the
            big fantasy platforms treat hockey as an afterthought, and a league full of people who
            watch every game deserves better numbers and a better week.
          </p>
        </section>

        <section className="relative max-w-[1100px] mx-auto px-6 pb-16">
          <div className="relative w-full aspect-[16/9] sm:aspect-[21/9] rounded-3xl overflow-hidden ring-1 ring-white/10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)]">
            <img src="/mascots/scene-squad.webp" alt="The Citrus Squad: Lemon, Stormy, Kiwi, and Pineapple on the bench" className="w-full h-full object-cover" loading="eager" />
            <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to top, rgba(15,31,21,0.75) 0%, transparent 35%)' }} />
            <div className="absolute bottom-5 left-6 sm:bottom-8 sm:left-10 z-10">
              <div className="font-plex font-semibold text-[11px] tracking-[0.18em] uppercase text-pressbox-orange-soft mb-1.5">
                The Citrus Squad
              </div>
              <div className="font-condensed font-extrabold uppercase text-[26px] sm:text-[34px] text-pressbox-text leading-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
                Four characters, one bench.
              </div>
            </div>
          </div>
        </section>

        {/* Story sections */}
        <section className="relative max-w-[860px] mx-auto px-6 pb-16 space-y-12">
          <article>
            <div className="font-plex font-semibold text-[11px] tracking-[0.18em] uppercase text-pressbox-orange-soft mb-3">
              Why the week ends Saturday
            </div>
            <h2 className="font-condensed font-extrabold uppercase text-[2.25rem] md:text-[3rem] tracking-[-0.01em] text-pressbox-text leading-[0.95] mb-4">
              Because that is when the hockey is.
            </h2>
            <p className="font-barlow font-normal text-[17px] text-pressbox-text/75 leading-relaxed">
              Matchup weeks here run Sunday to Saturday. Saturday is the biggest slate of the
              week in the NHL, so your matchup gets decided on the night everyone is watching
              instead of on a Sunday morning with three games and nothing left to play for.
            </p>
          </article>

          <article>
            <div className="font-plex font-semibold text-[11px] tracking-[0.18em] uppercase text-pressbox-orange-soft mb-3">
              The model
            </div>
            <h2 className="font-condensed font-extrabold uppercase text-[2.25rem] md:text-[3rem] tracking-[-0.01em] text-pressbox-text leading-[0.95] mb-4">
              Projections built for hockey, retrained through the season.
            </h2>
            <p className="font-barlow font-normal text-[17px] text-pressbox-text/75 leading-relaxed">
              Every shot in the play-by-play gets an expected-goal value from a gradient-boosted
              model trained on shot location, shot type and the passing sequence before the shot.
              Player projections are built up from there, with shrinkage for players who have not
              played much yet, and every projection is run as a simulation so you get a floor and
              a ceiling rather than one average. The model is retrained as the season goes, not
              frozen in October.
            </p>
          </article>

          <article>
            <div className="font-plex font-semibold text-[11px] tracking-[0.18em] uppercase text-pressbox-orange-soft mb-3">
              What Citrus is and is not
            </div>
            <h2 className="font-condensed font-extrabold uppercase text-[2.25rem] md:text-[3rem] tracking-[-0.01em] text-pressbox-text leading-[0.95] mb-4">
              Season-long fantasy with your friends. That is the whole business.
            </h2>
            <p className="font-barlow font-normal text-[17px] text-pressbox-text/75 leading-relaxed">
              Citrus does not take entry fees and does not pay anything out. There is no
              sportsbook behind it. The focus is the hockey community and the numbers behind the
              game, and a league app is the best place to put both. If you want something
              changed, use the contact page and a person will answer.
            </p>
          </article>
        </section>

        {/* The Squad */}
        <section className="relative max-w-[1280px] mx-auto px-6 pb-24">
          <SectionHeader
            eyebrow="Roll Call"
            title="The Citrus Squad."
            sub="Four characters who show up around the app. Stormy runs the bench, Lemon plays up front, Kiwi is on the back end and Pineapple is in the crease."
            align="center"
          />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto">
            {MASCOT_LIST.map((m) => (
              <div key={m.id} className="group text-center cursor-pointer">
                <div className="relative mb-3">
                  {/* Ambient glow that intensifies on hover */}
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 -m-3 rounded-full opacity-0 group-hover:opacity-60 blur-2xl transition-opacity duration-500"
                    style={{ background: 'radial-gradient(circle, #FF6B1A 0%, transparent 60%)' }}
                  />
                  <MascotPortrait
                    id={m.id}
                    className="relative ring-2 ring-white/10 group-hover:ring-pastel-orange/50 group-hover:scale-105 transition-all duration-300"
                  />
                </div>
                <div className="font-plex font-semibold text-[11px] tracking-[0.18em] uppercase text-pressbox-orange-soft mb-1 group-hover:text-pressbox-orange transition-colors">
                  {m.position}{m.number ? ` · #${m.number}` : ''}
                </div>
                <div className="font-condensed font-extrabold uppercase text-[22px] text-pressbox-text group-hover:text-pressbox-orange-soft transition-colors">
                  {m.name}
                </div>
                <div className="font-barlow text-[13px] text-pressbox-text/70 leading-snug mt-1 max-w-[200px] mx-auto opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  {m.tagline}
                </div>
              </div>
            ))}
          </div>
        </section>

        <CtaBanner
          title={
            <>
              Bring the group chat. <span className="text-pressbox-orange">Draft this weekend.</span>
            </>
          }
          sub="Free to play. No card and no entry fee."
          ctaLabel="Create your league"
          ctaHref="/create-league"
        />
      </main>

      <HockeyFooter />
    </DarkLayout>
  );
}
