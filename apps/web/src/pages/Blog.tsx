/**
 * Blog — an honest placeholder, not a fake magazine.
 *
 * WHAT WAS HERE (removed 2026-08-26, pre-App-Store fabrication sweep):
 * six invented articles — "Top 10 Draft Strategies", "Analyzing Player
 * Performance", an "Injury Report Updates: What You Need to Know This Week" —
 * each bylined to an invented person (Alex Johnson, Samantha Lee, Carlos
 * Rodriguez, Taylor Kim, Morgan Williams, Jordan Patel), dated March/April
 * 2025, illustrated with stock photography, filterable by seven invented
 * categories, searchable, with a "Load More Articles" button. None of it
 * existed and none of it was clickable.
 *
 * An invented injury report is the worst of the set: it is the exact kind of
 * claim a fantasy manager would act on. services/NewsService.ts already states
 * the rule this page needed — "Presenting invented reporting under a real
 * outlet's name is not a graceful degradation."
 *
 * When there are real posts, this page grows a real list. Until then it says
 * there aren't any.
 */
import { PenLine } from 'lucide-react';
import Navbar from '@/components/Navbar';
import { DarkLayout, HockeyFooter, GlowCard, MascotPeek, CtaBanner } from '@/components/citrus2';

const Blog = () => {
  return (
    <DarkLayout>
      <Navbar />
      <main className="relative max-w-[1280px] mx-auto px-6 pt-28 pb-16">
        <section className="relative max-w-[860px] mx-auto px-2 pb-12 text-center">
          <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-4 font-bold">
            In the works
          </div>
          <h1 className="font-sans font-black text-[2.5rem] md:text-[4rem] leading-[0.98] tracking-[-0.035em] text-pastel-cream mb-5">
            The Citrus <span className="text-pastel-orange">Blog</span>.
          </h1>
          <p className="text-[16px] md:text-[18px] leading-relaxed text-white/65 max-w-xl mx-auto">
            Nothing published yet. When we write about the projection model,
            draft strategy or what changed in the app, it will show up here.
          </p>
        </section>

        <section className="max-w-[720px] mx-auto mb-12">
          <GlowCard accent="sage">
            <div className="p-8 relative overflow-hidden text-center">
              <MascotPeek id="lemon" position="top-right" size="sm" />
              <PenLine className="w-8 h-8 text-pastel-orange mx-auto mb-4" strokeWidth={2} />
              <h2 className="font-sans font-bold text-[20px] text-pastel-cream tracking-[-0.015em] mb-3 relative z-10">
                No posts yet
              </h2>
              <p className="text-[14px] text-white/65 leading-relaxed max-w-md mx-auto relative z-10">
                For player news and injuries, the app's own headlines feed pulls
                from real sources. That's the one you want in-season.
              </p>
            </div>
          </GlowCard>
        </section>
      </main>

      <CtaBanner
        title={
          <>
            Nothing to read yet. <span className="text-pastel-orange">Plenty to play.</span>
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

export default Blog;
