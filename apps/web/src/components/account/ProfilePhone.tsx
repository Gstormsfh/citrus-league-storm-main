/**
 * THE ACCOUNT SCREEN, THE PHONE (PR10p, 2026-09-04)
 *
 * No artboard. The Profile page is four tabs of desktop cards -- personal
 * information, a season summary, a statistics wall, trophies, and a
 * settings tab that stacks eleven cards including a copy of the league
 * settings dialog -- and at 393 wide every one of them was a two-column
 * grid folded in half. The settings screen (artboard 1a) already draws a
 * fact, a value, a switch, an action and a typed field as one row each,
 * so the account is those rows: an avatar and a name over a chip row of
 * OVERVIEW · STATS · TROPHIES · SETTINGS, and groups of rows under it.
 *
 * Presentational. The page owns the state, the loads and the saves; every
 * handler here is the page's own. What is NOT drawn, and why:
 *  - the old "Email Notifications" switch: there is no email sender in the
 *    repo. The push switch IS drawn now (ALERTS): it writes
 *    profiles.push_notifications and PushService honours it.
 *  - the "Commissioner League Settings" card: a 340-line copy of League
 *    HQ's settings dialog. On a phone the commissioner's leagues are rows
 *    that open League HQ, where the Press Box settings screen already is.
 *  - the subscription card's four "(Free during Beta)" ticks: one fact row
 *    says the plan.
 */
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { PressBoxChips } from '@/components/pressbox/Chips';
import { PressBoxSheet } from '@/components/pressbox/Sheet';
import { PressBoxStatTiles } from '@/components/pressbox/PlayerCard';
import {
  PressBoxSettingGroup,
  PressBoxSettingRow,
  PressBoxTextRow,
  PressBoxCallout,
} from '@/components/pressbox/Settings';
import type { ConsentStatus } from '@/services/UserAccountService';

export type ProfileTab = 'overview' | 'stats' | 'achievements' | 'settings';

export interface ProfileStats {
  totalSeasons: number;
  championships: number;
  playoffAppearances: number;
  overallRecord: string;
  currentRank: number | null;
  totalPoints: number;
  avgPointsPerGame: number;
  wins: number;
  losses: number;
  ties: number;
  statsLoaded: boolean;
}

export interface ProfileIdentity {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
  bio: string;
}

export interface ProfilePhoneProps {
  tab: ProfileTab;
  onTabChange: (tab: ProfileTab) => void;
  hero: {
    avatarUrl?: string | null;
    initials: string;
    displayName: string;
    teamName: string;
    since: number;
    championships: number;
    uploading: boolean;
    onAvatarInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  };
  identity: ProfileIdentity & {
    editing: boolean;
    onEditing: (on: boolean) => void;
    onChange: (field: keyof ProfileIdentity, value: string) => void;
    onSave: () => void;
  };
  stats: ProfileStats;
  /** Always empty today; the page says so. Drawn so the day it is not, it is. */
  activity: Array<{ action: string; points?: string; date: string }>;
  achievements: Array<{ title: string; year?: string; description?: string }>;
  hasLeague: boolean;
  settings: {
    message: { type: 'success' | 'error'; text: string } | null;
    displayName: string;
    onDisplayName: (v: string) => void;
    canSaveDisplayName: boolean;
    savingDisplayName: boolean;
    onSaveDisplayName: () => void;
    email: string;
    newPassword: string;
    confirmPassword: string;
    onNewPassword: (v: string) => void;
    onConfirmPassword: (v: string) => void;
    changingPassword: boolean;
    onChangePassword: (e: React.FormEvent) => void;
    team: {
      name: string;
      abbr: string;
      slogan: string;
      onChange: (field: 'teamName' | 'teamAbbr' | 'teamDescription', value: string) => void;
      onSave: () => void;
    };
    commissionerLeagues: Array<{ id: string; name: string; draft_status: string }>;
    loadingLeagues: boolean;
    onResetDraft: (leagueId: string, leagueName: string) => void;
    /** League HQ, where the Press Box settings screen is. */
    onOpenLeague: (leagueId: string) => void;
    consent: {
      rows: ConsentStatus[];
      loading: boolean;
      error: string | null;
      busy: string | null;
      onGrant: (row: ConsentStatus) => void;
      onWithdraw: (row: ConsentStatus) => void;
      onRetry: () => void;
    };
    /** The on-the-clock push opt-in: the app's one push, stored on the profile. */
    pushEnabled: boolean;
    pushSaving: boolean;
    onPushToggle: (on: boolean) => void;
    exporting: boolean;
    onExport: () => void;
    deleteConfirmation: string;
    onDeleteConfirmation: (v: string) => void;
    deleting: boolean;
    onDelete: () => void;
  };
  className?: string;
}

const TABS: { key: ProfileTab; label: string }[] = [
  { key: 'overview', label: 'OVERVIEW' },
  { key: 'stats', label: 'STATS' },
  { key: 'achievements', label: 'TROPHIES' },
  { key: 'settings', label: 'SETTINGS' },
];

const CONSENT_LABEL: Record<ConsentStatus['status'], string> = {
  current: 'Active',
  outdated: 'Update needed',
  withdrawn: 'Withdrawn',
  never_given: 'Not recorded',
};
const CONSENT_HELP: Record<ConsentStatus['status'], string> = {
  current: 'You have accepted the current version',
  outdated: 'This policy has changed since you accepted it',
  withdrawn: 'You withdrew consent. You can grant it again at any time',
  never_given: 'No consent on record for this policy',
};
const prettyPolicy = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const EMPTY = 'py-8 text-center font-plex font-medium text-[10px] tracking-[0.06em] uppercase text-pressbox-text/45';
const PRIMARY =
  'focus-citrus w-full h-11 rounded-[10px] bg-pressbox-orange text-pressbox-orange-ink font-condensed font-bold text-[15px] uppercase tracking-[0.06em] disabled:opacity-40';
const SECONDARY =
  'focus-citrus w-full h-11 rounded-[10px] border border-white/[0.12] bg-white/[0.03] text-pressbox-text/80 font-condensed font-bold text-[15px] uppercase tracking-[0.06em] disabled:opacity-40';
const DANGER =
  'focus-citrus w-full h-11 rounded-[10px] bg-pressbox-grapefruit/[0.18] border border-pressbox-grapefruit/40 font-condensed font-bold text-[15px] uppercase tracking-[0.06em] text-pressbox-grapefruit-text disabled:opacity-40';

const or = (v: string) => (v.trim() ? v : 'Not set');

export function ProfilePhone({ tab, onTabChange, hero, identity, stats, activity, achievements, hasLeague, settings, className }: ProfilePhoneProps) {
  const avatarInput = useRef<HTMLInputElement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const games = stats.wins + stats.losses + stats.ties;
  const winRate = games > 0 ? Math.round((stats.wins / games) * 100) : null;

  return (
    <div className={cn(PB_TYPE, 'lg:hidden bg-pressbox-surface text-pressbox-text pb-app-chrome', className)} data-testid="profile-phone">
      {/* The hero: the face, the name, the team, since when. */}
      <div className="flex items-center gap-3 px-3.5 pt-2">
        <button
          type="button"
          onClick={() => avatarInput.current?.click()}
          aria-label={hero.uploading ? 'Uploading photo' : 'Change photo'}
          className="focus-citrus relative w-16 h-16 flex-none rounded-full overflow-hidden border-[1.5px] border-pressbox-orange/50 bg-pressbox-tile-high"
        >
          {hero.avatarUrl ? (
            <img src={hero.avatarUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="w-full h-full flex items-center justify-center font-condensed font-extrabold text-[22px] text-pressbox-orange-soft">
              {hero.initials}
            </span>
          )}
          <span className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-pressbox-surface border border-white/[0.12] flex items-center justify-center">
            {hero.uploading ? <Loader2 className="w-3 h-3 animate-spin text-pressbox-text" /> : <Camera className="w-3 h-3 text-pressbox-text" />}
          </span>
        </button>
        <input ref={avatarInput} type="file" accept="image/*" className="hidden" onChange={hero.onAvatarInput} />
        <div className="min-w-0">
          <h2 className="font-condensed font-extrabold text-[24px] uppercase tracking-[0.02em] leading-none truncate">{hero.displayName}</h2>
          <p className="mt-1.5 font-plex font-medium text-[10px] tracking-[0.06em] uppercase text-pressbox-text/45 truncate">
            {hero.teamName || 'No team yet'} · Since {hero.since}
          </p>
          {hero.championships > 0 && (
            <span className="mt-1.5 inline-block px-1.5 py-0.5 rounded-[4px] bg-pressbox-orange-soft/15 font-plex font-semibold text-[9px] tracking-[0.12em] text-pressbox-orange-soft">
              {hero.championships}× CHAMPION
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <PressBoxChips chips={TABS} activeKey={tab} onSelect={(k) => onTabChange(k as ProfileTab)} label="Account section" outlined className="w-max px-3.5" />
      </div>

      <div className="px-3.5 pt-3.5 flex flex-col gap-4">
        {tab === 'overview' && (
          <>
            <PressBoxSettingGroup label="THE SEASON">
              <PressBoxSettingRow label="Current rank" value={stats.currentRank != null ? `#${stats.currentRank}` : '–'} />
              <PressBoxSettingRow label="Championships" value={String(stats.championships)} />
              <PressBoxSettingRow label="Seasons" value={String(stats.totalSeasons)} />
              <PressBoxSettingRow label="Playoff appearances" value={String(stats.playoffAppearances)} />
              <PressBoxSettingRow label="Overall record" value={stats.overallRecord} last />
            </PressBoxSettingGroup>

            <PressBoxSettingGroup label={identity.editing ? 'ABOUT YOU · EDITING' : 'ABOUT YOU'}>
              {identity.editing ? (
                <>
                  <PressBoxTextRow label="First name" value={identity.firstName} onChange={(v) => identity.onChange('firstName', v)} />
                  <PressBoxTextRow label="Last name" value={identity.lastName} onChange={(v) => identity.onChange('lastName', v)} />
                  <PressBoxSettingRow label="Email" help="Set from your account" value={or(identity.email)} />
                  <PressBoxTextRow label="Phone" inputType="tel" value={identity.phone} onChange={(v) => identity.onChange('phone', v)} />
                  <PressBoxTextRow label="Location" value={identity.location} onChange={(v) => identity.onChange('location', v)} />
                  <PressBoxTextRow label="Bio" multiline value={identity.bio} onChange={(v) => identity.onChange('bio', v)} last />
                </>
              ) : (
                <>
                  <PressBoxSettingRow label="Name" value={or(`${identity.firstName} ${identity.lastName}`)} />
                  <PressBoxSettingRow label="Email" help="Set from your account" value={or(identity.email)} />
                  <PressBoxSettingRow label="Phone" value={or(identity.phone)} />
                  <PressBoxSettingRow label="Location" value={or(identity.location)} />
                  <PressBoxSettingRow label="Bio" help={identity.bio.trim() ? identity.bio : null} value={identity.bio.trim() ? '' : 'Not set'} />
                  <PressBoxSettingRow label="Edit your details" action={{ label: 'EDIT', onPress: () => identity.onEditing(true) }} last />
                </>
              )}
            </PressBoxSettingGroup>
            {identity.editing && (
              <div className="flex gap-2">
                <button type="button" className={cn(SECONDARY, 'flex-1')} onClick={() => identity.onEditing(false)}>
                  Cancel
                </button>
                <button type="button" className={cn(PRIMARY, 'flex-[2]')} onClick={identity.onSave}>
                  Save
                </button>
              </div>
            )}

            <PressBoxSettingGroup label="RECENT ACTIVITY">
              {activity.length === 0 ? (
                <p className={EMPTY}>{hasLeague ? 'Nothing yet this season' : 'Join a league to get started'}</p>
              ) : (
                activity.map((a, i) => (
                  <PressBoxSettingRow key={`${a.action}-${i}`} label={a.action} help={a.date} value={a.points ?? ''} last={i === activity.length - 1} />
                ))
              )}
            </PressBoxSettingGroup>
          </>
        )}

        {tab === 'stats' && (
          <>
            <PressBoxStatTiles
              tiles={[
                { key: 'leagues', label: 'LEAGUES', value: String(stats.totalSeasons) },
                // The record itself is three figures wide and wraps a tile; the rows below carry it.
                { key: 'winrate', label: 'WIN %', value: winRate !== null ? `${winRate}%` : '–' },
                { key: 'points', label: 'POINTS', value: stats.totalPoints.toLocaleString() },
                { key: 'avg', label: 'AVG · WK', value: stats.avgPointsPerGame ? String(stats.avgPointsPerGame) : '–' },
              ]}
            />
            <PressBoxSettingGroup label="PERFORMANCE · ALL LEAGUES">
              {!stats.statsLoaded ? (
                <p className={EMPTY}>Loading…</p>
              ) : stats.totalSeasons > 0 ? (
                <>
                  <PressBoxSettingRow label="Wins" value={String(stats.wins)} />
                  <PressBoxSettingRow label="Losses" value={String(stats.losses)} />
                  <PressBoxSettingRow label="Ties" value={String(stats.ties)} last={winRate === null} />
                  {winRate !== null && (
                    <div className="px-3.5 py-3">
                      <div className="flex items-center justify-between font-plex font-medium text-[9px] tracking-[0.1em] text-pressbox-text/45">
                        <span>WIN RATE</span>
                        <span className="text-pressbox-text">{winRate}%</span>
                      </div>
                      <div className="mt-1.5 h-[3px] rounded-[2px] bg-white/[0.08] overflow-hidden">
                        <div className="h-full bg-pressbox-sage" style={{ width: `${winRate}%` }} />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="px-3.5 py-6 text-center">
                  <p className="font-condensed font-bold text-[18px] uppercase tracking-[0.02em]">No history yet</p>
                  <p className="mt-1 font-barlow text-[13px] text-pressbox-text/60">
                    {hasLeague ? 'Finish a matchup week and it lands here.' : 'Join a league and finish a season; it lands here.'}
                  </p>
                  {!hasLeague && (
                    <Link to="/create-league" className={cn(PRIMARY, 'mt-4 inline-flex items-center justify-center')}>
                      Create or join a league
                    </Link>
                  )}
                </div>
              )}
            </PressBoxSettingGroup>
          </>
        )}

        {tab === 'achievements' && (
          <PressBoxSettingGroup label="TROPHY CASE">
            {achievements.length === 0 ? (
              <div className="px-3.5 py-6 text-center">
                <p className="font-condensed font-bold text-[18px] uppercase tracking-[0.02em]">Nothing on the shelf yet</p>
                <p className="mt-1 font-barlow text-[13px] text-pressbox-text/60">
                  {hasLeague ? 'Keep competing.' : 'Join a league and start competing.'}
                </p>
                {!hasLeague && (
                  <Link to="/create-league" className={cn(PRIMARY, 'mt-4 inline-flex items-center justify-center')}>
                    Create or join a league
                  </Link>
                )}
              </div>
            ) : (
              achievements.map((a, i) => (
                <PressBoxSettingRow key={a.title} label={a.title} help={a.description ?? null} value={a.year ?? ''} last={i === achievements.length - 1} />
              ))
            )}
          </PressBoxSettingGroup>
        )}

        {tab === 'settings' && (
          <>
            {settings.message && (
              <PressBoxCallout
                role={settings.message.type === 'error' ? 'alert' : undefined}
                className={
                  settings.message.type === 'success'
                    ? 'border-pressbox-sage/40 bg-pressbox-sage/[0.08]'
                    : 'border-pressbox-grapefruit/40 bg-pressbox-grapefruit/[0.08]'
                }
              >
                {settings.message.text}
              </PressBoxCallout>
            )}

            <PressBoxSettingGroup label="ACCOUNT">
              <PressBoxTextRow
                label="Display name"
                help="What other managers see"
                value={settings.displayName}
                onChange={settings.onDisplayName}
                placeholder="Choose a display name"
                maxLength={40}
              />
              <PressBoxSettingRow
                label="Save display name"
                action={{ label: settings.savingDisplayName ? 'SAVING…' : 'SAVE', onPress: settings.onSaveDisplayName, busy: settings.savingDisplayName || !settings.canSaveDisplayName }}
              />
              <PressBoxSettingRow label="Email" help="Set from your account" value={settings.email} />
              <PressBoxSettingRow label="Appearance" help="Rink-side dark, tuned for the whole app" value="Citrus Dark" last />
            </PressBoxSettingGroup>

            <form onSubmit={settings.onChangePassword}>
              <PressBoxSettingGroup label="PASSWORD">
                <PressBoxTextRow
                  label="New password"
                  help="At least 8 characters"
                  inputType="password"
                  autoComplete="new-password"
                  value={settings.newPassword}
                  onChange={settings.onNewPassword}
                  disabled={settings.changingPassword}
                />
                <PressBoxTextRow
                  label="Confirm"
                  inputType="password"
                  autoComplete="new-password"
                  value={settings.confirmPassword}
                  onChange={settings.onConfirmPassword}
                  disabled={settings.changingPassword}
                  last
                />
              </PressBoxSettingGroup>
              <button
                type="submit"
                className={cn(PRIMARY, 'mt-2')}
                disabled={settings.changingPassword || !settings.newPassword || !settings.confirmPassword}
              >
                {settings.changingPassword ? 'Updating…' : 'Update password'}
              </button>
            </form>

            <PressBoxSettingGroup label="YOUR TEAM">
              <PressBoxTextRow label="Team name" value={settings.team.name} onChange={(v) => settings.team.onChange('teamName', v)} maxLength={40} />
              <PressBoxTextRow label="Abbreviation" help="3 or 4 letters" value={settings.team.abbr} onChange={(v) => settings.team.onChange('teamAbbr', v)} maxLength={4} />
              <PressBoxTextRow label="Slogan" multiline value={settings.team.slogan} onChange={(v) => settings.team.onChange('teamDescription', v)} maxLength={140} />
              <PressBoxSettingRow label="Save team" action={{ label: 'SAVE', onPress: settings.team.onSave }} last />
            </PressBoxSettingGroup>

            {(settings.loadingLeagues || settings.commissionerLeagues.length > 0) && (
              <PressBoxSettingGroup label="YOU COMMISSION">
                {settings.loadingLeagues ? (
                  <p className={EMPTY}>Loading…</p>
                ) : (
                  settings.commissionerLeagues.map((l, i) => (
                    <div key={l.id}>
                      <PressBoxSettingRow
                        label={l.name}
                        help="Waivers, scoring, draft and rosters"
                        value="League HQ"
                        onPress={() => settings.onOpenLeague(l.id)}
                      />
                      <PressBoxSettingRow
                        label="Reset the draft"
                        help={`Draft ${l.draft_status.replace(/_/g, ' ')}. Every pick and the order, gone for good`}
                        action={{
                          label: 'RESET',
                          onPress: () => settings.onResetDraft(l.id, l.name),
                          busy: l.draft_status === 'not_started',
                        }}
                        last={i === settings.commissionerLeagues.length - 1}
                      />
                    </div>
                  ))
                )}
              </PressBoxSettingGroup>
            )}

            <PressBoxSettingGroup label="ALERTS">
              <PressBoxSettingRow
                label="On-the-clock push"
                help="A push the moment a draft pick is yours. iOS app only"
                checked={settings.pushEnabled}
                onToggle={settings.pushSaving ? undefined : settings.onPushToggle}
                last
              />
            </PressBoxSettingGroup>

            <PressBoxSettingGroup label="PRIVACY & CONSENT">
              {settings.consent.loading ? (
                <p className={EMPTY}>Loading your consent record…</p>
              ) : settings.consent.error ? (
                <PressBoxSettingRow
                  label="Could not load your consent record"
                  help={settings.consent.error}
                  action={{ label: 'TRY AGAIN', onPress: settings.consent.onRetry }}
                  last
                />
              ) : settings.consent.rows.length === 0 ? (
                <p className={EMPTY}>No policies are in force</p>
              ) : (
                settings.consent.rows.map((row, i) => {
                  const busy = settings.consent.busy === row.policy_type;
                  const withdraw = row.status === 'current';
                  const when = row.consented_at
                    ? `Accepted ${new Date(row.consented_at).toLocaleDateString()}${row.withdrawn_at ? ` · withdrawn ${new Date(row.withdrawn_at).toLocaleDateString()}` : ''}`
                    : null;
                  return (
                    <PressBoxSettingRow
                      key={row.policy_type}
                      label={`${prettyPolicy(row.policy_type)} · ${CONSENT_LABEL[row.status]}`}
                      help={[CONSENT_HELP[row.status], when].filter(Boolean).join('. ')}
                      action={{
                        label: busy ? 'WORKING…' : withdraw ? 'WITHDRAW' : 'ACCEPT',
                        onPress: () => (withdraw ? settings.consent.onWithdraw(row) : settings.consent.onGrant(row)),
                        busy,
                      }}
                      last={i === settings.consent.rows.length - 1}
                    />
                  );
                })
              )}
            </PressBoxSettingGroup>

            <PressBoxSettingGroup label="LEGAL & DATA">
              <PressBoxSettingRow label="Privacy policy" onPress={() => window.open('/privacy-policy.html', '_blank', 'noopener')} value="Open" />
              <PressBoxSettingRow label="Terms of service" onPress={() => window.open('/terms-of-service.html', '_blank', 'noopener')} value="Open" />
              <PressBoxSettingRow
                label="Export your data"
                help="A JSON file: profile, teams, leagues, transactions, drafts"
                action={{ label: settings.exporting ? 'EXPORTING…' : 'EXPORT', onPress: settings.onExport, busy: settings.exporting }}
              />
              <PressBoxSettingRow label="Plan" help="Everything is free during the beta" value="Free" last />
            </PressBoxSettingGroup>

            <PressBoxSettingGroup label="DANGER">
              <PressBoxSettingRow
                label="Delete account"
                help="Your account, teams and league data, permanently"
                action={{ label: 'DELETE…', onPress: () => setConfirmDelete(true) }}
                last
              />
            </PressBoxSettingGroup>

            <p className="pb-2 text-center font-plex font-medium text-[9px] tracking-[0.06em] uppercase text-pressbox-text/40">
              Need help?{' '}
              <a href="mailto:CitrusFantasySports@Gmail.com" className="text-pressbox-orange-soft">
                CitrusFantasySports@Gmail.com
              </a>
            </p>

            <PressBoxSheet open={confirmDelete} onOpenChange={(o) => { if (!o) { setConfirmDelete(false); settings.onDeleteConfirmation(''); } }} title="Delete account" shape="bottom">
              <div className="px-3.5 pt-3 pb-[max(env(safe-area-inset-bottom),22px)]" data-testid="delete-account-sheet">
                <p className="font-condensed font-bold text-[18px] uppercase tracking-[0.02em]">Delete your account?</p>
                <p className="mt-1.5 font-barlow text-[13px] leading-[1.45] text-pressbox-text/70">
                  Your account and sign-in are deleted for good. Your teams and league data go with them; leagues you commission
                  may be left without one; your draft history and transactions are anonymized. This cannot be undone.
                </p>
                <label className="block mt-4">
                  <span className="font-plex font-semibold text-[9px] tracking-[0.14em] text-pressbox-text/45">
                    TYPE <span className="text-pressbox-orange-soft">DELETE</span> TO CONFIRM
                  </span>
                  <input
                    type="text"
                    value={settings.deleteConfirmation}
                    onChange={(e) => settings.onDeleteConfirmation(e.target.value)}
                    placeholder="DELETE"
                    autoCapitalize="characters"
                    className="focus-citrus mt-1.5 w-full h-11 rounded-[8px] bg-white/[0.04] border border-white/[0.1] px-3 font-plex text-[15px] text-pressbox-text placeholder:text-pressbox-text/30"
                  />
                </label>
                <div className="mt-3 flex gap-2">
                  <button type="button" className={cn(SECONDARY, 'flex-1')} onClick={() => { setConfirmDelete(false); settings.onDeleteConfirmation(''); }}>
                    Keep it
                  </button>
                  <button
                    type="button"
                    className={cn(DANGER, 'flex-[2]')}
                    onClick={settings.onDelete}
                    disabled={settings.deleteConfirmation !== 'DELETE' || settings.deleting}
                  >
                    {settings.deleting ? 'Deleting…' : 'Delete account'}
                  </button>
                </div>
              </div>
            </PressBoxSheet>
          </>
        )}
      </div>
    </div>
  );
}

export default ProfilePhone;
