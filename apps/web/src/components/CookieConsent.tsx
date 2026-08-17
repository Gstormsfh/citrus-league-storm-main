import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  hasConsentChoice,
  grantAnalyticsConsent,
  denyAnalyticsConsent,
} from "@/integrations/firebase/config";

/**
 * CSS custom property published on <html> while this banner is on screen, set
 * to the banner's measured height. Any other bottom-anchored fixed element
 * adds it to its own offset so it is never buried under the banner.
 *
 * Consumers: StormyChatBubble (the floating assistant button).
 *
 * A variable rather than shared state on purpose — it applies the instant the
 * banner mounts, resizes or unmounts, with no re-render coordination between
 * two otherwise unrelated components.
 */
const CONSENT_HEIGHT_VAR = "--citrus-consent-h";

export function CookieConsent() {
  const [visible, setVisible] = useState(() => !hasConsentChoice());
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const el = ref.current;
    if (!visible || !el) {
      root.style.removeProperty(CONSENT_HEIGHT_VAR);
      return;
    }
    // The banner wraps to two lines on narrow phones and one on desktop, so its
    // height is measured, not assumed.
    const publish = () => root.style.setProperty(CONSENT_HEIGHT_VAR, `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty(CONSENT_HEIGHT_VAR);
    };
  }, [visible]);

  if (!visible) return null;

  const accept = () => {
    grantAnalyticsConsent();
    setVisible(false);
  };

  const decline = () => {
    denyAnalyticsConsent();
    setVisible(false);
  };

  return (
    // z-[110] sits above the Stormy FAB (z-100). Belt and braces alongside the
    // height variable: even if the offset fails, consent text is never covered.
    //
    // Restyled 2026-08-14. This was bg-white/95 with text-gray-700 — a bright
    // slab on a deep-forest app, the highest-contrast thing on the screen and
    // the first thing the eye landed on. It read as a third-party widget rather
    // than part of Citrus.
    //
    // Height is NOT materially improved: 117px -> 115px on a 390px viewport
    // (73 -> 69 on desktop). Tighter padding and shorter copy bought back about
    // what the privacy link cost. It still occupies ~14% of a phone screen and
    // is still fixed until a choice is made. If that matters, the next move is
    // a two-stage pattern — a compact bar that expands on tap — not more
    // trimming of this one.
    <div
      ref={ref}
      className="fixed bottom-[4.5rem] lg:bottom-0 inset-x-0 z-[110] px-4 py-3 bg-pastel-surface/95 backdrop-blur-xl border-t border-white/10 shadow-[0_-8px_32px_-8px_rgba(0,0,0,0.5)]"
      role="region"
      aria-label="Cookie consent"
    >
      <div className="max-w-3xl mx-auto flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-4">
        <p className="flex-1 text-[13px] leading-snug text-white/70">
          We use analytics cookies. You can opt out anytime — see our{' '}
          <Link to="/privacy" className="text-pastel-orange-soft underline underline-offset-2 hover:text-pastel-orange">
            privacy policy
          </Link>
          .
        </p>
        {/* h-11 = 44px, the same touch-target floor applied to the card CTAs. */}
        <div className="flex gap-2 shrink-0">
          <button
            onClick={decline}
            className="h-11 px-5 rounded-md text-[13px] font-bold text-white/80 ring-1 ring-white/20 hover:bg-white/5 hover:text-white transition-colors"
          >
            Decline
          </button>
          <button
            onClick={accept}
            className="h-11 px-5 rounded-md text-[13px] font-bold bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft transition-colors"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
