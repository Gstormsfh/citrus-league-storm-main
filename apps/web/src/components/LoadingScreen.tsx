import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface LoadingScreenProps {
  message?: string;
  className?: string;
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({
  message = 'Loading...',
  className,
}) => {
  const [dismissed, setDismissed] = useState(false);
  const [showTapHint, setShowTapHint] = useState(false);

  // Auto-dismiss after 8 seconds as a safety valve
  useEffect(() => {
    const hintTimer = setTimeout(() => setShowTapHint(true), 4000);
    const dismissTimer = setTimeout(() => setDismissed(true), 8000);
    return () => {
      clearTimeout(hintTimer);
      clearTimeout(dismissTimer);
    };
  }, []);

  if (dismissed) return null;

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center cursor-pointer',
        'bg-pastel-surface',
        className
      )}
      onClick={() => setDismissed(true)}
    >
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-full border-4 border-white/10 border-t-pastel-orange animate-spin" />
        <p className="text-white/55 text-sm">{message}</p>
        {showTapHint && (
          <p className="text-white/45 text-xs animate-pulse">Tap anywhere to continue</p>
        )}
      </div>
    </div>
  );
};

export default LoadingScreen;
