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
        className="fixed bottom-6 left-6 h-14 w-14 rounded-full shadow-xl bg-gradient-to-r from-primary to-purple-600 hover:scale-105 transition-transform z-[100] p-0"
      >
        <Narwhal className="h-7 w-7 text-white" />
        <span className="absolute -top-1 -right-1 h-3 w-3 bg-green-500 rounded-full border-2 border-background animate-pulse" />
      </Button>
    );
  }

  return (
    <Card className={`fixed bottom-6 left-6 w-[380px] shadow-2xl z-[100] border-primary/20 flex flex-col transition-all duration-300 ${isMinimized ? 'h-[70px]' : 'h-[600px]'}`}>
      <CardHeader className="p-4 bg-gradient-to-r from-primary/10 to-purple-600/10 border-b flex flex-row items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center shadow-inner">
               <Narwhal className="h-6 w-6 text-white" />
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 bg-green-500 rounded-full border-2 border-background" />
          </div>
          <div>
            <CardTitle className="text-base">Stormy</CardTitle>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-purple-500" /> AI Assistant
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsMinimized(!isMinimized)}>
            {isMinimized ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive" onClick={() => setIsOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      {!isMinimized && (
        <>
          <CardContent className="flex-1 p-0 overflow-hidden bg-background/50 relative">
            <ScrollArea className="h-full p-4" ref={scrollRef}>
              <div className="space-y-4">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex gap-2 ${msg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    {msg.sender === 'stormy' && (
                      <Avatar className="h-8 w-8 border bg-gradient-to-br from-primary/10 to-purple-600/10">
                        <AvatarFallback><Narwhal className="h-4 w-4 text-primary" /></AvatarFallback>
                      </Avatar>
                    )}
                    <div
                      className={`max-w-[80%] p-3 rounded-2xl text-sm ${
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

          <CardFooter className="p-3 border-t bg-background">
            <form 
              className="flex w-full items-center gap-2"
              onSubmit={(e) => { e.preventDefault(); handleSend(); }}
            >
              <Input 
                placeholder="Ask Stormy..." 
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="flex-1"
                autoFocus
              />
              <Button type="submit" size="icon" disabled={!inputValue.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </CardFooter>
        </>
      )}
    </Card>
  );
};

