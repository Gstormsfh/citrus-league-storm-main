
import { useState, useEffect } from "react";
import { CitrusSparkle } from '@/components/icons/CitrusIcons';

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
    <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-r from-citrus-sage via-citrus-cream to-citrus-peach backdrop-blur-lg border-t-4 border-citrus-forest py-3 z-50 shadow-[0_-4px_10px_rgba(27,48,34,0.15)]">
      {/* Corduroy texture overlay */}
      <div className="absolute inset-0 opacity-10 corduroy-texture pointer-events-none"></div>
      
      <div className="container mx-auto flex items-center justify-center gap-3 relative z-10">
        <div className="flex items-center gap-2">
          <CitrusSparkle className="w-4 h-4 text-citrus-orange animate-pulse" />
          <span className="font-varsity text-xs font-black text-citrus-forest uppercase tracking-wider">Live:</span>
        </div>
        <div className="text-sm font-display font-semibold text-citrus-charcoal transition-all duration-500 px-3 py-1 bg-citrus-cream/60 rounded-lg border-2 border-citrus-sage/30">{updates[currentUpdateIndex]}</div>
        <CitrusSparkle className="w-4 h-4 text-citrus-orange animate-pulse" />
      </div>
    </div>
  );
};
