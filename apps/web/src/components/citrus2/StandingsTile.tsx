export interface StandingsTeam {
  rank: number;
  team: string;
  /** Fantasy record — W-L (no ties in fantasy) */
  record: string;
  pts?: number;
}

/**
 * Compact league standings list — used in hero composition + dashboard.
 * Fantasy records are W-L (no ties). NHL records would use W-L-OTL but those
 * aren't shown here (this tile is for fantasy leagues only).
 */
export function StandingsTile({
  leagueName,
  weekLabel = 'Week 12',
  members = 12,
  standings,
}: {
  leagueName: string;
  weekLabel?: string;
  members?: number;
  standings: StandingsTeam[];
}) {
  return (
    <div className="bg-pastel-surface-tile border border-white/10 rounded-2xl shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)] overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <div>
          <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/45 font-bold">
            {leagueName}
          </div>
          <div className="font-sans font-bold text-[15px] text-pastel-cream mt-0.5">{weekLabel} Standings</div>
        </div>
        <span className="font-jbmono text-[10px] text-pastel-sage tabular-nums">
          {members} managers
        </span>
      </div>
      <div className="divide-y divide-white/5">
        {standings.map((t) => (
          <div key={t.team} className="flex items-center gap-4 px-5 py-3 hover:bg-white/5 transition-colors">
            <span className={`font-sans font-black text-[14px] w-5 ${t.rank <= 3 ? 'text-pastel-orange' : 'text-white/45'}`}>
              {t.rank}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-sans font-semibold text-[14px] text-pastel-cream truncate">{t.team}</div>
              <div className="font-jbmono text-[10px] text-white/45 mt-0.5">{t.record}</div>
            </div>
            {t.pts !== undefined && (
              <span className="font-jbmono text-[14px] font-bold text-pastel-cream tabular-nums">
                {t.pts.toLocaleString()}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
