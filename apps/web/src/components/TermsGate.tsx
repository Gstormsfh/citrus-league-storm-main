/**
 * THE TERMS GATE (2026-09-05). See lib/consent.ts for why it exists.
 *
 * Mounted once, app-wide, inside the providers. With a signed-in user it
 * reads the consent status once per user; when a policy is due it either
 * records silently (the signup form already accepted this exact version)
 * or shows one non-dismissable sheet: the two documents, one AGREE, and a
 * SIGN OUT for the manager who would rather not. A failed status read
 * shows nothing -- the app does not lock on a network error -- and the
 * Account screen still shows the truth.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { UserAccountService, type ConsentStatus } from '@/services/UserAccountService';
import { announceConsentChanged, clearSignupConsent, consentDue, readSignupConsent, signupCoversDue, termsGateSuppressed } from '@/lib/consent';
import { interceptExternal } from '@/lib/openExternal';
import { PressBoxSheet } from '@/components/pressbox/Sheet';
import { logger } from '@/utils/logger';

const POLICY_LABEL: Record<string, string> = {
  terms_of_service: 'Terms of Service',
  privacy_policy: 'Privacy Policy',
};
const POLICY_HREF: Record<string, string> = {
  terms_of_service: '/terms-of-service.html',
  privacy_policy: '/privacy-policy.html',
};

const PRIMARY =
  'focus-citrus w-full h-12 rounded-[12px] bg-pressbox-orange text-pressbox-orange-ink font-plex font-semibold text-[12px] tracking-[0.08em] uppercase disabled:opacity-50';
const SECONDARY =
  'focus-citrus w-full h-11 rounded-[12px] bg-transparent text-pressbox-text/60 font-plex font-semibold text-[12px] tracking-[0.06em] uppercase';

export function TermsGate() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [due, setDue] = useState<ConsentStatus[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setDue(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await UserAccountService.getConsentStatus();
      if (cancelled || !res.success || !res.data) return;
      const needed = consentDue(res.data);
      if (needed.length === 0) return;
      // The signup form's checkbox, kept for the session it could not
      // record into. Same version, no second ask.
      if (signupCoversDue(needed, readSignupConsent())) {
        const results = await Promise.all(
          needed.map((r) => UserAccountService.grantConsent(r.policy_type, r.required_version)),
        );
        if (cancelled) return;
        if (results.every((r) => r.success)) {
          clearSignupConsent();
          announceConsentChanged();
          return;
        }
        logger.warn('[TermsGate] signup consent could not be recorded; asking');
      }
      setDue(needed);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const agree = useCallback(async () => {
    if (!due) return;
    setBusy(true);
    setError(null);
    const results = await Promise.all(
      due.map((r) => UserAccountService.grantConsent(r.policy_type, r.required_version)),
    );
    setBusy(false);
    if (results.every((r) => r.success)) {
      clearSignupConsent();
      setDue(null);
      announceConsentChanged();
    } else {
      setError(results.find((r) => !r.success)?.error || 'Could not record your agreement. Try again.');
    }
  }, [due]);

  const leave = useCallback(async () => {
    setDue(null);
    await signOut();
    navigate('/auth', { replace: true });
  }, [signOut, navigate]);

  if (!user || !due || termsGateSuppressed(pathname)) return null;

  const updated = due.some((r) => r.status === 'outdated');
  const version = due[0]?.required_version;

  return (
    <PressBoxSheet
      open
      onOpenChange={() => {
        /* not dismissable: agreeing or signing out are the two ways out */
      }}
      title="Terms of Service and Privacy Policy"
      shape="bottom"
      className="lg:max-w-[480px] lg:mx-auto"
    >
      <div className="px-5 pt-5 pb-1" data-testid="terms-gate">
        <p className="font-plex font-semibold text-[9px] tracking-[0.14em] uppercase text-pressbox-orange-soft">
          {updated ? 'Updated terms' : 'Before you play'}
        </p>
        <h2 className="mt-1.5 font-condensed font-extrabold text-[24px] uppercase tracking-[0.02em] leading-none">
          {updated ? 'The terms have changed' : 'One thing to agree to'}
        </h2>
        <p className="mt-2.5 font-barlow text-[13px] leading-[1.45] text-pressbox-text/70">
          Citrus runs on the Terms of Service and the Privacy Policy
          {version ? ` (${version})` : ''}. Read them any time; agreeing here is what lets you draft, trade and play.
        </p>
        <ul className="mt-3 rounded-[12px] bg-pressbox-tile border border-white/[0.08] divide-y divide-white/[0.06]">
          {due.map((r) => (
            <li key={r.policy_type}>
              <a
                href={POLICY_HREF[r.policy_type] ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  if (interceptExternal(POLICY_HREF[r.policy_type] ?? '')) e.preventDefault();
                }}
                className="focus-citrus flex items-center justify-between min-h-[48px] px-3.5 font-barlow font-semibold text-[15px] text-pressbox-text"
              >
                {POLICY_LABEL[r.policy_type] ?? r.policy_type}
                <span className="font-plex font-semibold text-[10px] tracking-[0.08em] uppercase text-pressbox-orange-soft">Read ›</span>
              </a>
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="mt-3 font-barlow text-[12px] text-pressbox-grapefruit-text">
            {error}
          </p>
        )}
        <button type="button" className={`${PRIMARY} mt-4`} onClick={() => void agree()} disabled={busy} data-testid="terms-gate-agree">
          {busy ? 'Recording…' : 'I agree · continue'}
        </button>
        <button type="button" className={`${SECONDARY} mt-1`} onClick={() => void leave()} disabled={busy}>
          Sign out instead
        </button>
      </div>
    </PressBoxSheet>
  );
}

export default TermsGate;
