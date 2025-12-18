
import { useState, useEffect } from "react";

interface LiveUpdatesProps {
  updates: string[];
}

export const LiveUpdates = ({ updates }: LiveUpdatesProps) => {
  const [currentUpdateIndex, setCurrentUpdateIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentUpdateIndex(prev => (prev + 1) % updates.length);
    }, 5000);
    
    return () => clearInterval(interval);
  }, [updates.length]);

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-background/80 backdrop-blur-md border-t border-border/40 py-2 z-50">
      <div className="container mx-auto flex items-center justify-center gap-2">
        <div className="text-primary text-xs">●</div>
        <div className="text-sm font-medium text-muted-foreground transition-all duration-500">{updates[currentUpdateIndex]}</div>
      </div>
    </div>
  );
};
