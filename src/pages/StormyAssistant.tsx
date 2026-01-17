import { useState, useRef, useEffect } from 'react';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Zap, MessageSquare, Clock, Shield, Settings, Crown, Send, Sparkles } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Narwhal } from '@/components/icons/Narwhal';
import { isGuestMode } from '@/utils/guestHelpers';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import { CitrusBackground } from '@/components/CitrusBackground';
import { CitrusSparkle, CitrusLeaf, CitrusWedge } from '@/components/icons/CitrusIcons';
import { AdSpace } from '@/components/AdSpace';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'stormy';
  timestamp: Date;
}

const StormyAssistant = () => {
  const { userLeagueState } = useLeague();
  const [activeTab, setActiveTab] = useState("chat");
  const [inputValue, setInputValue] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      text: "Hi! I'm Stormy. I'm ready to help you dominate your league. What's on your mind?",
      sender: 'stormy',
      timestamp: new Date()
    }
  ]);

  const usageStats = {
    weeklyRequests: 14,
    weeklyLimit: 50,
    resetDate: "Monday at 3:00 AM"
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, activeTab]);

  const handleSend = () => {
    if (!inputValue.trim()) return;

    const newUserMsg: Message = {
      id: Date.now().toString(),
      text: inputValue,
      sender: 'user',
      timestamp: new Date()
    };

    setMessages(prev => [...prev, newUserMsg]);
    setInputValue('');

    // Mock Response
    setTimeout(() => {
      const responseText = "I'm analyzing your league data... It looks like you have a strong roster, but your goaltending could use some help. Check out the free agents list for potential upgrades.";
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        text: responseText,
        sender: 'stormy',
        timestamp: new Date()
      }]);
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
      {/* Citrus Background */}
      <CitrusBackground density="light" />
      
      <Navbar />
      <main className="w-full pt-28 pb-16 m-0 p-0 relative z-10">
        <div className="w-full m-0 p-0">
          {/* Sidebar and Content Grid */}
          <div className="flex flex-col lg:grid lg:grid-cols-[240px_1fr]">
            {/* Main Content - Scrollable - Appears first on mobile */}
            <div className="min-w-0 max-h-[calc(100vh-12rem)] overflow-y-auto px-2 lg:px-6 order-1 lg:order-2">
              <div className="max-w-5xl mx-auto">
          <div className="text-center mb-8 relative">
            {/* Decorative citrus icons */}
            <CitrusLeaf className="absolute -top-4 -left-8 w-16 h-16 text-citrus-sage/15 rotate-12" />
            <CitrusWedge className="absolute -top-2 -right-6 w-14 h-14 text-citrus-orange/15 -rotate-45" />
            
            <div className="inline-flex items-center justify-center w-24 h-24 rounded-varsity bg-gradient-to-br from-citrus-sage to-citrus-orange border-4 border-citrus-forest mb-4 shadow-[inset_0_2px_4px_rgba(0,0,0,0.1),0_6px_0_rgba(27,48,34,0.2)] corduroy-texture relative overflow-hidden group">
              <Narwhal className="h-12 w-12 text-citrus-cream relative z-10 group-hover:scale-110 transition-transform" />
              <CitrusSparkle className="absolute top-1 right-1 w-8 h-8 text-citrus-cream/20 animate-pulse" />
            </div>
            <div className="flex items-center justify-center gap-3 mb-2">
              <CitrusSparkle className="w-6 h-6 text-citrus-orange animate-pulse" />
              <h1 className="text-4xl font-varsity font-black text-citrus-forest uppercase tracking-tight">Stormy AI Assistant</h1>
              <CitrusSparkle className="w-6 h-6 text-citrus-sage animate-pulse" style={{ animationDelay: '0.5s' }} />
            </div>
            <p className="text-lg font-display text-citrus-charcoal">
              Your personal fantasy sports strategist
            </p>
          </div>

          {/* Demo Mode Banner */}
          {isGuestMode(userLeagueState) && (
            <div className="mb-8 max-w-2xl mx-auto">
              <LeagueCreationCTA 
                title="You're viewing demo Stormy Assistant"
                description="Sign up to get personalized AI advice for your team and league."
                variant="compact"
              />
            </div>
          )}

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2 max-w-[400px] mx-auto mb-8 bg-citrus-cream corduroy-texture border-4 border-citrus-sage rounded-varsity shadow-patch p-2">
              <TabsTrigger value="chat" className="gap-2 font-varsity font-bold data-[state=active]:bg-citrus-sage data-[state=active]:text-citrus-cream rounded-varsity">
                <MessageSquare className="h-4 w-4" /> Chat
              </TabsTrigger>
              <TabsTrigger value="settings" className="gap-2 font-varsity font-bold data-[state=active]:bg-citrus-orange data-[state=active]:text-citrus-cream rounded-varsity">
                <Settings className="h-4 w-4" /> Settings
              </TabsTrigger>
            </TabsList>

            <TabsContent value="chat" className="mt-0">
              <Card className="h-[600px] flex flex-col shadow-[0_8px_0_rgba(27,48,34,0.2)] border-4 border-citrus-forest rounded-[2rem] overflow-hidden corduroy-texture bg-citrus-cream">
                <CardHeader className="border-b-4 border-citrus-sage bg-gradient-to-r from-citrus-sage/20 to-citrus-orange/20 px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-varsity bg-gradient-to-br from-citrus-sage to-citrus-orange border-2 border-citrus-forest flex items-center justify-center shadow-patch">
                      <Narwhal className="h-7 w-7 text-citrus-cream" />
                    </div>
                    <div>
                      <CardTitle className="text-lg font-varsity font-black text-citrus-forest uppercase">Stormy</CardTitle>
                      <CardDescription className="flex items-center gap-1.5 text-xs font-display">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-citrus-sage opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-citrus-sage"></span>
                        </span>
                        Online & Ready
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                
                <CardContent className="flex-1 p-0 overflow-hidden bg-citrus-cream/50 relative">
                  <ScrollArea className="h-full p-6" ref={scrollRef}>
                    <div className="space-y-6 max-w-3xl mx-auto">
                      {messages.map((msg) => (
                        <div
                          key={msg.id}
                          className={`flex gap-4 ${msg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                        >
                          {msg.sender === 'stormy' && (
                            <Avatar className="h-10 w-10 border-2 border-citrus-sage bg-gradient-to-br from-citrus-sage/20 to-citrus-orange/20 shadow-patch shrink-0">
                              <AvatarFallback><Narwhal className="h-5 w-5 text-citrus-sage" /></AvatarFallback>
                            </Avatar>
                          )}
                          <div
                            className={`p-4 rounded-varsity text-sm shadow-patch leading-relaxed font-display border-2 ${
                              msg.sender === 'user'
                                ? 'bg-gradient-to-br from-citrus-orange to-citrus-peach text-citrus-cream font-semibold border-citrus-forest'
                                : 'bg-citrus-cream border-citrus-sage/40 text-citrus-charcoal'
                            }`}
                          >
                            {msg.text}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>

                <CardFooter className="p-4 border-t-4 border-citrus-sage bg-gradient-to-r from-citrus-sage/10 to-citrus-orange/10">
                  <div className="max-w-3xl mx-auto w-full">
                    <form 
                      className="flex w-full items-center gap-3"
                      onSubmit={(e) => { e.preventDefault(); handleSend(); }}
                    >
                      <Input 
                        placeholder="Ask Stormy about trades, waivers, or start/sit decisions..." 
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        className="flex-1 h-12 border-3 border-citrus-sage rounded-varsity bg-citrus-cream font-display"
                        autoFocus
                      />
                      <Button type="submit" size="icon" className="h-12 w-12 rounded-varsity shadow-[inset_0_2px_4px_rgba(0,0,0,0.1),0_4px_0_rgba(27,48,34,0.2)] bg-gradient-to-br from-citrus-sage to-citrus-orange border-4 border-citrus-forest hover:-translate-y-1 transition-all" disabled={!inputValue.trim()}>
                        <Send className="h-5 w-5 text-citrus-cream" />
                      </Button>
                    </form>
                    <div className="text-center mt-2">
                      <p className="text-[10px] font-display text-citrus-charcoal/70">
                        Stormy can make mistakes. Consider checking important stats.
                      </p>
                    </div>
                  </div>
                </CardFooter>
              </Card>
            </TabsContent>

            <TabsContent value="settings" className="mt-0 space-y-8">
              <div className="grid md:grid-cols-2 gap-8">
                {/* Usage Card */}
                <Card className="border-4 border-citrus-orange shadow-[0_6px_0_rgba(27,48,34,0.2)] rounded-[2rem] corduroy-texture bg-citrus-cream h-full relative overflow-hidden">
                  <CitrusLeaf className="absolute top-2 right-2 w-20 h-20 text-citrus-orange/10 rotate-12" />
                  <CardHeader className="relative z-10">
                    <CardTitle className="flex items-center gap-2 font-varsity font-black text-citrus-forest uppercase">
                      <Zap className="h-6 w-6 text-citrus-orange" />
                      Weekly Usage
                    </CardTitle>
                    <CardDescription className="font-display text-citrus-charcoal">Requests remaining this week</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6 relative z-10">
                    <div className="text-center py-4">
                      <div className="text-5xl font-varsity font-black text-citrus-orange mb-2">
                        {usageStats.weeklyRequests}<span className="text-xl text-citrus-charcoal font-display font-normal">/{usageStats.weeklyLimit}</span>
                      </div>
                      <p className="text-sm font-display text-citrus-charcoal">Requests Used</p>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm font-display">
                        <span className="font-semibold text-citrus-forest">Usage Level</span>
                        <span className="font-bold text-citrus-orange">{Math.round((usageStats.weeklyRequests / usageStats.weeklyLimit) * 100)}%</span>
                      </div>
                      <Progress value={(usageStats.weeklyRequests / usageStats.weeklyLimit) * 100} className="h-3 bg-citrus-sage/20" />
                    </div>

                    <div className="flex items-center justify-between p-3 bg-citrus-sage/10 border-2 border-citrus-sage/30 rounded-varsity text-sm">
                      <div className="flex items-center gap-2 font-display text-citrus-charcoal">
                        <Clock className="h-4 w-4" />
                        <span>Resets on:</span>
                      </div>
                      <span className="font-varsity font-bold text-citrus-forest">{usageStats.resetDate}</span>
                    </div>

                    <Button className="w-full bg-gradient-to-r from-citrus-orange to-citrus-peach hover:from-citrus-peach hover:to-citrus-orange text-citrus-cream border-4 border-citrus-forest rounded-varsity shadow-[inset_0_2px_4px_rgba(0,0,0,0.1),0_4px_0_rgba(27,48,34,0.2)] font-varsity font-bold uppercase hover:-translate-y-1 transition-all">
                      <Crown className="h-5 w-5 mr-2" />
                      Upgrade to Unlimited
                    </Button>
                  </CardContent>
                </Card>

                {/* Configuration Card */}
                <Card className="border-4 border-citrus-sage shadow-[0_6px_0_rgba(27,48,34,0.2)] rounded-[2rem] corduroy-texture bg-citrus-cream h-full relative overflow-hidden">
                  <CitrusWedge className="absolute top-2 right-2 w-20 h-20 text-citrus-sage/10 -rotate-12" />
                  <CardHeader className="relative z-10">
                    <CardTitle className="flex items-center gap-2 font-varsity font-black text-citrus-forest uppercase">
                      <Settings className="h-6 w-6 text-citrus-sage" />
                      Configuration
                    </CardTitle>
                    <CardDescription className="font-display text-citrus-charcoal">Customize Stormy's behavior</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6 relative z-10">
                    <div className="flex items-center justify-between p-3 bg-citrus-cream/60 border-2 border-citrus-sage/30 rounded-varsity">
                      <div className="space-y-0.5">
                        <Label className="text-base font-varsity font-bold text-citrus-forest">Proactive Hints</Label>
                        <p className="text-sm font-display text-citrus-charcoal">
                          Show suggestion bubbles on new pages
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                    
                    <div className="flex items-center justify-between p-3 bg-citrus-cream/60 border-2 border-citrus-sage/30 rounded-varsity">
                      <div className="space-y-0.5">
                        <Label className="text-base font-varsity font-bold text-citrus-forest">Trade Alerts</Label>
                        <p className="text-sm font-display text-citrus-charcoal">
                          Notify when a fair trade is found
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>

                    <div className="flex items-center justify-between p-3 bg-citrus-cream/60 border-2 border-citrus-sage/30 rounded-varsity">
                      <div className="space-y-0.5">
                        <Label className="text-base font-varsity font-bold text-citrus-forest">Personality Mode</Label>
                        <p className="text-sm font-display text-citrus-charcoal">
                          Enable humorous / trash-talk style
                        </p>
                      </div>
                      <Switch />
                    </div>

                     <div className="pt-4 border-t-2 border-citrus-sage/30">
                       <h4 className="text-sm font-varsity font-black mb-3 flex items-center gap-2 text-citrus-forest uppercase">
                         <Shield className="h-5 w-5 text-citrus-orange" /> Data & Privacy
                       </h4>
                       <p className="text-xs font-display text-citrus-charcoal leading-relaxed mb-3">
                         Stormy analyzes your league data to provide insights. Your chat history is stored privately to improve future recommendations.
                       </p>
                       <Button variant="outline" size="sm" className="w-full border-2 border-citrus-sage rounded-varsity font-display font-semibold hover:bg-citrus-sage/10">Clear Chat History</Button>
                     </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
              </div>
            </div>

            {/* Left Sidebar - At bottom on mobile, left on desktop */}
            <aside className="w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-32 space-y-4 lg:space-y-6">
                <AdSpace size="300x250" label="AI Sponsor" />
              </div>
            </aside>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default StormyAssistant;
