import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { analyticsService } from '@/services/AnalyticsService';
import { captureAcquisitionFromSearch } from '@/lib/acquisition';

/**
 * Scrolls to top on every route change and tracks page views.
 * Place inside <BrowserRouter> in App.tsx.
 */
const ScrollToTop = () => {
  const { pathname, search } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
    // Campaign attribution (2026-09-09): utm_source / ref on any URL.
    captureAcquisitionFromSearch(search, pathname);
    
    // Track page view for analytics
    const pageName = pathname.split('/').filter(Boolean).join('_') || 'home';
    analyticsService.logPageView(pageName, pathname);
  }, [pathname, search]);

  return null;
};

export default ScrollToTop;
