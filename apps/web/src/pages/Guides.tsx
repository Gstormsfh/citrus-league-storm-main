import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Navbar from '@/components/Navbar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DarkLayout,
  HockeyFooter,
  GlowCard,
  MascotPeek,
  CtaBanner,
} from '@/components/citrus2';

type Accent = 'orange' | 'sage';

const GUIDES = {
  beginner: [
    { title: 'Getting Started with Fantasy Sports', description: 'Learn the basics of fantasy sports, including how leagues work, scoring systems, and draft strategies.', icon: '🏆', accent: 'orange' as Accent },
    { title: 'Understanding Fantasy Scoring', description: 'A breakdown of common scoring formats and how to adapt your strategy for each one.', icon: '📊', accent: 'sage' as Accent },
    { title: 'Draft Day Preparation', description: 'How to research players, create rankings, and prepare for your first fantasy draft.', icon: '📝', accent: 'orange' as Accent },
    { title: 'Managing Your Roster', description: 'Weekly management tips for lineups, waiver wire pickups, and trade strategies.', icon: '👥', accent: 'sage' as Accent },
    { title: 'Understanding Matchups', description: 'How to analyze player matchups and make informed lineup decisions.', icon: '🔍', accent: 'orange' as Accent },
    { title: 'Fantasy Sports Glossary', description: "All the terms and acronyms you need to know to sound like a fantasy sports expert.", icon: '📚', accent: 'sage' as Accent },
  ],
  intermediate: [
    { title: 'Advanced Draft Strategies', description: 'Take your draft to the next level with positional scarcity, value-based drafting, and auction tactics.', icon: '🧠', accent: 'orange' as Accent },
    { title: 'In-Season Player Evaluation', description: 'How to use advanced metrics to identify breakout players and regression candidates.', icon: '📈', accent: 'sage' as Accent },
    { title: 'Trading Tactics', description: 'Master the art of fantasy trades, from identifying trade targets to negotiation strategies.', icon: '🔄', accent: 'orange' as Accent },
    { title: 'Streaming Strategies', description: 'How to maximize value by streaming positions based on matchups and schedule advantages.', icon: '🌊', accent: 'sage' as Accent },
    { title: 'Injury Management', description: 'Strategies for handling injuries, understanding timelines, and making roster decisions.', icon: '🚑', accent: 'orange' as Accent },
    { title: 'Mid-Season Adjustments', description: 'How to pivot your strategy as the season progresses to stay competitive.', icon: '⚙️', accent: 'sage' as Accent },
  ],
  advanced: [
    { title: 'Statistical Analysis Deep Dive', description: 'Advanced metrics and how to use them for predictive player evaluation.', icon: '📊', accent: 'orange' as Accent },
    { title: 'Dynasty League Strategy', description: 'Long-term planning for dynasty formats, including prospect evaluation and roster construction.', icon: '👑', accent: 'sage' as Accent },
    { title: 'Game Theory Applications', description: 'Using game theory concepts to gain edges in drafts, trades, and waiver wire competition.', icon: '🎮', accent: 'orange' as Accent },
    { title: 'Bankroll Management', description: 'Advanced techniques for managing your investment across multiple leagues and contests.', icon: '💰', accent: 'sage' as Accent },
    { title: 'Contest Selection Strategy', description: 'How to identify and select the most profitable fantasy contests based on your skill edge.', icon: '🎯', accent: 'orange' as Accent },
    { title: 'Multi-League Management', description: 'Strategies for balancing multiple teams and leagues without burning out.', icon: '⚖️', accent: 'sage' as Accent },
  ],
};

const Guides = () => {
  return (
    <DarkLayout>
      <Navbar />
      <main className="relative max-w-[1280px] mx-auto px-6 pt-28 pb-16">
        {/* Hero with Stormy peek (the strategist) */}
        <section className="relative max-w-[860px] mx-auto px-2 pb-12 text-center">
          <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-4 font-bold">
            ✦ Behind the Bench
          </div>
          <h1 className="font-sans font-black text-[2.5rem] md:text-[4rem] leading-[0.98] tracking-[-0.035em] text-pastel-cream mb-5">
            Strategy <span className="text-pastel-orange">guides</span>.
          </h1>
          <p className="text-[16px] md:text-[18px] leading-relaxed text-white/65 max-w-xl mx-auto">
            Comprehensive resources to help you dominate your league. From draft to playoffs.
          </p>
        </section>

        <Tabs defaultValue="beginner" className="mb-12">
          <div className="flex justify-center mb-8">
            <TabsList className="bg-[#1A2A20] h-10 ring-1 ring-white/10">
              <TabsTrigger value="beginner" className="px-6 text-[13px] font-bold data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] text-white/70">Beginner</TabsTrigger>
              <TabsTrigger value="intermediate" className="px-6 text-[13px] font-bold data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] text-white/70">Intermediate</TabsTrigger>
              <TabsTrigger value="advanced" className="px-6 text-[13px] font-bold data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] text-white/70">Advanced</TabsTrigger>
            </TabsList>
          </div>

          {(['beginner', 'intermediate', 'advanced'] as const).map((tier) => (
            <TabsContent key={tier} value={tier}>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {GUIDES[tier].map((g) => (
                  <GuideCard key={g.title} title={g.title} description={g.description} icon={g.icon} accent={g.accent} />
                ))}
              </div>
            </TabsContent>
          ))}
        </Tabs>

        {/* Coaching CTA — Stormy peeks */}
        <section className="relative max-w-3xl mx-auto">
          <GlowCard accent="orange">
            <div className="p-8 text-center relative overflow-hidden">
              <MascotPeek id="stormy" position="top-right" size="md" />
              <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-3 font-bold relative z-10">
                ✦ One-on-One
              </div>
              <h2 className="font-sans font-black text-[1.75rem] md:text-[2.25rem] tracking-[-0.025em] text-pastel-cream mb-3 relative z-10">
                Need <span className="text-pastel-orange">personalized advice?</span>
              </h2>
              <p className="text-[15px] text-white/65 leading-relaxed mb-6 max-w-md mx-auto relative z-10">
                Our fantasy sports experts are available for one-on-one coaching sessions tailored to your league and team needs.
              </p>
              <Link
                to="/contact"
                className="inline-flex items-center gap-2 bg-pastel-orange text-[#581E00] text-[14px] font-bold px-6 rounded-md hover:bg-pastel-orange-deep hover:-translate-y-0.5 transition-all duration-200 active:scale-95 shadow-[0_4px_16px_-4px_rgba(255,107,26,0.5)] relative z-10"
                style={{ height: '48px' }}
              >
                Book a Coaching Session <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
              </Link>
            </div>
          </GlowCard>
        </section>
      </main>

      <CtaBanner
        title={
          <>
            Stop guessing. <span className="text-pastel-orange">Start dominating.</span>
          </>
        }
        sub="Free during launch · 31-feature xG model · Built by hockey heads"
        ctaLabel="Create your league"
        ctaHref="/create-league"
      />

      <HockeyFooter />
    </DarkLayout>
  );
};

const GuideCard = ({
  title,
  description,
  icon,
  accent,
}: {
  title: string;
  description: string;
  icon: string;
  accent: Accent;
}) => {
  return (
    <GlowCard accent={accent}>
      <article className="p-6 h-full flex flex-col">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl mb-4 ring-1 ${
          accent === 'orange' ? 'bg-pastel-orange/15 ring-pastel-orange/30' : 'bg-pastel-sage/15 ring-pastel-sage/30'
        }`}>
          {icon}
        </div>
        <h3 className="font-sans font-bold text-[18px] tracking-[-0.015em] text-pastel-cream mb-2 leading-tight">
          {title}
        </h3>
        <p className="text-[14px] text-white/65 leading-relaxed flex-1">
          {description}
        </p>
        <div className={`mt-5 inline-flex items-center text-[13px] font-bold transition-colors group ${
          accent === 'orange' ? 'text-pastel-orange-soft hover:text-pastel-orange' : 'text-pastel-sage-soft hover:text-pastel-sage'
        }`}>
          <span>Read Guide</span>
          <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
        </div>
      </article>
    </GlowCard>
  );
};

export default Guides;
