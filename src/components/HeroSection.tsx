
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

const HeroSection = () => {
  return (
    <div className="relative min-h-screen bg-citrus-cream pt-28 overflow-hidden">
      {/* Background decorative elements */}
      <div className="absolute top-20 right-0 w-96 h-96 bg-citrus-yellow-light rounded-full opacity-50 blur-3xl -z-10"></div>
      <div className="absolute bottom-20 left-0 w-96 h-96 bg-citrus-green-light rounded-full opacity-50 blur-3xl -z-10"></div>
      
      <div className="container mx-auto px-4 flex flex-col lg:flex-row items-center justify-between py-16 lg:py-24">
        <div className="lg:w-1/2 mb-12 lg:mb-0 lg:pr-12 animate-fade-in">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mb-6">
            Leave Your Parents<br/> 
            <span className="citrus-gradient-text">Fantasy Sports Apps Behind</span>
          </h1>
          <p className="text-lg md:text-xl mb-8 text-foreground/80 max-w-lg">
            Built by real NHL fanatics who understand proper projections. Experience next-level fantasy hockey with AI-powered insights that actually work.
          </p>
          
          <div className="flex flex-wrap gap-4">
            <Link to="/auth">
              <Button size="lg" className="rounded-full text-base px-8">
                Get Started <ArrowRight size={18} className="ml-2" />
              </Button>
            </Link>
            <Link to="/standings">
              <Button size="lg" variant="outline" className="rounded-full text-base px-8">
                View Leagues
              </Button>
            </Link>
          </div>
          
          <div className="mt-8 flex items-center">
            <div className="flex -space-x-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="w-10 h-10 rounded-full bg-citrus-peach border-2 border-white"></div>
              ))}
            </div>
            <p className="ml-4 text-sm text-foreground/80">
              <span className="font-bold">5,000+</span> fantasy players joined this month
            </p>
          </div>
        </div>
        
        <div className="lg:w-1/2 relative animate-fade-in">
          <div className="relative rounded-2xl overflow-hidden shadow-2xl border border-white/20 bg-white/10 backdrop-blur-sm">
            <div className="absolute inset-0 bg-gradient-to-br from-citrus-green-light/40 to-citrus-yellow-light/40 opacity-70"></div>
            <div className="relative p-6 md:p-8">
              <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg p-6 mb-6">
                <h3 className="text-lg font-bold mb-4 flex items-center">
                  <span className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white mr-3">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                    </svg>
                  </span>
                  Stormy's Draft Analysis
                </h3>
                <p className="text-sm text-foreground/80 mb-2">Your center depth is solid, but consider:</p>
                <div className="bg-citrus-peach-light rounded-lg p-3 text-sm">
                  "Auston Matthews is consistently undervalued at this ADP. Consider grabbing him in round 2 for massive positional advantage and elite goal scoring."
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white/80 backdrop-blur-sm rounded-lg p-4">
                  <h4 className="font-bold text-sm mb-2 flex items-center justify-between">
                    League Activity
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                  </h4>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs border-b border-black/5 pb-1">
                        <div className="w-1 h-8 bg-foreground/20 rounded-full"></div>
                        <div>
                            <span className="font-semibold">Team Orange</span>
                            <p className="text-foreground/70 leading-tight">Added <span className="font-medium">M. Michkov</span></p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                         <div className="w-1 h-8 bg-foreground/20 rounded-full"></div>
                         <div>
                            <span className="font-semibold">Puck Peelers</span>
                            <p className="text-foreground/70 leading-tight">Traded for <span className="font-medium">K. Kaprizov</span></p>
                         </div>
                    </div>
                  </div>
                </div>
                <div className="bg-white/80 backdrop-blur-sm rounded-lg p-4 flex flex-col justify-between">
                  <h4 className="font-bold text-sm mb-1 flex items-center gap-2">
                    Weekly Matchup
                    <span className="text-[10px] bg-foreground/10 text-foreground/80 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Live</span>
                  </h4>
                  <div className="flex flex-col gap-3 mt-1">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-foreground/5 flex items-center justify-center text-xs font-bold text-foreground/70">CC</div>
                            <span className="text-xs font-bold">Citrus Crush</span>
                        </div>
                        <span className="font-bold text-sm">128.7</span>
                    </div>
                    <div className="w-full bg-muted/30 h-1.5 rounded-full overflow-hidden">
                         <div className="bg-foreground/40 w-[55%] h-full rounded-full"></div>
                    </div>
                  <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                             <div className="w-6 h-6 rounded-full bg-foreground/5 flex items-center justify-center text-xs font-bold text-foreground/70">PP</div>
                             <span className="text-xs font-bold">Puck Peelers</span>
                        </div>
                        <span className="font-bold text-sm">115.3</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Floating elements */}
          <div className="absolute -right-10 -top-10 w-24 h-24 bg-citrus-yellow rounded-lg rotate-12 animate-bounce-subtle"></div>
          <div className="absolute -left-8 bottom-20 w-16 h-16 bg-citrus-peach rounded-full animate-bounce-subtle" style={{ animationDelay: "0.5s" }}></div>
        </div>
      </div>
      
      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 flex flex-col items-center">
        <p className="text-sm text-foreground/60 mb-2">Scroll to explore</p>
        <div className="w-6 h-10 border-2 border-foreground/20 rounded-full flex justify-center">
          <div className="w-2 h-2 bg-foreground/60 rounded-full mt-2 animate-bounce"></div>
        </div>
      </div>
    </div>
  );
};

export default HeroSection;
