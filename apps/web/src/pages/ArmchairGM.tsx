import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Navbar from '@/components/Navbar';
import { HockeyFooter } from '@/components/citrus2';
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
import { SEASON_LABEL } from '@/utils/seasonConstants';
import MockDraftSimulator from '@/components/armchair-gm/MockDraftSimulator';
import {
  DollarSign, TrendingUp, ChevronLeft, Loader2, AlertCircle,
  ArrowLeftRight, Calculator, CalendarRange, BarChart3, PenLine, Trophy,
} from 'lucide-react';

type GMTab = 'tracker' | 'trade' | 'signing' | 'buyout' | 'projection' | 'mockdraft';

const TABS: { id: GMTab; label: string; shortLabel: string; icon: React.ReactNode; description: string }[] = [
  { id: 'tracker', label: 'Cap Tracker', shortLabel: 'Cap', icon: <BarChart3 className="w-4 h-4" />, description: 'View team rosters & cap details' },
  { id: 'trade', label: 'Trade Simulator', shortLabel: 'Trade', icon: <ArrowLeftRight className="w-4 h-4" />, description: 'Simulate trades between teams' },
  { id: 'signing', label: 'Signing Sim', shortLabel: 'Sign', icon: <PenLine className="w-4 h-4" />, description: 'Simulate free agent signings' },
  { id: 'buyout', label: 'Buyout Calculator', shortLabel: 'Buy', icon: <Calculator className="w-4 h-4" />, description: 'Calculate buyout costs & savings' },
  { id: 'projection', label: 'Cap Projection', shortLabel: 'Proj', icon: <CalendarRange className="w-4 h-4" />, description: 'Multi-year cap commitments' },
  { id: 'mockdraft', label: 'Mock Draft', shortLabel: 'Draft', icon: <Trophy className="w-4 h-4" />, description: 'Practice your draft strategy' },
];

const GM_TAB_IDS: GMTab[] = ['tracker', 'trade', 'signing', 'buyout', 'projection', 'mockdraft'];

const ArmchairGM = () => {
  /*
   * THE TAB IS LINKABLE, NOT JUST CLICKABLE.
   *
   * Every "Mock Draft" entry in the app's navigation used to point at
   * /draft — the retired v1 league draft room, behind auth — while the
   * actual mock draft simulator lived here, under a tab nothing could
   * deep-link to. ?tab=mockdraft is what lets navigation reach it.
   */
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab') as GMTab | null;
  const [activeTab, setActiveTab] = useState<GMTab>(
    requestedTab && GM_TAB_IDS.includes(requestedTab) ? requestedTab : 'tracker'
  );
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
    <div className="min-h-screen flex flex-col bg-[#0F1F15] text-pastel-cream">
      <Navbar />

      <main className="flex-1 w-full pt-[var(--header-height)] pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-12">
        {/* Hero Header — deeper #0F1F15 band with orange glow + diagonal stripes for depth */}
        <div className="w-full bg-[#0F1F15] border-b border-white/10 relative isolate overflow-hidden">
          <div aria-hidden="true" className="absolute -top-32 -right-20 w-[480px] h-[480px] bg-pastel-orange/15 rounded-full blur-3xl pointer-events-none" />
          <div aria-hidden="true" className="absolute -bottom-24 -left-20 w-[360px] h-[360px] bg-pastel-sage/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute inset-0 opacity-[0.04] pointer-events-none z-0" aria-hidden="true"
            style={{
              backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 20px, rgba(255,255,255,0.5) 20px, rgba(255,255,255,0.5) 40px)',
            }}
          />

          <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 md:py-8 relative z-10">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="p-2 sm:p-3 rounded-2xl bg-pastel-orange/15 ring-1 ring-pastel-orange/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                <DollarSign className="w-5 h-5 sm:w-7 sm:h-7 md:w-8 md:h-8 text-pastel-orange" />
              </div>
              <div>
                <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-1">
                  ✦ NHL Salary Cap Toolkit
                </div>
                <h1 className="font-calistoga text-xl sm:text-2xl md:text-3xl text-pastel-cream leading-none">
                  Armchair GM
                </h1>
                <p className="text-xs sm:text-sm text-white/55 mt-1.5">
                  NHL Salary Cap Toolkit &middot; {formatCap(SALARY_CAP_2025_26)} cap
                </p>
              </div>
            </div>

            {/* Quick stats bar - hidden on smallest phones, shown as scrollable on sm+ */}
            <div className="hidden sm:flex flex-wrap gap-3 md:gap-6 mt-4">
              <HeroBadge label="Salary Cap" value={formatCap(SALARY_CAP_2025_26)} />
              <HeroBadge label="Cap Floor" value="$70.6M" />
              <HeroBadge label="Max Contracts" value="50" />
              <HeroBadge label="Season" value={SEASON_LABEL} />
            </div>
            {/* Condensed mobile stats row */}
            <div className="flex sm:hidden gap-2 mt-3 overflow-x-auto scrollbar-hide">
              <HeroBadge label="Cap" value={formatCap(SALARY_CAP_2025_26)} />
              <HeroBadge label="Floor" value="$70.6M" />
              <HeroBadge label="Season" value={SEASON_LABEL.slice(2)} />
            </div>
          </div>

          {/* Tab Bar */}
          <div className="max-w-7xl mx-auto px-2 sm:px-4 md:px-6 relative z-10">
            {/* 2026-08-19 — was `overflow-x-auto scrollbar-hide`. Measured
                on production at a 943px viewport: the row needed 973px in
                an 895px container, so "Cap Projection" and "Mock Draft"
                sat entirely offscreen — with the scrollbar deliberately
                hidden and no fade or arrow, there was no way for a user
                to know those two tools existed at all. Two whole features
                invisible. Wrapping guarantees every tab is reachable at
                every width; it costs one extra row on narrow screens,
                which is a trade worth making against hiding a feature. */}
            <div className="flex flex-wrap gap-1 -mb-[2px] pb-[2px]">
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2.5 min-h-[44px] rounded-t-xl text-xs sm:text-sm font-bold transition-all border-2 border-b-0 flex-shrink-0 whitespace-nowrap cursor-pointer",
                    activeTab === tab.id
                      ? "bg-pastel-orange text-[#581E00] border-pastel-orange shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]"
                      : "bg-white/5 text-white/55 border-white/10 hover:bg-white/[0.08] hover:border-pastel-orange/30 hover:text-pastel-cream"
                  )}
                >
                  {tab.icon}
                  <span className="hidden md:inline">{tab.label}</span>
                  <span className="inline md:hidden text-xs sm:text-xs">{tab.shortLabel}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
          {/* Cap Tracker Tab */}
          {activeTab === 'tracker' && (
            <>
              {showTeamSelector || !selectedTeam ? (
                <>
                  <div className="flex items-center gap-3 mb-2">
                    <TrendingUp className="w-5 h-5 text-pastel-orange" />
                    <h2 className="font-calistoga text-lg text-pastel-cream">Select a Team</h2>
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
                    className="flex items-center gap-2 px-4 py-2 rounded-xl ring-1 ring-pastel-cream/30 bg-transparent hover:bg-white/5 hover:ring-pastel-cream/50 transition-colors text-sm text-pastel-cream font-bold"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    All Teams
                  </button>

                  {isLoading && (
                    <div className="flex flex-col items-center justify-center py-20 gap-4">
                      <Loader2 className="w-8 h-8 text-pastel-orange animate-spin" />
                      <span className="text-sm text-white/55">
                        Loading roster data…
                      </span>
                    </div>
                  )}

                  {error && (
                    <div className="flex flex-col items-center justify-center py-12 gap-3 bg-[#1A2A20] ring-1 ring-red-400/40 rounded-2xl shadow-[0_8px_24px_-12px_rgba(248,113,113,0.2)]">
                      <AlertCircle className="w-8 h-8 text-red-300" />
                      <span className="text-sm text-white/70">
                        Unable to load team data. Please try again.
                      </span>
                      <button
                        onClick={() => setSelectedTeam(selectedTeam)}
                        className="px-4 py-2 rounded-lg bg-pastel-orange text-[#581E00] text-sm font-bold hover:bg-pastel-orange-soft transition-colors shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]"
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
                        <p className="text-xs text-white/55">
                          Contract data is based on publicly available information and may not reflect the most recent transactions.
                          <br />
                          Salary cap for 2025-26: {formatCap(SALARY_CAP_2025_26)} · Roster data from NHL.com
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

          {/* Mock Draft Tab */}
          {activeTab === 'mockdraft' && <MockDraftSimulator />}
        </div>
      </main>

      <HockeyFooter variant="app" />
    </div>
  );
};

function HeroBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-white/5 ring-1 ring-white/10 flex-shrink-0">
      <span className="text-[10px] sm:text-xs text-white/55 font-jbmono uppercase tracking-[0.18em] font-bold">{label}</span>
      <span className="text-xs sm:text-sm font-bold text-pastel-cream tabular-nums">{value}</span>
    </div>
  );
}

export default ArmchairGM;
