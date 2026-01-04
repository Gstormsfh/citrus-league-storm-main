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
    <div className="min-h-screen bg-gradient-to-br from-background to-background/95 flex flex-col">
      <Navbar />
      <main className="flex-1 pt-24 pb-8">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-primary to-purple-600 mb-4 shadow-lg shadow-primary/20">
              <Narwhal className="h-10 w-10 text-white" />
            </div>
            <h1 className="text-4xl font-bold mb-2">Stormy AI Assistant</h1>
            <p className="text-lg text-muted-foreground">
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
            <TabsList className="grid w-full grid-cols-2 max-w-[400px] mx-auto mb-8">
              <TabsTrigger value="chat" className="gap-2">
                <MessageSquare className="h-4 w-4" /> Chat
              </TabsTrigger>
              <TabsTrigger value="settings" className="gap-2">
                <Settings className="h-4 w-4" /> Settings
              </TabsTrigger>
            </TabsList>

            <TabsContent value="chat" className="mt-0">
              <Card className="h-[600px] flex flex-col shadow-xl border-primary/10 overflow-hidden">
                <CardHeader className="border-b bg-muted/20 px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center shadow-inner">
                      <Narwhal className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Stormy</CardTitle>
                      <CardDescription className="flex items-center gap-1.5 text-xs">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                        </span>
                        Online & Ready
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                
                <CardContent className="flex-1 p-0 overflow-hidden bg-background relative">
                  <ScrollArea className="h-full p-6" ref={scrollRef}>
                    <div className="space-y-6 max-w-3xl mx-auto">
                      {messages.map((msg) => (
                        <div
                          key={msg.id}
                          className={`flex gap-4 ${msg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                        >
                          {msg.sender === 'stormy' && (
                            <Avatar className="h-10 w-10 border bg-gradient-to-br from-primary/10 to-purple-600/10 shadow-sm shrink-0">
                              <AvatarFallback><Narwhal className="h-5 w-5 text-primary" /></AvatarFallback>
                            </Avatar>
                          )}
                          <div
                            className={`p-4 rounded-2xl text-sm shadow-sm leading-relaxed ${
                              msg.sender === 'user'
                                ? 'bg-primary text-primary-foreground rounded-tr-none'
                                : 'bg-muted border rounded-tl-none'
                            }`}
                          >
                            {msg.text}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>

                <CardFooter className="p-4 border-t bg-muted/10">
                  <div className="max-w-3xl mx-auto w-full">
                    <form 
                      className="flex w-full items-center gap-3"
                      onSubmit={(e) => { e.preventDefault(); handleSend(); }}
                    >
                      <Input 
                        placeholder="Ask Stormy about trades, waivers, or start/sit decisions..." 
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        className="flex-1 h-12 shadow-sm"
                        autoFocus
                      />
                      <Button type="submit" size="icon" className="h-12 w-12 rounded-xl shadow-md transition-transform hover:scale-105" disabled={!inputValue.trim()}>
                        <Send className="h-5 w-5" />
                      </Button>
                    </form>
                    <div className="text-center mt-2">
                      <p className="text-[10px] text-muted-foreground">
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
                <Card className="border-primary/10 shadow-lg h-full">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Zap className="h-5 w-5 text-yellow-500" />
                      Weekly Usage
                    </CardTitle>
                    <CardDescription>Requests remaining this week</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="text-center py-4">
                      <div className="text-5xl font-bold text-primary mb-2">
                        {usageStats.weeklyRequests}<span className="text-xl text-muted-foreground font-normal">/{usageStats.weeklyLimit}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">Requests Used</p>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">Usage Level</span>
                        <span>{Math.round((usageStats.weeklyRequests / usageStats.weeklyLimit) * 100)}%</span>
                      </div>
                      <Progress value={(usageStats.weeklyRequests / usageStats.weeklyLimit) * 100} className="h-2" />
                    </div>

                    <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        <span>Resets on:</span>
                      </div>
                      <span className="font-medium">{usageStats.resetDate}</span>
                    </div>

                    <Button className="w-full bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-white border-0">
                      <Crown className="h-4 w-4 mr-2" />
                      Upgrade to Unlimited
                    </Button>
                  </CardContent>
                </Card>

                {/* Configuration Card */}
                <Card className="border-primary/10 shadow-lg h-full">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Settings className="h-5 w-5 text-primary" />
                      Configuration
                    </CardTitle>
                    <CardDescription>Customize Stormy's behavior</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="text-base">Proactive Hints</Label>
                        <p className="text-sm text-muted-foreground">
                          Show suggestion bubbles on new pages
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="text-base">Trade Alerts</Label>
                        <p className="text-sm text-muted-foreground">
                          Notify when a fair trade is found
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="text-base">Personality Mode</Label>
                        <p className="text-sm text-muted-foreground">
                          Enable humorous / trash-talk style
                        </p>
                      </div>
                      <Switch />
                    </div>

                     <div className="pt-4 border-t">
                       <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                         <Shield className="h-4 w-4 text-primary" /> Data & Privacy
                       </h4>
                       <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                         Stormy analyzes your league data to provide insights. Your chat history is stored privately to improve future recommendations.
                       </p>
                       <Button variant="outline" size="sm" className="w-full">Clear Chat History</Button>
                     </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default StormyAssistant;
