import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { registerPushTapListener } from '@/lib/pushNotifications';
import { logger } from '@/utils/logger';

/**
 * Routes a tapped draft-turn notification into the right draft room.
 *
 * Lives inside BrowserRouter (alongside ScrollToTop) because it needs
 * `useNavigate`. Renders nothing — it exists purely for the effect.
 *
 * In every browser `registerPushTapListener` returns a no-op immediately
 * (Capacitor.isNativePlatform() is false), so the web app is untouched. The
 * returned unsubscriber is the effect cleanup, which is what stops StrictMode's
 * double-mount from stacking two listeners and navigating twice on one tap.
 */
const PushDeepLink = () => {
  const navigate = useNavigate();

  useEffect(
    () =>
      registerPushTapListener(
        (path) => navigate(path),
        (msg) => logger.warn('[Push] ' + msg),
      ),
    [navigate],
  );

  return null;
};

export default PushDeepLink;
