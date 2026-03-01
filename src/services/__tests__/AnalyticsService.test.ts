import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock firebase/analytics
// =============================================================================

const mockLogEvent = vi.fn();
const mockSetUserId = vi.fn();
const mockSetUserProperties = vi.fn();
const mockGetAnalyticsInstance = vi.fn();

vi.mock('firebase/analytics', () => ({
  logEvent: (...args: unknown[]) => mockLogEvent(...args),
  setUserId: (...args: unknown[]) => mockSetUserId(...args),
  setUserProperties: (...args: unknown[]) => mockSetUserProperties(...args),
}));

vi.mock('@/integrations/firebase/config', () => ({
  getAnalyticsInstance: () => mockGetAnalyticsInstance(),
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// =============================================================================
// Import after mocks
// =============================================================================

import { analyticsService } from '../AnalyticsService';
import { logger } from '@/utils/logger';

// =============================================================================
// Tests
// =============================================================================

describe('AnalyticsService', () => {
  const fakeAnalytics = { app: 'test' };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: analytics is available
    mockGetAnalyticsInstance.mockReturnValue(fakeAnalytics);
    // Ensure window is defined (jsdom env)
  });

  // ---------------------------------------------------------------------------
  // logEvent
  // ---------------------------------------------------------------------------
  describe('logEvent', () => {
    it('calls firebase logEvent with correct arguments', () => {
      analyticsService.logEvent('test_event', { key: 'value' });

      expect(mockLogEvent).toHaveBeenCalledWith(fakeAnalytics, 'test_event', { key: 'value' });
    });

    it('does nothing when analytics is null', () => {
      mockGetAnalyticsInstance.mockReturnValue(null);

      analyticsService.logEvent('test_event');

      expect(mockLogEvent).not.toHaveBeenCalled();
    });

    it('catches errors silently and logs them', () => {
      mockLogEvent.mockImplementation(() => {
        throw new Error('firebase error');
      });

      // Should not throw
      analyticsService.logEvent('test_event');

      expect(logger.error).toHaveBeenCalledWith('Analytics error:', expect.any(Error));
    });

    it('does not pass parameters when none provided', () => {
      analyticsService.logEvent('simple_event');

      expect(mockLogEvent).toHaveBeenCalledWith(fakeAnalytics, 'simple_event', undefined);
    });
  });

  // ---------------------------------------------------------------------------
  // setUserId
  // ---------------------------------------------------------------------------
  describe('setUserId', () => {
    it('calls firebase setUserId with correct arguments', () => {
      analyticsService.setUserId('user-123');

      expect(mockSetUserId).toHaveBeenCalledWith(fakeAnalytics, 'user-123');
    });

    it('does nothing when userId is null', () => {
      analyticsService.setUserId(null);

      expect(mockSetUserId).not.toHaveBeenCalled();
    });

    it('does nothing when analytics is null', () => {
      mockGetAnalyticsInstance.mockReturnValue(null);

      analyticsService.setUserId('user-123');

      expect(mockSetUserId).not.toHaveBeenCalled();
    });

    it('catches errors and logs them', () => {
      mockSetUserId.mockImplementation(() => {
        throw new Error('setUserId error');
      });

      analyticsService.setUserId('user-123');

      expect(logger.error).toHaveBeenCalledWith('Analytics setUserId error:', expect.any(Error));
    });
  });

  // ---------------------------------------------------------------------------
  // setUserProperties
  // ---------------------------------------------------------------------------
  describe('setUserProperties', () => {
    it('calls firebase setUserProperties with correct arguments', () => {
      analyticsService.setUserProperties({ plan: 'pro', source: 'web' });

      expect(mockSetUserProperties).toHaveBeenCalledWith(fakeAnalytics, { plan: 'pro', source: 'web' });
    });

    it('does nothing when analytics is null', () => {
      mockGetAnalyticsInstance.mockReturnValue(null);

      analyticsService.setUserProperties({ plan: 'free' });

      expect(mockSetUserProperties).not.toHaveBeenCalled();
    });

    it('catches errors and logs them', () => {
      mockSetUserProperties.mockImplementation(() => {
        throw new Error('properties error');
      });

      analyticsService.setUserProperties({ plan: 'pro' });

      expect(logger.error).toHaveBeenCalledWith('Analytics setUserProperties error:', expect.any(Error));
    });
  });

  // ---------------------------------------------------------------------------
  // logPageView
  // ---------------------------------------------------------------------------
  describe('logPageView', () => {
    it('logs page_view event with page_name and provided path', () => {
      analyticsService.logPageView('Dashboard', '/dashboard');

      expect(mockLogEvent).toHaveBeenCalledWith(fakeAnalytics, 'page_view', {
        page_name: 'Dashboard',
        page_path: '/dashboard',
      });
    });

    it('defaults page_path to window.location.pathname when not provided', () => {
      // jsdom default pathname is '/'
      analyticsService.logPageView('Home');

      expect(mockLogEvent).toHaveBeenCalledWith(fakeAnalytics, 'page_view', {
        page_name: 'Home',
        page_path: window.location.pathname,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // logUserAction
  // ---------------------------------------------------------------------------
  describe('logUserAction', () => {
    it('logs user_action event with action name', () => {
      analyticsService.logUserAction('click_button', { button: 'save' });

      expect(mockLogEvent).toHaveBeenCalledWith(fakeAnalytics, 'user_action', {
        action: 'click_button',
        button: 'save',
      });
    });

    it('works without details', () => {
      analyticsService.logUserAction('logout');

      expect(mockLogEvent).toHaveBeenCalledWith(fakeAnalytics, 'user_action', {
        action: 'logout',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // logDraftEvent
  // ---------------------------------------------------------------------------
  describe('logDraftEvent', () => {
    it('logs draft_event with event_type', () => {
      analyticsService.logDraftEvent('pick_made', { round: 1 });

      expect(mockLogEvent).toHaveBeenCalledWith(fakeAnalytics, 'draft_event', {
        event_type: 'pick_made',
        round: 1,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // logLeagueEvent
  // ---------------------------------------------------------------------------
  describe('logLeagueEvent', () => {
    it('logs league_event with event_type and league_id', () => {
      analyticsService.logLeagueEvent('league_created', 'league-abc', { size: 10 });

      expect(mockLogEvent).toHaveBeenCalledWith(fakeAnalytics, 'league_event', {
        event_type: 'league_created',
        league_id: 'league-abc',
        size: 10,
      });
    });

    it('defaults league_id to empty string when not provided', () => {
      analyticsService.logLeagueEvent('league_joined');

      expect(mockLogEvent).toHaveBeenCalledWith(fakeAnalytics, 'league_event', {
        event_type: 'league_joined',
        league_id: '',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // logRosterEvent
  // ---------------------------------------------------------------------------
  describe('logRosterEvent', () => {
    it('logs roster_event with event_type', () => {
      analyticsService.logRosterEvent('lineup_saved', { changes: 3 });

      expect(mockLogEvent).toHaveBeenCalledWith(fakeAnalytics, 'roster_event', {
        event_type: 'lineup_saved',
        changes: 3,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // logMatchupEvent
  // ---------------------------------------------------------------------------
  describe('logMatchupEvent', () => {
    it('logs matchup_event with event_type', () => {
      analyticsService.logMatchupEvent('matchup_viewed', { week: 5 });

      expect(mockLogEvent).toHaveBeenCalledWith(fakeAnalytics, 'matchup_event', {
        event_type: 'matchup_viewed',
        week: 5,
      });
    });
  });
});
