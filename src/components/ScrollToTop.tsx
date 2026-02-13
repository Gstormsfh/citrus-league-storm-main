import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { analyticsService } from '@/services/AnalyticsService';

/**
 * Scrolls to top on every route change and tracks page views.
 * Place inside <BrowserRouter> in App.tsx.
 */
const ScrollToTop = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
    
    // Track page view for analytics
    const pageName = pathname.split('/').filter(Boolean).join('_') || 'home';
    analyticsService.logPageView(pageName, pathname);
  }, [pathname]);

  return null;
};

export default ScrollToTop;
