import { Link } from 'react-router-dom';
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
  return (
    <DarkLayout>

      <Navbar />
      <main>
        {/* Hero */}
        <section className="relative max-w-[860px] mx-auto px-6 pt-20 pb-16 text-center">
          <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-4 font-bold">
            About Citrus
          </div>
          <h1 className="font-sans font-black text-[3rem] md:text-[4.5rem] leading-[0.98] tracking-[-0.035em] text-pastel-cream mb-6">
            Built by hockey heads,<br />
            for <span className="text-pastel-orange">hockey heads</span>.
          </h1>
          <p className="text-[17px] md:text-[19px] leading-relaxed text-white/65 max-w-xl mx-auto">
            Every other fantasy hockey platform feels like it was built by people who don't
            actually watch hockey. Bad projections. Sunday finishes when nobody plays. We got
            tired of it. So we made something better.
          </p>
        </section>

        {/* Story sections */}
        <section className="relative max-w-[860px] mx-auto px-6 pb-16 space-y-12">
          <article>
            <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-3 font-bold">
              ✦ Why Saturday
            </div>
            <h2 className="font-sans font-black text-[1.75rem] md:text-[2.25rem] tracking-[-0.025em] text-pastel-cream leading-tight mb-4">
              Because that's when hockey happens.
            </h2>
            <p className="text-[16px] text-white/70 leading-relaxed">
              Twelve games on a Saturday slate. Maximum chaos. Your matchup gets decided when it
              actually matters — not on Sunday morning when 3 teams are playing and your opponent
              already won. Saturday night is peak hockey. Your fantasy week should end then too.
            </p>
          </article>

          <article>
            <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-3 font-bold">
              ✦ The Model
            </div>
            <h2 className="font-sans font-black text-[1.75rem] md:text-[2.25rem] tracking-[-0.025em] text-pastel-cream leading-tight mb-4">
              31 features. 19,000 sims. Every shift since 2007.
            </h2>
            <p className="text-[16px] text-white/70 leading-relaxed">
              Our XGBoost xG model uses xGF%, Corsi, deployment patterns, line chemistry, PP1
              share, zone entry rates, and Bayesian shrinkage for low-sample players. We don't
              just project a single number — we give you a Monte Carlo distribution: floor,
              median, ceiling. So you know who has the highest upside and who has the safest
              floor.
            </p>
          </article>

          <article>
            <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-3 font-bold">
              ✦ Built Different
            </div>
            <h2 className="font-sans font-black text-[1.75rem] md:text-[2.25rem] tracking-[-0.025em] text-pastel-cream leading-tight mb-4">
              We're not trying to be Yahoo or ESPN.
            </h2>
            <p className="text-[16px] text-white/70 leading-relaxed">
              We're building the platform we actually want to use. Fast. Clean. Smart. No ads
              cluttering your dashboard. No features you'll never touch. No premium tier hiding
              the analytics you need. Just the tools to dominate your league and chirp your group
              chat.
            </p>
          </article>
        </section>

        {/* The Squad */}
        <section className="relative max-w-[1280px] mx-auto px-6 pb-24">
          <SectionHeader
            eyebrow="Roll Call"
            title="The Citrus Squad."
            sub="Four characters who live inside the app — Stormy on the bench, Lemon up front, Kiwi on the back end, Pineapple in the crease."
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
                <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft font-bold mb-1 group-hover:text-pastel-orange transition-colors">
                  {m.position}{m.number ? ` · #${m.number}` : ''}
                </div>
                <div className="font-calistoga text-[20px] text-pastel-cream group-hover:text-pastel-orange-soft transition-colors">
                  {m.name}
                </div>
                <div className="text-[12px] text-white/45 leading-snug mt-1 max-w-[200px] mx-auto opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  {m.tagline}
                </div>
              </div>
            ))}
          </div>
        </section>

        <CtaBanner
          title={
            <>
              Built different. <span className="text-pastel-orange">Play different.</span>

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
