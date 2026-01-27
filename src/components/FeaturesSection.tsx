
import { useEffect, useRef } from 'react';
import { 
  Zap, 
  MessageSquare, 
  BarChart, 
  Calendar,
  FileText,
  TrendingUp
} from 'lucide-react';

const features = [
  {
    icon: <TrendingUp className="h-8 w-8" />,
    title: "98.7% Projection Accuracy",
    description: "Our proprietary model analyzes 200+ data points per player including xGF%, zone entries, deployment patterns, and line chemistry. We're not guessing—we're predicting.",
    color: "sage"
  },
  {
    icon: <Calendar className="h-8 w-8" />,
    title: "Saturday Finishes",
    description: "Your matchups end when 12 games are live. Not Sunday morning when 3 teams play and your opponent already won. Peak hockey. Peak drama.",
    color: "sage"
  },
  {
    icon: <FileText className="h-8 w-8" />,
    title: "700+ Player Writeups Daily",
    description: "Post-game analysis for every NHL player. Every game. Know why Matthews dominated or why your sleeper pick got 0.2 points.",
    color: "sage"
  },
  {
    icon: <Zap className="h-8 w-8" />,
    title: "Sub-Second Live Scoring",
    description: "Real-time data pipeline processes goals, assists, and stats faster than ESPN can load. Watch your matchup shift with every goal.",
    color: "sage"
  },
  {
    icon: <MessageSquare className="h-8 w-8" />,
    title: "AI That Watches Every Shift",
    description: "Stormy analyzes ice time, PP deployment, line combos, and matchups. Get advice based on actual hockey, not generic algorithms.",
    color: "sage"
  },
  {
    icon: <BarChart className="h-8 w-8" />,
    title: "Advanced Metrics Built In",
    description: "xGF%, Corsi, deployment splits, PP1 percentage, zone entry rates. All the nerdy stats that help you dominate, zero extra subscriptions.",
    color: "sage"
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
    <section id="features" ref={sectionRef} className="section-padding bg-[#D4E8B8] relative overflow-hidden">
      {/* Solid creamy green background */}
      
      <div className="container mx-auto relative z-10">
        {/* Section Header with Vintage Style */}
        <div className="text-center mb-20 animated-element" ref={el => elementRefs.current[0] = el}>
          <div className="inline-flex items-center gap-2 bg-citrus-sage/20 border-2 border-citrus-sage rounded-varsity px-5 py-2 mb-6">
            <span className="font-varsity text-xs uppercase tracking-widest text-citrus-forest">The Citrus Advantage</span>
          </div>
          
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-varsity font-black uppercase text-citrus-forest mb-6 leading-none tracking-tight drop-shadow-[0_2px_2px_rgba(255,255,255,0.3)]">
            The Data<br/>
            <span className="text-citrus-green-dark drop-shadow-[0_2px_4px_rgba(255,255,255,0.5)]">That Wins Championships</span>
          </h2>
          
          <p className="text-lg md:text-xl text-citrus-forest/80 max-w-2xl mx-auto font-sans leading-relaxed">
            We process 10M+ data points per game to give you insights other platforms can't touch. This is what separates champions from chumps.
          </p>
        </div>

        {/* Feature Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
          {features.map((feature, index) => {
            const colors = getColorClasses(feature.color);
            return (
              <div 
                key={index} 
                className="card-letterman-thick animated-element group cursor-pointer hover:shadow-md hover:-translate-y-1 transition-all duration-300"
                ref={el => elementRefs.current[index + 1] = el}
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                {/* Icon Badge with Varsity Style */}
                <div className={`mb-5 ${colors.bg} border-2 ${colors.border} w-16 h-16 rounded-varsity flex items-center justify-center shadow-sm ${colors.glow} transition-all duration-300 text-citrus-sage`}>
                  {feature.icon}
                </div>
                
                {/* Title with Varsity Font */}
                <h3 className="text-xl font-varsity uppercase text-citrus-forest mb-3 leading-tight tracking-wide font-bold">
                  {feature.title}
                </h3>
                
                {/* Description */}
                <p className="text-citrus-forest/80 font-sans leading-relaxed">
                  {feature.description}
                </p>
              </div>
            );
          })}
        </div>
        
        {/* Bottom CTA Badge */}
        <div className="mt-16 text-center">
          <div className="inline-flex items-center gap-3 bg-[#E8EED9]/50 backdrop-blur-sm/80 backdrop-blur-sm border border-citrus-sage/30 rounded-xl px-6 py-4">
            <BarChart className="h-6 w-6 text-citrus-sage" />
            <p className="font-display font-bold text-citrus-forest">
              Processing 10M+ data points per game to give you the edge
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
