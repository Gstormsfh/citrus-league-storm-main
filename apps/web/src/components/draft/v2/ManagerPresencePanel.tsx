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
    <div
      className="rounded border border-border p-3 bg-card"
      data-testid="manager-presence-panel"
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        Managers
      </div>
      <div className="text-sm mb-2" data-testid="manager-presence-count">
        {connectedCount} of {ownedTeams.length} connected
      </div>
      <ul className="space-y-1">
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
              className="flex items-center gap-2 text-sm"
              data-testid="manager-presence-row"
              data-team-id={t.id}
            >
              <PresenceDot userId={t.owner_id ?? null} />
              <span className="flex-1 truncate">{t.team_name}</span>
              <span className="text-xs text-muted-foreground">
                {statusLabel}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
