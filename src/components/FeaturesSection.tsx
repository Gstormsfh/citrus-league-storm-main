
import { useEffect, useRef } from 'react';
import { 
  Zap, 
  Trophy, 
  MessageSquare, 
  BarChart, 
  Users, 
  Calendar 
} from 'lucide-react';

const features = [
  {
    icon: <Zap className="h-8 w-8" />,
    title: "Lightning Updates",
    description: "Real-time scores and player updates so you're always in the know.",
    color: "orange"
  },
  {
    icon: <Trophy className="h-8 w-8" />,
    title: "Custom Leagues",
    description: "Create leagues with unique scoring systems tailored to your group.",
    color: "sage"
  },
  {
    icon: <MessageSquare className="h-8 w-8" />,
    title: "Stormy AI",
    description: "Get personalized advice and insights from your AI assistant GM.",
    color: "peach"
  },
  {
    icon: <BarChart className="h-8 w-8" />,
    title: "Advanced Stats",
    description: "Dive deep into stats with intuitive visualizations and projections.",
    color: "orange"
  },
  {
    icon: <Users className="h-8 w-8" />,
    title: "Community Hub",
    description: "Tap into collective wisdom with community rankings and discussion.",
    color: "sage"
  },
  {
    icon: <Calendar className="h-8 w-8" />,
    title: "Smart Scheduling",
    description: "Automated schedules and reminders so you never miss a deadline.",
    color: "peach"
  }
];

const FeaturesSection = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const elementRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('animate');
          }
        });
      },
      { threshold: 0.2 }
    );

    elementRefs.current.forEach(el => {
      if (el) observer.observe(el);
    });

    return () => {
      elementRefs.current.forEach(el => {
        if (el) observer.unobserve(el);
      });
    };
  }, []);

  const getColorClasses = (color: string) => {
    switch (color) {
      case 'orange':
        return {
          bg: 'bg-citrus-orange',
          border: 'border-citrus-orange',
          text: 'text-citrus-orange',
          glow: 'group-hover:bg-citrus-orange'
        };
      case 'sage':
        return {
          bg: 'bg-citrus-sage',
          border: 'border-citrus-sage',
          text: 'text-citrus-sage',
          glow: 'group-hover:bg-citrus-sage'
        };
      case 'peach':
        return {
          bg: 'bg-citrus-peach',
          border: 'border-citrus-peach',
          text: 'text-citrus-peach',
          glow: 'group-hover:bg-citrus-peach'
        };
      default:
        return {
          bg: 'bg-citrus-sage',
          border: 'border-citrus-sage',
          text: 'text-citrus-sage',
          glow: 'group-hover:bg-citrus-sage'
        };
    }
  };

  return (
    <section id="features" ref={sectionRef} className="section-padding bg-citrus-cream relative overflow-hidden">
      {/* Vintage texture overlay */}
      <div className="absolute inset-0 opacity-[0.015] bg-[radial-gradient(circle_at_1px_1px,_#1B3022_1px,_transparent_1px)] bg-[length:40px_40px]"></div>
      
      <div className="container mx-auto relative z-10">
        {/* Section Header with Vintage Style */}
        <div className="text-center mb-20 animated-element" ref={el => elementRefs.current[0] = el}>
          <div className="inline-flex items-center gap-2 bg-citrus-sage/20 border-2 border-citrus-sage rounded-varsity px-5 py-2 mb-6">
            <span className="font-varsity text-xs uppercase tracking-widest text-citrus-forest">The Citrus Advantage</span>
          </div>
          
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-varsity font-black uppercase text-citrus-forest mb-6 leading-none tracking-tight">
            Why Players<br/>
            <span className="text-citrus-orange">Choose Us</span>
          </h2>
          
          <p className="text-lg md:text-xl text-citrus-charcoal max-w-2xl mx-auto font-sans font-medium leading-relaxed">
            Enjoy a refreshing take on fantasy sports with <span className="text-citrus-orange font-bold">modern features</span> designed to enhance your experience.
          </p>
        </div>

        {/* Feature Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
          {features.map((feature, index) => {
            const colors = getColorClasses(feature.color);
            return (
              <div 
                key={index} 
                className="card-letterman-thick animated-element group cursor-pointer hover:shadow-varsity hover:-translate-y-2 transition-all duration-300"
                ref={el => elementRefs.current[index + 1] = el}
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                {/* Icon Badge with Varsity Style */}
                <div className={`mb-5 ${colors.bg} border-4 ${colors.border} w-16 h-16 rounded-varsity flex items-center justify-center shadow-patch ${colors.glow} transition-all duration-300 text-citrus-cream`}>
                  {feature.icon}
                </div>
                
                {/* Title with Varsity Font */}
                <h3 className="text-xl font-varsity uppercase text-citrus-forest mb-3 leading-tight tracking-wide">
                  {feature.title}
                </h3>
                
                {/* Description */}
                <p className="text-citrus-charcoal font-sans leading-relaxed">
                  {feature.description}
                </p>
                
                {/* Hover Arrow Indicator */}
                <div className={`mt-4 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 ${colors.text} font-display font-bold text-sm`}>
                  <span>Learn more</span>
                  <svg className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </div>
              </div>
            );
          })}
        </div>
        
        {/* Bottom CTA Badge */}
        <div className="mt-16 text-center">
          <div className="inline-flex items-center gap-3 bg-citrus-orange/10 border-3 border-citrus-orange rounded-varsity px-6 py-4 shadow-patch">
            <Trophy className="h-6 w-6 text-citrus-orange" />
            <p className="font-display font-bold text-citrus-forest">
              Join 5,000+ players already winning with Citrus
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
