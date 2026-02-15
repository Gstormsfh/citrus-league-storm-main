// Standalone Waitlist Page - Shareable link for social media signups
import { Link } from 'react-router-dom';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import WaitlistSignup from '@/components/WaitlistSignup';
import { CitrusBackground } from '@/components/CitrusBackground';
import { CitrusLogo } from '@/components/icons/CitrusIcons';
import { Narwhal } from '@/components/icons/Narwhal';
import { ArrowRight, Zap, BarChart3, Trophy, Users, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';

const Waitlist = () => {
  return (
    <div className="min-h-screen relative bg-[#D4E8B8]">
      <CitrusBackground density="medium" animated={true} />
      <Navbar />

      <main className="pt-[92px] pb-20">
        {/* Hero Section */}
        <section className="relative overflow-hidden">
          <div className="container mx-auto px-4 py-16 md:py-24">
            <div className="max-w-3xl mx-auto text-center">
              {/* Badge */}
              <div className="inline-flex items-center gap-2 bg-citrus-orange/30 border-2 border-citrus-orange rounded-varsity px-5 py-2.5 mb-8">
                <CitrusLogo className="w-5 h-5" />
                <span className="font-display font-bold text-xs uppercase tracking-wider text-citrus-forest">
                  Coming Soon • Be First In Line
                </span>
              </div>

              {/* Headline */}
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-varsity font-black leading-none uppercase mb-6 text-citrus-forest tracking-tight drop-shadow-[0_2px_2px_rgba(255,255,255,0.3)]">
                Fantasy Hockey<br />
                <span className="text-citrus-green-dark drop-shadow-[0_2px_4px_rgba(255,255,255,0.5)]">
                  Reimagined
                </span>
              </h1>

              <p className="text-lg md:text-xl text-citrus-forest/90 max-w-xl mx-auto mb-4 font-sans font-medium leading-relaxed">
                Citrus Fantasy Sports is building the next generation of fantasy hockey — 
                powered by real-time xG projections, AI-driven insights, and a platform designed for fans who actually watch the games.
              </p>

              <p className="text-base text-citrus-forest/70 max-w-lg mx-auto mb-10 font-sans leading-relaxed">
                We're currently in testing. Join the waitlist to be the first to know when full multiplayer leagues launch.
              </p>

              {/* Waitlist Signup - The Main Event */}
              <div className="max-w-lg mx-auto bg-white/40 backdrop-blur-sm border-4 border-citrus-forest rounded-[2rem] p-8 shadow-[0_8px_0_rgba(27,48,34,0.15)] mb-12">
                <div className="flex items-center justify-center gap-2 mb-4">
                  <Narwhal className="h-8 w-8 text-citrus-forest" />
                  <h2 className="font-varsity text-2xl text-citrus-forest uppercase">Join the Waitlist</h2>
                </div>
                <p className="text-sm text-citrus-forest/70 mb-6 font-sans">
                  Drop your email below and we'll notify you as soon as we're live. No spam — just launch news.
                </p>
                <WaitlistSignup source="waitlist_page" variant="default" />
              </div>

              {/* Try the Platform */}
              <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                <Link to="/create-league">
                  <Button variant="varsity" size="lg" className="text-base">
                    Try a Test League Now <ArrowRight size={18} className="ml-2" />
                  </Button>
                </Link>
                <Link to="/standings">
                  <Button variant="outline" size="lg" className="text-base border-2 border-citrus-forest text-citrus-forest hover:bg-citrus-forest/10">
                    View Demo League
                  </Button>
                </Link>
              </div>
              <p className="text-xs text-citrus-forest/50 mt-3 font-sans">
                Create a test league filled with AI teams to experience the full platform today.
              </p>
            </div>
          </div>
        </section>

        {/* Why Citrus? Features Grid */}
        <section className="container mx-auto px-4 py-16">
          <h2 className="text-3xl md:text-4xl font-varsity font-black text-center text-citrus-forest uppercase mb-12 tracking-tight">
            Why <span className="text-citrus-orange">Citrus?</span>
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {[
              {
                icon: <BarChart3 className="h-6 w-6" />,
                title: 'xG Projections',
                desc: '98.7% projection accuracy using Expected Goals, deployment patterns, and line combos updated in real-time.',
              },
              {
                icon: <Zap className="h-6 w-6" />,
                title: 'AI-Powered Insights',
                desc: 'Stormy, our AI assistant, watches every shift and gives you trade, start/sit, and pickup advice grounded in data.',
              },
              {
                icon: <Trophy className="h-6 w-6" />,
                title: 'Saturday Finishes',
                desc: 'Matchup weeks end Saturday so the entire league is battling it out on the biggest night in hockey.',
              },
              {
                icon: <Users className="h-6 w-6" />,
                title: 'Built for Hockey Fans',
                desc: 'Not a generic sports app with hockey bolted on. Every feature is designed by people who watch the games.',
              },
              {
                icon: <Star className="h-6 w-6" />,
                title: '700+ Player Writeups',
                desc: 'Every NHL player has a detailed scouting report, projection breakdown, and fantasy outlook.',
              },
              {
                icon: <CitrusLogo className="h-6 w-6" />,
                title: 'Modern Platform',
                desc: 'While Yahoo and ESPN serve stale 2015 data, we pull real-time xGF%, line combos, and deployment patterns.',
              },
            ].map((feature, i) => (
              <div
                key={i}
                className="bg-white/30 backdrop-blur-sm border-2 border-citrus-sage/40 rounded-2xl p-6 hover:border-citrus-orange/50 transition-colors"
              >
                <div className="h-12 w-12 rounded-varsity bg-citrus-sage/20 border-2 border-citrus-sage/30 flex items-center justify-center text-citrus-forest mb-4">
                  {feature.icon}
                </div>
                <h3 className="font-varsity text-lg text-citrus-forest uppercase mb-2">{feature.title}</h3>
                <p className="text-sm text-citrus-forest/70 font-sans leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="container mx-auto px-4 py-12">
          <div className="max-w-lg mx-auto text-center">
            <h3 className="font-varsity text-2xl text-citrus-forest uppercase mb-4">Don't Miss the Launch</h3>
            <p className="text-sm text-citrus-forest/70 mb-6 font-sans">
              Be among the first to create real multiplayer leagues when we go live.
            </p>
            <WaitlistSignup source="waitlist_page_bottom" variant="default" />
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default Waitlist;
