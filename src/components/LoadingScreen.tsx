import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';

export type LoadingCharacter = 'citrus' | 'narwhal';

interface LoadingScreenProps {
  character?: LoadingCharacter;
  message?: string;
  progress?: number; // Kept for interface compatibility, but not used
  className?: string;
}

// Available loading characters
const LOADING_CHARACTERS: LoadingCharacter[] = ['citrus', 'narwhal'];

// Persistent random character selection (stored in module scope to persist across renders)
let cachedRandomCharacter: LoadingCharacter | null = null;

const getRandomCharacter = (): LoadingCharacter => {
  // If we already have a cached character, use it (ensures only one is used at a time)
  if (cachedRandomCharacter) {
    return cachedRandomCharacter;
  }
  
  // Otherwise, pick a random one and cache it
  const randomIndex = Math.floor(Math.random() * LOADING_CHARACTERS.length);
  cachedRandomCharacter = LOADING_CHARACTERS[randomIndex];
  return cachedRandomCharacter;
};

const LoadingScreen: React.FC<LoadingScreenProps> = ({
  character,
  message = 'Loading...',
  progress = undefined,
  className,
}) => {
  // Use provided character, or randomize if not provided
  const selectedCharacter = useMemo(() => {
    return character || getRandomCharacter();
  }, [character]);
  
  const imageSrc = selectedCharacter === 'citrus' 
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
