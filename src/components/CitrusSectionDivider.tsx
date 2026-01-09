import { CitrusSlice, CitrusLeaf, CitrusWedge } from './icons/CitrusIcons';

interface CitrusSectionDividerProps {
  className?: string;
}

export const CitrusSectionDivider = ({ className = '' }: CitrusSectionDividerProps) => {
  return (
    <div className={`relative flex items-center justify-center py-8 ${className}`}>
      {/* Left citrus elements */}
      <div className="absolute left-0 flex items-center gap-3 opacity-20">
        <CitrusLeaf className="w-6 h-6 text-citrus-sage rotate-45" />
        <CitrusWedge className="w-5 h-5 text-citrus-orange" />
      </div>
      
      {/* Center citrus slice */}
      <div className="relative z-10 bg-citrus-cream rounded-varsity p-3 border-3 border-citrus-sage/30 shadow-patch">
        <CitrusSlice className="w-8 h-8 text-citrus-orange" />
      </div>
      
      {/* Right citrus elements */}
      <div className="absolute right-0 flex items-center gap-3 opacity-20">
        <CitrusWedge className="w-5 h-5 text-citrus-peach rotate-180" />
        <CitrusLeaf className="w-6 h-6 text-citrus-sage -rotate-45" />
      </div>
      
      {/* Decorative lines */}
      <div className="absolute inset-x-0 top-1/2 h-[2px] bg-gradient-to-r from-transparent via-citrus-sage/20 to-transparent" />
    </div>
  );
};
