
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const Guides = () => {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="pt-24 pb-16">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center mb-10 animated-element">
            <h1 className="text-4xl md:text-5xl font-bold mb-4 vibrant-gradient-1 bg-clip-text text-transparent">
              Strategy Guides
            </h1>
            <p className="text-lg text-muted-foreground">
              Comprehensive resources to help you dominate your fantasy league
            </p>
          </div>
          
          <Tabs defaultValue="beginner" className="mb-10 animated-element">
            <div className="flex justify-center mb-6">
              <TabsList className="bg-muted/30">
                <TabsTrigger value="beginner" className="px-6">Beginner</TabsTrigger>
                <TabsTrigger value="intermediate" className="px-6">Intermediate</TabsTrigger>
                <TabsTrigger value="advanced" className="px-6">Advanced</TabsTrigger>
              </TabsList>
            </div>
            
            <TabsContent value="beginner">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <GuideCard 
                  title="Getting Started with Fantasy Sports" 
                  description="Learn the basics of fantasy sports, including how leagues work, scoring systems, and draft strategies."
                  icon="🏆"
                  color="vibrant-orange"
                />
                <GuideCard 
                  title="Understanding Fantasy Scoring" 
                  description="A breakdown of common scoring formats and how to adapt your strategy for each one."
                  icon="📊"
                  color="vibrant-purple"
                />
                <GuideCard 
                  title="Draft Day Preparation" 
                  description="How to research players, create rankings, and prepare for your first fantasy draft."
                  icon="📝"
                  color="primary"
                />
                <GuideCard 
                  title="Managing Your Roster" 
                  description="Weekly management tips for lineups, waiver wire pickups, and trade strategies."
                  icon="👥"
                  color="secondary"
                />
                <GuideCard 
                  title="Understanding Matchups" 
                  description="How to analyze player matchups and make informed lineup decisions."
                  icon="🔍"
                  color="accent"
                />
                <GuideCard 
                  title="Fantasy Sports Glossary" 
                  description="All the terms and acronyms you need to know to sound like a fantasy sports expert."
                  icon="📚"
                  color="vibrant-magenta"
                />
              </div>
            </TabsContent>
            
            <TabsContent value="intermediate">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <GuideCard 
                  title="Advanced Draft Strategies" 
                  description="Take your draft to the next level with positional scarcity, value-based drafting, and auction tactics."
                  icon="🧠"
                  color="vibrant-purple"
                />
                <GuideCard 
                  title="In-Season Player Evaluation" 
                  description="How to use advanced metrics to identify breakout players and regression candidates."
                  icon="📈"
                  color="vibrant-orange"
                />
                <GuideCard 
                  title="Trading Tactics" 
                  description="Master the art of fantasy trades, from identifying trade targets to negotiation strategies."
                  icon="🔄"
                  color="primary"
                />
                <GuideCard 
                  title="Streaming Strategies" 
                  description="How to maximize value by streaming positions based on matchups and schedule advantages."
                  icon="🌊"
                  color="vibrant-magenta"
                />
                <GuideCard 
                  title="Injury Management" 
                  description="Strategies for handling injuries, understanding timelines, and making roster decisions."
                  icon="🚑"
                  color="accent"
                />
                <GuideCard 
                  title="Mid-Season Adjustments" 
                  description="How to pivot your strategy as the season progresses to stay competitive."
                  icon="⚙️"
                  color="secondary"
                />
              </div>
            </TabsContent>
            
            <TabsContent value="advanced">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <GuideCard 
                  title="Statistical Analysis Deep Dive" 
                  description="Advanced metrics and how to use them for predictive player evaluation."
                  icon="📊"
                  color="vibrant-purple"
                />
                <GuideCard 
                  title="Dynasty League Strategy" 
                  description="Long-term planning for dynasty formats, including prospect evaluation and roster construction."
                  icon="👑"
                  color="primary"
                />
                <GuideCard 
                  title="Game Theory Applications" 
                  description="Using game theory concepts to gain edges in drafts, trades, and waiver wire competition."
                  icon="🎮"
                  color="vibrant-orange"
                />
                <GuideCard 
                  title="Bankroll Management" 
                  description="Advanced techniques for managing your investment across multiple leagues and contests."
                  icon="💰"
                  color="secondary"
                />
                <GuideCard 
                  title="Contest Selection Strategy" 
                  description="How to identify and select the most profitable fantasy contests based on your skill edge."
                  icon="🎯"
                  color="accent"
                />
                <GuideCard 
                  title="Multi-League Management" 
                  description="Strategies for balancing multiple teams and leagues without burning out."
                  icon="⚖️"
                  color="vibrant-magenta"
                />
              </div>
            </TabsContent>
          </Tabs>
          
          <div className="bg-muted/30 rounded-lg p-8 max-w-3xl mx-auto text-center animated-element">
            <h2 className="text-2xl font-bold mb-4">Need Personalized Advice?</h2>
            <p className="mb-6 text-muted-foreground">
              Our fantasy sports experts are available for one-on-one coaching sessions tailored to your league and team needs.
            </p>
            <div className="inline-block relative overflow-hidden rounded-full btn-vibrant-purple">
              <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-[hsl(var(--vibrant-purple))] to-[hsl(var(--vibrant-magenta))]"></span>
              <button className="relative px-8 py-3 bg-transparent text-white font-medium">
                Book a Coaching Session
              </button>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

const GuideCard = ({ 
  title, 
  description, 
  icon,
  color = "primary"
}: { 
  title: string; 
  description: string;
  icon: string;
  color?: "primary" | "secondary" | "accent" | "vibrant-purple" | "vibrant-orange" | "vibrant-magenta"
}) => {
  const colorClasses = {
    primary: "bg-primary/10 text-primary border-primary/20",
    secondary: "bg-secondary/10 text-secondary-foreground border-secondary/20",
    accent: "bg-accent/10 text-accent-foreground border-accent/20",
    "vibrant-purple": "bg-[hsl(var(--vibrant-purple))]/10 text-[hsl(var(--vibrant-purple))] border-[hsl(var(--vibrant-purple))]/20",
    "vibrant-orange": "bg-[hsl(var(--vibrant-orange))]/10 text-[hsl(var(--vibrant-orange))] border-[hsl(var(--vibrant-orange))]/20",
    "vibrant-magenta": "bg-[hsl(var(--vibrant-magenta))]/10 text-[hsl(var(--vibrant-magenta))] border-[hsl(var(--vibrant-magenta))]/20"
  };
  
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className={`w-12 h-12 rounded-full ${colorClasses[color]} flex items-center justify-center text-2xl mb-4`}>
          {icon}
        </div>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <CardDescription className="text-base">{description}</CardDescription>
        <div className="mt-4 flex items-center text-sm font-medium">
          <span className={`text-${color}`}>Read Guide</span>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 ml-1">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </div>
      </CardContent>
    </Card>
  );
};

export default Guides;
