import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { NHL_TEAMS, type NHLTeamInfo, formatCap, SALARY_CAP_2025_26 } from '@/types/captracker';
import { getAllTeamsCapSummary } from '@/services/NHLCapService';
import { Search, Shield, ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react';

/* 2026-08-19 visual audit — muted-text correction.
   text-citrus-charcoal is #5C5C5C, a soft charcoal designed for the
   original CREAM theme. At 20-70% opacity on the dark #1A2A20 tiles it
   composites to near-invisible (team codes on this page measured
   1.47:1). Remapped to cream at the alpha that preserves the intended
   hierarchy while clearing 4.5:1 on a dark tile. */


/* 2026-08-19 visual audit — surface correction.
   These panels used bg-white/55..80 ("frosted glass") on the #0F1F15
   dark page. Composited, that lands around rgb(159,165,161) — a MID-GREY
   dead zone where nothing reads: cream text measured 2.37:1 and the dark
   labels 1.58:1 against it. There is no text colour that fixes a
   mid-grey surface; the surface itself is the bug. Swapped to the dark
   tile family the rest of the app uses (ui/card.tsx is
   bg-pastel-surface-tile max-lg:bg-pressbox-tile + ring-white/10), so cream text lands at 13:1. */


interface TeamSelectorProps {
  selectedTeam: string | null;
  onSelectTeam: (abbrev: string) => void;
}

type SortKey = 'name' | 'capHit' | 'capSpace' | 'roster';
type SortDir = 'asc' | 'desc';

export default function TeamSelector({ selectedTeam, onSelectTeam }: TeamSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'division' | 'grid' | 'rankings'>('division');
  const [sortKey, setSortKey] = useState<SortKey>('capSpace');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const { data: capSummaries } = useQuery({
    queryKey: ['allTeamsCapSummary'],
    queryFn: getAllTeamsCapSummary,
    staleTime: 10 * 60 * 1000,
    enabled: viewMode === 'rankings',
  });

  const filteredTeams = searchQuery
    ? NHL_TEAMS.filter(
        (t) =>
          t.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.abbrev.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : NHL_TEAMS;

  const divisions = ['Atlantic', 'Metropolitan', 'Central', 'Pacific'];
  const teamsByDivision = divisions.map((div) => ({
    name: div,
    conference: div === 'Atlantic' || div === 'Metropolitan' ? 'Eastern' : 'Western',
    teams: filteredTeams.filter((t) => t.division === div),
  }));

  // Sorted rankings data
  const rankingsData = useMemo(() => {
    if (!capSummaries) return [];
    const filtered = searchQuery
      ? capSummaries.filter(t =>
          t.teamName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.teamAbbrev.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : capSummaries;

    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = a.teamName.localeCompare(b.teamName); break;
        case 'capHit': cmp = a.projectedCapHit - b.projectedCapHit; break;
        case 'capSpace': cmp = a.capSpace - b.capSpace; break;
        case 'roster': cmp = a.activeRosterSize - b.activeRosterSize; break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [capSummaries, searchQuery, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  return (
    <div className="space-y-4">
      {/* Search + View Toggle */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-pastel-cream/60 max-lg:text-pressbox-text/60" />
          <input
            type="text"
            placeholder="Search teams..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border-2 border-citrus-sage/30 bg-pastel-surface-tile max-lg:bg-pressbox-tile backdrop-blur-sm text-sm font-display max-lg:font-barlow text-pastel-cream max-lg:text-pressbox-text placeholder:text-pastel-cream/60 placeholder:max-lg:text-pressbox-text/60 focus:outline-none focus:border-citrus-sage focus:ring-2 focus:ring-citrus-sage/20 transition-all"
          />
        </div>
        <div className="flex rounded-xl border-2 border-citrus-sage/30 overflow-hidden">
          {(['division', 'grid', 'rankings'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={cn(
                "px-3 py-2 text-[10px] font-display max-lg:font-barlow font-bold uppercase tracking-wider transition-colors",
                viewMode === mode
                  ? "bg-citrus-sage text-pastel-forest"
                  : "bg-pastel-surface-tile max-lg:bg-pressbox-tile text-pastel-cream/70 max-lg:text-pressbox-text/70 hover:bg-citrus-sage/10"
              )}
            >
              {mode === 'division' ? 'Division' : mode === 'grid' ? 'All' : 'Rankings'}
            </button>
          ))}
        </div>
      </div>

      {/* Division View */}
      {viewMode === 'division' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {teamsByDivision.map((div) => (
            <div
              key={div.name}
              className="bg-pastel-surface-tile max-lg:bg-pressbox-tile backdrop-blur-sm rounded-2xl max-lg:rounded-[12px] border-2 border-citrus-sage/30 overflow-hidden"
            >
              <div className="px-4 py-2.5 bg-gradient-to-r from-citrus-sage/20 to-citrus-sage/10 border-b border-citrus-sage/30">
                <div className="flex items-center gap-2">
                  <span className="font-varsity max-lg:font-condensed text-sm text-pastel-cream max-lg:text-pressbox-text tracking-tight">
                    {div.name}
                  </span>
                  <span className="text-[9px] text-pastel-cream/65 max-lg:text-pressbox-text/65 font-display max-lg:font-barlow">
                    {div.conference}
                  </span>
                </div>
              </div>
              <div className="p-2 grid grid-cols-2 gap-1.5">
                {div.teams.map((team) => (
                  <TeamCard
                    key={team.abbrev}
                    team={team}
                    selected={selectedTeam === team.abbrev}
                    onClick={() => onSelectTeam(team.abbrev)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Grid View */}
      {viewMode === 'grid' && (
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
          {filteredTeams.map((team) => (
            <TeamCard
              key={team.abbrev}
              team={team}
              selected={selectedTeam === team.abbrev}
              onClick={() => onSelectTeam(team.abbrev)}
              compact
            />
          ))}
        </div>
      )}

      {/* Rankings Table View */}
      {viewMode === 'rankings' && (
        <div className="bg-pastel-surface-tile max-lg:bg-pressbox-tile backdrop-blur-sm rounded-2xl max-lg:rounded-[12px] border-2 border-citrus-sage/30 shadow-varsity overflow-hidden">
          <div className="px-4 py-2.5 bg-gradient-to-r from-citrus-sage/20 to-citrus-sage/10 border-b-2 border-citrus-sage/30 flex items-center justify-between">
            <span className="font-varsity max-lg:font-condensed text-sm text-pastel-cream max-lg:text-pressbox-text">League Cap Rankings</span>
            <span className="text-[9px] text-pastel-cream/65 max-lg:text-pressbox-text/65 font-display max-lg:font-barlow">
              Click any team to view full roster
            </span>
          </div>

          {/* Table Header */}
          <div className="grid grid-cols-[1.5rem_2rem_1fr_4.5rem_4.5rem] sm:grid-cols-[2rem_2.5rem_1fr_6rem_6rem_4rem] md:grid-cols-[2rem_2.5rem_1fr_7rem_7rem_5rem] items-center gap-1 md:gap-2 px-2 sm:px-3 py-2 bg-citrus-sage/10 border-b border-citrus-sage/20">
            <span className="text-[7px] sm:text-[8px] text-pastel-cream/60 max-lg:text-pressbox-text/60 uppercase font-display max-lg:font-barlow font-bold text-center">#</span>
            <span></span>
            <SortHeader label="Team" sortKey="name" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
            <SortHeader label="Cap Hit" sortKey="capHit" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} align="right" />
            <SortHeader label="Space" sortKey="capSpace" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} align="right" />
            <SortHeader label="Roster" sortKey="roster" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} align="center" className="hidden sm:flex" />
          </div>

          {/* Table Rows */}
          <div className="max-h-[600px] overflow-y-auto">
            {rankingsData.map((team, i) => {
              const info = NHL_TEAMS.find(t => t.abbrev === team.teamAbbrev);
              const capPct = (team.projectedCapHit / SALARY_CAP_2025_26) * 100;
              const isNearCap = team.capSpace >= 0 && team.capSpace < 3_000_000;
              const isOverCap = team.capSpace < 0;

              return (
                <button
                  key={team.teamAbbrev}
                  onClick={() => onSelectTeam(team.teamAbbrev)}
                  className={cn(
                    "w-full grid grid-cols-[1.5rem_2rem_1fr_4.5rem_4.5rem] sm:grid-cols-[2rem_2.5rem_1fr_6rem_6rem_4rem] md:grid-cols-[2rem_2.5rem_1fr_7rem_7rem_5rem] items-center gap-1 md:gap-2 px-2 sm:px-3 py-2 sm:py-2.5 text-left transition-all border-b border-citrus-sage/10",
                    selectedTeam === team.teamAbbrev ? "bg-citrus-sage/20" : "hover:bg-citrus-sage/5",
                    i % 2 === 0 ? "bg-white/5" : "bg-citrus-cream/20"
                  )}
                >
                  <span className="text-[9px] sm:text-[10px] text-pastel-cream/65 max-lg:text-pressbox-text/65 font-display max-lg:font-barlow font-semibold text-center">{i + 1}</span>
                  <img loading="lazy" decoding="async" src={info?.logoUrl || ''} alt={team.teamAbbrev} className="w-5 h-5 sm:w-6 sm:h-6 object-contain" />
                  <div className="min-w-0">
                    <span className="font-display max-lg:font-barlow font-bold text-[10px] sm:text-xs text-pastel-cream max-lg:text-pressbox-text truncate block">{team.teamName}</span>
                    <div className="h-1 mt-0.5 sm:mt-1 bg-citrus-cream rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          isOverCap ? "bg-red-500" : isNearCap ? "bg-amber-400" : "bg-citrus-sage"
                        )}
                        style={{ width: `${Math.min(capPct, 100)}%` }}
                      />
                    </div>
                  </div>
                  <span className="font-varsity max-lg:font-condensed text-[10px] sm:text-xs text-pastel-cream max-lg:text-pressbox-text text-right">{formatCap(team.projectedCapHit)}</span>
                  <span className={cn(
                    "font-varsity max-lg:font-condensed text-[10px] sm:text-xs text-right",
                    isOverCap ? "text-red-600" : isNearCap ? "text-amber-600" : "text-green-600"
                  )}>
                    {isOverCap ? '-' : ''}{formatCap(Math.abs(team.capSpace))}
                  </span>
                  <span className="hidden sm:block font-varsity max-lg:font-condensed text-xs text-pastel-cream/75 max-lg:text-pressbox-text/75 text-center">{team.activeRosterSize}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SortHeader({
  label, sortKey: key, currentKey, dir, onToggle, align = 'left', className,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  dir: SortDir;
  onToggle: (key: SortKey) => void;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  const isActive = currentKey === key;
  return (
    <button
      onClick={() => onToggle(key)}
      className={cn(
        "flex items-center gap-0.5 text-[7px] sm:text-[8px] uppercase font-display max-lg:font-barlow font-bold tracking-wider transition-colors",
        isActive ? "text-pastel-cream max-lg:text-pressbox-text" : "text-pastel-cream/60 max-lg:text-pressbox-text/60 hover:text-pastel-cream/70 hover:max-lg:text-pressbox-text/70",
        align === 'right' && "justify-end",
        align === 'center' && "justify-center",
        className,
      )}
    >
      {label}
      {isActive && (dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
    </button>
  );
}

function TeamCard({
  team,
  selected,
  onClick,
  compact,
}: {
  team: NHLTeamInfo;
  selected: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  const [imageError, setImageError] = useState(false);

  if (compact) {
    return (
      <button
        onClick={onClick}
        className={cn(
          "flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition-all",
          selected
            ? "border-citrus-sage bg-citrus-sage/20 shadow-patch"
            : "border-transparent hover:border-citrus-sage/30 hover:bg-citrus-sage/5"
        )}
      >
        {!imageError ? (
          <img
            src={team.logoUrl}
            alt={team.abbrev}
            className="w-8 h-8 object-contain"
            onError={() => setImageError(true)}
          />
        ) : (
          <Shield className="w-8 h-8 text-citrus-sage/50" />
        )}
        <span className="text-[9px] font-varsity max-lg:font-condensed text-pastel-cream max-lg:text-pressbox-text">{team.abbrev}</span>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2.5 px-3 py-2 rounded-xl border-2 transition-all w-full text-left",
        selected
          ? "border-citrus-sage bg-citrus-sage/20 shadow-patch"
          : "border-transparent hover:border-citrus-sage/30 hover:bg-citrus-sage/5"
      )}
    >
      {!imageError ? (
        <img
          src={team.logoUrl}
          alt={team.abbrev}
          className="w-8 h-8 object-contain flex-shrink-0"
          onError={() => setImageError(true)}
        />
      ) : (
        <Shield className="w-8 h-8 text-citrus-sage/50 flex-shrink-0" />
      )}
      <div className="min-w-0">
        <div className="font-display max-lg:font-barlow font-bold text-xs text-pastel-cream max-lg:text-pressbox-text truncate">
          {team.name}
        </div>
        <div className="text-[9px] text-pastel-cream/65 max-lg:text-pressbox-text/65 font-display max-lg:font-barlow">{team.abbrev}</div>
      </div>
    </button>
  );
}
