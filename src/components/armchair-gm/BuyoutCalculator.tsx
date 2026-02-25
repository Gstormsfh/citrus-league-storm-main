import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import {
  PlayerContract, TeamCapData, NHL_TEAMS,
  formatCap, formatCapFull, SALARY_CAP_2025_26,
} from '@/types/captracker';
import { CURRENT_SEASON } from '@/utils/seasonConstants';
import { getTeamCapData } from '@/services/NHLCapService';
import { Badge } from '@/components/ui/badge';
import {
  Calculator, ChevronDown, Loader2, Search, Shield,
  TrendingDown, TrendingUp, AlertCircle, DollarSign,
} from 'lucide-react';
import PlayerAvatar from './PlayerAvatar';

interface BuyoutYear {
  season: string;
  capCharge: number;
  capSavings: number;
  actualCost: number;
  isPostContract: boolean;
}

function calculateBuyout(player: PlayerContract): { years: BuyoutYear[]; totalDeadCap: number; totalSavings: number; totalCost: number } {
  const isOver26 = player.age >= 26;
  const remaining = player.yearsRemaining;
  const annualSalary = player.baseSalary;

  // Buyout period: 2x remaining for 26+, same for under 26
  const buyoutPeriod = isOver26 ? remaining * 2 : Math.max(remaining, 1);

  // Total buyout cost to the team
  const buyoutFraction = isOver26 ? 2 / 3 : 1 / 3;
  const totalBuyoutCost = annualSalary * remaining * buyoutFraction;
  const annualBuyoutCap = totalBuyoutCost / buyoutPeriod;

  const years: BuyoutYear[] = [];
  const currentYear = CURRENT_SEASON;
  let totalDeadCap = 0;
  let totalSavings = 0;

  for (let i = 0; i < buyoutPeriod; i++) {
    const startYear = currentYear + i;
    const season = `${startYear}-${String(startYear + 1).slice(2)}`;
    const isPostContract = i >= remaining;
    const capSavings = isPostContract ? 0 : player.capHit - annualBuyoutCap;

    years.push({
      season,
      capCharge: annualBuyoutCap,
      capSavings: isPostContract ? -annualBuyoutCap : capSavings,
      actualCost: isPostContract ? 0 : annualSalary * buyoutFraction,
      isPostContract,
    });

    totalDeadCap += annualBuyoutCap;
    totalSavings += isPostContract ? -annualBuyoutCap : capSavings;
  }

  return { years, totalDeadCap, totalSavings, totalCost: totalBuyoutCost };
}

export default function BuyoutCalculator() {
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [showTeamPicker, setShowTeamPicker] = useState(false);
  const [playerSearch, setPlayerSearch] = useState('');

  const { data: teamData, isLoading } = useQuery<TeamCapData>({
    queryKey: ['teamCapData', selectedTeam],
    queryFn: () => getTeamCapData(selectedTeam!),
    enabled: !!selectedTeam,
    staleTime: 10 * 60 * 1000,
  });

  const allPlayers = useMemo(() => {
    if (!teamData) return [];
    return [
      ...teamData.forwards,
      ...teamData.defense,
      ...teamData.goalies,
    ].filter(p => p.rosterStatus === 'NHL' && p.yearsRemaining > 0);
  }, [teamData]);

  const filteredPlayers = useMemo(() => {
    if (!playerSearch.trim()) return allPlayers;
    const q = playerSearch.toLowerCase();
    return allPlayers.filter(p => p.name.toLowerCase().includes(q));
  }, [allPlayers, playerSearch]);

  const selectedPlayer = allPlayers.find(p => p.playerId === selectedPlayerId);

  const buyoutResult = useMemo(() => {
    if (!selectedPlayer) return null;
    return calculateBuyout(selectedPlayer);
  }, [selectedPlayer]);

  const teamInfo = selectedTeam ? NHL_TEAMS.find(t => t.abbrev === selectedTeam) : null;

  const handleSelectTeam = (abbrev: string) => {
    setSelectedTeam(abbrev);
    setSelectedPlayerId(null);
    setPlayerSearch('');
    setShowTeamPicker(false);
  };

  return (
    <div className="space-y-6">
      {/* Instructions */}
      {!selectedTeam && (
        <div className="text-center py-8 bg-white/60 backdrop-blur-sm rounded-2xl border-2 border-dashed border-citrus-sage/40">
          <Calculator className="w-10 h-10 text-citrus-sage/50 mx-auto mb-3" />
          <h3 className="font-varsity text-lg text-citrus-forest mb-1">Buyout Calculator</h3>
          <p className="text-sm text-citrus-charcoal/60 font-display max-w-md mx-auto">
            Select a team and player to calculate buyout costs, cap savings, and year-by-year dead cap schedule.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Team + Player selector */}
        <div className="lg:col-span-1 space-y-4">
          {/* Team Selector */}
          <div className="bg-white/60 backdrop-blur-sm rounded-2xl border-2 border-citrus-sage/30 shadow-varsity overflow-hidden">
            <button
              onClick={() => setShowTeamPicker(!showTeamPicker)}
              className="w-full px-4 py-3 bg-gradient-to-r from-citrus-sage/20 to-citrus-sage/10 flex items-center gap-3 hover:from-citrus-sage/25 transition-colors"
            >
              {teamInfo ? (
                <img src={teamInfo.logoUrl} alt={teamInfo.abbrev} className="w-8 h-8 object-contain" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-citrus-sage/20 flex items-center justify-center">
                  <Shield className="w-4 h-4 text-citrus-sage/60" />
                </div>
              )}
              <div className="flex-1 text-left">
                <div className="text-[10px] text-citrus-charcoal/50 uppercase font-display font-bold tracking-wider">Team</div>
                <div className="font-varsity text-sm text-citrus-forest">
                  {teamInfo ? teamInfo.fullName : 'Select a team'}
                </div>
              </div>
              <ChevronDown className={cn("w-4 h-4 text-citrus-charcoal/40 transition-transform", showTeamPicker && "rotate-180")} />
            </button>

            {showTeamPicker && (
              <div className="p-2 border-t border-citrus-sage/20 max-h-48 overflow-y-auto">
                <div className="grid grid-cols-4 gap-1">
                  {NHL_TEAMS.map(t => (
                    <button
                      key={t.abbrev}
                      onClick={() => handleSelectTeam(t.abbrev)}
                      className={cn(
                        "flex flex-col items-center gap-0.5 p-1.5 rounded-lg border transition-all",
                        selectedTeam === t.abbrev
                          ? "border-citrus-sage bg-citrus-sage/20"
                          : "border-transparent hover:border-citrus-sage/30"
                      )}
                    >
                      <img src={t.logoUrl} alt={t.abbrev} className="w-6 h-6 object-contain" />
                      <span className="text-[8px] font-varsity text-citrus-forest">{t.abbrev}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Player Selector */}
          {selectedTeam && (
            <div className="bg-white/60 backdrop-blur-sm rounded-2xl border-2 border-citrus-sage/30 shadow-varsity overflow-hidden">
              <div className="px-4 py-2.5 bg-gradient-to-r from-citrus-sage/15 to-citrus-sage/5 border-b border-citrus-sage/20">
                <div className="text-[10px] text-citrus-charcoal/50 uppercase font-display font-bold tracking-wider">Select Player</div>
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 text-citrus-sage animate-spin" />
                </div>
              ) : (
                <>
                  <div className="px-3 py-2 border-b border-citrus-sage/10">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-citrus-charcoal/40" />
                      <input
                        type="text"
                        placeholder="Search players..."
                        value={playerSearch}
                        onChange={e => setPlayerSearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-citrus-sage/30 bg-white/60 text-xs font-display text-citrus-forest placeholder:text-citrus-charcoal/40 focus:outline-none focus:border-citrus-sage transition-all"
                      />
                    </div>
                  </div>

                  <div className="max-h-64 overflow-y-auto">
                    {filteredPlayers.map(p => (
                      <button
                        key={p.playerId}
                        onClick={() => setSelectedPlayerId(p.playerId)}
                        className={cn(
                          "w-full flex items-center gap-2 px-3 py-2 text-left border-b border-citrus-sage/10 transition-colors",
                          selectedPlayerId === p.playerId
                            ? "bg-citrus-sage/20 border-l-4 border-l-citrus-sage"
                            : "hover:bg-citrus-sage/5"
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-display font-bold text-[11px] text-citrus-forest truncate">{p.name}</div>
                          <div className="flex items-center gap-1">
                            <Badge className="bg-citrus-sage/20 text-citrus-forest text-[7px] h-3.5 px-1 font-varsity border border-citrus-sage/40">
                              {p.position}
                            </Badge>
                            {p.age > 0 && <span className="text-[9px] text-citrus-charcoal/50 font-display">Age {p.age}</span>}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-varsity text-xs text-citrus-forest">{formatCap(p.capHit)}</div>
                          <div className="text-[8px] text-citrus-charcoal/50 font-display">{p.yearsRemaining}yr left</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Right: Buyout Results */}
        <div className="lg:col-span-2">
          {selectedPlayer && buyoutResult ? (
            <div className="space-y-4 animate-in fade-in duration-300">
              {/* Player Card */}
              <div className="bg-white/60 backdrop-blur-sm rounded-2xl border-2 border-citrus-sage/30 shadow-varsity overflow-hidden">
                <div className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 bg-gradient-to-r from-citrus-forest via-citrus-forest/95 to-citrus-forest">
                  <div className="flex items-center gap-3 sm:gap-4">
                    <div className="hidden sm:block">
                      <PlayerHeadshot player={selectedPlayer} size="lg" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-varsity text-lg sm:text-xl text-citrus-cream truncate">{selectedPlayer.name}</h3>
                      <div className="flex items-center gap-1.5 sm:gap-2 mt-0.5 sm:mt-1 flex-wrap">
                        <Badge className="bg-citrus-sage/30 text-citrus-cream text-[8px] sm:text-[9px] font-varsity">{selectedPlayer.position}</Badge>
                        {selectedPlayer.age > 0 && (
                          <>
                            <span className="text-[10px] sm:text-xs text-citrus-sage/80 font-display">Age {selectedPlayer.age}</span>
                            <span className="text-[10px] sm:text-xs text-citrus-sage/80 font-display">&middot;</span>
                            <span className="text-[10px] sm:text-xs text-citrus-sage/80 font-display">
                              {selectedPlayer.age >= 26 ? 'Standard' : 'Under-26'} buyout
                            </span>
                          </>
                        )}
                      </div>
                      {/* Mobile-only cap hit */}
                      <div className="sm:hidden mt-1">
                        <span className="font-varsity text-sm text-citrus-cream">{formatCap(selectedPlayer.capHit)}</span>
                        <span className="text-[9px] text-citrus-sage/60 font-display ml-1">cap hit</span>
                      </div>
                    </div>
                    <div className="hidden md:block text-right">
                      <div className="text-[10px] text-citrus-sage/60 uppercase font-display font-bold">Current Cap Hit</div>
                      <div className="font-varsity text-xl text-citrus-cream">{formatCap(selectedPlayer.capHit)}</div>
                    </div>
                  </div>
                </div>

                {/* Contract Details */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
                  <StatBox label="Base Salary" value={formatCap(selectedPlayer.baseSalary)} />
                  <StatBox label="Years Left" value={`${selectedPlayer.yearsRemaining}`} />
                  <StatBox label="Buyout Period" value={`${buyoutResult.years.length} years`} />
                  <StatBox
                    label="Buyout Type"
                    value={selectedPlayer.age >= 26 ? 'Standard (2/3)' : 'Under-26 (1/3)'}
                  />
                </div>
              </div>

              {/* Clause Warning */}
              {selectedPlayer.clause && (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-50 border-2 border-amber-200">
                  <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                  <span className="text-xs font-display text-amber-700">
                    This player has a <strong>{selectedPlayer.clause === 'NMC' ? 'No-Movement Clause' : selectedPlayer.clause === 'NTC' ? 'No-Trade Clause' : 'Modified No-Trade Clause'}</strong>. Buyouts require the player's consent if under NMC protection.
                  </span>
                </div>
              )}

              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
                <div className="bg-green-50 rounded-xl border-2 border-green-200 p-3 sm:p-4 flex sm:flex-col items-center sm:items-center gap-3 sm:gap-0 sm:text-center">
                  <TrendingDown className="w-5 h-5 text-green-600 flex-shrink-0 sm:mb-1" />
                  <div className="flex-1 sm:flex-none">
                    <div className="text-[9px] text-green-700 uppercase font-display font-bold tracking-wider">
                      Year 1 Savings
                    </div>
                    <div className="font-varsity text-base sm:text-lg text-green-700">
                      {buyoutResult.years[0]?.capSavings > 0 ? formatCap(buyoutResult.years[0].capSavings) : '$0'}
                    </div>
                  </div>
                </div>
                <div className="bg-red-50 rounded-xl border-2 border-red-200 p-3 sm:p-4 flex sm:flex-col items-center sm:items-center gap-3 sm:gap-0 sm:text-center">
                  <DollarSign className="w-5 h-5 text-red-600 flex-shrink-0 sm:mb-1" />
                  <div className="flex-1 sm:flex-none">
                    <div className="text-[9px] text-red-700 uppercase font-display font-bold tracking-wider">Total Dead Cap</div>
                    <div className="font-varsity text-base sm:text-lg text-red-700">{formatCap(buyoutResult.totalDeadCap)}</div>
                  </div>
                </div>
                <div className={cn(
                  "rounded-xl border-2 p-3 sm:p-4 flex sm:flex-col items-center sm:items-center gap-3 sm:gap-0 sm:text-center",
                  buyoutResult.totalSavings > 0
                    ? "bg-green-50 border-green-200"
                    : "bg-red-50 border-red-200"
                )}>
                  <TrendingUp className="w-5 h-5 text-citrus-forest flex-shrink-0 sm:mb-1" />
                  <div className="flex-1 sm:flex-none">
                    <div className="text-[9px] text-citrus-charcoal/70 uppercase font-display font-bold tracking-wider">Net Cap Impact</div>
                    <div className={cn(
                      "font-varsity text-base sm:text-lg",
                      buyoutResult.totalSavings > 0 ? "text-green-700" : "text-red-700"
                    )}>
                      {buyoutResult.totalSavings > 0 ? '+' : ''}{formatCap(buyoutResult.totalSavings)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Year-by-Year Schedule */}
              <div className="bg-white/60 backdrop-blur-sm rounded-2xl border-2 border-citrus-sage/30 shadow-varsity overflow-hidden">
                <div className="px-4 py-3 bg-gradient-to-r from-citrus-sage/20 to-citrus-sage/10 border-b-2 border-citrus-sage/30">
                  <h4 className="font-varsity text-base text-citrus-forest">Year-by-Year Buyout Schedule</h4>
                </div>

                {/* Table Header */}
                <div className="grid grid-cols-[1fr_4.5rem_4.5rem_4.5rem] sm:grid-cols-4 gap-1 sm:gap-2 px-2 sm:px-4 py-2 bg-citrus-sage/10 border-b border-citrus-sage/20">
                  <span className="text-[8px] sm:text-[9px] text-citrus-charcoal/50 uppercase font-display font-bold">Season</span>
                  <span className="text-[8px] sm:text-[9px] text-citrus-charcoal/50 uppercase font-display font-bold text-right">Charge</span>
                  <span className="text-[8px] sm:text-[9px] text-citrus-charcoal/50 uppercase font-display font-bold text-right">Savings</span>
                  <span className="text-[8px] sm:text-[9px] text-citrus-charcoal/50 uppercase font-display font-bold text-right">Cash</span>
                </div>

                {/* Rows */}
                {buyoutResult.years.map((year, i) => (
                  <div
                    key={year.season}
                    className={cn(
                      "grid grid-cols-[1fr_4.5rem_4.5rem_4.5rem] sm:grid-cols-4 gap-1 sm:gap-2 px-2 sm:px-4 py-2 sm:py-2.5 border-b border-citrus-sage/10",
                      year.isPostContract ? "bg-red-50/30" : i % 2 === 0 ? "bg-white/40" : "bg-citrus-cream/30"
                    )}
                  >
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] sm:text-xs font-display font-semibold text-citrus-forest">{year.season}</span>
                      {year.isPostContract && (
                        <Badge className="bg-red-100 text-red-700 text-[6px] sm:text-[7px] h-3 sm:h-3.5 px-0.5 sm:px-1 border border-red-200">
                          Post
                        </Badge>
                      )}
                    </div>
                    <span className="text-[10px] sm:text-xs font-varsity text-red-600 text-right">{formatCap(year.capCharge)}</span>
                    <span className={cn(
                      "text-[10px] sm:text-xs font-varsity text-right",
                      year.capSavings > 0 ? "text-green-600" : "text-red-600"
                    )}>
                      {year.capSavings > 0 ? '+' : ''}{formatCap(year.capSavings)}
                    </span>
                    <span className="text-[10px] sm:text-xs font-varsity text-citrus-charcoal text-right">
                      {formatCap(year.actualCost)}
                    </span>
                  </div>
                ))}

                {/* Total Row */}
                <div className="grid grid-cols-[1fr_4.5rem_4.5rem_4.5rem] sm:grid-cols-4 gap-1 sm:gap-2 px-2 sm:px-4 py-2.5 sm:py-3 bg-gradient-to-r from-citrus-sage/15 to-citrus-sage/10 border-t-2 border-citrus-sage/30">
                  <span className="text-[10px] sm:text-xs font-display font-bold text-citrus-forest uppercase">Total</span>
                  <span className="text-[10px] sm:text-xs font-varsity text-red-600 font-bold text-right">
                    {formatCap(buyoutResult.totalDeadCap)}
                  </span>
                  <span className={cn(
                    "text-[10px] sm:text-xs font-varsity font-bold text-right",
                    buyoutResult.totalSavings > 0 ? "text-green-600" : "text-red-600"
                  )}>
                    {buyoutResult.totalSavings > 0 ? '+' : ''}{formatCap(buyoutResult.totalSavings)}
                  </span>
                  <span className="text-[10px] sm:text-xs font-varsity text-citrus-charcoal font-bold text-right">
                    {formatCap(buyoutResult.totalCost)}
                  </span>
                </div>
              </div>

              {/* Explainer */}
              <div className="text-center">
                <p className="text-[10px] text-citrus-charcoal/40 font-display">
                  {selectedPlayer.age >= 26
                    ? 'Standard buyout: player receives 2/3 of remaining salary, spread over 2x remaining contract years.'
                    : 'Under-26 buyout: player receives 1/3 of remaining salary, spread over remaining contract years.'}
                  <br />Actual buyout calculations may differ based on year-by-year salary structure.
                </p>
              </div>
            </div>
          ) : selectedTeam ? (
            <div className="flex flex-col items-center justify-center py-20 bg-white/40 rounded-2xl border-2 border-dashed border-citrus-sage/30">
              <Calculator className="w-8 h-8 text-citrus-sage/30 mb-2" />
              <p className="text-sm text-citrus-charcoal/50 font-display">Select a player to calculate buyout</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PlayerHeadshot({ player, size = 'md' }: { player: PlayerContract; size?: 'md' | 'lg' }) {
  return (
    <PlayerAvatar
      name={player.name}
      position={player.position}
      jerseyNumber={player.jerseyNumber}
      size={size === 'lg' ? 'lg' : 'md'}
    />
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-citrus-cream/40 rounded-xl border border-citrus-sage/20 p-3 text-center">
      <div className="text-[9px] text-citrus-charcoal/50 uppercase font-display font-bold tracking-wider">{label}</div>
      <div className="font-varsity text-sm text-citrus-forest mt-0.5">{value}</div>
    </div>
  );
}
