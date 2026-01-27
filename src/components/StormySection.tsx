
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useEffect, useRef, useState } from 'react';
import { Zap, Sparkles, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { Narwhal } from '@/components/icons/Narwhal';

const demoMessages = [
  {
    question: "Who should I start at center this week? I have Elias Pettersson vs BOS or Sebastian Aho vs NYR?",
    answer: "Start Aho. His xGF% is 58.2% over the last 10 games and he's getting 2:30 of PP1 time per game. Pettersson's deployment dropped after the coaching change—only 18:45 TOI last week. Plus, Aho's line combo with Jarvis has a 62% Corsi together. The Rangers are giving up 3.1 goals/game on the road. Easy call."
  },
  {
    question: "Should I drop my backup goalie for a streaming spot?",
    answer: "Check your matchup first. If you're up 4-2 going into Saturday, you're probably safe. But if it's tight, keep the goalie. Your backup (Ullmark) has a .925 save% and faces ARI on Saturday—that's a 65% win probability based on our model. Saturday finishes mean every game matters. Don't get cute."
  },
  {
    question: "Is this trade fair? I give Matthews, get MacKinnon + a 3rd round pick.",
    answer: "Take it. MacKinnon's xGF% is 61.4% vs Matthews' 54.8%. MacKinnon also gets 3+ minutes more TOI per game and his line has better zone entry rates. The 3rd rounder is gravy. Our projections have MacKinnon finishing 8-12 points higher ROS. Plus, Matthews' shooting% is unsustainable at 18.2%—regression coming."
  }
];

const StormySection = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [activeDemo, setActiveDemo] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [displayedAnswer, setDisplayedAnswer] = useState("");
  const [demoInterval, setDemoInterval] = useState<number | null>(null);
  const [userInput, setUserInput] = useState("");
  const [isInteractive, setIsInteractive] = useState(false);

  // Typewriter effect
  useEffect(() => {
    if (isAnimating) return;
    
    setIsAnimating(true);
    setDisplayedAnswer("");
    
    const answer = demoMessages[activeDemo].answer;
    let index = 0;
    
    const interval = window.setInterval(() => {
      index++;
      setDisplayedAnswer(answer.slice(0, index));
      
      if (index >= answer.length) {
        clearInterval(interval);
        setIsAnimating(false);
      }
    }, 20);
    
    return () => clearInterval(interval);
  }, [activeDemo]);
  
  // Auto-rotate demos
  useEffect(() => {
    if (isInteractive) return;
    
    const interval = window.setInterval(() => {
      setActiveDemo(prev => (prev + 1) % demoMessages.length);
    }, 12000);
    
    return () => clearInterval(interval);
  }, [isInteractive]);
  
  // Manual demo navigation
  const navigateDemo = (index: number) => {
    setActiveDemo(index);
    setIsInteractive(false);
  };

  // Handle user input submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userInput.trim()) return;
    
    setIsInteractive(true);
    setIsAnimating(true);
    setDisplayedAnswer("");
    
    const response = "Thanks for asking! This is a demo version of Stormy. In the full app, I'll analyze your roster, league settings, and matchup data to provide personalized NHL fantasy advice. Sign up to get started!";
    let index = 0;
    
    const interval = window.setInterval(() => {
      index++;
      setDisplayedAnswer(response.slice(0, index));
      
      if (index >= response.length) {
        clearInterval(interval);
        setIsAnimating(false);
      }
    }, 20);
    
    toast.success("Demo response - Sign up for full AI analysis!");
    setUserInput("");
  };

  return (
    <section id="stormy" ref={sectionRef} className="section-padding bg-[#D4E8B8]">
      <div className="container mx-auto">
        <div className="flex flex-col lg:flex-row items-center gap-12">
          <div className="lg:w-1/2">
            <div className="mb-8 animated-element animate">
              <div className="inline-flex items-center bg-[#E8EED9]/60 backdrop-blur-sm/70 backdrop-blur-sm rounded-full px-4 py-2 mb-4">
                <Narwhal className="h-5 w-5 text-primary mr-2" />
                <span className="text-sm font-medium">Powered by Advanced AI</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Meet Stormy: Your AI GM Who Actually Watches Hockey</h2>
              <p className="text-lg text-foreground/80 max-w-xl">
                Ask Stormy anything. Start or sit decisions. Trade analysis. Who to grab off waivers. 
                Unlike those garbage generic AI tools, Stormy knows hockey—and won't tell you to start a healthy scratch.
              </p>
            </div>

            <div className="space-y-5 animated-element animate">
              <div className="flex items-start space-x-3">
                <div className="mt-1 bg-primary/20 rounded-full p-2">
                  <Zap size={20} className="text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">Actually Helpful Advice</h3>
                  <p className="text-sm text-foreground/70">Real analysis based on actual hockey. Not generic BS that tells you to "monitor the situation"</p>
                </div>
              </div>
              
              <div className="flex items-start space-x-3">
                <div className="mt-1 bg-primary/20 rounded-full p-2">
                  <Sparkles size={20} className="text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">Knows Your League</h3>
                  <p className="text-sm text-foreground/70">Understands your scoring settings, roster construction, and why you keep refusing to drop that 4th liner</p>
                </div>
              </div>
            </div>

            <div className="mt-10 animated-element animate">
              <Link to="/gm-office/stormy">
                <Button size="lg" className="rounded-full">
                  Try Stormy Now
                </Button>
              </Link>
            </div>
          </div>

          <div className="lg:w-1/2 animated-element animate">
            <div className="bg-[#E8EED9]/60 backdrop-blur-sm/80 backdrop-blur-sm rounded-2xl shadow-xl overflow-hidden">
              <div className="bg-primary/10 p-4 flex items-center">
                <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                  <Narwhal className="w-6 h-6 text-white" />
                </div>
                <div className="ml-3">
                  <h3 className="font-bold">Stormy</h3>
                  <p className="text-xs text-foreground/60">Your AI Assistant GM</p>
                </div>
              </div>
              
              <div className="p-5 h-[360px] overflow-y-auto space-y-4">
                {!isInteractive ? (
                  <>
                    <div className="flex justify-end">
                      <div className="bg-primary/10 rounded-lg rounded-tr-none p-4 max-w-[85%]">
                        <p className="text-sm font-medium">{demoMessages[activeDemo].question}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-start space-x-2">
                      <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0 mt-1">
                        <Narwhal className="w-5 h-5 text-white" />
                      </div>
                      <div className="bg-[#E8EED9]/60 backdrop-blur-sm rounded-lg rounded-tl-none p-4 max-w-[85%] shadow-sm border border-border">
                        <p className="text-sm leading-relaxed">{displayedAnswer}</p>
                        {isAnimating && (
                          <span className="inline-block w-1.5 h-4 bg-primary animate-pulse ml-1 align-middle"></span>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex items-start space-x-2">
                    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0 mt-1">
                      <Narwhal className="w-5 h-5 text-white" />
                    </div>
                    <div className="bg-[#E8EED9]/60 backdrop-blur-sm rounded-lg rounded-tl-none p-4 max-w-[85%] shadow-sm border border-border">
                      <p className="text-sm leading-relaxed">{displayedAnswer}</p>
                      {isAnimating && (
                        <span className="inline-block w-1.5 h-4 bg-primary animate-pulse ml-1 align-middle"></span>
                      )}
                    </div>
                  </div>
                )}
              </div>
              
              <div className="p-4 border-t border-border bg-muted/30">
                <form onSubmit={handleSubmit} className="flex gap-2 mb-3">
                  <Input
                    type="text"
                    placeholder="Ask Stormy about your fantasy hockey team..."
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    className="flex-1 bg-background"
                  />
                  <Button type="submit" size="icon" disabled={!userInput.trim()}>
                    <Send className="h-4 w-4" />
                  </Button>
                </form>
                
                {!isInteractive && (
                  <div className="flex justify-center gap-2">
                    {demoMessages.map((_, index) => (
                      <button
                        key={index}
                        onClick={() => navigateDemo(index)}
                        className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                          activeDemo === index ? 'bg-primary scale-110' : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'
                        }`}
                        aria-label={`View demo ${index + 1}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default StormySection;
