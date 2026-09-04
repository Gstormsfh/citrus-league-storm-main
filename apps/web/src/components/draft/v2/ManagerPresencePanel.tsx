// DR-4 (2026-07-30) — per-team manager presence panel.
//
// Renders one row per team: <PresenceDot /> team_name — status label.
// Fed by the fetched teams payload (which carries owner_id) so a team
// with no owner (harness slot, spectator) shows a neutral dot with
// no user-status text.
//
// Also renders a total-connected count at the top: "N of M managers
// connected" — the surface that would have caught the DR-1 count
// anomaly at first glance.

import { PresenceDot } from './PresenceDot';
import {
  usePresence,
  useObservedLeftUserIds,
} from '@/stores/draftClientStore';
import { computePresenceStatus } from './PresenceDot';

export interface ManagerPresencePanelTeam {
  id: string;
  team_name: string;
  owner_id?: string | null;
  owner_name?: string | null;
}

interface ManagerPresencePanelProps {
  teams: ReadonlyArray<ManagerPresencePanelTeam>;
}

export function ManagerPresencePanel({ teams }: ManagerPresencePanelProps) {
  const presentUserIds = usePresence();
  const observedLeftUserIds = useObservedLeftUserIds();

  const ownedTeams = teams.filter(
    (t) => typeof t.owner_id === 'string' && t.owner_id.length > 0,
  );
  const connectedCount = ownedTeams.filter((t) =>
    presentUserIds.has(t.owner_id as string),
  ).length;

  return (
    /* PRESS BOX (2026-09-04): the standings-table card — a #16241B tile at
       12px radius, an 8px mono column head, 11px mono rows — because a list
       of teams with one state each IS a standings table with one column.
       Every data-testid and every text node is what it was. */
    <div
      className="pb-type rounded-[12px] bg-pressbox-tile border border-white/[0.08] overflow-hidden"
      data-testid="manager-presence-panel"
    >
      <div className="flex items-center justify-between px-2.5 py-2 border-b border-white/[0.08] font-plex font-semibold text-[8px] tracking-[0.06em] text-pressbox-text/45">
        <span>MANAGERS</span>
        <span className="font-medium normal-case tracking-normal text-[9px]" data-testid="manager-presence-count">
          {connectedCount} of {ownedTeams.length} connected
        </span>
      </div>
      <ul>
        {teams.map((t) => {
          const status = computePresenceStatus(
            t.owner_id ?? null,
            presentUserIds,
            observedLeftUserIds,
          );
          const statusLabel =
            t.owner_id == null
              ? '-'
              : status === 'connected'
              ? 'connected'
              : status === 'away'
              ? 'away'
              : 'not connected';
          return (
            <li
              key={t.id}
              className="flex items-center gap-2 px-2.5 py-1.5 border-b border-white/[0.05] last:border-b-0 font-plex font-medium text-[11px]"
              data-testid="manager-presence-row"
              data-team-id={t.id}
            >
              <PresenceDot userId={t.owner_id ?? null} />
              <span className="flex-1 truncate font-barlow font-bold text-[13px] text-pressbox-text">{t.team_name}</span>
              <span className="text-[10px] text-pressbox-text/50">
                {statusLabel}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
