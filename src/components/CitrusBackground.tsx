import { memo } from 'react';
import { CitrusSlice, CitrusLeaf, CitrusWedge, CitrusFruit, CitrusZest, CitrusBurst } from './icons/CitrusIcons';

interface CitrusBackgroundProps {
  density?: 'light' | 'medium' | 'heavy';
  animated?: boolean;
}

/**
 * Decorative background — purely static SVGs positioned via CSS.
 * Animations removed: 12 infinite CSS animations caused constant
 * paint/composite (every 16.7 ms × 12 elements = ~720 paints/sec).
 * Static SVGs at 3-5% opacity are invisible-enough without animation.
 */
export const CitrusBackground = memo(({ density = 'light' }: CitrusBackgroundProps) => {
  const densityConfig = {
    light: 'opacity-[0.03]',
    medium: 'opacity-[0.05]',
    heavy: 'opacity-[0.08]',
  };

  return (
    <div className={`fixed inset-0 pointer-events-none overflow-hidden -z-10 ${densityConfig[density]}`}>
      <div className="absolute top-10 left-10">
        <CitrusSlice className="w-32 h-32 text-citrus-orange rotate-12" />
      </div>
      <div className="absolute top-32 left-40">
        <CitrusLeaf className="w-24 h-24 text-citrus-sage -rotate-45" />
      </div>
      <div className="absolute top-20 right-20">
        <CitrusFruit className="w-28 h-28 text-citrus-peach rotate-90" />
      </div>
      <div className="absolute top-40 right-60">
        <CitrusWedge className="w-20 h-20 text-citrus-orange rotate-180" />
      </div>
      <div className="absolute top-1/3 left-5">
        <CitrusBurst className="w-40 h-40 text-citrus-sage" />
      </div>
      <div className="absolute top-1/2 right-10">
        <CitrusSlice className="w-36 h-36 text-citrus-peach" />
      </div>
      <div className="absolute bottom-32 left-32">
        <CitrusLeaf className="w-28 h-28 text-citrus-orange" />
      </div>
      <div className="absolute bottom-10 left-60">
        <CitrusWedge className="w-24 h-24 text-citrus-sage rotate-45" />
      </div>
      <div className="absolute bottom-20 right-40">
        <CitrusFruit className="w-32 h-32 text-citrus-orange" />
      </div>
      <div className="absolute bottom-40 right-20">
        <CitrusZest className="w-20 h-20 text-citrus-peach" />
      </div>
      <div className="absolute top-2/3 left-1/3">
        <CitrusSlice className="w-24 h-24 text-citrus-sage" />
      </div>
      <div className="absolute top-1/4 right-1/3">
        <CitrusLeaf className="w-20 h-20 text-citrus-peach" />
      </div>
    </div>
  );
});
