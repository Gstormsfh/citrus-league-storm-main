import { useState } from 'react';
import { cn } from '@/lib/utils';
import { NHL_TEAMS, type NHLTeamInfo } from '@/types/captracker';
import { Search, Shield } from 'lucide-react';

interface TeamSelectorProps {
  selectedTeam: string | null;
  onSelectTeam: (abbrev: string) => void;
  teamCapSummaries?: Array<{
    teamAbbrev: string;
    capSpace: number;
    projectedCapHit: number;
  }>;
}

export default function TeamSelector({ selectedTeam, onSelectTeam, teamCapSummaries }: TeamSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'division'>('division');

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

  return (
    <div className="space-y-4">
      {/* Search + View Toggle */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-citrus-charcoal/40" />
          <input
            type="text"
            placeholder="Search teams..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border-2 border-citrus-sage/30 bg-white/60 backdrop-blur-sm text-sm font-display text-citrus-forest placeholder:text-citrus-charcoal/40 focus:outline-none focus:border-citrus-sage focus:ring-2 focus:ring-citrus-sage/20 transition-all"
          />
        </div>
        <div className="flex rounded-xl border-2 border-citrus-sage/30 overflow-hidden">
          <button
            onClick={() => setViewMode('division')}
            className={cn(
              "px-3 py-2 text-[10px] font-display font-bold uppercase tracking-wider transition-colors",
              viewMode === 'division'
                ? "bg-citrus-sage text-citrus-forest"
                : "bg-white/60 text-citrus-charcoal/60 hover:bg-citrus-sage/10"
            )}
          >
            Division
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={cn(
              "px-3 py-2 text-[10px] font-display font-bold uppercase tracking-wider transition-colors",
              viewMode === 'grid'
                ? "bg-citrus-sage text-citrus-forest"
                : "bg-white/60 text-citrus-charcoal/60 hover:bg-citrus-sage/10"
            )}
          >
            All
          </button>
        </div>
      </div>

      {/* Division View */}
      {viewMode === 'division' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {teamsByDivision.map((div) => (
            <div
              key={div.name}
              className="bg-white/60 backdrop-blur-sm rounded-2xl border-2 border-citrus-sage/30 overflow-hidden"
            >
              <div className="px-4 py-2.5 bg-gradient-to-r from-citrus-sage/20 to-citrus-sage/10 border-b border-citrus-sage/30">
                <div className="flex items-center gap-2">
                  <span className="font-varsity text-sm text-citrus-forest tracking-tight">
                    {div.name}
                  </span>
                  <span className="text-[9px] text-citrus-charcoal/50 font-display">
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
      ) : (
        /* Grid View */
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
    </div>
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
        <span className="text-[9px] font-varsity text-citrus-forest">{team.abbrev}</span>
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
        <div className="font-display font-bold text-xs text-citrus-forest truncate">
          {team.name}
        </div>
        <div className="text-[9px] text-citrus-charcoal/50 font-display">{team.abbrev}</div>
      </div>
    </button>
  );
}
