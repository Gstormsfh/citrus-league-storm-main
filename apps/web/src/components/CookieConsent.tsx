import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  hasConsentChoice,
  grantAnalyticsConsent,
  denyAnalyticsConsent,
} from "@/integrations/firebase/config";

export function CookieConsent() {
  const [visible, setVisible] = useState(() => !hasConsentChoice());

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
    <div className="fixed bottom-[4.5rem] lg:bottom-0 inset-x-0 z-app-nav p-3 sm:p-4 bg-white/95 backdrop-blur border-t shadow-lg">
      <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center gap-3 text-sm">
        <p className="flex-1 text-pastel-forest">
          We use analytics cookies to improve your experience. You can opt out anytime.
        </p>
        {/* 2026-08-19: this banner is one of the few LIGHT surfaces left
            (bg-white/95). The shared outline/ghost button variants now
            carry cream text for the dark app, so they need an explicit
            dark label here or they vanish into the white banner. */}
        <div className="flex gap-2 shrink-0 [&_button]:text-[#0F1F15]">
          <Button size="sm" variant="outline" onClick={decline}>
            Decline
          </Button>
          <Button
            size="sm"
            onClick={accept}
            className="bg-[#2E7D32] hover:bg-[#1B5E20] text-white"
          >
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
