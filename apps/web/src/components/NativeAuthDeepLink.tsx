import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { registerNativeRecoveryListener } from '@/lib/nativeAuth';
import { logger } from '@/utils/logger';

/**
 * Lands a password-recovery deep link on the reset form.
 *
 * Lives inside BrowserRouter (alongside ScrollToTop and PushDeepLink) because
 * it needs `useNavigate`. AuthProvider — where the OAuth callback listener is
 * registered — is mounted OUTSIDE the router in App.tsx and has no navigate to
 * give, which is the whole reason recovery is handled here instead of there.
 *
 * The split is safe: that listener matches `citrussports://auth-callback` and
 * this one `citrussports://reset-password`, so a given URL wakes exactly one
 * of them.
 *
 * Renders nothing — it exists purely for the effect. In every browser
 * `registerNativeRecoveryListener` returns a no-op immediately
 * (Capacitor.isNativePlatform() is false), so the web app is untouched. The
 * returned unsubscriber is the effect cleanup, which stops StrictMode's
 * double-mount from stacking two listeners and exchanging one code twice.
 */
const NativeAuthDeepLink = () => {
  const navigate = useNavigate();

  useEffect(
    () =>
      registerNativeRecoveryListener(
        supabase,
        (path) => navigate(path),
        (msg) => logger.error('[Auth] native recovery callback failed: ' + msg),
      ),
    [navigate],
  );

  return null;
};

export default NativeAuthDeepLink;
