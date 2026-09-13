/** Current club evidence is separate from injury, fantasy ownership and the
 * team on which an immutable projection scenario was calculated. */
export function PlayerAffiliationDetails({ affiliation, projectionTeam }: {
  affiliation?: Record<string, unknown> | null;
  projectionTeam?: string | null;
}) {
  if (!affiliation) return null;
  const status = String(affiliation.status ?? 'unknown');
  if (affiliation.authority === 'nhl_roster_feed' && status === 'affiliated') return null;
  const team = typeof affiliation.team === 'string' ? affiliation.team : null;
  const labels: Record<string, string> = { affiliated: team ? `NHL organization: ${team}` : 'NHL affiliation unconfirmed',
    free_agent: 'NHL free agent', retired: 'Retired', non_nhl: 'No confirmed NHL contract', unknown: 'NHL affiliation unconfirmed' };
  return <div aria-label="Current club context" className="my-2 text-xs leading-relaxed text-pressbox-text/70">
    <strong>{labels[status] ?? labels.unknown}</strong>
    {typeof affiliation.organization === 'string' && <> · {affiliation.organization}</>}
    {typeof affiliation.as_of === 'string' && <> · Evidence dated {affiliation.as_of}</>}
    {typeof affiliation.reason === 'string' && <p>{affiliation.reason}</p>}
    {projectionTeam && projectionTeam !== team && <p>Retained projection scenario: {projectionTeam}. Current club evidence does not change its rates or workload.</p>}
  </div>;
}
