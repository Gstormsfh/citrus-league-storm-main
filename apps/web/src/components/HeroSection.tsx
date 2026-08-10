
import { Button } from '@/components/ui/button';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { CitrusLogo } from '@/components/icons/CitrusIcons';
import { CURRENT_SEASON, SEASON_LABEL } from '@/utils/seasonConstants';
import WaitlistSignup from '@/components/WaitlistSignup';

const HeroSection = () => {
  return (
    <div className="relative bg-[#D4E8B8] dark:bg-background overflow-x-hidden">
      {/* Solid creamy green background */}

      <div className="container mx-auto px-4 flex flex-col lg:flex-row items-center justify-between py-12 lg:py-16">
        <div className="lg:w-1/2 mb-12 lg:mb-0 lg:pr-12 animate-fade-in">
          {/* Testing Phase Badge */}
          <div className="inline-flex items-center gap-2 bg-pastel-orange/40 border-2 border-pastel-orange rounded-varsity px-4 py-2 mb-4">
            <Sparkles className="w-4 h-4 text-pastel-cream" />
            <span className="font-display font-bold text-xs uppercase tracking-wider text-pastel-cream">Testing Phase • Full Launch Coming Soon</span>
          </div>
          
          {/* Vintage badge */}
          <div className="inline-flex items-center gap-2 bg-pastel-sage/40 border-2 border-pastel-sage rounded-varsity px-4 py-2 mb-6">
            <CitrusLogo className="w-5 h-5 animate-pulse" />
            <span className="font-display font-bold text-xs uppercase tracking-wider text-pastel-cream">Live Fantasy Hockey • {CURRENT_SEASON}</span>
          </div>
          
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-7xl font-varsity font-black leading-none uppercase mb-6 text-pastel-cream tracking-tight drop-shadow-[0_2px_2px_rgba(255,255,255,0.3)]">
            Leave Your<br/>
            <span className="text-pastel-sage-soft drop-shadow-[0_2px_4px_rgba(255,255,255,0.5)]">Parents' Apps</span><br/>
            Behind
          </h1>
          
          <p className="text-lg md:text-xl mb-4 text-pastel-cream max-w-lg font-sans font-medium leading-relaxed">
            <span className="font-black text-pastel-sage-soft drop-shadow-[0_1px_2px_rgba(255,255,255,0.5)]">31-feature xG model.</span> Real-time projections for every NHL player. <span className="font-black text-pastel-sage-soft drop-shadow-[0_1px_2px_rgba(255,255,255,0.5)]">Saturday finishes</span> when the entire league is playing.
          </p>
          
          <p className="text-base md:text-lg mb-4 text-pastel-cream/80 max-w-lg font-sans leading-relaxed">
            While Yahoo and ESPN serve you stale data from 2015, we're pulling real-time xGF%, deployment patterns, and line combos. Our AI watches every shift. You get insights that actually win matchups.
          </p>
          
          {/* Testing Phase Message */}
          <div className="bg-pastel-orange/20 border-2 border-pastel-orange/40 rounded-xl p-4 mb-6 max-w-lg">
            <p className="text-sm md:text-base text-pastel-cream font-sans font-medium leading-relaxed mb-2">
              <span className="font-black text-pastel-orange">We're in testing!</span> Create a league and we'll fill it with AI teams so you can experience the full platform. Try the complete draft experience and draft against AI opponents.
            </p>
            <p className="text-xs md:text-sm text-pastel-cream/70 font-sans">
              Sign up for the waitlist to be notified when full service launches with real multiplayer leagues.
            </p>
          </div>
          
          <div className="flex flex-wrap gap-4 mb-6">
            <Link to="/create-league">
              <Button variant="varsity" size="lg" className="text-base">
                <Sparkles size={18} className="mr-2" />
                Create Test League
              </Button>
            </Link>
            <Link to="/standings">
              <Button variant="outline" size="lg" className="text-base">
                View Demo League
              </Button>
            </Link>
          </div>
          
          {/* Data-driven stats showcase */}
          <div className="grid grid-cols-3 gap-3 sm:gap-4 max-w-lg">
            <div className="bg-[#1A2A20] backdrop-blur-sm border-2 border-pastel-sage-soft/40 rounded-xl p-3 sm:p-4 text-center shadow-md">
              <div className="font-varsity text-xl sm:text-2xl font-black text-pastel-sage-soft drop-shadow-[0_1px_2px_rgba(255,255,255,0.5)] mb-1">31</div>
              <div className="text-[10px] sm:text-xs text-pastel-cream font-display uppercase tracking-wide font-bold">xG Features</div>
            </div>
            <div className="bg-[#1A2A20] backdrop-blur-sm border-2 border-pastel-sage-soft/40 rounded-xl p-3 sm:p-4 text-center shadow-md">
              <div className="font-varsity text-xl sm:text-2xl font-black text-pastel-sage-soft drop-shadow-[0_1px_2px_rgba(255,255,255,0.5)] mb-1">SAT</div>
              <div className="text-[10px] sm:text-xs text-pastel-cream font-display uppercase tracking-wide font-bold">Finishes</div>
            </div>
            <div className="bg-[#1A2A20] backdrop-blur-sm border-2 border-pastel-orange/60 rounded-xl p-3 sm:p-4 text-center shadow-md">
              <div className="font-varsity text-xl sm:text-2xl font-black text-pastel-orange drop-shadow-[0_1px_2px_rgba(255,255,255,0.5)] mb-1">LIVE</div>
              <div className="text-[10px] sm:text-xs text-pastel-cream font-display uppercase tracking-wide font-bold">Scoring</div>
            </div>
          </div>
        </div>
        
        <div className="lg:w-1/2 relative animate-fade-in">
          {/* Waitlist Signup - positioned right below News/Contact */}
          <div className="hidden lg:block mb-6 max-w-lg">
            <p className="text-sm font-display font-bold text-pastel-cream mb-3 uppercase tracking-wide">
              Join the Waitlist
            </p>
            <WaitlistSignup source="hero_section" variant="default" />
          </div>
          
          {/* Testing phase context text — fills the visual gap above the card */}
          <div className="hidden lg:block mb-6 max-w-lg">
            <p className="text-sm md:text-base text-pastel-cream/90 font-sans leading-relaxed">
              <span className="font-bold text-pastel-orange">We're in testing!</span> Create a league and we'll fill it with AI teams so you can experience the full platform. Try the complete draft experience and draft against AI opponents. Sign up for the waitlist to be notified when full service launches with real multiplayer leagues.
            </p>
          </div>

          {/* Premium Letterman Card with thick borders */}
          <div className="card-letterman-thick shadow-varsity relative">
            <div className="absolute -top-4 -right-4 w-16 h-16 rotate-12">
              <CitrusLogo className="w-16 h-16 drop-shadow-lg" />
            </div>
            
            <div className="relative">
              {/* Stormy AI Card */}
              <div className="card-letterman mb-6 bg-gradient-to-br from-pastel-sage/20 to-pastel-sage/20 border-2 border-pastel-sage/50 hover:shadow-md transition-all">
                <div className="flex items-start gap-4 mb-4">
                  <div className="w-12 h-12 rounded-varsity bg-pastel-sage/40 border-2 border-pastel-sage flex items-center justify-center shadow-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 text-pastel-sage">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-varsity text-base uppercase text-pastel-cream mb-1 tracking-wide">
                      Stormy AI Analysis
                    </h3>
                    <p className="text-xs text-white/55 font-display">Real-time draft insights</p>
                  </div>
                </div>
                <div className="bg-[#1A2A20] backdrop-blur-sm border-2 border-pastel-sage rounded-xl p-4 shadow-sm">
                  <p className="text-sm text-white/55 font-sans leading-relaxed italic">
                    "Auston Matthews is consistently undervalued at this ADP. Consider grabbing him in round 2 for <span className="font-bold text-pastel-sage not-italic">massive positional advantage</span> and elite goal scoring."
                  </p>
                </div>
              </div>
              
              {/* Activity Grid */}
              <div className="grid grid-cols-2 gap-4">
                {/* League Activity Card */}
                <div className="card-letterman bg-[#1A2A20] backdrop-blur-sm hover:shadow-varsity transition-all p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-display font-bold text-xs uppercase text-pastel-cream tracking-wide">
                      Live Activity
                    </h4>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-pastel-sage animate-pulse"></span>
                      <span className="text-[9px] font-bold text-pastel-sage uppercase">Live</span>
                    </span>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 p-2 bg-pastel-sage/10 rounded-lg border border-pastel-sage/30">
                        <div className="w-6 h-6 bg-pastel-sage rounded-full flex items-center justify-center text-[8px] font-varsity text-pastel-cream border-2 border-white/10/20">
                            TO
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-display font-bold text-pastel-cream truncate">Team Orange</p>
                            <p className="text-[9px] text-white/55">+ M. Michkov</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 p-2 bg-pastel-sage/15/10 rounded-lg border border-pastel-sage/30">
                         <div className="w-6 h-6 bg-pastel-sage/15 rounded-full flex items-center justify-center text-[8px] font-varsity text-pastel-cream border-2 border-pastel-orange/20">
                            PP
                         </div>
                         <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-display font-bold text-pastel-cream truncate">Puck Peelers</p>
                            <p className="text-[9px] text-white/55">↔ K. Kaprizov</p>
                         </div>
                    </div>
                  </div>
                </div>
                
                {/* Matchup Score Card */}
                <div className="card-letterman bg-gradient-to-br from-pastel-sage/10 to-pastel-sage-soft/10 border-2 border-pastel-sage/40 hover:shadow-md transition-all p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-display font-bold text-xs uppercase text-pastel-cream tracking-wide">
                      This Week
                    </h4>
                    <div className="bg-pastel-sage/20 border-2 border-pastel-sage rounded-full px-2 py-0.5">
                      <span className="text-[9px] font-varsity text-pastel-cream uppercase">W13</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center p-2 bg-[#1A2A20] backdrop-blur-sm/80 rounded-lg">
                        <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded-full bg-pastel-sage border-2 border-white/10/20 flex items-center justify-center text-[8px] font-varsity text-pastel-cream">C</div>
                            <span className="text-[10px] font-display font-bold text-pastel-cream">Citrus</span>
                        </div>
                        <span className="font-varsity text-sm text-pastel-sage">128</span>
                    </div>
                    <div className="relative w-full h-3 bg-white/10 rounded-full overflow-hidden border-2 border-white/10/20">
                         <div className="absolute left-0 top-0 h-full w-[55%] bg-gradient-to-r from-pastel-sage to-pastel-sage rounded-full shadow-inner"></div>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-[#1A2A20] backdrop-blur-sm/80 rounded-lg">
                        <div className="flex items-center gap-2">
                             <div className="w-5 h-5 rounded-full bg-pastel-sage-soft border-2 border-pastel-sage/20 flex items-center justify-center text-[8px] font-varsity text-pastel-cream">P</div>
                             <span className="text-[10px] font-display font-bold text-pastel-cream">Peelers</span>
                        </div>
                        <span className="font-varsity text-sm text-white/55">115</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Vintage Scroll Indicator — hidden on mobile so it doesn't block content */}
      <div className="hidden md:flex absolute bottom-12 left-1/2 transform -translate-x-1/2 flex-col items-center animate-bounce-subtle">
        <p className="font-display text-xs text-white/55 mb-3 uppercase tracking-widest">Explore Features</p>
        <div className="w-8 h-12 border-2 border-pastel-sage/60 rounded-varsity flex justify-center shadow-sm">
          <div className="w-2.5 h-2.5 bg-pastel-orange rounded-full mt-2 animate-bounce"></div>
        </div>
      </div>
    </div>
  );
};

export default HeroSection;
