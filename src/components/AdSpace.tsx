import { Card } from '@/components/ui/card';
import { CitrusSlice, CitrusSparkle, CitrusLeaf, CitrusWedge } from '@/components/icons/CitrusIcons';
import { cn } from '@/lib/utils';

interface AdSpaceProps {
  size?: '300x250' | '728x90' | '160x600' | '300x600';
  className?: string;
  label?: string;
}

export const AdSpace = ({ size = '300x250', className, label = 'Featured Sponsor' }: AdSpaceProps) => {
  const sizeConfig = {
    '300x250': {
      container: 'min-h-[280px] w-full',
      inner: 'min-h-[200px] p-8',
      icon: 'w-20 h-20',
      iconInner: 'w-12 h-12',
    },
    '728x90': {
      container: 'min-h-[120px] w-full',
      inner: 'min-h-[80px] p-4 flex-row gap-6',
      icon: 'w-12 h-12',
      iconInner: 'w-8 h-8',
    },
    '160x600': {
      container: 'min-h-[620px] w-[180px]',
      inner: 'min-h-[560px] p-6',
      icon: 'w-16 h-16',
      iconInner: 'w-10 h-10',
    },
    '300x600': {
      container: 'min-h-[620px] w-full',
      inner: 'min-h-[560px] p-10',
      icon: 'w-24 h-24',
      iconInner: 'w-16 h-16',
    },
  };

  const config = sizeConfig[size];
  const isHorizontal = size === '728x90';

  return (
    <Card 
      className={cn(
        "overflow-hidden bg-gradient-to-br from-citrus-sage/10 via-citrus-cream to-citrus-peach/10 corduroy-texture border-4 border-citrus-orange rounded-[1.5rem] shadow-[0_6px_0_rgba(223,117,54,0.3)] relative hover:shadow-[0_8px_0_rgba(223,117,54,0.4)] hover:-translate-y-1 transition-all duration-300",
        config.container,
        className
      )}
    >
      {/* Decorative Elements */}
      <div className="absolute top-3 right-3">
        <CitrusSparkle className="w-6 h-6 text-citrus-orange animate-pulse" />
      </div>
      <div className="absolute top-3 left-3">
        <CitrusWedge className="w-5 h-5 text-citrus-sage opacity-70" />
      </div>
      <div className="absolute bottom-2 right-2">
        <CitrusLeaf className="w-20 h-20 text-citrus-peach/20 -rotate-12" />
      </div>
      
      <div className={cn(
        "text-center p-6 relative z-10",
        isHorizontal && "flex items-center justify-between"
      )}>
        {/* Badge/Patch Style Header */}
        <div className={cn(
          "mb-4 inline-block px-4 py-1.5 bg-citrus-orange border-3 border-citrus-forest rounded-varsity shadow-patch",
          isHorizontal && "mb-0"
        )}>
          <span className="font-varsity text-xs text-citrus-cream uppercase tracking-wider whitespace-nowrap">
            ⭐ {label}
          </span>
        </div>
        
        {/* Main Ad Container */}
        <div className={cn(
          "w-full bg-citrus-cream/80 backdrop-blur-sm rounded-xl border-3 border-citrus-sage shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)] flex flex-col items-center justify-center",
          config.inner,
          isHorizontal ? "mb-0" : "mb-3"
        )}>
          <div className={cn(
            "mx-auto rounded-varsity bg-gradient-to-br from-citrus-sage to-citrus-orange border-4 border-citrus-forest flex items-center justify-center shadow-patch",
            config.icon,
            isHorizontal ? "mb-0" : "mb-3"
          )}>
            <CitrusSlice className={cn("text-citrus-cream", config.iconInner)} />
          </div>
          <div className={cn(
            isHorizontal && "ml-4 text-left flex-1"
          )}>
            <div className="font-varsity text-base text-citrus-forest uppercase tracking-wide mb-2">
              Your Brand Here
            </div>
            <div className="font-display text-xs text-citrus-charcoal/70 mb-1">
              Premium Placement
            </div>
            <div className="font-mono text-[10px] text-citrus-sage">
              {size}
            </div>
          </div>
        </div>
        
        {/* CTA */}
        {!isHorizontal && (
          <div className="font-display text-[10px] text-citrus-orange uppercase tracking-wide">
            Reach thousands of fantasy hockey fans
          </div>
        )}
      </div>
    </Card>
  );
};
