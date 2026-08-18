import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { CitrusSlice, CitrusSparkle, CitrusLeaf, CitrusWedge } from '@/components/icons/CitrusIcons';
import { cn } from '@/lib/utils';

// AdSense publisher ID (public - embedded in page HTML)
const ADSENSE_PUB_ID = 'ca-pub-9217677881289656';
const ADSENSE_DISABLED = import.meta.env.VITE_ADSENSE_ENABLED === 'false';

// Map our sizes to AdSense-compatible dimensions
const adSizeMap = {
  '300x250': { width: 300, height: 250 },
  '728x90':  { width: 728, height: 90 },
  '160x600': { width: 160, height: 600 },
  '300x600': { width: 300, height: 600 },
} as const;

declare global {
  interface Window {
    adsbygoogle?: Record<string, unknown>[];
  }
}

interface AdSpaceProps {
  size?: '300x250' | '728x90' | '160x600' | '300x600';
  className?: string;
  label?: string;
  /** Google AdSense ad slot ID for this placement. Optional - uses auto-format if not set. */
  adSlot?: string;
}

export const AdSpace = ({ size = '300x250', className, label = 'The Citrus Squad', adSlot }: AdSpaceProps) => {
  const adRef = useRef<HTMLModElement>(null);
  const [adFailed, setAdFailed] = useState(false);
  const pushedRef = useRef(false);

  const shouldShowAd = !ADSENSE_DISABLED && !adFailed;

  useEffect(() => {
    if (!shouldShowAd) return;

    // Push the ad after a short delay to let the script initialize
    const timer = setTimeout(() => {
      try {
        if (!pushedRef.current && adRef.current) {
          (window.adsbygoogle = window.adsbygoogle || []).push({});
          pushedRef.current = true;
        }
      } catch {
        setAdFailed(true);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [shouldShowAd]);

  const adSize = adSizeMap[size];

  // Render a real AdSense unit
  if (shouldShowAd) {
    return (
      <div
        className={cn('flex items-center justify-center overflow-hidden rounded-2xl', className)}
        style={{ minHeight: adSize.height }}
      >
        <ins
          ref={adRef}
          className="adsbygoogle"
          style={{ display: 'block', width: '100%', height: adSize.height }}
          data-ad-client={ADSENSE_PUB_ID}
          {...(adSlot ? { 'data-ad-slot': adSlot } : {})}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
      </div>
    );
  }

  // Fallback: branded placeholder (shown when ads fail or are disabled)
  return <AdSpacePlaceholder size={size} className={className} label={label} />;
};

// ── Branded placeholder (shown when ads aren't configured) ──────────────

function AdSpacePlaceholder({
  size,
  className,
  label,
}: {
  size: '300x250' | '728x90' | '160x600' | '300x600';
  className?: string;
  label: string;
}) {
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
          <span className="font-varsity text-xs text-[#E8EED9] uppercase tracking-wider whitespace-nowrap">
            {label}
          </span>
        </div>

        {/* Main Ad Container */}
        <div className={cn(
          "w-full bg-[#E8EED9]/50 backdrop-blur-sm rounded-xl border-3 border-citrus-sage shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)] flex flex-col items-center justify-center",
          config.inner,
          isHorizontal ? "mb-0" : "mb-3"
        )}>
          <div className={cn(
            "mx-auto rounded-varsity bg-gradient-to-br from-citrus-sage to-citrus-orange border-4 border-citrus-forest flex items-center justify-center shadow-patch",
            config.icon,
            isHorizontal ? "mb-0" : "mb-3"
          )}>
            <CitrusSlice className={cn("text-[#E8EED9]", config.iconInner)} />
          </div>
          {/* SWEEP FIX (2026-08-16): this fallback renders in the native
              app (ads stripped) and whenever AdSense fails — "Your Brand
              Here / Premium Placement / 300x250" read as an unfinished ad
              slot to users and App Store reviewers. House-brand card now. */}
          <div className={cn(
            isHorizontal && "ml-4 text-left flex-1"
          )}>
            <div className="font-varsity text-base text-citrus-forest uppercase tracking-wide mb-2">
              Citrus Fantasy
            </div>
            <div className="font-display text-xs text-citrus-charcoal/70 mb-1">
              Built by hockey heads, for hockey heads
            </div>
          </div>
        </div>

        {/* CTA */}
        {!isHorizontal && (
          <div className="font-display text-[10px] text-citrus-orange uppercase tracking-wide">
            Live xG scoring · Snake &amp; auction drafts · Stormy AI
          </div>
        )}
      </div>
    </Card>
  );
}
