import { useEffect, useState } from 'react';
import { ANALYTICS_CONSENT_EVENT, denyAnalyticsConsent, grantAnalyticsConsent } from '@/integrations/firebase/config';

/**
 * THE ANALYTICS TOGGLE, AND THE SENTENCE THAT HAS TO SIT BESIDE IT.
 *
 * This component renders in three places: `pages/Profile.tsx`,
 * `components/account/ProfilePhone.tsx`, and above the privacy policy in
 * `components/LegalDocument.tsx`. Since 2026-09-11 it is the ONLY analytics
 * control surface in the iOS app: App Store guideline 5.1.2(i) rejected
 * build 17 over the web cookie banner, and `App.tsx` no longer mounts that
 * banner in a native build.
 *
 * WHICH IS WHY THE DISCLOSURE IS IN THE BINARY. With the banner gone,
 * nothing else tells an iOS user what is collected or that it is off by
 * default, and "we removed the prompt" is only a defensible answer to App
 * Review if the information the prompt carried still reaches the user
 * somewhere. It is rendered here rather than linked to, because a
 * disclosure behind a tap is a disclosure most people never read.
 *
 * It also fixes the order of operations for later: the native analytics
 * default must NOT be flipped on through remote config until this sentence
 * has shipped in a binary. A config flag that quietly starts collecting data
 * users were never told about is a compliance problem rather than an Apple
 * one. With the disclosure in the build, changing the default later is
 * legitimate; without it, it is not.
 */
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
    <div className="rounded-xl p-3 text-sm">
      <label className="flex items-center justify-between gap-4">
        <span>Optional usage analytics</span>
        <input type="checkbox" checked={enabled} onChange={(event) => {
          const next = event.target.checked;
          if (next) grantAnalyticsConsent(); else denyAnalyticsConsent();
          setEnabled(next);
        }} aria-label="Optional usage analytics" className="h-5 w-5 accent-green-700" />
      </label>
      <p className="mt-2 text-xs leading-relaxed opacity-70">
        Citrus collects anonymous usage data to understand which features are used and to
        find problems. It is first-party analytics: nothing is shared with advertisers or
        data brokers, and it is never linked to data from other apps. It is off unless you
        turn it on here.
      </p>
    </div>
  );
}
