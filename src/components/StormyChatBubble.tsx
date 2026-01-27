import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { X, MessageSquare, Send, Sparkles, Minimize2, Maximize2 } from 'lucide-react';
import { Narwhal } from '@/components/icons/Narwhal';
import { CitrusSparkle, CitrusLeaf } from '@/components/icons/CitrusIcons';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'stormy';
  timestamp: Date;
}

export const StormyChatBubble = () => {
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      text: "Hi! I'm Stormy. How can I help you manage your team today?",
      sender: 'stormy',
      timestamp: new Date()
    }
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Context Awareness Logic
  useEffect(() => {
    const getContextGreeting = () => {
      const path = location.pathname;
      if (path.includes('/roster')) return "I see you're looking at your roster. Need help with start/sit decisions?";
      if (path.includes('/trade-analyzer')) return "Analyzing a trade? I can help evaluate the long-term impact.";
      if (path.includes('/free-agents')) return "Scouting the waiver wire? Ask me about players with favorable schedules.";
      if (path.includes('/matchup')) return "Checking the scoreboard? I can project your win probability.";
      if (path.includes('/team-analytics')) return "Reviewing team stats? I can pinpoint your biggest positional weakness.";
      return "Hi! I'm Stormy. How can I help you manage your team today?";
    };

    // Only add a context message if the chat is open or on specific triggers
    // For now, let's just update the "thought" bubble or subtle indicator if we wanted
    // But we'll just reset the conversation starter if it's empty/default
    if (messages.length === 1) {
        setMessages([{
            id: '1',
            text: getContextGreeting(),
            sender: 'stormy',
            timestamp: new Date()
        }]);
    }
  }, [location.pathname]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

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
      const responseText = "That's a great question! Based on your current roster data, I'd suggest looking at the free agent pool for a backup goalie. Your save percentage is trending down.";
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        text: responseText,
        sender: 'stormy',
        timestamp: new Date()
      }]);
    }, 1000);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 left-6 h-14 w-14 rounded-varsity shadow-[0_6px_0_rgba(27,48,34,0.2)] bg-gradient-to-br from-citrus-sage to-citrus-orange border-4 border-citrus-forest hover:scale-105 hover:-translate-y-1 transition-all z-[9999] p-0 overflow-hidden"
        style={{ position: 'fixed', bottom: '1.5rem', left: '1.5rem' }}
      >
        {/* Corduroy texture */}
        <div className="absolute inset-0 opacity-20 corduroy-texture pointer-events-none" />
        <Narwhal className="h-7 w-7 text-[#E8EED9] relative z-10 pointer-events-none" />
        <span className="absolute -top-1 -right-1 h-3 w-3 bg-citrus-sage rounded-full border-2 border-citrus-cream animate-pulse shadow-[0_0_8px_rgba(120,149,97,0.6)] pointer-events-none" />
        <CitrusSparkle className="absolute top-1 left-1 w-3 h-3 text-[#E8EED9] opacity-70 pointer-events-none" />
      </Button>
    );
  }

  return (
    <Card 
      className={`fixed bottom-6 left-6 w-[380px] shadow-[0_8px_0_rgba(27,48,34,0.2)] z-[9999] border-4 border-citrus-forest rounded-[2rem] overflow-hidden flex flex-col transition-all duration-300 bg-[#E8EED9]/60 backdrop-blur-sm corduroy-texture ${isMinimized ? 'h-[70px]' : 'h-[600px]'}`}
      style={{ position: 'fixed', bottom: '1.5rem', left: '1.5rem' }}
    >
      <CardHeader className="p-4 bg-gradient-to-r from-citrus-sage/20 via-citrus-sage/10 to-citrus-peach/10 border-b-4 border-citrus-forest flex flex-row items-center justify-between shrink-0 relative">
        {/* Decorative citrus leaf */}
        <CitrusLeaf className="absolute top-2 right-20 w-8 h-8 text-citrus-sage opacity-10 rotate-12" />
        
        <div className="flex items-center gap-3 relative z-10">
          <div className="relative">
            <div className="h-10 w-10 rounded-varsity bg-gradient-to-br from-citrus-sage to-citrus-orange border-3 border-citrus-forest flex items-center justify-center shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)]">
               <Narwhal className="h-6 w-6 text-[#E8EED9]" />
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 bg-citrus-sage rounded-full border-2 border-citrus-cream shadow-[0_0_8px_rgba(120,149,97,0.6)]" />
          </div>
          <div>
            <CardTitle className="text-base font-varsity font-black text-citrus-forest uppercase tracking-tight">Stormy</CardTitle>
            <p className="text-xs font-display text-citrus-charcoal flex items-center gap-1">
              <CitrusSparkle className="h-3 w-3 text-citrus-orange" /> AI Assistant
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 relative z-10">
          <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-citrus-sage/20 text-citrus-forest" onClick={() => setIsMinimized(!isMinimized)}>
            {isMinimized ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-citrus-peach/30 text-citrus-forest" onClick={() => setIsOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      {!isMinimized && (
        <>
          <CardContent className="flex-1 p-0 overflow-hidden bg-[#E8EED9]/60 backdrop-blur-sm/50 relative">
            <ScrollArea className="h-full p-4" ref={scrollRef}>
              <div className="space-y-4">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex gap-2 ${msg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    {msg.sender === 'stormy' && (
                      <Avatar className="h-8 w-8 border-2 border-citrus-sage bg-gradient-to-br from-citrus-sage/20 to-citrus-orange/20 shadow-sm">
                        <AvatarFallback className="bg-transparent"><Narwhal className="h-4 w-4 text-citrus-forest" /></AvatarFallback>
                      </Avatar>
                    )}
                    <div
                      className={`max-w-[80%] p-3 rounded-2xl text-sm font-display shadow-sm ${
                        msg.sender === 'user'
                          ? 'bg-gradient-to-br from-citrus-orange to-citrus-peach text-[#E8EED9] font-medium rounded-tr-none border-2 border-citrus-orange'
                          : 'bg-[#E8EED9]/60 backdrop-blur-sm border-2 border-citrus-sage/40 rounded-tl-none text-citrus-forest'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>

          <CardFooter className="p-3 border-t-4 border-citrus-forest bg-[#E8EED9]/60 backdrop-blur-sm">
            <form 
              className="flex w-full items-center gap-2"
              onSubmit={(e) => { e.preventDefault(); handleSend(); }}
            >
              <Input 
                placeholder="Ask Stormy..." 
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="flex-1 rounded-xl border-2 border-citrus-sage/40 bg-[#E8EED9]/60 backdrop-blur-sm/50 text-citrus-forest placeholder:text-citrus-charcoal/50 font-display focus:border-citrus-orange transition-all"
                autoFocus
              />
              <Button 
                type="submit" 
                size="icon" 
                disabled={!inputValue.trim()}
                className="bg-gradient-to-br from-citrus-sage to-citrus-orange border-3 border-citrus-forest rounded-varsity shadow-patch hover:-translate-y-0.5 transition-all disabled:opacity-50"
              >
                <Send className="h-4 w-4 text-[#E8EED9]" />
              </Button>
            </form>
          </CardFooter>
        </>
      )}
    </Card>
  );
};

