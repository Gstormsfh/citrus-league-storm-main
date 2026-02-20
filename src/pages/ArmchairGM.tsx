import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import TeamSelector from '@/components/armchair-gm/TeamSelector';
import CapSummaryBar from '@/components/armchair-gm/CapSummaryBar';
import TeamCapBreakdown from '@/components/armchair-gm/TeamCapBreakdown';
import { getTeamCapData } from '@/services/NHLCapService';
import { TeamCapData, formatCap, SALARY_CAP_2025_26 } from '@/types/captracker';
import { cn } from '@/lib/utils';
import { DollarSign, TrendingUp, ChevronLeft, Loader2, AlertCircle } from 'lucide-react';

const ArmchairGM = () => {
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [showTeamSelector, setShowTeamSelector] = useState(true);

  // Fetch team cap data when a team is selected
  const {
    data: teamCapData,
    isLoading,
    error,
  } = useQuery<TeamCapData>({
    queryKey: ['teamCapData', selectedTeam],
    queryFn: () => getTeamCapData(selectedTeam!),
    enabled: !!selectedTeam,
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes
  });

  const handleTeamSelect = (abbrev: string) => {
    setSelectedTeam(abbrev);
    setShowTeamSelector(false);
  };

  const handleBackToTeams = () => {
    setShowTeamSelector(true);
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-[#E8EED9] via-[#F0F4E8] to-[#E8EED9]">
      <Navbar />

      <main className="flex-1 w-full pt-[var(--header-height)] pb-24 lg:pb-12">
        {/* Hero Header */}
        <div className="w-full bg-gradient-to-r from-citrus-forest via-citrus-forest/95 to-citrus-forest relative overflow-hidden">
          {/* Subtle pattern overlay */}
          <div className="absolute inset-0 opacity-5">
            <div className="absolute inset-0" style={{
              backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 20px, rgba(255,255,255,0.1) 20px, rgba(255,255,255,0.1) 40px)',
            }} />
          </div>

          <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8 relative">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-2xl bg-citrus-sage/20 border-2 border-citrus-sage/30">
                <DollarSign className="w-7 h-7 md:w-8 md:h-8 text-citrus-sage" />
              </div>
              <div>
                <h1 className="font-varsity text-2xl md:text-3xl text-citrus-cream tracking-tight">
                  Armchair GM
                </h1>
                <p className="text-sm text-citrus-sage/80 font-display mt-0.5">
                  NHL Salary Cap Tracker &middot; {formatCap(SALARY_CAP_2025_26)} cap
                </p>
              </div>
            </div>

            {/* Quick stats bar */}
            <div className="flex flex-wrap gap-3 md:gap-6 mt-4">
              <HeroBadge label="Salary Cap" value={formatCap(SALARY_CAP_2025_26)} />
              <HeroBadge label="Cap Floor" value="$70.6M" />
              <HeroBadge label="Max Contracts" value="50" />
              <HeroBadge label="Season" value="2025-26" />
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-6">
          {/* Team Selector or Team View */}
          {showTeamSelector || !selectedTeam ? (
            <>
              <div className="flex items-center gap-3 mb-2">
                <TrendingUp className="w-5 h-5 text-citrus-sage" />
                <h2 className="font-varsity text-lg text-citrus-forest">Select a Team</h2>
              </div>
              <TeamSelector
                selectedTeam={selectedTeam}
                onSelectTeam={handleTeamSelect}
              />
            </>
          ) : (
            <>
              {/* Back Button */}
              <button
                onClick={handleBackToTeams}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border-2 border-citrus-sage/30 bg-white/60 hover:bg-citrus-sage/10 transition-colors font-display text-sm text-citrus-forest"
              >
                <ChevronLeft className="w-4 h-4" />
                All Teams
              </button>

              {/* Loading State */}
              {isLoading && (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                  <Loader2 className="w-8 h-8 text-citrus-sage animate-spin" />
                  <span className="text-sm text-citrus-charcoal/60 font-display">
                    Loading roster data...
                  </span>
                </div>
              )}

              {/* Error State */}
              {error && (
                <div className="flex flex-col items-center justify-center py-12 gap-3 bg-red-50/50 rounded-2xl border-2 border-red-200">
                  <AlertCircle className="w-8 h-8 text-red-400" />
                  <span className="text-sm text-red-600 font-display">
                    Failed to load team data. Please try again.
                  </span>
                  <button
                    onClick={() => setSelectedTeam(selectedTeam)}
                    className="px-4 py-2 rounded-lg bg-red-100 text-red-700 text-sm font-display font-bold hover:bg-red-200 transition-colors"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Team Data */}
              {teamCapData && !isLoading && (
                <div className="space-y-6 animate-in fade-in duration-300">
                  {/* Cap Summary */}
                  <CapSummaryBar data={teamCapData} />

                  {/* Roster Breakdown */}
                  <TeamCapBreakdown
                    title="Forwards"
                    players={teamCapData.forwards}
                    positionIcon="🏒"
                    defaultExpanded
                  />

                  <TeamCapBreakdown
                    title="Defense"
                    players={teamCapData.defense}
                    positionIcon="🛡️"
                    defaultExpanded
                  />

                  <TeamCapBreakdown
                    title="Goalies"
                    players={teamCapData.goalies}
                    positionIcon="🥅"
                    defaultExpanded
                  />

                  {/* Minor League / IR */}
                  {teamCapData.minorLeague && teamCapData.minorLeague.length > 0 && (
                    <TeamCapBreakdown
                      title="Minor League / IR / Other"
                      players={teamCapData.minorLeague}
                      positionIcon="📋"
                      defaultExpanded={false}
                    />
                  )}

                  {/* Data disclaimer */}
                  <div className="text-center py-4">
                    <p className="text-[10px] text-citrus-charcoal/40 font-display">
                      Contract data is based on publicly available information and may not reflect the most recent transactions.
                      <br />
                      Salary cap for 2025-26: {formatCap(SALARY_CAP_2025_26)} &middot; Roster data from NHL.com
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
};

function HeroBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-citrus-sage/10 border border-citrus-sage/20">
      <span className="text-[10px] text-citrus-sage/60 font-display uppercase tracking-wider">{label}</span>
      <span className="font-varsity text-sm text-citrus-cream">{value}</span>
    </div>
  );
}

export default ArmchairGM;
