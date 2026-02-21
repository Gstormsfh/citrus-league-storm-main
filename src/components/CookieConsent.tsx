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
    <div className="fixed bottom-[4.5rem] lg:bottom-0 inset-x-0 z-50 p-3 sm:p-4 bg-white/95 backdrop-blur border-t shadow-lg">
      <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center gap-3 text-sm">
        <p className="flex-1 text-gray-700">
          We use analytics cookies to improve your experience. You can opt out anytime.
        </p>
        <div className="flex gap-2 shrink-0">
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
