import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import {
  PlayerContract, TeamCapData, NHL_TEAMS,
  formatCap, formatCapFull, SALARY_CAP_2025_26,
} from '@/types/captracker';
import { getTeamCapData } from '@/services/NHLCapService';
import { Badge } from '@/components/ui/badge';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, ReferenceLine, Cell, Legend,
} from 'recharts';
import {
  CalendarRange, ChevronDown, Loader2, Shield, TrendingUp, TrendingDown, Users,
} from 'lucide-react';

// Projected cap increases (estimated ~$4M/yr increase based on recent CBA trends)
const PROJECTED_CAPS: Record<number, number> = {
  2026: 95_500_000,  // 2025-26 (current)
  2027: 99_500_000,  // 2026-27
  2028: 103_500_000, // 2027-28
  2029: 107_500_000, // 2028-29
  2030: 111_500_000, // 2029-30
  2031: 115_000_000, // 2030-31
};

interface YearProjection {
  season: string;
  expiryYear: number;
  committed: number;
  projected: number;
  capCeiling: number;
  projectedSpace: number;
  expiringPlayers: PlayerContract[];
  expiringCap: number;
  ufaCount: number;
  rfaCount: number;
}

function projectCapYears(players: PlayerContract[]): YearProjection[] {
  const years: YearProjection[] = [];
  const currentYear = 2026;

  for (let y = currentYear; y <= 2031; y++) {
    const season = `${y - 1}-${String(y).slice(2)}`;
    const yearOffset = y - currentYear;

    // Players still under contract for this year
    const underContract = players.filter(p =>
      p.expiryYear >= y && p.rosterStatus !== 'Buyout' && p.rosterStatus !== 'Retained'
    );
    const committed = underContract.reduce((s, p) => s + p.capHit, 0);

    // Players whose contracts expire at end of this season (expiryYear === y)
    const expiring = players.filter(p => p.expiryYear === y);
    const expiringCap = expiring.reduce((s, p) => s + p.capHit, 0);

    const capCeiling = PROJECTED_CAPS[y] || SALARY_CAP_2025_26;

    years.push({
      season,
      expiryYear: y,
      committed,
      projected: committed,
      capCeiling,
      projectedSpace: capCeiling - committed,
      expiringPlayers: expiring,
      expiringCap,
      ufaCount: expiring.filter(p => p.expiryStatus === 'UFA').length,
      rfaCount: expiring.filter(p => p.expiryStatus === 'RFA').length,
    });
  }

  return years;
}

export default function CapProjection() {
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [showTeamPicker, setShowTeamPicker] = useState(false);
  const [expandedYear, setExpandedYear] = useState<number | null>(null);

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
      ...(teamData.minorLeague || []),
    ];
  }, [teamData]);

  const projection = useMemo(() => projectCapYears(allPlayers), [allPlayers]);

  const chartData = useMemo(() =>
    projection.map(y => ({
      name: y.season,
      committed: Math.round(y.committed / 1_000_000 * 10) / 10,
      capCeiling: Math.round(y.capCeiling / 1_000_000 * 10) / 10,
      space: Math.round(y.projectedSpace / 1_000_000 * 10) / 10,
    })),
  [projection]);

  const teamInfo = selectedTeam ? NHL_TEAMS.find(t => t.abbrev === selectedTeam) : null;

  const handleSelectTeam = (abbrev: string) => {
    setSelectedTeam(abbrev);
    setShowTeamPicker(false);
    setExpandedYear(null);
  };

  return (
    <div className="space-y-6">
      {/* Instructions */}
      {!selectedTeam && (
        <div className="text-center py-8 bg-white/60 backdrop-blur-sm rounded-2xl border-2 border-dashed border-citrus-sage/40">
          <CalendarRange className="w-10 h-10 text-citrus-sage/50 mx-auto mb-3" />
          <h3 className="font-varsity text-lg text-citrus-forest mb-1">Cap Projection</h3>
          <p className="text-sm text-citrus-charcoal/60 font-display max-w-md mx-auto">
            See committed salary, projected cap space, and expiring contracts for the next 6 seasons.
          </p>
        </div>
      )}

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
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-1">
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
                  <span className="text-[7px] font-varsity text-citrus-forest">{t.abbrev}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-citrus-sage animate-spin" />
        </div>
      )}

      {/* Projection Content */}
      {teamData && !isLoading && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* Chart */}
          <div className="bg-white/60 backdrop-blur-sm rounded-2xl border-2 border-citrus-sage/30 shadow-varsity overflow-hidden">
            <div className="px-4 md:px-6 py-3 bg-gradient-to-r from-citrus-sage/20 to-citrus-sage/10 border-b-2 border-citrus-sage/30">
              <h4 className="font-varsity text-base text-citrus-forest">Committed Salary vs Cap Ceiling</h4>
              <p className="text-[10px] text-citrus-charcoal/50 font-display mt-0.5">
                Cap ceiling projections based on estimated ~$4M/year increase
              </p>
            </div>

            <div className="p-4 md:p-6">
              <div className="h-64 md:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#A4C4A0" strokeOpacity={0.3} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 9, fill: '#5C5C5C', fontFamily: 'Montserrat' }}
                      interval={0}
                      angle={-35}
                      textAnchor="end"
                      height={40}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: '#5C5C5C', fontFamily: 'Montserrat' }}
                      tickFormatter={(v) => `$${v}M`}
                      domain={[0, 'dataMax + 20']}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: '#4A5F4D',
                        border: 'none',
                        borderRadius: '12px',
                        color: '#E8EED9',
                        fontSize: '12px',
                        fontFamily: 'Montserrat',
                      }}
                      formatter={(value: number, name: string) => [
                        `$${value.toFixed(1)}M`,
                        name === 'committed' ? 'Committed' : 'Projected Space',
                      ]}
                    />
                    <Bar dataKey="committed" name="committed" radius={[6, 6, 0, 0]}>
                      {chartData.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={
                            entry.committed > entry.capCeiling
                              ? '#EF4444'
                              : entry.space < 5
                              ? '#F59E0B'
                              : '#A4C4A0'
                          }
                        />
                      ))}
                    </Bar>
                    {chartData.length > 0 && (
                      <ReferenceLine
                        y={chartData[0].capCeiling}
                        stroke="#4A5F4D"
                        strokeWidth={2}
                        strokeDasharray="8 4"
                        label={{
                          value: `Cap: $${chartData[0].capCeiling}M`,
                          position: 'insideTopRight',
                          fill: '#4A5F4D',
                          fontSize: 10,
                          fontFamily: 'Montserrat',
                        }}
                      />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Year-by-Year Breakdown */}
          <div className="space-y-3">
            <h4 className="font-varsity text-base text-citrus-forest flex items-center gap-2">
              <CalendarRange className="w-4 h-4 text-citrus-sage" />
              Season-by-Season Breakdown
            </h4>

            {projection.map(year => (
              <div key={year.expiryYear} className="bg-white/60 backdrop-blur-sm rounded-2xl border-2 border-citrus-sage/30 shadow-varsity overflow-hidden">
                <button
                  onClick={() => setExpandedYear(expandedYear === year.expiryYear ? null : year.expiryYear)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-citrus-sage/5 transition-colors"
                >
                  <div className="flex-1 text-left">
                    <div className="font-varsity text-sm text-citrus-forest">{year.season}</div>
                    <div className="text-[10px] text-citrus-charcoal/50 font-display">
                      {year.expiringPlayers.length} expiring contract{year.expiringPlayers.length !== 1 ? 's' : ''}
                    </div>
                  </div>

                  <div className="hidden md:flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-[8px] text-citrus-charcoal/50 uppercase font-display font-bold">Committed</div>
                      <div className="font-varsity text-sm text-citrus-forest">{formatCap(year.committed)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[8px] text-citrus-charcoal/50 uppercase font-display font-bold">Proj. Space</div>
                      <div className={cn(
                        "font-varsity text-sm",
                        year.projectedSpace < 0 ? "text-red-600" : year.projectedSpace < 5_000_000 ? "text-amber-600" : "text-green-600"
                      )}>
                        {formatCap(year.projectedSpace)}
                      </div>
                    </div>
                    {year.ufaCount > 0 && (
                      <Badge className="bg-red-100 text-red-700 text-[8px] font-varsity border border-red-200">
                        {year.ufaCount} UFA
                      </Badge>
                    )}
                    {year.rfaCount > 0 && (
                      <Badge className="bg-amber-100 text-amber-700 text-[8px] font-varsity border border-amber-200">
                        {year.rfaCount} RFA
                      </Badge>
                    )}
                  </div>

                  {/* Mobile summary */}
                  <div className="md:hidden flex items-center gap-1.5 flex-wrap justify-end">
                    {year.ufaCount > 0 && (
                      <Badge className="bg-red-100 text-red-700 text-[7px] h-4 px-1 font-varsity border border-red-200">
                        {year.ufaCount} UFA
                      </Badge>
                    )}
                    {year.rfaCount > 0 && (
                      <Badge className="bg-amber-100 text-amber-700 text-[7px] h-4 px-1 font-varsity border border-amber-200">
                        {year.rfaCount} RFA
                      </Badge>
                    )}
                    <span className={cn(
                      "font-varsity text-sm",
                      year.projectedSpace < 0 ? "text-red-600" : "text-green-600"
                    )}>
                      {formatCap(year.projectedSpace)}
                    </span>
                  </div>

                  <ChevronDown className={cn(
                    "w-4 h-4 text-citrus-charcoal/40 transition-transform",
                    expandedYear === year.expiryYear && "rotate-180"
                  )} />
                </button>

                {/* Expanded: Expiring Contracts */}
                {expandedYear === year.expiryYear && year.expiringPlayers.length > 0 && (
                  <div className="border-t-2 border-citrus-sage/20 animate-in fade-in slide-in-from-top-1 duration-200">
                    {/* Header */}
                    <div className="px-4 py-2 bg-citrus-sage/10">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] text-citrus-charcoal/60 uppercase font-display font-bold tracking-wider">
                          Expiring after {year.season}
                        </span>
                        <span className="text-xs font-varsity text-citrus-forest">
                          {formatCap(year.expiringCap)} coming off books
                        </span>
                      </div>
                    </div>

                    {/* Player rows */}
                    {year.expiringPlayers
                      .sort((a, b) => b.capHit - a.capHit)
                      .map((p, i) => (
                        <div
                          key={p.playerId || `${p.name}-${i}`}
                          className={cn(
                            "flex items-center gap-3 px-4 py-2 border-b border-citrus-sage/10",
                            i % 2 === 0 ? "bg-white/40" : "bg-citrus-cream/30"
                          )}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="font-display font-bold text-xs text-citrus-forest truncate">{p.name}</div>
                            <div className="flex items-center gap-1">
                              <Badge className="bg-citrus-sage/20 text-citrus-forest text-[7px] h-3.5 px-1 font-varsity border border-citrus-sage/40">
                                {p.position}
                              </Badge>
                              <span className="text-[9px] text-citrus-charcoal/50 font-display">Age {p.age + (year.expiryYear - 2026)}</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-varsity text-xs text-citrus-forest">{formatCap(p.capHit)}</div>
                          </div>
                          <Badge className={cn(
                            "text-[8px] h-5 px-1.5 font-varsity font-bold",
                            p.expiryStatus === 'UFA' ? "bg-red-500/80 text-white" : "bg-amber-500/80 text-white"
                          )}>
                            {p.expiryStatus}
                          </Badge>
                        </div>
                      ))}
                  </div>
                )}

                {expandedYear === year.expiryYear && year.expiringPlayers.length === 0 && (
                  <div className="border-t-2 border-citrus-sage/20 px-4 py-6 text-center">
                    <span className="text-xs text-citrus-charcoal/50 font-display">No contracts expiring after this season</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Disclaimer */}
          <div className="text-center">
            <p className="text-[10px] text-citrus-charcoal/40 font-display">
              Cap ceiling projections are estimates based on recent CBA trends (~$4M/year increase).
              <br />Actual cap numbers will be announced by the NHL. Future commitments do not include potential signings.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
