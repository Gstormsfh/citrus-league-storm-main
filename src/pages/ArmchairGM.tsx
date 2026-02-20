import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import TeamSelector from '@/components/armchair-gm/TeamSelector';
import CapSummaryBar from '@/components/armchair-gm/CapSummaryBar';
import RosterLineupView from '@/components/armchair-gm/RosterLineupView';
import TradeSimulator from '@/components/armchair-gm/TradeSimulator';
import BuyoutCalculator from '@/components/armchair-gm/BuyoutCalculator';
import CapProjection from '@/components/armchair-gm/CapProjection';
import SigningSimulator from '@/components/armchair-gm/SigningSimulator';
import { getTeamCapData } from '@/services/NHLCapService';
import { TeamCapData, formatCap, SALARY_CAP_2025_26 } from '@/types/captracker';
import { cn } from '@/lib/utils';
import {
  DollarSign, TrendingUp, ChevronLeft, Loader2, AlertCircle,
  ArrowLeftRight, Calculator, CalendarRange, BarChart3, PenLine,
} from 'lucide-react';

type GMTab = 'tracker' | 'trade' | 'signing' | 'buyout' | 'projection';

const TABS: { id: GMTab; label: string; shortLabel: string; icon: React.ReactNode; description: string }[] = [
  { id: 'tracker', label: 'Cap Tracker', shortLabel: 'Cap', icon: <BarChart3 className="w-4 h-4" />, description: 'View team rosters & cap details' },
  { id: 'trade', label: 'Trade Simulator', shortLabel: 'Trade', icon: <ArrowLeftRight className="w-4 h-4" />, description: 'Simulate trades between teams' },
  { id: 'signing', label: 'Signing Sim', shortLabel: 'Sign', icon: <PenLine className="w-4 h-4" />, description: 'Simulate free agent signings' },
  { id: 'buyout', label: 'Buyout Calculator', shortLabel: 'Buyout', icon: <Calculator className="w-4 h-4" />, description: 'Calculate buyout costs & savings' },
  { id: 'projection', label: 'Cap Projection', shortLabel: 'Project', icon: <CalendarRange className="w-4 h-4" />, description: 'Multi-year cap commitments' },
];

const ArmchairGM = () => {
  const [activeTab, setActiveTab] = useState<GMTab>('tracker');
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [showTeamSelector, setShowTeamSelector] = useState(true);

  const {
    data: teamCapData,
    isLoading,
    error,
  } = useQuery<TeamCapData>({
    queryKey: ['teamCapData', selectedTeam],
    queryFn: () => getTeamCapData(selectedTeam!),
    enabled: !!selectedTeam,
    staleTime: 10 * 60 * 1000,
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
        <div className="w-full bg-gradient-to-r from-citrus-forest via-citrus-forest/95 to-citrus-forest relative">
          <div className="absolute inset-0 opacity-5 pointer-events-none">
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
                  NHL Salary Cap Toolkit &middot; {formatCap(SALARY_CAP_2025_26)} cap
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

          {/* Tab Bar */}
          <div className="max-w-7xl mx-auto px-4 md:px-6 relative">
            <div className="flex gap-1 -mb-[2px] overflow-x-auto scrollbar-hide pb-[2px]">
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-sm font-display font-bold transition-all border-2 border-b-0 flex-shrink-0 whitespace-nowrap",
                    activeTab === tab.id
                      ? "bg-[#E8EED9] text-citrus-forest border-citrus-sage/30 shadow-sm"
                      : "bg-citrus-forest/50 text-citrus-sage/70 border-transparent hover:bg-citrus-forest/30 hover:text-citrus-cream"
                  )}
                >
                  {tab.icon}
                  <span className="hidden md:inline">{tab.label}</span>
                  <span className="md:hidden">{tab.shortLabel}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-6">
          {/* Cap Tracker Tab */}
          {activeTab === 'tracker' && (
            <>
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
                  <button
                    onClick={handleBackToTeams}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl border-2 border-citrus-sage/30 bg-white/60 hover:bg-citrus-sage/10 transition-colors font-display text-sm text-citrus-forest"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    All Teams
                  </button>

                  {isLoading && (
                    <div className="flex flex-col items-center justify-center py-20 gap-4">
                      <Loader2 className="w-8 h-8 text-citrus-sage animate-spin" />
                      <span className="text-sm text-citrus-charcoal/60 font-display">
                        Loading roster data...
                      </span>
                    </div>
                  )}

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

                  {teamCapData && !isLoading && (
                    <div className="space-y-6 animate-in fade-in duration-300">
                      <CapSummaryBar data={teamCapData} />

                      <RosterLineupView data={teamCapData} />

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
            </>
          )}

          {/* Trade Simulator Tab */}
          {activeTab === 'trade' && <TradeSimulator />}

          {/* Signing Simulator Tab */}
          {activeTab === 'signing' && <SigningSimulator />}

          {/* Buyout Calculator Tab */}
          {activeTab === 'buyout' && <BuyoutCalculator />}

          {/* Cap Projection Tab */}
          {activeTab === 'projection' && <CapProjection />}
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
