/**
 * Stormy AI API client — replaces direct edge function calls for Stormy chat.
 */

import { apiClient } from './client';

export const stormyApi = {
  /** Send a message to Stormy AI assistant */
  chat(params: {
    message: string;
    leagueId?: string;
    context?: Record<string, unknown>;
  }) {
    return apiClient.post('/api/stormy/chat', params);
  },
};
