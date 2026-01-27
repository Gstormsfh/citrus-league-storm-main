
import { Button } from '@/components/ui/button';
import { Play, ArrowRight, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';

const CtaSection = () => {
  return (
    <section className="section-padding relative overflow-hidden bg-gradient-to-br from-citrus-sage via-citrus-green-light to-citrus-sage-light">
      {/* Soft pastel gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,_rgba(184,212,168,0.2)_0%,_transparent_50%)]"></div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_70%,_rgba(200,220,196,0.15)_0%,_transparent_50%)]"></div>
      
      <div className="container mx-auto relative z-10">
        <div className="max-w-4xl mx-auto text-center">
          {/* Varsity Badge */}
          <div className="inline-flex items-center gap-2 bg-[#E8EED9]/60 backdrop-blur-sm border-4 border-citrus-forest rounded-varsity px-6 py-3 mb-8 shadow-varsity animated-element animate">
            <Trophy className="h-5 w-5 text-citrus-sage" />
            <span className="font-varsity text-xs uppercase tracking-widest text-citrus-forest">Championship Ready</span>
          </div>
          
          {/* Main Headline */}
          <h2 className="text-4xl md:text-5xl lg:text-7xl font-varsity font-black uppercase text-citrus-forest mb-8 leading-none tracking-tight animated-element animate drop-shadow-[0_2px_2px_rgba(255,255,255,0.3)]">
            Ready to<br/>
            <span className="text-citrus-orange drop-shadow-[0_2px_4px_rgba(255,255,255,0.6)]">Actually Win?</span>
          </h2>
          
          {/* Subheadline */}
          <div className="max-w-2xl mx-auto mb-12">
            <p className="text-lg md:text-2xl text-citrus-forest font-display font-bold leading-relaxed animated-element animate">
              Built by people who actually watch hockey. For people who actually want to win.
            </p>
            <p className="text-base md:text-lg text-citrus-forest/80 font-sans mt-4 leading-relaxed animated-element animate">
              Free forever • No credit card • Join in 30 seconds
            </p>
          </div>
          
          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-5 justify-center mb-10 animated-element animate">
            <Link to="/gm-office">
              <Button 
                size="lg" 
                className="bg-[#E8EED9]/60 backdrop-blur-sm text-citrus-orange hover:bg-citrus-orange hover:text-[#E8EED9] border-3 border-citrus-sage rounded-varsity text-base px-10 py-6 font-varsity uppercase shadow-md hover:translate-y-1 hover:shadow-sm transition-all font-bold"
              >
                Start Your Season <ArrowRight size={20} className="ml-2" />
              </Button>
            </Link>
            <Link to="/standings">
              <Button 
                size="lg" 
                className="bg-[#E8EED9]/60 backdrop-blur-sm/30 text-citrus-forest border-3 border-[#F2EDE1] hover:bg-[#E8EED9]/60 backdrop-blur-sm rounded-varsity text-base px-10 py-6 font-varsity uppercase shadow-sm hover:translate-y-0.5 transition-all"
              >
                <Play size={20} className="mr-2" /> View Demo
              </Button>
            </Link>
          </div>
          
          {/* Trust Badge */}
          <div className="inline-flex items-center gap-4 bg-[#E8EED9]/60 backdrop-blur-sm/10 backdrop-blur-sm border-2 border-citrus-cream/30 rounded-2xl px-6 py-4 animated-element animate">
            <div className="flex -space-x-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="w-10 h-10 rounded-full bg-citrus-sage border-3 border-citrus-cream shadow-md flex items-center justify-center font-varsity text-xs text-citrus-forest">
                  ★
                </div>
              ))}
            </div>
            <div className="text-left">
              <p className="font-display font-bold text-[#E8EED9] text-sm">
                No credit card required
              </p>
              <p className="text-xs text-[#E8EED9]/80">
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
