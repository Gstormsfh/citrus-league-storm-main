// Standalone Waitlist Page - Shareable link for social media signups
import { Link } from 'react-router-dom';
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
                <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft leading-none font-bold">
                  Coming Soon · Be First In Line
                </span>
              </div>

              <h1 className="font-sans font-black text-[3rem] md:text-[4.5rem] lg:text-[5.5rem] leading-[0.95] tracking-[-0.035em] text-pastel-cream mb-6">
                Fantasy Hockey<br />
                <span className="text-pastel-orange">Reimagined</span>
              </h1>

              <p className="text-[17px] md:text-[19px] leading-relaxed text-white/65 max-w-xl mx-auto mb-4">
                Citrus is building the next generation of fantasy hockey — real-time xG projections,
                Stormy AI as your assistant GM, and a platform designed by people who actually watch the games.
              </p>

              <p className="text-[14px] text-white/55 max-w-lg mx-auto mb-10 leading-relaxed">
                We're currently in testing. Join the waitlist to be first when full multiplayer leagues launch.
              </p>

              {/* Waitlist Signup - The Main Event */}
              <div className="max-w-lg mx-auto mb-12">
                <GlowCard accent="orange">
                  <div className="p-8">
                    <div className="flex items-center justify-center gap-2 mb-4">
                      <Narwhal className="h-7 w-7 text-pastel-orange" />
                      <h2 className="font-sans font-black text-[1.5rem] tracking-[-0.02em] text-pastel-cream">
                        Join the <span className="text-pastel-orange">Waitlist</span>
                      </h2>
                    </div>
                    <p className="text-[13px] text-white/65 mb-6 leading-relaxed">
                      Drop your email below and we'll notify you as soon as we're live. No spam — just launch news.
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
              <p className="text-[11px] font-jbmono text-white/45 mt-4">
                Create a test league filled with AI teams to experience the full platform today.
              </p>
            </div>
          </div>
        </section>

        {/* Why Citrus? Features Grid */}
        <section className="max-w-[1100px] mx-auto px-6 py-16">
          <div className="text-center mb-12">
            <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-3 font-bold">
              ✦ Why Citrus
            </div>
            <h2 className="font-sans font-black text-[2rem] md:text-[2.75rem] tracking-[-0.025em] text-pastel-cream">
              Built different. <span className="text-pastel-orange">Play different.</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
            {[
              { icon: <BarChart3 className="h-5 w-5" strokeWidth={2.5} />, title: 'xG Projections', desc: '31-feature XGBoost model using Expected Goals, deployment patterns, and line combos updated in real-time.', accent: 'orange' as const },
              { icon: <Zap className="h-5 w-5" strokeWidth={2.5} />, title: 'AI-Powered Insights', desc: 'Stormy, our AI assistant, watches every shift and gives you trade, start/sit, and pickup advice grounded in data.', accent: 'sage' as const },
              { icon: <Trophy className="h-5 w-5" strokeWidth={2.5} />, title: 'Saturday Finishes', desc: 'Matchup weeks end Saturday so the entire league is battling it out on the biggest night in hockey.', accent: 'orange' as const },
              { icon: <Users className="h-5 w-5" strokeWidth={2.5} />, title: 'Built for Hockey Fans', desc: 'Not a generic sports app with hockey bolted on. Every feature is designed by people who watch the games.', accent: 'sage' as const },
              { icon: <Star className="h-5 w-5" strokeWidth={2.5} />, title: 'Full Player Projections', desc: 'Daily projections with confidence intervals and Monte Carlo ranges for every rostered NHL player.', accent: 'orange' as const },
              { icon: <CitrusLogo className="h-5 w-5" />, title: 'Modern Platform', desc: 'While Yahoo and ESPN serve stale 2015 data, we pull real-time xGF%, line combos, and deployment patterns.', accent: 'sage' as const },
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
                <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-3 font-bold">
                  ✦ Don't Miss the Drop
                </div>
                <h3 className="font-sans font-black text-[1.75rem] text-pastel-cream mb-3 tracking-[-0.025em]">
                  Be among the <span className="text-pastel-orange">first.</span>
                </h3>
                <p className="text-[13px] text-white/65 mb-6 leading-relaxed">
                  Be first to create real multiplayer leagues when we go live.
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
