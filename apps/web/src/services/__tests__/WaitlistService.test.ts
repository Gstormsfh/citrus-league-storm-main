import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock Supabase client
// =============================================================================

function createChainMock() {
  const chain: Record<string, any> = {};
  const chainMethods = ['select', 'insert', 'update', 'delete', 'eq', 'is', 'in', 'order', 'limit', 'filter'];
  chainMethods.forEach(m => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  return chain;
}

let defaultChain = createChainMock();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => defaultChain),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'mock-token' } } }),
    },
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
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/utils/logger';

// =============================================================================
// Tests
// =============================================================================

describe('WaitlistService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultChain = createChainMock();
    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(defaultChain);
  });

  // ---------------------------------------------------------------------------
  // addToWaitlist
  // ---------------------------------------------------------------------------
  describe('addToWaitlist', () => {
    it('validates email format and rejects invalid emails', async () => {
      const result = await WaitlistService.addToWaitlist('not-an-email');

      expect(result.success).toBe(false);
      expect(result.message).toContain('valid email');
      expect(supabase.from).not.toHaveBeenCalled();
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

    it('inserts valid email into waitlist table', async () => {
      defaultChain.insert.mockResolvedValue({ error: null });

      const result = await WaitlistService.addToWaitlist('user@example.com');

      expect(supabase.from).toHaveBeenCalledWith('waitlist');
      expect(defaultChain.insert).toHaveBeenCalledWith({
        email: 'user@example.com',
        source: 'landing_page',
        user_agent: expect.any(String),
      });
      expect(result.success).toBe(true);
      expect(result.message).toContain('Successfully added');
    });

    it('normalizes email to lowercase and trims whitespace', async () => {
      defaultChain.insert.mockResolvedValue({ error: null });

      // Note: the regex validation rejects leading/trailing spaces,
      // so we test with a valid email that has mixed case
      await WaitlistService.addToWaitlist('User@Example.COM');

      expect(defaultChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'user@example.com',
        })
      );
    });

    it('uses provided source parameter', async () => {
      defaultChain.insert.mockResolvedValue({ error: null });

      await WaitlistService.addToWaitlist('user@example.com', 'hero_section');

      expect(defaultChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'hero_section',
        })
      );
    });

    it('defaults source to landing_page when not provided', async () => {
      defaultChain.insert.mockResolvedValue({ error: null });

      await WaitlistService.addToWaitlist('user@example.com');

      expect(defaultChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'landing_page',
        })
      );
    });

    it('returns specific message for duplicate email (code 23505)', async () => {
      defaultChain.insert.mockResolvedValue({
        error: { code: '23505', message: 'unique constraint violation' },
      });

      const result = await WaitlistService.addToWaitlist('existing@example.com');

      expect(result.success).toBe(false);
      expect(result.message).toContain('already on the waitlist');
    });

    it('returns specific message for duplicate email (message contains "duplicate")', async () => {
      defaultChain.insert.mockResolvedValue({
        error: { code: 'other', message: 'duplicate key value violates unique constraint' },
      });

      const result = await WaitlistService.addToWaitlist('existing@example.com');

      expect(result.success).toBe(false);
      expect(result.message).toContain('already on the waitlist');
    });

    it('returns generic error for non-duplicate insert failures', async () => {
      defaultChain.insert.mockResolvedValue({
        error: { code: '42P01', message: 'table not found' },
      });

      const result = await WaitlistService.addToWaitlist('user@example.com');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to add email');
      expect(logger.error).toHaveBeenCalled();
    });

    it('catches unexpected exceptions', async () => {
      (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Unexpected failure');
      });

      const result = await WaitlistService.addToWaitlist('user@example.com');

      expect(result.success).toBe(false);
      expect(result.message).toContain('unexpected error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // isEmailInWaitlist
  // ---------------------------------------------------------------------------
  describe('isEmailInWaitlist', () => {
    it('always returns false (relies on insert error for duplicate detection)', async () => {
      const result = await WaitlistService.isEmailInWaitlist('user@example.com');

      expect(result).toBe(false);
    });
  });
});
