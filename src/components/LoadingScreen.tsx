import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';

// Import the 4 loading screen images
import kiwiImage from '../../assets/images/Gemini_Generated_Image_Kiwi.png';
import lemonImage from '../../assets/images/Gemini_Generated_Image_Lemon.png';
import narwhalImage from '../../assets/images/Gemini_Generated_Image_Narwhal.png';
import pineappleImage from '../../assets/images/Gemini_Generated_Image_Pineapple.png';

export type LoadingCharacter = 'kiwi' | 'lemon' | 'narwhal' | 'pineapple';

interface LoadingScreenProps {
  character?: LoadingCharacter;
  message?: string;
  progress?: number; // Kept for interface compatibility, but not used
  className?: string;
}

// Available loading characters (all 4 images)
const LOADING_CHARACTERS: LoadingCharacter[] = ['kiwi', 'lemon', 'narwhal', 'pineapple'];

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
  
  const getImageSrc = (char: LoadingCharacter): string => {
    switch (char) {
      case 'kiwi':
        return kiwiImage;
      case 'lemon':
        return lemonImage;
      case 'narwhal':
        return narwhalImage;
      case 'pineapple':
        return pineappleImage;
      default:
        return kiwiImage;
    }
  };

  const imageSrc = getImageSrc(selectedCharacter);

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
          alt={`${selectedCharacter} loading screen`}
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
