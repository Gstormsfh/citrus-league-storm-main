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
  ArrowLeftRight, Search, AlertTriangle,
  ChevronDown, Loader2, RotateCcw, Check, X, SlidersHorizontal,
  Save, FolderOpen, Trash2, Clock, Shield,
} from 'lucide-react';
import PlayerAvatar from './PlayerAvatar';

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


interface SavedTrade {
  id: string;
  name: string;
  timestamp: number;
  teamA: string;
  teamB: string;
  playerIdsA: number[];
  playerIdsB: number[];
  retainA: number;
  retainB: number;
}

const STORAGE_KEY = 'citrus-armchair-gm-trades';

function loadSavedTrades(): SavedTrade[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveTrades(trades: SavedTrade[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trades.slice(0, 10)));
}

function getAllPlayers(data: TeamCapData | undefined): PlayerContract[] {
  if (!data) return [];
  return [
    ...data.forwards,
    ...data.defense,
    ...data.goalies,
    ...(data.minorLeague || []),
  ];
}

export default function TradeSimulator() {
  const [teamA, setTeamA] = useState<string | null>(null);
  const [teamB, setTeamB] = useState<string | null>(null);
  const [selectedA, setSelectedA] = useState<Set<number>>(new Set());
  const [selectedB, setSelectedB] = useState<Set<number>>(new Set());
  const [searchA, setSearchA] = useState('');
  const [searchB, setSearchB] = useState('');
  const [retainA, setRetainA] = useState(0);
  const [retainB, setRetainB] = useState(0);
  const [showPickerA, setShowPickerA] = useState(false);
  const [showPickerB, setShowPickerB] = useState(false);
  const [savedTrades, setSavedTrades] = useState<SavedTrade[]>(loadSavedTrades);
  const [showSaved, setShowSaved] = useState(false);

  const { data: dataA, isLoading: loadingA } = useQuery<TeamCapData>({
    queryKey: ['teamCapData', teamA],
    queryFn: () => getTeamCapData(teamA!),
    enabled: !!teamA,
    staleTime: 10 * 60 * 1000,
  });

  const { data: dataB, isLoading: loadingB } = useQuery<TeamCapData>({
    queryKey: ['teamCapData', teamB],
    queryFn: () => getTeamCapData(teamB!),
    enabled: !!teamB,
    staleTime: 10 * 60 * 1000,
  });

  const playersA = useMemo(() => getAllPlayers(dataA), [dataA]);
  const playersB = useMemo(() => getAllPlayers(dataB), [dataB]);

  const pickedA = playersA.filter(p => selectedA.has(p.playerId));
  const pickedB = playersB.filter(p => selectedB.has(p.playerId));

  const hasTrade = pickedA.length > 0 || pickedB.length > 0;

  // Cap impact: Team A sends pickedA, receives pickedB
  const impact = useMemo(() => {
    if (!dataA || !dataB) return null;
    const outA = pickedA.reduce((s, p) => s + p.capHit, 0);
    const outB = pickedB.reduce((s, p) => s + p.capHit, 0);
    const retainedByA = outA * (retainA / 100);
    const retainedByB = outB * (retainB / 100);

    const aNewHit = dataA.projectedCapHit - outA + retainedByA + (outB - retainedByB);
    const bNewHit = dataB.projectedCapHit - outB + retainedByB + (outA - retainedByA);

    return {
      teamA: {
        before: dataA.projectedCapHit,
        after: aNewHit,
        spaceBefore: dataA.capSpace,
        spaceAfter: SALARY_CAP_2025_26 - aNewHit,
        outgoing: outA,
        incoming: outB - retainedByB,
        retained: retainedByA,
      },
      teamB: {
        before: dataB.projectedCapHit,
        after: bNewHit,
        spaceBefore: dataB.capSpace,
        spaceAfter: SALARY_CAP_2025_26 - bNewHit,
        outgoing: outB,
        incoming: outA - retainedByA,
        retained: retainedByB,
      },
    };
  }, [dataA, dataB, pickedA, pickedB, retainA, retainB]);

  // Clause warnings
  const clauseWarnings = useMemo(() => {
    const warnings: string[] = [];
    for (const p of pickedA) {
      if (p.clause === 'NMC') warnings.push(`${p.name} has a No-Movement Clause (must waive)`);
      else if (p.clause === 'NTC') warnings.push(`${p.name} has a No-Trade Clause (must waive)`);
      else if (p.clause === 'M-NTC') warnings.push(`${p.name} has a Modified No-Trade Clause`);
    }
    for (const p of pickedB) {
      if (p.clause === 'NMC') warnings.push(`${p.name} has a No-Movement Clause (must waive)`);
      else if (p.clause === 'NTC') warnings.push(`${p.name} has a No-Trade Clause (must waive)`);
      else if (p.clause === 'M-NTC') warnings.push(`${p.name} has a Modified No-Trade Clause`);
    }
    return warnings;
  }, [pickedA, pickedB]);

  const handleReset = () => {
    setSelectedA(new Set());
    setSelectedB(new Set());
    setRetainA(0);
    setRetainB(0);
    setSearchA('');
    setSearchB('');
  };

  const togglePlayer = (side: 'A' | 'B', playerId: number) => {
    const setter = side === 'A' ? setSelectedA : setSelectedB;
    setter(prev => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  };

  const handleSelectTeam = (side: 'A' | 'B', abbrev: string) => {
    if (side === 'A') {
      setTeamA(abbrev);
      setSelectedA(new Set());
      setRetainA(0);
      setSearchA('');
      setShowPickerA(false);
    } else {
      setTeamB(abbrev);
      setSelectedB(new Set());
      setRetainB(0);
      setSearchB('');
      setShowPickerB(false);
    }
  };

  const filterPlayers = (players: PlayerContract[], query: string) => {
    if (!query.trim()) return players;
    const q = query.toLowerCase();
    return players.filter(
      p => p.name.toLowerCase().includes(q) || p.position.toLowerCase().includes(q)
    );
  };

  const handleSaveTrade = () => {
    if (!teamA || !teamB || !hasTrade) return;
    const teamAInfo = NHL_TEAMS.find(t => t.abbrev === teamA);
    const teamBInfo = NHL_TEAMS.find(t => t.abbrev === teamB);
    const names = [...pickedA.map(p => p.name.split(' ').pop()), ...pickedB.map(p => p.name.split(' ').pop())];
    const label = `${teamAInfo?.name || teamA} / ${teamBInfo?.name || teamB}: ${names.slice(0, 3).join(', ')}${names.length > 3 ? '...' : ''}`;

    const trade: SavedTrade = {
      id: `trade-${Date.now()}`,
      name: label,
      timestamp: Date.now(),
      teamA,
      teamB,
      playerIdsA: [...selectedA],
      playerIdsB: [...selectedB],
      retainA,
      retainB,
    };
    const updated = [trade, ...savedTrades].slice(0, 10);
    setSavedTrades(updated);
    saveTrades(updated);
  };

  const handleLoadTrade = (trade: SavedTrade) => {
    setTeamA(trade.teamA);
    setTeamB(trade.teamB);
    setSelectedA(new Set(trade.playerIdsA));
    setSelectedB(new Set(trade.playerIdsB));
    setRetainA(trade.retainA);
    setRetainB(trade.retainB);
    setSearchA('');
    setSearchB('');
    setShowSaved(false);
  };

  const handleDeleteTrade = (id: string) => {
    const updated = savedTrades.filter(t => t.id !== id);
    setSavedTrades(updated);
    saveTrades(updated);
  };

  return (
    <div className="space-y-6">
      {/* Toolbar: Save/Load */}
      <div className="flex items-center gap-2 flex-wrap">
        {hasTrade && (
          <button
            onClick={handleSaveTrade}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border-2 border-citrus-sage/30 bg-pastel-surface-tile max-lg:bg-pressbox-tile hover:bg-citrus-sage/10 transition-colors text-xs font-display max-lg:font-barlow font-bold text-pastel-cream max-lg:text-pressbox-text"
          >
            <Save className="w-3.5 h-3.5 text-citrus-sage" />
            Save Scenario
          </button>
        )}
        {savedTrades.length > 0 && (
          <button
            onClick={() => setShowSaved(!showSaved)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 rounded-xl border-2 transition-colors text-xs font-display max-lg:font-barlow font-bold",
              showSaved
                ? "border-citrus-sage bg-citrus-sage/20 text-pastel-cream max-lg:text-pressbox-text"
                : "border-citrus-sage/30 bg-pastel-surface-tile max-lg:bg-pressbox-tile hover:bg-citrus-sage/10 text-pastel-cream max-lg:text-pressbox-text"
            )}
          >
            <FolderOpen className="w-3.5 h-3.5 text-citrus-sage" />
            Saved ({savedTrades.length})
          </button>
        )}
      </div>

      {/* Saved Trades Panel */}
      {showSaved && savedTrades.length > 0 && (
        <div className="bg-pastel-surface-tile max-lg:bg-pressbox-tile backdrop-blur-sm rounded-2xl max-lg:rounded-[12px] border-2 border-citrus-sage/30 shadow-varsity overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="px-4 py-2.5 bg-gradient-to-r from-citrus-sage/15 to-citrus-sage/5 border-b border-citrus-sage/20">
            <span className="text-[10px] text-pastel-cream/70 max-lg:text-pressbox-text/70 uppercase font-display max-lg:font-barlow font-bold tracking-wider">Saved Trade Scenarios</span>
          </div>
          {savedTrades.map(trade => (
            <div key={trade.id} className="flex items-center gap-2 px-4 py-2.5 border-b border-citrus-sage/10 hover:bg-citrus-sage/5 transition-colors">
              <Clock className="w-3.5 h-3.5 text-pastel-cream/60 max-lg:text-pressbox-text/60 flex-shrink-0" />
              <button onClick={() => handleLoadTrade(trade)} className="flex-1 text-left min-w-0">
                <div className="font-display max-lg:font-barlow font-bold text-[11px] text-pastel-cream max-lg:text-pressbox-text truncate">{trade.name}</div>
                <div className="text-[9px] text-pastel-cream/60 max-lg:text-pressbox-text/60 font-display max-lg:font-barlow">
                  {new Date(trade.timestamp).toLocaleDateString()} {new Date(trade.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </button>
              <button onClick={() => handleDeleteTrade(trade.id)} className="p-1 rounded-lg hover:bg-red-100 transition-colors">
                <Trash2 className="w-3 h-3 text-red-400" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Instructions */}
      {!teamA && !teamB && !showSaved && (
        <div className="text-center py-8 bg-pastel-surface-tile max-lg:bg-pressbox-tile backdrop-blur-sm rounded-2xl max-lg:rounded-[12px] border-2 border-dashed border-citrus-sage/40">
          <ArrowLeftRight className="w-10 h-10 text-citrus-sage/50 mx-auto mb-3" />
          <h3 className="font-varsity max-lg:font-condensed text-lg text-pastel-cream max-lg:text-pressbox-text mb-1">Trade Simulator</h3>
          <p className="text-sm text-pastel-cream/70 max-lg:text-pressbox-text/70 font-display max-lg:font-barlow max-w-md mx-auto">
            Select two teams below to start building a trade. See real-time cap impact, trade clause warnings, and salary retention options.
          </p>
        </div>
      )}

      {/* Two-Panel Layout - always side by side on md+ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* Side A */}
        <TradePanel
          label="Team A"
          team={teamA}
          players={filterPlayers(playersA, searchA)}
          selected={selectedA}
          search={searchA}
          onSearch={setSearchA}
          loading={loadingA}
          otherTeam={teamB}
          showPicker={showPickerA}
          onTogglePicker={() => setShowPickerA(!showPickerA)}
          onSelectTeam={(a) => handleSelectTeam('A', a)}
          onTogglePlayer={(id) => togglePlayer('A', id)}
          retention={retainA}
          onRetention={setRetainA}
          teamData={dataA}
        />

        {/* Mobile Divider */}
        <div className="flex lg:hidden items-center justify-center py-1">
          <div className="flex-1 h-px bg-citrus-sage/30" />
          <div className="w-8 h-8 rounded-full bg-citrus-forest flex items-center justify-center shadow-md mx-3">
            <ArrowLeftRight className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 h-px bg-citrus-sage/30" />
        </div>

        {/* Side B */}
        <TradePanel
          label="Team B"
          team={teamB}
          players={filterPlayers(playersB, searchB)}
          selected={selectedB}
          search={searchB}
          onSearch={setSearchB}
          loading={loadingB}
          otherTeam={teamA}
          showPicker={showPickerB}
          onTogglePicker={() => setShowPickerB(!showPickerB)}
          onSelectTeam={(a) => handleSelectTeam('B', a)}
          onTogglePlayer={(id) => togglePlayer('B', id)}
          retention={retainB}
          onRetention={setRetainB}
          teamData={dataB}
        />
      </div>

      {/* Trade Summary */}
      {hasTrade && impact && dataA && dataB && (
        <div className="bg-pastel-surface-tile max-lg:bg-pressbox-tile backdrop-blur-sm rounded-2xl max-lg:rounded-[12px] border-2 border-citrus-sage/30 shadow-varsity overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="px-4 md:px-6 py-3 bg-gradient-to-r from-citrus-forest via-citrus-forest/95 to-citrus-forest border-b-2 border-citrus-sage/30 flex items-center justify-between">
            <h3 className="font-varsity max-lg:font-condensed text-lg text-citrus-cream flex items-center gap-2">
              <ArrowLeftRight className="w-5 h-5" />
              Trade Summary
            </h3>
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-citrus-sage/20 hover:bg-citrus-sage/30 text-citrus-cream text-xs font-display max-lg:font-barlow font-bold transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
          </div>

          <div className="p-4 md:p-6">
            {/* Trade cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <TradeSummaryCard
                teamName={dataA.teamName}
                logoUrl={dataA.logoUrl}
                receives={pickedB}
                sends={pickedA}
                capBefore={impact.teamA.before}
                capAfter={impact.teamA.after}
                spaceBefore={impact.teamA.spaceBefore}
                spaceAfter={impact.teamA.spaceAfter}
                retained={impact.teamA.retained}
                retainLabel={retainA > 0 ? `Retaining ${retainA}%` : undefined}
              />
              <TradeSummaryCard
                teamName={dataB.teamName}
                logoUrl={dataB.logoUrl}
                receives={pickedA}
                sends={pickedB}
                capBefore={impact.teamB.before}
                capAfter={impact.teamB.after}
                spaceBefore={impact.teamB.spaceBefore}
                spaceAfter={impact.teamB.spaceAfter}
                retained={impact.teamB.retained}
                retainLabel={retainB > 0 ? `Retaining ${retainB}%` : undefined}
              />
            </div>

            {/* Trade Status */}
            <div className="flex flex-col gap-2">
              {impact.teamA.spaceAfter >= 0 && impact.teamB.spaceAfter >= 0 ? (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-green-50 border-2 border-green-200">
                  <Check className="w-5 h-5 text-green-600" />
                  <span className="text-sm font-display max-lg:font-barlow font-bold text-green-700">
                    Trade is cap compliant for both teams
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 border-2 border-red-200">
                  <X className="w-5 h-5 text-red-600" />
                  <span className="text-sm font-display max-lg:font-barlow font-bold text-red-700">
                    Trade puts {impact.teamA.spaceAfter < 0 ? dataA.teamName : dataB.teamName} over the cap
                  </span>
                </div>
              )}

              {/* Clause warnings */}
              {clauseWarnings.map((w, i) => (
                <div key={i} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-50 border border-amber-200">
                  <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                  <span className="text-xs font-display max-lg:font-barlow text-amber-700">{w}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Trade Panel (one side) ─────────────────────────── */

function TradePanel({
  label, team, players, selected, search, onSearch, loading,
  otherTeam, showPicker, onTogglePicker, onSelectTeam, onTogglePlayer,
  retention, onRetention, teamData,
}: {
  label: string;
  team: string | null;
  players: PlayerContract[];
  selected: Set<number>;
  search: string;
  onSearch: (q: string) => void;
  loading: boolean;
  otherTeam: string | null;
  showPicker: boolean;
  onTogglePicker: () => void;
  onSelectTeam: (abbrev: string) => void;
  onTogglePlayer: (id: number) => void;
  retention: number;
  onRetention: (v: number) => void;
  teamData: TeamCapData | undefined;
}) {
  const teamInfo = team ? NHL_TEAMS.find(t => t.abbrev === team) : null;
  const [imgErr, setImgErr] = useState(false);

  return (
    <div className="bg-pastel-surface-tile max-lg:bg-pressbox-tile backdrop-blur-sm rounded-2xl max-lg:rounded-[12px] border-2 border-citrus-sage/30 shadow-varsity overflow-hidden flex flex-col">
      {/* Team Header */}
      <button
        onClick={onTogglePicker}
        className="w-full px-4 py-3 bg-gradient-to-r from-citrus-sage/20 via-citrus-sage/10 to-citrus-sage/20 border-b-2 border-citrus-sage/30 flex items-center gap-3 hover:from-citrus-sage/25 hover:to-citrus-sage/25 transition-colors"
      >
        {teamInfo && !imgErr ? (
          <img loading="lazy" decoding="async" src={teamInfo.logoUrl} alt={teamInfo.abbrev} className="w-8 h-8 object-contain" onError={() => setImgErr(true)} />
        ) : (
          <div className="w-8 h-8 rounded-full bg-citrus-sage/20 flex items-center justify-center">
            <Shield className="w-4 h-4 text-citrus-sage/60" />
          </div>
        )}
        <div className="flex-1 text-left">
          <div className="text-[10px] text-pastel-cream/65 max-lg:text-pressbox-text/65 uppercase font-display max-lg:font-barlow font-bold tracking-wider">{label}</div>
          <div className="font-varsity max-lg:font-condensed text-base text-pastel-cream max-lg:text-pressbox-text">
            {teamInfo ? teamInfo.fullName : 'Select a team'}
          </div>
        </div>
        <ChevronDown className={cn("w-4 h-4 text-pastel-cream/60 max-lg:text-pressbox-text/60 transition-transform", showPicker && "rotate-180")} />
      </button>

      {/* Team Picker Dropdown */}
      {showPicker && (
        <div className="p-2 border-b-2 border-citrus-sage/20 bg-citrus-cream/30 max-h-48 overflow-y-auto">
          <div className="grid grid-cols-4 gap-1">
            {NHL_TEAMS.filter(t => t.abbrev !== otherTeam).map(t => (
              <button
                key={t.abbrev}
                onClick={() => onSelectTeam(t.abbrev)}
                className={cn(
                  "flex flex-col items-center gap-0.5 p-1.5 rounded-lg border transition-all",
                  team === t.abbrev
                    ? "border-citrus-sage bg-citrus-sage/20"
                    : "border-transparent hover:border-citrus-sage/30 hover:bg-citrus-sage/5"
                )}
              >
                <img loading="lazy" decoding="async" src={t.logoUrl} alt={t.abbrev} className="w-6 h-6 object-contain" />
                <span className="text-[8px] font-varsity max-lg:font-condensed text-pastel-cream max-lg:text-pressbox-text">{t.abbrev}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      {team && (
        <div className="flex-1 flex flex-col">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-citrus-sage animate-spin" />
            </div>
          ) : (
            <>
              {/* Search */}
              <div className="px-3 py-2 border-b border-citrus-sage/20">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-pastel-cream/60 max-lg:text-pressbox-text/60" />
                  <input
                    type="text"
                    placeholder="Search players..."
                    value={search}
                    onChange={e => onSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-citrus-sage/30 bg-pastel-surface-tile max-lg:bg-pressbox-tile text-xs font-display max-lg:font-barlow text-pastel-cream max-lg:text-pressbox-text placeholder:text-pastel-cream/60 placeholder:max-lg:text-pressbox-text/60 focus:outline-none focus:border-citrus-sage transition-all"
                  />
                </div>
              </div>

              {/* Retention slider */}
              <div className="px-3 py-2 border-b border-citrus-sage/20 bg-citrus-cream/20">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-pastel-cream/65 max-lg:text-pressbox-text/65 flex-shrink-0" />
                  <span className="text-[9px] text-pastel-cream/70 max-lg:text-pressbox-text/70 font-display max-lg:font-barlow font-bold uppercase tracking-wider flex-shrink-0">Retain</span>
                  <input
                    type="range"
                    min={0}
                    max={50}
                    step={5}
                    value={retention}
                    onChange={e => onRetention(Number(e.target.value))}
                    className="flex-1 h-1.5 accent-citrus-sage"
                  />
                  <span className="text-xs font-varsity max-lg:font-condensed text-pastel-cream max-lg:text-pressbox-text w-8 text-right">{retention}%</span>
                </div>
              </div>

              {/* Player list */}
              <div className="flex-1 max-h-80 overflow-y-auto">
                {players.length === 0 ? (
                  <div className="text-center py-8 text-xs text-pastel-cream/65 max-lg:text-pressbox-text/65 font-display max-lg:font-barlow">
                    {search ? 'Nobody matches that search.' : 'No contracts on file for this team.'}
                  </div>
                ) : (
                  players.map(p => (
                    <TradePlayerRow
                      key={p.playerId}
                      player={p}
                      isSelected={selected.has(p.playerId)}
                      onToggle={() => onTogglePlayer(p.playerId)}
                      retentionPct={retention}
                    />
                  ))
                )}
              </div>

              {/* Selected count */}
              {selected.size > 0 && (
                <div className="px-3 py-2 bg-citrus-sage/15 border-t-2 border-citrus-sage/30 flex items-center justify-between">
                  <span className="text-[10px] font-display max-lg:font-barlow font-bold text-pastel-cream max-lg:text-pressbox-text uppercase tracking-wider">
                    {selected.size} player{selected.size !== 1 ? 's' : ''} selected
                  </span>
                  <span className="font-varsity max-lg:font-condensed text-sm text-pastel-cream max-lg:text-pressbox-text">
                    {formatCap(players.filter(p => selected.has(p.playerId)).reduce((s, p) => s + p.capHit, 0))}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Trade Player Row ───────────────────────────────── */

function TradePlayerRow({
  player, isSelected, onToggle, retentionPct,
}: {
  player: PlayerContract;
  isSelected: boolean;
  onToggle: () => void;
  retentionPct: number;
}) {
  const effectiveCap = player.capHit * (1 - retentionPct / 100);

  return (
    <button
      onClick={onToggle}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-2 transition-all text-left border-b border-citrus-sage/10",
        isSelected
          ? "bg-citrus-sage/20 border-l-4 border-l-citrus-sage"
          : "hover:bg-citrus-sage/5"
      )}
    >
      {/* Checkbox */}
      <div className={cn(
        "w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors",
        isSelected ? "bg-citrus-sage border-citrus-sage" : "border-citrus-charcoal/30"
      )}>
        {isSelected && <Check className="w-3 h-3 text-white" />}
      </div>

      {/* Player Avatar */}
      <PlayerAvatar name={player.name} position={player.position} image={player.headshot} team={player.team} size="xs" />

      {/* Name + Position */}
      <div className="flex-1 min-w-0">
        <div className="font-display max-lg:font-barlow font-bold text-[11px] text-pastel-cream max-lg:text-pressbox-text truncate">{player.name}</div>
        <div className="flex items-center gap-1">
          <Badge className="bg-citrus-sage/20 text-pastel-cream max-lg:text-pressbox-text text-[7px] h-3.5 px-1 font-varsity max-lg:font-condensed border border-citrus-sage/40">
            {player.position}
          </Badge>
          {player.clause && (
            <Badge className={cn(
              "text-[6px] h-3 px-1 border",
              player.clause === 'NMC' ? "bg-red-100 text-red-700 border-red-200" :
              player.clause === 'NTC' ? "bg-orange-100 text-orange-700 border-orange-200" :
              "bg-amber-100 text-amber-700 border-amber-200"
            )}>
              {player.clause}
            </Badge>
          )}
          {player.rosterStatus !== 'NHL' && (
            <Badge className="bg-slate-500 text-white text-[6px] h-3 px-1">{player.rosterStatus}</Badge>
          )}
        </div>
      </div>

      {/* Cap Hit */}
      <div className="text-right flex-shrink-0">
        <div className="font-varsity max-lg:font-condensed text-xs text-pastel-cream max-lg:text-pressbox-text">{formatCap(player.capHit)}</div>
        {retentionPct > 0 && (
          <div className="text-[8px] text-pastel-cream/65 max-lg:text-pressbox-text/65 font-display max-lg:font-barlow">
            net {formatCap(effectiveCap)}
          </div>
        )}
        <div className="text-[8px] text-pastel-cream/65 max-lg:text-pressbox-text/65 font-display max-lg:font-barlow">
          {player.yearsRemaining}yr &middot; {player.expiryStatus}
        </div>
      </div>
    </button>
  );
}

/* ── Trade Summary Card ─────────────────────────────── */

function TradeSummaryCard({
  teamName, logoUrl, receives, sends,
  capBefore, capAfter, spaceBefore, spaceAfter,
  retained, retainLabel,
}: {
  teamName: string;
  logoUrl: string;
  receives: PlayerContract[];
  sends: PlayerContract[];
  capBefore: number;
  capAfter: number;
  spaceBefore: number;
  spaceAfter: number;
  retained: number;
  retainLabel?: string;
}) {
  const [imgErr, setImgErr] = useState(false);
  const capDelta = capAfter - capBefore;

  return (
    <div className="bg-citrus-cream/40 rounded-xl border-2 border-citrus-sage/20 p-4">
      {/* Team header */}
      <div className="flex items-center gap-2 mb-3">
        {!imgErr ? (
          <img loading="lazy" decoding="async" src={logoUrl} alt={teamName} className="w-8 h-8 object-contain" onError={() => setImgErr(true)} />
        ) : (
          <Shield className="w-8 h-8 text-citrus-sage/50" />
        )}
        <span className="font-varsity max-lg:font-condensed text-base text-pastel-cream max-lg:text-pressbox-text">{teamName}</span>
      </div>

      {/* Receives */}
      {receives.length > 0 && (
        <div className="mb-2">
          <div className="text-[9px] text-green-700 uppercase font-display max-lg:font-barlow font-bold tracking-wider mb-1">Acquires</div>
          {receives.map(p => (
            <div key={p.playerId} className="flex items-center justify-between py-0.5">
              <span className="text-xs font-display max-lg:font-barlow text-pastel-cream max-lg:text-pressbox-text">{p.name} <span className="text-pastel-cream/65 max-lg:text-pressbox-text/65">({p.position})</span></span>
              <span className="text-xs font-varsity max-lg:font-condensed text-green-700">+{formatCap(p.capHit)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Sends */}
      {sends.length > 0 && (
        <div className="mb-3">
          <div className="text-[9px] text-red-700 uppercase font-display max-lg:font-barlow font-bold tracking-wider mb-1">Sends</div>
          {sends.map(p => (
            <div key={p.playerId} className="flex items-center justify-between py-0.5">
              <span className="text-xs font-display max-lg:font-barlow text-pastel-cream max-lg:text-pressbox-text">{p.name} <span className="text-pastel-cream/65 max-lg:text-pressbox-text/65">({p.position})</span></span>
              <span className="text-xs font-varsity max-lg:font-condensed text-red-600">-{formatCap(p.capHit)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Retention */}
      {retainLabel && retained > 0 && (
        <div className="px-2 py-1 mb-3 rounded-lg bg-amber-50 border border-amber-200 text-[9px] font-display max-lg:font-barlow text-amber-700">
          {retainLabel} salary ({formatCap(retained)} dead cap)
        </div>
      )}

      {/* Cap Impact */}
      <div className="border-t border-citrus-sage/20 pt-3 space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="font-display max-lg:font-barlow text-pastel-cream/70 max-lg:text-pressbox-text/70">Cap Before</span>
          <span className="font-varsity max-lg:font-condensed text-pastel-cream/85 max-lg:text-pressbox-text/85">{formatCapFull(capBefore)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="font-display max-lg:font-barlow text-pastel-cream/70 max-lg:text-pressbox-text/70">Cap After</span>
          <span className="font-varsity max-lg:font-condensed text-pastel-cream/85 max-lg:text-pressbox-text/85">{formatCapFull(capAfter)}</span>
        </div>
        <div className="flex justify-between text-xs font-bold">
          <span className="font-display max-lg:font-barlow text-pastel-cream/70 max-lg:text-pressbox-text/70">Net Change</span>
          <span className={cn("font-varsity max-lg:font-condensed", capDelta > 0 ? "text-red-600" : "text-green-600")}>
            {capDelta > 0 ? '+' : ''}{formatCap(capDelta)}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="font-display max-lg:font-barlow font-bold text-pastel-cream max-lg:text-pressbox-text">Cap Space</span>
          <span className={cn("font-varsity max-lg:font-condensed font-bold", spaceAfter < 0 ? "text-red-600" : "text-green-600")}>
            {formatCap(spaceAfter)}
          </span>
        </div>
      </div>
    </div>
  );
}
