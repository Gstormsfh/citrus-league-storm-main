
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
    icon: <Zap className="h-6 w-6 text-primary" />,
    title: "Lightning Fast Updates",
    description: "Real-time scores and player updates so you're always in the know."
  },
  {
    icon: <Trophy className="h-6 w-6 text-primary" />,
    title: "Customizable Leagues",
    description: "Create leagues with unique scoring systems tailored to your group."
  },
  {
    icon: <MessageSquare className="h-6 w-6 text-primary" />,
    title: "Stormy AI Assistant",
    description: "Get personalized advice and insights from your AI assistant GM."
  },
  {
    icon: <BarChart className="h-6 w-6 text-primary" />,
    title: "Advanced Analytics",
    description: "Dive deep into stats with intuitive visualizations and projections."
  },
  {
    icon: <Users className="h-6 w-6 text-primary" />,
    title: "Community Insights",
    description: "Tap into collective wisdom with community rankings and discussion."
  },
  {
    icon: <Calendar className="h-6 w-6 text-primary" />,
    title: "Smart Scheduling",
    description: "Automated schedules and reminders so you never miss a deadline."
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

  return (
    <section id="features" ref={sectionRef} className="section-padding bg-white">
      <div className="container mx-auto">
        <div className="text-center mb-16 animated-element" ref={el => elementRefs.current[0] = el}>
          <h6 className="text-primary font-semibold mb-3">FEATURES</h6>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Why Players Choose CitrusSports</h2>
          <p className="text-foreground/70 max-w-2xl mx-auto">
            Enjoy a refreshing take on fantasy sports with modern features designed to enhance your experience.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <div 
              key={index} 
              className="card-citrus animated-element group cursor-pointer hover:border-primary/50 transition-all"
              ref={el => elementRefs.current[index + 1] = el}
              style={{ animationDelay: `${index * 0.1}s` }}
            >
              <div className="mb-4 rounded-full bg-primary/10 w-12 h-12 flex items-center justify-center group-hover:scale-110 transition-transform">
                {feature.icon}
              </div>
              <h3 className="text-xl font-bold mb-2 group-hover:text-primary transition-colors">{feature.title}</h3>
              <p className="text-foreground/70">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
