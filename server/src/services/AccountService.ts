import { SupabaseClient } from '@supabase/supabase-js';

export class AccountService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async exportUserData() {
    const { data, error } = await this.supabase.rpc('export_user_data');
    if (error) return { success: false, error: error.message };
    const result = data as Record<string, unknown>;
    if (result && result.success === false) return { success: false, error: (result.error as string) || 'Export failed' };
    return { success: true, data: result };
  }

  async deleteAccount() {
    const { data, error } = await this.supabase.rpc('delete_user_account');
    if (error) return { success: false, error: error.message };
    const result = data as Record<string, unknown>;
    if (result && result.success === false) return { success: false, error: (result.error as string) || 'Deletion failed' };
    return { success: true };
  }

  async recordConsent(policyType: string, version: string) {
    await this.supabase.rpc('record_user_consent', { p_policy_type: policyType, p_version: version });
    return { success: true };
  }

  async logSecurityEvent(eventType: string, leagueId: string | null, details: Record<string, unknown>, severity: string = 'INFO') {
    await this.supabase.rpc('log_security_event', {
      p_event_type: eventType, p_league_id: leagueId || null,
      p_details: details || {}, p_severity: severity,
    });
    return { success: true };
  }
}
