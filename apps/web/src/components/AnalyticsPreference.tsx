import { useEffect, useState } from 'react';
import { ANALYTICS_CONSENT_EVENT, denyAnalyticsConsent, grantAnalyticsConsent } from '@/integrations/firebase/config';

export function AnalyticsPreference() {
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem('citrus_analytics_consent') === 'granted'; }
    catch { return false; }
  });
  useEffect(() => {
    const sync = () => {
      try { setEnabled(localStorage.getItem('citrus_analytics_consent') === 'granted'); }
      catch { setEnabled(false); }
    };
    window.addEventListener(ANALYTICS_CONSENT_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(ANALYTICS_CONSENT_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return (
    <label className="flex items-center justify-between gap-4 rounded-xl p-3 text-sm">
      <span>Optional usage analytics</span>
      <input type="checkbox" checked={enabled} onChange={(event) => {
        const next = event.target.checked;
        if (next) grantAnalyticsConsent(); else denyAnalyticsConsent();
        setEnabled(next);
      }} aria-label="Optional usage analytics" className="h-5 w-5 accent-green-700" />
    </label>
  );
}
