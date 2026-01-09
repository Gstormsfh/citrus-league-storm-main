import { CitrusSlice, CitrusLeaf, CitrusWedge, CitrusFruit, CitrusZest, CitrusBurst } from './icons/CitrusIcons';

interface CitrusBackgroundProps {
  density?: 'light' | 'medium' | 'heavy';
  animated?: boolean;
}

export const CitrusBackground = ({ density = 'light', animated = true }: CitrusBackgroundProps) => {
  const densityConfig = {
    light: 'opacity-[0.03]',
    medium: 'opacity-[0.05]',
    heavy: 'opacity-[0.08]',
  };

  const animationClass = animated ? 'animate-float' : '';

  return (
    <div className={`fixed inset-0 pointer-events-none overflow-hidden -z-10 ${densityConfig[density]}`}>
      {/* Top left cluster */}
      <div className={`absolute top-10 left-10 ${animationClass}`} style={{ animationDelay: '0s', animationDuration: '20s' }}>
        <CitrusSlice className="w-32 h-32 text-citrus-orange rotate-12" />
      </div>
      
      <div className={`absolute top-32 left-40 ${animationClass}`} style={{ animationDelay: '2s', animationDuration: '25s' }}>
        <CitrusLeaf className="w-24 h-24 text-citrus-sage -rotate-45" />
      </div>
      
      {/* Top right cluster */}
      <div className={`absolute top-20 right-20 ${animationClass}`} style={{ animationDelay: '1s', animationDuration: '22s' }}>
        <CitrusFruit className="w-28 h-28 text-citrus-peach rotate-90" />
      </div>
      
      <div className={`absolute top-40 right-60 ${animationClass}`} style={{ animationDelay: '3s', animationDuration: '18s' }}>
        <CitrusWedge className="w-20 h-20 text-citrus-orange rotate-180" />
      </div>
      
      {/* Middle left */}
      <div className={`absolute top-1/3 left-5 ${animationClass}`} style={{ animationDelay: '4s', animationDuration: '24s' }}>
        <CitrusBurst className="w-40 h-40 text-citrus-sage" />
      </div>
      
      {/* Middle right */}
      <div className={`absolute top-1/2 right-10 ${animationClass}`} style={{ animationDelay: '2.5s', animationDuration: '21s' }}>
        <CitrusSlice className="w-36 h-36 text-citrus-peach -rotate-30" />
      </div>
      
      {/* Bottom left cluster */}
      <div className={`absolute bottom-32 left-32 ${animationClass}`} style={{ animationDelay: '1.5s', animationDuration: '23s' }}>
        <CitrusLeaf className="w-28 h-28 text-citrus-orange rotate-120" />
      </div>
      
      <div className={`absolute bottom-10 left-60 ${animationClass}`} style={{ animationDelay: '3.5s', animationDuration: '19s' }}>
        <CitrusWedge className="w-24 h-24 text-citrus-sage rotate-45" />
      </div>
      
      {/* Bottom right cluster */}
      <div className={`absolute bottom-20 right-40 ${animationClass}`} style={{ animationDelay: '2.8s', animationDuration: '26s' }}>
        <CitrusFruit className="w-32 h-32 text-citrus-orange -rotate-60" />
      </div>
      
      <div className={`absolute bottom-40 right-20 ${animationClass}`} style={{ animationDelay: '4.5s', animationDuration: '20s' }}>
        <CitrusZest className="w-20 h-20 text-citrus-peach" />
      </div>
      
      {/* Center scattered elements */}
      <div className={`absolute top-2/3 left-1/3 ${animationClass}`} style={{ animationDelay: '5s', animationDuration: '27s' }}>
        <CitrusSlice className="w-24 h-24 text-citrus-sage rotate-75" />
      </div>
      
      <div className={`absolute top-1/4 right-1/3 ${animationClass}`} style={{ animationDelay: '3.2s', animationDuration: '22s' }}>
        <CitrusLeaf className="w-20 h-20 text-citrus-peach rotate-135" />
      </div>
    </div>
  );
};

// Add the float animation to global CSS if not already present
// @keyframes float {
//   0%, 100% { transform: translateY(0px) rotate(0deg); }
//   50% { transform: translateY(-20px) rotate(5deg); }
// }
