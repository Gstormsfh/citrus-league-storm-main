
import { Button } from '@/components/ui/button';
import { Play, ArrowRight, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';

const CtaSection = () => {
  return (
    <section className="section-padding relative overflow-hidden bg-gradient-to-br from-citrus-sage via-citrus-orange to-citrus-peach">
      {/* Vintage texture overlay */}
      <div className="absolute inset-0 opacity-[0.03] bg-[radial-gradient(circle_at_1px_1px,_#1B3022_1px,_transparent_1px)] bg-[length:40px_40px]"></div>
      
      {/* Large decorative patches */}
      <div className="absolute top-0 left-0 right-0 bottom-0 overflow-hidden">
        <div className="absolute top-10 left-10 w-64 h-64 rounded-varsity bg-citrus-cream/10 rotate-12 border-4 border-citrus-cream/20"></div>
        <div className="absolute bottom-10 right-10 w-96 h-96 rounded-varsity bg-citrus-cream/10 -rotate-6 border-4 border-citrus-cream/20"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-citrus-cream/5"></div>
      </div>
      
      <div className="container mx-auto relative z-10">
        <div className="max-w-4xl mx-auto text-center">
          {/* Varsity Badge */}
          <div className="inline-flex items-center gap-2 bg-citrus-cream border-4 border-citrus-forest rounded-varsity px-6 py-3 mb-8 shadow-varsity animated-element animate">
            <Trophy className="h-5 w-5 text-citrus-orange" />
            <span className="font-varsity text-xs uppercase tracking-widest text-citrus-forest">Championship Ready</span>
          </div>
          
          {/* Main Headline */}
          <h2 className="text-4xl md:text-5xl lg:text-7xl font-varsity font-black uppercase text-citrus-cream mb-8 leading-none tracking-tight animated-element animate drop-shadow-lg">
            Stop Losing<br/>
            To <span className="text-citrus-forest">Outdated</span><br/>
            Platforms
          </h2>
          
          {/* Subheadline */}
          <div className="max-w-2xl mx-auto mb-12">
            <p className="text-lg md:text-2xl text-citrus-cream font-display font-bold leading-relaxed animated-element animate drop-shadow-md">
              We're NHL fanatics who built the projections system we wished existed.
            </p>
            <p className="text-base md:text-lg text-citrus-cream/90 font-sans mt-4 leading-relaxed animated-element animate">
              Real data • Real analysis • Real results • No more guessing games
            </p>
          </div>
          
          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-5 justify-center mb-10 animated-element animate">
            <Link to="/gm-office">
              <Button 
                size="lg" 
                className="bg-citrus-cream text-citrus-orange hover:bg-citrus-cream/90 border-4 border-citrus-charcoal rounded-varsity text-base px-10 py-6 font-varsity uppercase shadow-varsity hover:translate-y-0.5 transition-all"
              >
                Start Your Season <ArrowRight size={20} className="ml-2" />
              </Button>
            </Link>
            <Link to="/standings">
              <Button 
                size="lg" 
                className="bg-transparent text-citrus-cream border-4 border-citrus-cream hover:bg-citrus-cream/10 rounded-varsity text-base px-10 py-6 font-varsity uppercase shadow-patch hover:translate-y-0.5 transition-all"
              >
                <Play size={20} className="mr-2" /> View Demo
              </Button>
            </Link>
          </div>
          
          {/* Trust Badge */}
          <div className="inline-flex items-center gap-4 bg-citrus-cream/10 backdrop-blur-sm border-2 border-citrus-cream/30 rounded-2xl px-6 py-4 animated-element animate">
            <div className="flex -space-x-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="w-10 h-10 rounded-full bg-citrus-sage border-3 border-citrus-cream shadow-md flex items-center justify-center font-varsity text-xs text-citrus-forest">
                  ★
                </div>
              ))}
            </div>
            <div className="text-left">
              <p className="font-display font-bold text-citrus-cream text-sm">
                No credit card required
              </p>
              <p className="text-xs text-citrus-cream/80">
                Free puck drop • Available forever
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CtaSection;
