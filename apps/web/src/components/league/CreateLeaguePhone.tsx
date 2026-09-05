/**
 * CREATE OR JOIN A LEAGUE, THE PHONE (PR10o, 2026-09-04).
 *
 * The settings screen's shape for a league that does not exist yet:
 * CREATE · JOIN segmented at the top, a chip row of sections, groups of
 * rows with the value on the right and the rule underneath, a callout
 * where one is due, and the orange bar at the foot that does the thing.
 * Every row is a `SettingField` from `createLeagueSections.ts`; this file
 * knows nothing about keepers or FAAB.
 *
 * JOIN is two typed rows, the three things to check first, and the bar.
 * The clipboard copy the desktop draws beside the code is not here: on a
 * phone the code arrived by link or by paste, and copying it back out is
 * the share sheet's job on the league page.
 */
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { BOTTOM_CHROME_H } from '@/components/pressbox/chromeMetrics';
import { PressBoxChips } from '@/components/pressbox/Chips';
import { PressBoxSegmented } from '@/components/pressbox/Segmented';
import { PressBoxSettingGroup, PressBoxCallout, PressBoxTextRow } from '@/components/pressbox/Settings';
import type { SettingSection } from './leagueSettingsSections';
import { SettingFieldRows, SettingPicker, type SettingPickerState } from './SettingFields';

export interface CreateLeaguePhoneProps {
  tab: 'create' | 'join';
  onTabChange: (tab: 'create' | 'join') => void;
  sections: SettingSection[];
  /** The one line the page has to say, when it has one. */
  error?: string | null;
  /** The guest banner, when the page is in demo. */
  banner?: React.ReactNode;
  loading: boolean;
  canCreate: boolean;
  onCreate: () => void;
  joinCode: string;
  onJoinCode: (v: string) => void;
  teamName: string;
  onTeamName: (v: string) => void;
  canJoin: boolean;
  onJoin: () => void;
  onCancelJoin: () => void;
  className?: string;
}

/** The foot bar sticks just above the app chrome; a spacer after it clears the chrome at the end. */
const BAR = 'sticky z-sticky-base flex-none px-3.5 py-2.5 border-t border-white/[0.06] bg-pressbox-surface';
const ABOVE_CHROME = { bottom: `calc(${BOTTOM_CHROME_H}px + env(safe-area-inset-bottom))` } as const;
const PRIMARY =
  'focus-citrus w-full h-11 rounded-[10px] bg-pressbox-orange text-pressbox-orange-ink font-condensed font-bold text-[15px] uppercase tracking-[0.06em] disabled:opacity-40';
const SECONDARY =
  'focus-citrus w-full h-11 rounded-[10px] border border-white/[0.12] bg-white/[0.03] text-pressbox-text/80 font-condensed font-bold text-[15px] uppercase tracking-[0.06em]';

export function CreateLeaguePhone({
  tab,
  onTabChange,
  sections,
  error,
  banner,
  loading,
  canCreate,
  onCreate,
  joinCode,
  onJoinCode,
  teamName,
  onTeamName,
  canJoin,
  onJoin,
  onCancelJoin,
  className,
}: CreateLeaguePhoneProps) {
  const [sectionKey, setSectionKey] = useState(sections[0]?.key ?? 'format');
  const [picker, setPicker] = useState<SettingPickerState>(null);
  // A section can vanish under you: switch the league type to a pool and
  // DRAFT is gone. Fall back to the first rather than to an empty pane.
  const section = sections.find((s) => s.key === sectionKey) ?? sections[0];
  const fields = section ? section.groups.flatMap((g) => g.fields) : [];
  const chipsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const active = chipsRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    active?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }, [section?.key]);

  return (
    <div
      className={cn(PB_TYPE, 'lg:hidden flex flex-col bg-pressbox-surface text-pressbox-text', className)}
      style={{ minHeight: 'calc(100dvh - env(safe-area-inset-top))' }}
      data-testid="create-league-phone"
    >
      <div className="px-3.5 pt-1">
        {banner && <div className="mb-3">{banner}</div>}
        <PressBoxSegmented
          label="Create or join"
          segments={[
            { key: 'create', label: 'CREATE' },
            { key: 'join', label: 'JOIN' },
          ]}
          activeKey={tab}
          onSelect={(k) => onTabChange(k as 'create' | 'join')}
        />
      </div>

      {tab === 'create' ? (
        <>
          <div ref={chipsRef} className="mt-2.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <PressBoxChips
              chips={sections.map((s) => ({ key: s.key, label: s.label }))}
              activeKey={section?.key ?? ''}
              onSelect={setSectionKey}
              label="League setup section"
              outlined
              className="w-max px-3.5"
            />
          </div>

          <div className="flex-1 px-3.5 pt-3.5 pb-4 flex flex-col gap-4" data-testid="create-league-phone-fields">
            {error && (
              <PressBoxCallout className="border-pressbox-grapefruit/40 bg-pressbox-grapefruit/[0.08]" role="alert">
                {error}
              </PressBoxCallout>
            )}
            {section?.groups.map((g) =>
              g.fields.length === 0 ? null : (
                <PressBoxSettingGroup key={g.key} label={g.label}>
                  <SettingFieldRows fields={g.fields} onPick={setPicker} />
                </PressBoxSettingGroup>
              ),
            )}
            {section?.callout && <PressBoxCallout>{section.callout}</PressBoxCallout>}
          </div>

          <div className={BAR} style={ABOVE_CHROME}>
            <button type="button" className={PRIMARY} onClick={onCreate} disabled={loading || !canCreate}>
              {loading ? 'Creating…' : 'Create league'}
            </button>
          </div>
          <div className="pb-app-chrome" aria-hidden="true" />
          <SettingPicker picker={picker} fields={fields} onClose={() => setPicker(null)} />
        </>
      ) : (
        <>
          <div className="flex-1 px-3.5 pt-3.5 pb-4 flex flex-col gap-4" data-testid="join-league-phone">
            {error && (
              <PressBoxCallout className="border-pressbox-grapefruit/40 bg-pressbox-grapefruit/[0.08]" role="alert">
                {error}
              </PressBoxCallout>
            )}
            <PressBoxSettingGroup label="THE INVITE">
              <PressBoxTextRow
                label="Join code"
                help="From your commissioner, or the invite link"
                value={joinCode}
                onChange={onJoinCode}
                placeholder="Paste the code"
              />
              <PressBoxTextRow
                label="Team name"
                help="Optional. Blank uses your default team name"
                value={teamName}
                onChange={onTeamName}
                placeholder="Ice Warriors"
                maxLength={40}
                last
              />
            </PressBoxSettingGroup>
            <PressBoxSettingGroup label="BEFORE YOU JOIN">
              <div className="rounded-[12px] bg-pressbox-tile border border-white/[0.08] px-3.5 py-3 space-y-1.5">
                {[
                  'Make sure you trust the commissioner',
                  'Check whether the draft has already happened',
                  'You can own one team a league',
                ].map((line) => (
                  <p key={line} className="flex gap-2 font-barlow text-[13px] leading-[1.45] text-pressbox-text/85">
                    <span className="text-pressbox-orange-soft" aria-hidden="true">▸</span>
                    {line}
                  </p>
                ))}
              </div>
            </PressBoxSettingGroup>
          </div>
          <div className={cn(BAR, 'flex gap-2')} style={ABOVE_CHROME}>
            <button type="button" className={cn(SECONDARY, 'flex-1')} onClick={onCancelJoin} disabled={loading}>
              Cancel
            </button>
            <button type="button" className={cn(PRIMARY, 'flex-[2]')} onClick={onJoin} disabled={loading || !canJoin}>
              {loading ? 'Joining…' : 'Join league'}
            </button>
          </div>
          <div className="pb-app-chrome" aria-hidden="true" />
        </>
      )}
    </div>
  );
}

export default CreateLeaguePhone;
