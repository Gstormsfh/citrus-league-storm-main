import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock API client
// =============================================================================

const mockPost = vi.fn();

vi.mock('@/api/client', () => ({
  apiClient: {
    post: (...args: unknown[]) => mockPost(...args),
  },
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

import { WaitlistService } from '../WaitlistService';
import { logger } from '@/utils/logger';

// =============================================================================
// Tests
// =============================================================================

describe('WaitlistService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // addToWaitlist
  // ---------------------------------------------------------------------------
  describe('addToWaitlist', () => {
    it('validates email format and rejects invalid emails', async () => {
      const result = await WaitlistService.addToWaitlist('not-an-email');

      expect(result.success).toBe(false);
      expect(result.message).toContain('valid email');
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('rejects empty string', async () => {
      const result = await WaitlistService.addToWaitlist('');

      expect(result.success).toBe(false);
      expect(result.message).toContain('valid email');
    });

    it('rejects email without domain', async () => {
      const result = await WaitlistService.addToWaitlist('user@');

      expect(result.success).toBe(false);
    });

    it('posts valid email to the API waitlist endpoint', async () => {
      mockPost.mockResolvedValue({
        data: { success: true, message: 'Successfully added to waitlist!' },
      });

      const result = await WaitlistService.addToWaitlist('user@example.com');

      expect(mockPost).toHaveBeenCalledWith('/api/public/waitlist', {
        email: 'user@example.com',
        source: 'landing_page',
      });
      expect(result.success).toBe(true);
      expect(result.message).toContain('Successfully added');
    });

    it('normalizes email to lowercase and trims whitespace', async () => {
      mockPost.mockResolvedValue({
        data: { success: true, message: 'Successfully added to waitlist!' },
      });

      await WaitlistService.addToWaitlist('User@Example.COM');

      expect(mockPost).toHaveBeenCalledWith('/api/public/waitlist', expect.objectContaining({
        email: 'user@example.com',
      }));
    });

    it('uses provided source parameter', async () => {
      mockPost.mockResolvedValue({
        data: { success: true, message: 'OK' },
      });

      await WaitlistService.addToWaitlist('user@example.com', 'hero_section');

      expect(mockPost).toHaveBeenCalledWith('/api/public/waitlist', expect.objectContaining({
        source: 'hero_section',
      }));
    });

    it('defaults source to landing_page when not provided', async () => {
      mockPost.mockResolvedValue({
        data: { success: true, message: 'OK' },
      });

      await WaitlistService.addToWaitlist('user@example.com');

      expect(mockPost).toHaveBeenCalledWith('/api/public/waitlist', expect.objectContaining({
        source: 'landing_page',
      }));
    });

    it('returns success with default message when API returns no data', async () => {
      mockPost.mockResolvedValue({ data: undefined });

      const result = await WaitlistService.addToWaitlist('user@example.com');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Successfully added');
    });

    it('returns error message from API when call fails', async () => {
      mockPost.mockRejectedValue(new Error('Duplicate email'));

      const result = await WaitlistService.addToWaitlist('existing@example.com');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Duplicate email');
      expect(logger.error).toHaveBeenCalled();
    });

    it('catches unexpected exceptions', async () => {
      mockPost.mockRejectedValue(new Error('Unexpected failure'));

      const result = await WaitlistService.addToWaitlist('user@example.com');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Unexpected failure');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // isEmailInWaitlist
  // ---------------------------------------------------------------------------
  describe('isEmailInWaitlist', () => {
    it('always returns false (relies on server-side duplicate detection)', async () => {
      const result = await WaitlistService.isEmailInWaitlist('user@example.com');

      expect(result).toBe(false);
    });
  });
});
