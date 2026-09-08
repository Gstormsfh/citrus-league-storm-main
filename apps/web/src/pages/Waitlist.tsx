// Standalone Waitlist Page - Shareable link for social media signups
import { Link } from 'react-router-dom';
import { usePageMeta } from '@/lib/pageMeta';
import { ArrowRight, BarChart3, Zap, Trophy, Users, Star } from 'lucide-react';
import WaitlistSignup from '@/components/WaitlistSignup';
import Navbar from '@/components/Navbar';
import { Narwhal } from '@/components/icons/Narwhal';
import {
  DarkLayout,
  HockeyFooter,
  MascotAvatar,
  CitrusLogo,
  GlowCard,
  LivePulse,
} from '@/components/citrus2';

const Waitlist = () => {
  usePageMeta({ title: 'Join the Waitlist', description: 'Be first in line when Citrus Fantasy Sports launches on iOS. One launch email, no spam.', path: '/waitlist' });
  return (
    <DarkLayout>
      <Navbar />
      <main className="relative pt-24 pb-20">
        {/* Hero Section */}
        <section className="relative overflow-hidden">
          <div className="max-w-[1100px] mx-auto px-6 py-16 md:py-24">
            <div className="max-w-3xl mx-auto text-center">
              <div className="flex justify-center mb-6">
                <MascotAvatar id="stormy" size="xl" />
              </div>
              <div className="inline-flex items-center gap-2 mb-7 px-3 py-1.5 rounded-md bg-pastel-orange/15 ring-1 ring-pastel-orange/30">
                <LivePulse size="xs" />
                <span className="font-plex font-semibold text-[11px] tracking-[0.16em] uppercase text-pressbox-orange-soft leading-none">
                  Launch updates · Puck drops Sep 29
                </span>
              </div>

              <h1 className="font-condensed font-extrabold uppercase text-[3rem] md:text-[4.5rem] lg:text-[5.5rem] leading-[0.92] tracking-[-0.01em] text-pressbox-text mb-6">
                Hear from us<br />
                <span className="text-pressbox-orange">when it matters</span>
              </h1>

              <p className="font-barlow font-normal text-[17px] md:text-[19px] leading-relaxed text-pressbox-text/75 max-w-xl mx-auto mb-4">
                Citrus is live and drafts are open. Leave your email and we will write when the
                iPhone app ships, when the model gets a real update, and the week before puck drop.
              </p>

              <p className="font-barlow font-normal text-[15px] text-pressbox-text/60 max-w-lg mx-auto mb-10 leading-relaxed">
                A few emails a season and nothing else.
              </p>

              {/* Waitlist Signup - The Main Event */}
              <div className="max-w-lg mx-auto mb-12">
                <GlowCard accent="orange">
                  <div className="p-8">
                    <div className="flex items-center justify-center gap-2 mb-4">
                      <Narwhal className="h-7 w-7 text-pastel-orange" />
                      <h2 className="font-condensed font-extrabold uppercase text-[1.5rem] tracking-[-0.02em] text-pastel-cream">
                        Get the <span className="text-pressbox-orange">updates</span>
                      </h2>
                    </div>
                    <p className="text-[13px] text-white/65 mb-6 leading-relaxed">
                      Leave your email and you will hear from us when something worth knowing ships.
                    </p>
                    <WaitlistSignup source="waitlist_page" variant="default" />
                  </div>
                </GlowCard>
              </div>

              {/* Try the Platform */}
              <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
                <Link
                  to="/create-league"
                  className="inline-flex items-center gap-2 bg-pastel-orange text-[#581E00] text-[14px] font-bold px-6 rounded-md hover:bg-pastel-orange-soft hover:-translate-y-0.5 active:scale-95 transition-all duration-200 shadow-[0_4px_16px_-4px_rgba(255,107,26,0.5)]"
                  style={{ height: '48px' }}
                >
                  Try a Test League Now <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
                </Link>
                <Link
                  to="/standings"
                  className="inline-flex items-center text-[14px] font-bold text-pastel-cream hover:text-pastel-orange-soft transition-colors px-5 rounded-md ring-1 ring-white/15 hover:ring-white/30"
                  style={{ height: '48px' }}
                >
                  View Demo League
                </Link>
              </div>
              <p className="text-[11px] font-jbmono text-white/55 mt-4">
                Create a test league filled with AI teams to experience the full platform today.
              </p>
            </div>
          </div>
        </section>

        {/* Why Citrus? Features Grid */}
        <section className="max-w-[1100px] mx-auto px-6 py-16">
          <div className="text-center mb-12">
            <div className="font-plex font-semibold text-[11px] tracking-[0.18em] uppercase text-pressbox-orange-soft mb-3">
              Why Citrus
            </div>
            <h2 className="font-condensed font-extrabold uppercase text-[2rem] md:text-[2.75rem] tracking-[-0.025em] text-pastel-cream">
              What you are <span className="text-pressbox-orange">signing up for</span>.
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
            {[
              { icon: <BarChart3 className="h-5 w-5" strokeWidth={2.5} />, title: 'xG Projections', desc: 'Every projection comes from an expected-goals model built for the NHL, and it is a range with a floor and a ceiling rather than one number.', accent: 'orange' as const },
              { icon: <Zap className="h-5 w-5" strokeWidth={2.5} />, title: 'AI-Powered Insights', desc: 'Stormy knows your roster and your scoring settings before you ask, and he quotes the number he is leaning on when he answers.', accent: 'sage' as const },
              { icon: <Trophy className="h-5 w-5" strokeWidth={2.5} />, title: 'Saturday Finishes', desc: 'Matchup weeks run Sunday to Saturday, so your week ends on the biggest slate of the schedule.', accent: 'orange' as const },
              { icon: <Users className="h-5 w-5" strokeWidth={2.5} />, title: 'Built for hockey', desc: 'Citrus is a hockey app first. Every screen, stat and rule was designed around the NHL season, not ported from another sport.', accent: 'sage' as const },
              { icon: <Star className="h-5 w-5" strokeWidth={2.5} />, title: 'Full Player Projections', desc: 'A floor, a middle and a ceiling for every skater every night, on the player page next to the stats.', accent: 'orange' as const },
              { icon: <CitrusLogo className="h-5 w-5" />, title: 'No fees, no payouts', desc: 'Citrus does not take entry fees and does not pay anything out. It is season-long fantasy with your friends.', accent: 'sage' as const },
            ].map((feature, i) => (
              <GlowCard key={i} accent={feature.accent}>
                <article className="p-5 h-full flex flex-col">
                  <div className={`h-11 w-11 rounded-xl flex items-center justify-center mb-4 ring-1 ${
                    feature.accent === 'orange'
                      ? 'bg-pastel-orange/15 ring-pastel-orange/30 text-pastel-orange'
                      : 'bg-pastel-sage/15 ring-pastel-sage/30 text-pastel-sage-soft'
                  }`}>
                    {feature.icon}
                  </div>
                  <h3 className="font-sans font-bold text-[16px] text-pastel-cream mb-2 tracking-[-0.015em] leading-tight">{feature.title}</h3>
                  <p className="text-[13px] text-white/65 leading-relaxed flex-1">{feature.desc}</p>
                </article>
              </GlowCard>
            ))}
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="max-w-[1100px] mx-auto px-6 py-12">
          <div className="max-w-lg mx-auto">
            <GlowCard accent="orange">
              <div className="p-8 text-center">
                <div className="font-plex font-semibold text-[11px] tracking-[0.18em] uppercase text-pressbox-orange-soft mb-3">
                  Before puck drop
                </div>
                <h3 className="font-condensed font-extrabold uppercase text-[1.75rem] text-pastel-cream mb-3 tracking-[-0.025em]">
                  One email <span className="text-pressbox-orange">the week before</span>.
                </h3>
                <p className="text-[13px] text-white/65 mb-6 leading-relaxed">
                  A reminder to get your league drafted before the season starts, and nothing else.
                </p>
                <WaitlistSignup source="waitlist_page_bottom" variant="default" />
              </div>
            </GlowCard>
          </div>
        </section>
      </main>

      <HockeyFooter />
    </DarkLayout>
  );
};

export default Waitlist;
