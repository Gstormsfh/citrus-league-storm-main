
import { Button } from '@/components/ui/button';
import { Play, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

const CtaSection = () => {
  return (
    <section className="section-padding relative overflow-hidden bg-gradient-to-br from-[hsl(var(--vibrant-green))] to-[hsl(var(--vibrant-orange))]">
      {/* Background decorations */}
      <div className="absolute top-0 left-0 right-0 bottom-0">
        <div className="absolute top-10 left-10 w-64 h-64 rounded-full bg-white opacity-10"></div>
        <div className="absolute bottom-10 right-10 w-96 h-96 rounded-full bg-white opacity-10"></div>
      </div>
      
      <div className="container mx-auto relative z-10">
        <div className="max-w-3xl mx-auto text-center text-white">
          <h2 className="text-3xl md:text-5xl font-bold mb-6 animated-element animate">Stop Losing to Outdated Fantasy Platforms</h2>
          <p className="text-lg md:text-xl mb-10 text-white/80 animated-element animate">
            We're NHL fanatics who built the projections system we wished existed. Real data, real analysis, real results. No more guessing games.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center animated-element animate">
            <Link to="/gm-office">
              <Button size="lg" className="bg-white text-primary hover:bg-white/90 rounded-full text-base px-8">
                Start Your Season <ArrowRight size={18} className="ml-2" />
              </Button>
            </Link>
            <Link to="/stormy-assistant">
              <Button size="lg" variant="outline" className="bg-transparent text-white border-white hover:bg-white/10 rounded-full text-base px-8">
                <Play size={18} className="mr-2" /> Watch Demo
              </Button>
            </Link>
          </div>
          
          <p className="mt-6 text-sm text-white/70 animated-element animate">
            No credit card required. Free puck drop available forever.
          </p>
        </div>
      </div>
    </section>
  );
};

export default CtaSection;
