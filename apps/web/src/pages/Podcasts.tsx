/**
 * Podcasts — an honest placeholder, not a fake show.
 *
 * WHAT WAS HERE (removed 2026-08-26, pre-App-Store fabrication sweep):
 * four invented episodes with invented runtimes and April 2025 dates, an "On
 * Air" header with a live-pulse animation, a "Featured Episode" hero reading
 * "with three-time fantasy champion MARCUS JOHNSON" — a named person with a
 * credential who does not exist — a "Play Episode" button wired to nothing,
 * four platform Subscribe buttons wired to nothing, and a "View All Episodes"
 * button wired to nothing.
 *
 * Every one of those is a claim about the world that is not true, on a public,
 * crawlable, unauthenticated route. NewsService.ts already carries the ruling
 * this page needed: "Presenting invented reporting under a real outlet's name
 * is not a graceful degradation." An empty shelf is not embarrassing. A shelf
 * of books that do not exist is.
 *
 * When there is a real show, this page grows a real episode list fed by real
 * data. Until then it says so.
 */
import { Headphones } from 'lucide-react';
import Navbar from '@/components/Navbar';
import {
  DarkLayout,
  HockeyFooter,
  GlowCard,
  MascotPeek,
  CtaBanner,
} from '@/components/citrus2';

const Podcasts = () => {
  return (
    <DarkLayout>
      <Navbar />
      <main className="relative max-w-[1280px] mx-auto px-6 pt-28 pb-16">
        <section className="relative max-w-[860px] mx-auto px-2 pb-12 text-center">
          <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-4 font-bold">
            In the works
          </div>
          <h1 className="font-sans font-black text-[2.5rem] md:text-[4rem] leading-[0.98] tracking-[-0.035em] text-pastel-cream mb-5">
            Citrus <span className="text-pastel-orange">Podcasts</span>.
          </h1>
          <p className="text-[16px] md:text-[18px] leading-relaxed text-white/65 max-w-xl mx-auto">
            We haven't recorded anything yet. When we do, episodes will land here
            and on the usual platforms, and you'll be able to play them from this
            page.
          </p>
        </section>

        <section className="max-w-[720px] mx-auto mb-12">
          <GlowCard accent="sage">
            <div className="p-8 relative overflow-hidden text-center">
              <MascotPeek id="lemon" position="top-right" size="sm" />
              <Headphones className="w-8 h-8 text-pastel-orange mx-auto mb-4" strokeWidth={2} />
              <h2 className="font-sans font-bold text-[20px] text-pastel-cream tracking-[-0.015em] mb-3 relative z-10">
                No episodes yet
              </h2>
              <p className="text-[14px] text-white/65 leading-relaxed max-w-md mx-auto relative z-10">
                The projections and the league tooling came first. If you'd rather
                we spent the time on the app than on a microphone, we agree. For
                now.
              </p>
            </div>
          </GlowCard>
        </section>
      </main>

      <CtaBanner
        title={
          <>
            Nothing to listen to yet. <span className="text-pastel-orange">Plenty to play.</span>
          </>
        }
        sub="Free to play · No credit card required"
        ctaLabel="Create your league"
        ctaHref="/create-league"
      />

      <HockeyFooter />
    </DarkLayout>
  );
};

export default Podcasts;
