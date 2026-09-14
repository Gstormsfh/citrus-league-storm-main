-- =====================================================================
-- Yahoo OAuth: server-only storage for the refresh token
-- 2026-09-13
--
-- oauth_connections (20260914110100) records THAT a user connected Yahoo
-- and whether the connection is live. The refresh token itself lives here,
-- sealed with AES-256-GCM under a key only the API server holds
-- (YAHOO_TOKEN_ENCRYPTION_KEY, user id as additional authenticated data),
-- the same posture as apple_provider_tokens. Yahoo rotates refresh tokens on
-- every use, so each refresh re-seals the row. Access tokens live for an
-- hour and are never persisted anywhere.
--
-- Backup: additive. Rollback: drop table public.yahoo_provider_tokens; the audit
-- CHECK reverts to the 20260914110100 list.
-- =====================================================================

create table if not exists public.yahoo_provider_tokens (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  yahoo_guid   text not null,
  sealed_token text not null,
  updated_at   timestamptz not null default now()
);

alter table public.yahoo_provider_tokens enable row level security;
revoke all on public.yahoo_provider_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.yahoo_provider_tokens to service_role;

comment on table public.yahoo_provider_tokens is
  'AES-256-GCM sealed Yahoo refresh tokens; key held only by the API server. No client access. Re-sealed on every refresh because Yahoo rotates the token.';

-- ---------------------------------------------------------------------
-- Audit event types: connecting and disconnecting a platform account are
-- security events. DRAFT_OFFLINE_IMPORT has been in AuditService's union
-- since the offline draft shipped but never in this list, so its writes were
-- being rejected; it is added here because the list is being rewritten.
-- ---------------------------------------------------------------------

do $$ begin
  if to_regclass('public.security_audit_log') is not null then
    alter table public.security_audit_log drop constraint if exists security_audit_log_event_type_check;
    alter table public.security_audit_log add constraint security_audit_log_event_type_check check (event_type in (
      'AUTH_LOGIN', 'AUTH_LOGOUT', 'AUTH_FAILED',
      'LEAGUE_CREATE', 'LEAGUE_DELETE', 'LEAGUE_JOIN', 'LEAGUE_LEAVE',
      'DRAFT_START', 'DRAFT_COMPLETE', 'DRAFT_RESET', 'DRAFT_OFFLINE_IMPORT',
      'ROSTER_MOVE', 'ROSTER_MOVE_FAILED',
      'TRADE_OFFER', 'TRADE_ACCEPT', 'TRADE_REJECT',
      'WAIVER_CLAIM', 'WAIVER_PROCESS',
      'ADMIN_ACTION', 'SECURITY_VIOLATION',
      'RLS_BYPASS_ATTEMPT', 'DATA_EXPORT',
      'LEAGUE_HISTORY_IMPORT', 'LEAGUE_HISTORY_CLAIM', 'LEAGUE_HISTORY_MERGE', 'LEAGUE_HISTORY_LOCK',
      'OAUTH_CONNECTED', 'OAUTH_DISCONNECTED'
    ));
  end if;
end $$;
