// Standalone Waitlist Page - Shareable link for social media signups
import WaitlistSignup from '@/components/WaitlistSignup';
import { DarkLayout, HockeyNav, HockeyFooter, MascotAvatar } from '@/components/citrus2';

const Waitlist = () => {
  return (
    <DarkLayout>
      <HockeyNav />

      <main className="relative pt-12 pb-20">
        {/* Hero Section */}
        <section className="relative overflow-hidden">
          <div className="max-w-[1100px] mx-auto px-6 py-16 md:py-24">
            <div className="max-w-3xl mx-auto text-center">
              <div className="flex justify-center mb-6">
                <MascotAvatar id="stormy" size="xl" />
              </div>
              <div className="inline-flex items-center gap-2 mb-7 px-3 py-1.5 rounded-md bg-pastel-orange/15 ring-1 ring-pastel-orange/30">
                <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft leading-none font-bold">
                  🏒 Coming Soon · Be First In Line
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

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6 max-w-5xl mx-auto">
            {[
              {
                icon: <BarChart3 className="h-6 w-6" />,
                title: 'xG Projections',
                desc: '31-feature XGBoost model using Expected Goals, deployment patterns, and line combos updated in real-time.',
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
                title: 'Full Player Projections',
                desc: 'Daily projections with confidence intervals and Monte Carlo ranges for every rostered NHL player.',
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
        <section className="max-w-[1100px] mx-auto px-6 py-12">
          <div className="max-w-lg mx-auto text-center">
            <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-3 font-bold">
              Don't Miss the Drop
            </div>
            <h3 className="font-sans font-black text-[1.75rem] text-pastel-cream mb-4 tracking-[-0.02em]">
              Be among the first.
            </h3>
            <p className="text-[14px] text-white/60 mb-6">
              Be first to create real multiplayer leagues when we go live.
            </p>
            <WaitlistSignup source="waitlist_page_bottom" variant="default" />
          </div>
        </section>
      </main>

      <HockeyFooter />
    </DarkLayout>
  );
};

export default Waitlist;
