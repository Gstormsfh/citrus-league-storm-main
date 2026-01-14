
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

const HeroSection = () => {
  return (
    <div className="relative min-h-screen bg-citrus-cream pt-28 overflow-hidden">
      {/* Background decorative elements - Vintage texture */}
      <div className="absolute inset-0 opacity-[0.02] bg-[radial-gradient(circle_at_1px_1px,_#1B3022_1px,_transparent_1px)] bg-[length:40px_40px] -z-10"></div>
      <div className="absolute top-20 right-0 w-96 h-96 bg-citrus-sage/20 rounded-full opacity-50 blur-3xl -z-10"></div>
      <div className="absolute bottom-20 left-0 w-96 h-96 bg-citrus-peach/30 rounded-full opacity-50 blur-3xl -z-10"></div>
      
      {/* Floating varsity patches */}
      <div className="absolute top-40 right-20 w-32 h-32 bg-citrus-orange/10 border-4 border-citrus-orange/20 rounded-varsity rotate-12 animate-bounce-subtle hidden lg:block"></div>
      <div className="absolute bottom-40 left-20 w-24 h-24 bg-citrus-sage/10 border-4 border-citrus-sage/20 rounded-varsity -rotate-6 animate-bounce-subtle hidden lg:block" style={{ animationDelay: "0.5s" }}></div>
      
      <div className="container mx-auto px-4 flex flex-col lg:flex-row items-center justify-between py-16 lg:py-24">
        <div className="lg:w-1/2 mb-12 lg:mb-0 lg:pr-12 animate-fade-in">
          {/* Vintage badge */}
          <div className="inline-flex items-center gap-2 bg-citrus-sage/20 border-2 border-citrus-sage rounded-varsity px-4 py-2 mb-6">
            <span className="w-2 h-2 bg-citrus-orange rounded-full animate-pulse"></span>
            <span className="font-display font-bold text-xs uppercase tracking-wider text-citrus-forest">Live Fantasy Hockey • 2025</span>
          </div>
          
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-varsity font-black leading-none uppercase mb-6 text-citrus-forest tracking-tight">
            Leave Your<br/>
            <span className="text-citrus-orange">Parents' Apps</span><br/>
            Behind
          </h1>
          
          <p className="text-lg md:text-xl mb-10 text-citrus-charcoal max-w-lg font-sans font-medium leading-relaxed">
            Built by real NHL fanatics who understand proper projections. Experience <span className="text-citrus-orange font-bold">next-level fantasy hockey</span> with AI-powered insights that actually work.
          </p>
          
          <div className="flex flex-wrap gap-4 mb-10">
            <Link to="/auth">
              <Button variant="varsity" size="lg" className="text-base">
                Get Started <ArrowRight size={18} className="ml-2" />
              </Button>
            </Link>
            <Link to="/create-league?tab=join">
              <Button variant="outline" size="lg" className="text-base">
                Join League
              </Button>
            </Link>
            <Link to="/standings">
              <Button variant="outline" size="lg" className="text-base">
                View Demo League
              </Button>
            </Link>
          </div>
          
          {/* Social proof with vintage styling */}
          <div className="flex items-center gap-6 p-4 bg-citrus-peach/20 border-2 border-citrus-peach rounded-2xl">
            <div className="flex -space-x-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="w-12 h-12 rounded-full bg-citrus-sage border-3 border-citrus-cream shadow-md flex items-center justify-center font-varsity text-xs text-citrus-forest">
                  {i}K+
                </div>
              ))}
            </div>
            <div>
              <p className="font-display font-bold text-citrus-forest">
                5,000+ Players
              </p>
              <p className="text-sm text-citrus-charcoal">
                Joined this month
              </p>
            </div>
          </div>
        </div>
        
        <div className="lg:w-1/2 relative animate-fade-in">
          {/* Premium Letterman Card with thick borders */}
          <div className="card-letterman-thick shadow-varsity relative">
            <div className="absolute -top-3 -right-3 bg-citrus-orange border-3 border-citrus-charcoal rounded-full w-16 h-16 flex items-center justify-center font-varsity text-xs text-citrus-cream uppercase rotate-12 shadow-patch">
              New
            </div>
            
            <div className="relative">
              {/* Stormy AI Card */}
              <div className="card-letterman mb-6 bg-gradient-to-br from-citrus-sage/20 to-citrus-peach/20 border-3 border-citrus-sage hover:shadow-varsity transition-all">
                <div className="flex items-start gap-4 mb-4">
                  <div className="w-12 h-12 rounded-varsity bg-citrus-orange border-3 border-citrus-charcoal flex items-center justify-center shadow-patch">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="w-6 h-6 text-citrus-cream">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-varsity text-base uppercase text-citrus-forest mb-1 tracking-wide">
                      Stormy AI Analysis
                    </h3>
                    <p className="text-xs text-citrus-charcoal font-display">Real-time draft insights</p>
                  </div>
                </div>
                <div className="bg-citrus-cream border-2 border-citrus-peach rounded-xl p-4 shadow-sm">
                  <p className="text-sm text-citrus-charcoal font-sans leading-relaxed italic">
                    "Auston Matthews is consistently undervalued at this ADP. Consider grabbing him in round 2 for <span className="font-bold text-citrus-orange not-italic">massive positional advantage</span> and elite goal scoring."
                  </p>
                </div>
              </div>
              
              {/* Activity Grid */}
              <div className="grid grid-cols-2 gap-4">
                {/* League Activity Card */}
                <div className="card-letterman bg-citrus-cream hover:shadow-varsity transition-all p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-display font-bold text-xs uppercase text-citrus-forest tracking-wide">
                      Live Activity
                    </h4>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-citrus-orange animate-pulse"></span>
                      <span className="text-[9px] font-bold text-citrus-orange uppercase">Live</span>
                    </span>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 p-2 bg-citrus-sage/10 rounded-lg border border-citrus-sage/30">
                        <div className="w-6 h-6 bg-citrus-sage rounded-full flex items-center justify-center text-[8px] font-varsity text-citrus-forest border-2 border-citrus-forest/20">
                            TO
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-display font-bold text-citrus-forest truncate">Team Orange</p>
                            <p className="text-[9px] text-citrus-charcoal">+ M. Michkov</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 p-2 bg-citrus-peach/10 rounded-lg border border-citrus-peach/30">
                         <div className="w-6 h-6 bg-citrus-peach rounded-full flex items-center justify-center text-[8px] font-varsity text-citrus-forest border-2 border-citrus-orange/20">
                            PP
                         </div>
                         <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-display font-bold text-citrus-forest truncate">Puck Peelers</p>
                            <p className="text-[9px] text-citrus-charcoal">↔ K. Kaprizov</p>
                         </div>
                    </div>
                  </div>
                </div>
                
                {/* Matchup Score Card */}
                <div className="card-letterman bg-gradient-to-br from-citrus-orange/10 to-citrus-sage/10 border-3 border-citrus-orange/40 hover:shadow-varsity transition-all p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-display font-bold text-xs uppercase text-citrus-forest tracking-wide">
                      This Week
                    </h4>
                    <div className="bg-citrus-orange/20 border-2 border-citrus-orange rounded-full px-2 py-0.5">
                      <span className="text-[9px] font-varsity text-citrus-forest uppercase">W13</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center p-2 bg-citrus-cream/80 rounded-lg">
                        <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded-full bg-citrus-sage border-2 border-citrus-forest/20 flex items-center justify-center text-[8px] font-varsity text-citrus-forest">C</div>
                            <span className="text-[10px] font-display font-bold text-citrus-forest">Citrus</span>
                        </div>
                        <span className="font-varsity text-sm text-citrus-orange">128</span>
                    </div>
                    <div className="relative w-full h-3 bg-citrus-charcoal/10 rounded-full overflow-hidden border-2 border-citrus-charcoal/20">
                         <div className="absolute left-0 top-0 h-full w-[55%] bg-gradient-to-r from-citrus-sage to-citrus-orange rounded-full shadow-inner"></div>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-citrus-cream/80 rounded-lg">
                        <div className="flex items-center gap-2">
                             <div className="w-5 h-5 rounded-full bg-citrus-peach border-2 border-citrus-orange/20 flex items-center justify-center text-[8px] font-varsity text-citrus-forest">P</div>
                             <span className="text-[10px] font-display font-bold text-citrus-forest">Peelers</span>
                        </div>
                        <span className="font-varsity text-sm text-citrus-charcoal">115</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Vintage Scroll Indicator */}
      <div className="absolute bottom-12 left-1/2 transform -translate-x-1/2 flex flex-col items-center animate-bounce-subtle">
        <p className="font-display text-xs text-citrus-charcoal mb-3 uppercase tracking-widest">Explore Features</p>
        <div className="w-8 h-12 border-3 border-citrus-sage rounded-varsity flex justify-center shadow-patch">
          <div className="w-2.5 h-2.5 bg-citrus-orange rounded-full mt-2 animate-bounce"></div>
        </div>
      </div>
    </div>
  );
};

export default HeroSection;
