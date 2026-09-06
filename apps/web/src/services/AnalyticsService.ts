// Analytics Service - Centralized Firebase Analytics tracking
import { getAnalyticsInstance } from '@/integrations/firebase/config';
import { logEvent, setUserId, setUserProperties } from 'firebase/analytics';
import { logger } from '@/utils/logger';

interface AnalyticsEvent {
  name: string;
  parameters?: Record<string, string | number | boolean>;
}

class AnalyticsService {
  private getAnalytics() {
    return getAnalyticsInstance();
  }

  private isEnabled(): boolean {
    const analytics = this.getAnalytics();
    return analytics !== null && typeof window !== 'undefined';
  }

  /**
   * Log a custom event
   */
  logEvent(eventName: string, parameters?: Record<string, string | number | boolean>): void {
    const analytics = this.getAnalytics();
    if (!analytics || !this.isEnabled()) return;

    try {
      logEvent(analytics, eventName, parameters);
    } catch (error) {
      // Silently fail - analytics should never break the app
      logger.error('Analytics error:', error);
    }
  }

  /**
   * Set user ID for analytics
   */
  setUserId(userId: string | null): void {
    const analytics = this.getAnalytics();
    if (!analytics || !this.isEnabled()) return;

    try {
      setUserId(analytics, userId);
    } catch (error) {
      logger.error('Analytics setUserId error:', error);
    }
  }

  /**
   * Set user properties
   */
  setUserProperties(properties: Record<string, string>): void {
    const analytics = this.getAnalytics();
    if (!analytics || !this.isEnabled()) return;

    try {
      setUserProperties(analytics, properties);
    } catch (error) {
      logger.error('Analytics setUserProperties error:', error);
    }
  }

  /**
   * Track page views
   */
  logPageView(pageName: string, pagePath?: string): void {
    this.logEvent('page_view', {
      page_name: pageName,
      page_path: pagePath || window.location.pathname,
    });
  }

  /**
   * Track user actions
   */
  logUserAction(action: string, details?: Record<string, string | number | boolean>): void {
    this.logEvent('user_action', {
      action,
      ...details,
    });
  }

  /**
   * Track draft events
   */
  logDraftEvent(eventType: string, details?: Record<string, string | number | boolean>): void {
    this.logEvent('draft_event', {
      event_type: eventType,
      ...details,
    });
  }

  /**
   * Track league events
   */
  logLeagueEvent(eventType: string, leagueId?: string, details?: Record<string, string | number | boolean>): void {
    this.logEvent('league_event', {
      event_type: eventType,
      league_id: leagueId || '',
      ...details,
    });
  }

  /**
   * Track roster events
   */
  logRosterEvent(eventType: string, details?: Record<string, string | number | boolean>): void {
    this.logEvent('roster_event', {
      event_type: eventType,
      ...details,
    });
  }

  /**
   * Track matchup events
   */
  logMatchupEvent(eventType: string, details?: Record<string, string | number | boolean>): void {
    this.logEvent('matchup_event', {
      event_type: eventType,
      ...details,
    });
  }
}

export const analyticsService = new AnalyticsService();
export default analyticsService;
