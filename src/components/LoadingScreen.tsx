import React from 'react';
import { cn } from '@/lib/utils';

export type LoadingCharacter = 'citrus' | 'narwhal';

interface LoadingScreenProps {
  character?: LoadingCharacter;
  message?: string;
  progress?: number; // Kept for interface compatibility, but not used
  className?: string;
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({
  character = 'citrus',
  message = 'Loading...',
  progress = undefined,
  className,
}) => {
  const imageSrc = character === 'citrus' 
    ? '/loading-citrus.png' 
    : '/loading-narwhal.png';

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center',
        'bg-[#D4E8B8]', // Light green background
        className
      )}
    >
      <div className="relative">
        <img
          src={imageSrc}
          alt={character === 'citrus' ? 'Citrus loading screen' : 'Narwhal loading screen'}
          className="w-auto h-auto max-w-[90vw] max-h-[90vh] object-contain drop-shadow-lg relative"
          style={{
            maxWidth: '600px',
            maxHeight: '800px',
          }}
        />
        
      </div>
    </div>
  );
};

export default LoadingScreen;
