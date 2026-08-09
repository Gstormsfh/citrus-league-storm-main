import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import {
  PlayerContract, TeamCapData, NHL_TEAMS,
  formatCap, SALARY_CAP_2025_26, MAX_CONTRACTS,
} from '@/types/captracker';
import { getTeamCapData } from '@/services/NHLCapService';
import { Badge } from '@/components/ui/badge';
import {
  PenLine, ChevronDown, Loader2, Shield, Plus, Trash2,
  TrendingUp, TrendingDown, UserPlus, RotateCcw, AlertTriangle,
} from 'lucide-react';

interface HypotheticalSigning {
  id: string;
  name: string;
  position: string;
  aav: number;
  term: number;
  isResign: boolean;
  replacesPlayerId?: number;
}

const POSITIONS = ['C', 'LW', 'RW', 'D', 'G'] as const;

export default function SigningSimulator() {
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [showTeamPicker, setShowTeamPicker] = useState(false);
  const [signings, setSignings] = useState<HypotheticalSigning[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showResignPicker, setShowResignPicker] = useState(false);
  const [resignTarget, setResignTarget] = useState<PlayerContract | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formPosition, setFormPosition] = useState<string>('C');
  const [formAAV, setFormAAV] = useState('');
  const [formTerm, setFormTerm] = useState('');

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

  const expiringPlayers = useMemo(() =>
    allPlayers
      .filter(p => (p.expiryStatus === 'UFA' || p.expiryStatus === 'RFA') && p.yearsRemaining <= 1)
      .sort((a, b) => b.capHit - a.capHit),
    [allPlayers]
  );

  // Calculate impact
  const impact = useMemo(() => {
    if (!teamData) return null;
    const totalNewCap = signings.reduce((s, sig) => s + sig.aav, 0);
    const removedCap = signings
      .filter(s => s.replacesPlayerId)
      .reduce((s, sig) => {
        const player = allPlayers.find(p => p.playerId === sig.replacesPlayerId);
        return s + (player?.capHit || 0);
      }, 0);

    const netChange = totalNewCap - removedCap;
    const newProjected = teamData.projectedCapHit + netChange;
    const newSpace = SALARY_CAP_2025_26 - newProjected;
    const newContracts = teamData.totalContracts + signings.filter(s => !s.replacesPlayerId).length;

    return {
      currentHit: teamData.projectedCapHit,
      currentSpace: teamData.capSpace,
      totalNewCap,
      removedCap,
      netChange,
      newProjected,
      newSpace,
      newContracts,
      isOverCap: newSpace < 0,
      isOverContracts: newContracts > MAX_CONTRACTS,
    };
  }, [teamData, signings, allPlayers]);

  const teamInfo = selectedTeam ? NHL_TEAMS.find(t => t.abbrev === selectedTeam) : null;

  const handleSelectTeam = (abbrev: string) => {
    setSelectedTeam(abbrev);
    setShowTeamPicker(false);
    setSignings([]);
  };

  const parseAAV = (input: string): number => {
    const cleaned = input.replace(/[$,]/g, '').trim();
    const num = parseFloat(cleaned);
    if (isNaN(num)) return 0;
    if (num < 10_000) return num * 1_000_000; // e.g., "5.5" -> $5.5M
    return num;
  };

  const addSigning = (resign?: PlayerContract) => {
    const aav = parseAAV(formAAV);
    const term = parseInt(formTerm) || 1;

    if (resign) {
      setSignings(prev => [...prev, {
        id: `sig-${Date.now()}`,
        name: resign.name,
        position: resign.position,
        aav,
        term,
        isResign: true,
        replacesPlayerId: resign.playerId,
      }]);
    } else {
      if (!formName.trim()) return;
      setSignings(prev => [...prev, {
        id: `sig-${Date.now()}`,
        name: formName.trim(),
        position: formPosition,
        aav,
        term,
        isResign: false,
      }]);
    }

    resetForm();
  };

  const removeSigning = (id: string) => {
    setSignings(prev => prev.filter(s => s.id !== id));
  };

  const resetForm = () => {
    setFormName('');
    setFormAAV('');
    setFormTerm('');
    setShowForm(false);
    setShowResignPicker(false);
    setResignTarget(null);
  };

  const resetAll = () => {
    setSignings([]);
    resetForm();
  };

  return (
    <div className="space-y-6">
      {/* Instructions */}
      {!selectedTeam && (
        <div className="text-center py-8 bg-white/60 backdrop-blur-sm rounded-2xl border-2 border-dashed border-citrus-sage/40">
          <PenLine className="w-10 h-10 text-citrus-sage/50 mx-auto mb-3" />
          <h3 className="font-varsity text-lg text-citrus-forest mb-1">Signing Simulator</h3>
          <p className="text-sm text-citrus-charcoal/60 font-display max-w-md mx-auto">
            Add hypothetical signings to any team. Re-sign expiring players or add free agents
            and see real-time cap impact.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Left Panel: Team + Signing Controls */}
        <div className="lg:col-span-2 space-y-4">
          {/* Team Selector */}
          <div className="bg-white/60 backdrop-blur-sm rounded-2xl border-2 border-citrus-sage/30 shadow-varsity overflow-hidden">
            <button
              onClick={() => setShowTeamPicker(!showTeamPicker)}
              className="w-full px-4 py-3 bg-gradient-to-r from-citrus-sage/20 to-citrus-sage/10 flex items-center gap-3 hover:from-citrus-sage/25 transition-colors"
            >
              {teamInfo ? (
                <img loading="lazy" decoding="async" src={teamInfo.logoUrl} alt={teamInfo.abbrev} className="w-8 h-8 object-contain" />
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
                        selectedTeam === t.abbrev ? "border-citrus-sage bg-citrus-sage/20" : "border-transparent hover:border-citrus-sage/30"
                      )}
                    >
                      <img loading="lazy" decoding="async" src={t.logoUrl} alt={t.abbrev} className="w-6 h-6 object-contain" />
                      <span className="text-[8px] font-varsity text-citrus-forest">{t.abbrev}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          {selectedTeam && !isLoading && teamData && (
            <div className="space-y-3">
              {/* Add New Signing */}
              <button
                onClick={() => { setShowForm(true); setShowResignPicker(false); }}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all font-display font-bold text-sm",
                  showForm && !showResignPicker
                    ? "bg-citrus-sage/20 border-citrus-sage text-citrus-forest"
                    : "bg-white/60 border-citrus-sage/30 text-citrus-forest hover:bg-citrus-sage/10"
                )}
              >
                <UserPlus className="w-5 h-5 text-citrus-sage" />
                Sign Free Agent
              </button>

              {/* Re-sign Expiring */}
              {expiringPlayers.length > 0 && (
                <button
                  onClick={() => { setShowResignPicker(true); setShowForm(false); }}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all font-display font-bold text-sm",
                    showResignPicker
                      ? "bg-citrus-sage/20 border-citrus-sage text-citrus-forest"
                      : "bg-white/60 border-citrus-sage/30 text-citrus-forest hover:bg-citrus-sage/10"
                  )}
                >
                  <PenLine className="w-5 h-5 text-citrus-sage" />
                  Re-sign Expiring Player
                  <Badge className="bg-amber-100 text-amber-700 text-[8px] font-varsity border border-amber-200 ml-auto">
                    {expiringPlayers.length}
                  </Badge>
                </button>
              )}

              {/* New Signing Form */}
              {showForm && !showResignPicker && (
                <div className="bg-white/60 backdrop-blur-sm rounded-2xl border-2 border-citrus-sage/30 p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                  <h4 className="font-varsity text-sm text-citrus-forest">
                    {resignTarget ? `Re-sign ${resignTarget.name}` : 'New Free Agent Signing'}
                  </h4>
                  {resignTarget && (
                    <div className="text-[10px] text-citrus-charcoal/50 font-display -mt-2">
                      Current cap hit: <span className="font-varsity text-citrus-forest">{formatCap(resignTarget.capHit)}</span>
                    </div>
                  )}

                  {!resignTarget && (
                    <input
                      type="text"
                      placeholder="Player name..."
                      value={formName}
                      onChange={e => setFormName(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-citrus-sage/30 bg-white/60 text-xs font-display text-citrus-forest placeholder:text-citrus-charcoal/40 focus:outline-none focus:border-citrus-sage"
                    />
                  )}

                  <div className="grid grid-cols-[4rem_1fr_4rem] sm:grid-cols-3 gap-2">
                    <select
                      value={formPosition}
                      onChange={e => setFormPosition(e.target.value)}
                      className="px-1.5 sm:px-2 py-2 rounded-lg border border-citrus-sage/30 bg-white/60 text-xs font-display text-citrus-forest focus:outline-none focus:border-citrus-sage"
                    >
                      {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <input
                      type="text"
                      placeholder="AAV ($M)"
                      value={formAAV}
                      onChange={e => setFormAAV(e.target.value)}
                      className="px-2 py-2 rounded-lg border border-citrus-sage/30 bg-white/60 text-xs font-display text-citrus-forest placeholder:text-citrus-charcoal/40 focus:outline-none focus:border-citrus-sage min-w-0"
                    />
                    <input
                      type="text"
                      placeholder="Yrs"
                      value={formTerm}
                      onChange={e => setFormTerm(e.target.value)}
                      className="px-1.5 sm:px-2 py-2 rounded-lg border border-citrus-sage/30 bg-white/60 text-xs font-display text-citrus-forest placeholder:text-citrus-charcoal/40 focus:outline-none focus:border-citrus-sage min-w-0"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        if (resignTarget) {
                          addSigning(resignTarget);
                          setResignTarget(null);
                        } else {
                          addSigning();
                        }
                      }}
                      disabled={(!resignTarget && !formName.trim()) || !formAAV}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-citrus-sage text-white text-xs font-display font-bold hover:bg-citrus-sage/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {resignTarget ? 'Re-sign' : 'Add Signing'}
                    </button>
                    <button
                      onClick={resetForm}
                      className="px-3 py-2 rounded-lg border border-citrus-sage/30 text-citrus-charcoal/60 text-xs font-display hover:bg-citrus-sage/10 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Re-sign Picker */}
              {showResignPicker && (
                <div className="bg-white/60 backdrop-blur-sm rounded-2xl border-2 border-citrus-sage/30 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="px-4 py-2.5 bg-citrus-sage/10 border-b border-citrus-sage/20">
                    <span className="text-[10px] text-citrus-charcoal/60 uppercase font-display font-bold tracking-wider">
                      Select expiring player to re-sign
                    </span>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {expiringPlayers.map(p => {
                      const alreadySigned = signings.some(s => s.replacesPlayerId === p.playerId);
                      return (
                        <button
                          key={p.playerId}
                          onClick={() => {
                            if (!alreadySigned) {
                              setResignTarget(p);
                              setFormName(p.name);
                              setFormPosition(p.position);
                              setFormAAV('');
                              setFormTerm('');
                              setShowResignPicker(false);
                              setShowForm(true);
                            }
                          }}
                          disabled={alreadySigned}
                          className={cn(
                            "w-full flex items-center gap-2 px-3 py-2 text-left border-b border-citrus-sage/10 transition-colors",
                            alreadySigned ? "opacity-40 cursor-not-allowed" : "hover:bg-citrus-sage/5"
                          )}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="font-display font-bold text-[11px] text-citrus-forest truncate">{p.name}</div>
                            <div className="flex items-center gap-1">
                              <Badge className="bg-citrus-sage/20 text-citrus-forest text-[7px] h-3.5 px-1 font-varsity border border-citrus-sage/40">{p.position}</Badge>
                              <Badge className={cn("text-[7px] h-3.5 px-1 font-varsity", p.expiryStatus === 'UFA' ? "bg-red-500/80 text-white" : "bg-amber-500/80 text-white")}>{p.expiryStatus}</Badge>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-varsity text-xs text-citrus-forest">{formatCap(p.capHit)}</div>
                            <div className="text-[8px] text-citrus-charcoal/50 font-display">current</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="px-3 py-2 border-t border-citrus-sage/20">
                    <button onClick={resetForm} className="text-xs text-citrus-charcoal/50 font-display hover:text-citrus-forest transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Reset All */}
              {signings.length > 0 && (
                <button
                  onClick={resetAll}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl border-2 border-red-200 bg-red-50/50 text-red-600 text-xs font-display font-bold hover:bg-red-100 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Clear All Signings
                </button>
              )}
            </div>
          )}

          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-citrus-sage animate-spin" />
            </div>
          )}
        </div>

        {/* Right Panel: Results */}
        <div className="lg:col-span-3 space-y-4">
          {teamData && impact && (
            <>
              {/* Cap Impact Dashboard */}
              <div className="bg-white/60 backdrop-blur-sm rounded-2xl border-2 border-citrus-sage/30 shadow-varsity overflow-hidden">
                <div className="px-4 md:px-6 py-3 bg-gradient-to-r from-citrus-forest via-citrus-forest/95 to-citrus-forest flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {teamInfo && <img loading="lazy" decoding="async" src={teamInfo.logoUrl} alt={teamInfo.abbrev} className="w-8 h-8 object-contain" />}
                    <div>
                      <h3 className="font-varsity text-lg text-citrus-cream">{teamData.teamName}</h3>
                      <p className="text-[10px] text-citrus-sage/70 font-display">Cap Impact Analysis</p>
                    </div>
                  </div>
                </div>

                <div className="p-4">
                  {/* Before / After comparison */}
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="bg-citrus-cream/40 rounded-xl border border-citrus-sage/20 p-3">
                      <div className="text-[9px] text-citrus-charcoal/50 uppercase font-display font-bold tracking-wider mb-2">Current</div>
                      <div className="space-y-1.5">
                        <div className="flex justify-between">
                          <span className="text-[10px] text-citrus-charcoal/60 font-display">Cap Hit</span>
                          <span className="font-varsity text-xs text-citrus-forest">{formatCap(impact.currentHit)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[10px] text-citrus-charcoal/60 font-display">Cap Space</span>
                          <span className={cn("font-varsity text-xs", impact.currentSpace < 0 ? "text-red-600" : "text-green-600")}>{formatCap(impact.currentSpace)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[10px] text-citrus-charcoal/60 font-display">Contracts</span>
                          <span className="font-varsity text-xs text-citrus-forest">{teamData.totalContracts} / {MAX_CONTRACTS}</span>
                        </div>
                      </div>
                    </div>

                    <div className={cn(
                      "rounded-xl border p-3",
                      signings.length === 0 ? "bg-citrus-cream/40 border-citrus-sage/20" :
                      impact.isOverCap ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"
                    )}>
                      <div className="text-[9px] text-citrus-charcoal/50 uppercase font-display font-bold tracking-wider mb-2">
                        {signings.length === 0 ? 'Projected' : 'After Signings'}
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex justify-between">
                          <span className="text-[10px] text-citrus-charcoal/60 font-display">Cap Hit</span>
                          <span className="font-varsity text-xs text-citrus-forest">{formatCap(impact.newProjected)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[10px] text-citrus-charcoal/60 font-display">Cap Space</span>
                          <span className={cn("font-varsity text-xs", impact.newSpace < 0 ? "text-red-600" : "text-green-600")}>
                            {impact.newSpace < 0 ? '-' : ''}{formatCap(Math.abs(impact.newSpace))}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[10px] text-citrus-charcoal/60 font-display">Contracts</span>
                          <span className={cn("font-varsity text-xs", impact.isOverContracts ? "text-red-600" : "text-citrus-forest")}>
                            {impact.newContracts} / {MAX_CONTRACTS}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Net Change */}
                  {signings.length > 0 && (
                    <div className={cn(
                      "flex items-center justify-between px-4 py-2.5 rounded-xl border-2",
                      impact.netChange > 0 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"
                    )}>
                      <span className="text-xs font-display font-bold text-citrus-charcoal/70">Net Cap Change</span>
                      <div className="flex items-center gap-1.5">
                        {impact.netChange > 0 ? (
                          <TrendingUp className="w-4 h-4 text-red-600" />
                        ) : (
                          <TrendingDown className="w-4 h-4 text-green-600" />
                        )}
                        <span className={cn("font-varsity text-base", impact.netChange > 0 ? "text-red-600" : "text-green-600")}>
                          {impact.netChange > 0 ? '+' : ''}{formatCap(impact.netChange)}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Warnings */}
                  {impact.isOverCap && signings.length > 0 && (
                    <div className="flex items-center gap-2 px-4 py-2.5 mt-3 rounded-xl bg-red-50 border-2 border-red-200">
                      <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
                      <span className="text-xs font-display font-bold text-red-700">
                        Team would be {formatCap(Math.abs(impact.newSpace))} over the salary cap
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Signings List */}
              {signings.length > 0 && (
                <div className="bg-white/60 backdrop-blur-sm rounded-2xl border-2 border-citrus-sage/30 shadow-varsity overflow-hidden">
                  <div className="px-4 py-3 bg-gradient-to-r from-citrus-sage/20 to-citrus-sage/10 border-b-2 border-citrus-sage/30">
                    <h4 className="font-varsity text-base text-citrus-forest">
                      Hypothetical Signings ({signings.length})
                    </h4>
                  </div>

                  {signings.map((sig, i) => {
                    const oldPlayer = sig.replacesPlayerId
                      ? allPlayers.find(p => p.playerId === sig.replacesPlayerId)
                      : null;

                    return (
                      <div
                        key={sig.id}
                        className={cn(
                          "flex items-center gap-3 px-4 py-3 border-b border-citrus-sage/10",
                          i % 2 === 0 ? "bg-white/40" : "bg-citrus-cream/30"
                        )}
                      >
                        <div className="w-8 h-8 rounded-full bg-citrus-sage/20 flex items-center justify-center flex-shrink-0">
                          {sig.isResign ? (
                            <PenLine className="w-4 h-4 text-citrus-sage" />
                          ) : (
                            <UserPlus className="w-4 h-4 text-citrus-sage" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="font-display font-bold text-xs text-citrus-forest truncate">{sig.name}</div>
                          <div className="flex items-center gap-1.5">
                            <Badge className="bg-citrus-sage/20 text-citrus-forest text-[7px] h-3.5 px-1 font-varsity border border-citrus-sage/40">
                              {sig.position}
                            </Badge>
                            <span className="text-[9px] text-citrus-charcoal/50 font-display">{sig.term}yr</span>
                            {sig.isResign && oldPlayer && (
                              <span className="text-[8px] text-citrus-charcoal/40 font-display">
                                (was {formatCap(oldPlayer.capHit)})
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="font-varsity text-sm text-citrus-forest">{formatCap(sig.aav)}</div>
                          <div className="text-[8px] text-citrus-charcoal/50 font-display">
                            {sig.isResign ? 'Re-sign' : 'New'}
                          </div>
                        </div>

                        <button
                          onClick={() => removeSigning(sig.id)}
                          className="p-1.5 rounded-lg hover:bg-red-100 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      </div>
                    );
                  })}

                  <div className="px-4 py-3 bg-gradient-to-r from-citrus-sage/15 to-citrus-sage/10 border-t-2 border-citrus-sage/30 flex items-center justify-between">
                    <span className="text-xs font-display font-bold text-citrus-charcoal/60 uppercase tracking-wider">
                      Total New Cap
                    </span>
                    <span className="font-varsity text-base text-citrus-forest">
                      {formatCap(impact.totalNewCap)}
                    </span>
                  </div>
                </div>
              )}

              {/* Empty State */}
              {signings.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 bg-white/40 rounded-2xl border-2 border-dashed border-citrus-sage/30">
                  <PenLine className="w-8 h-8 text-citrus-sage/30 mb-2" />
                  <p className="text-sm text-citrus-charcoal/50 font-display mb-1">No signings yet</p>
                  <p className="text-[10px] text-citrus-charcoal/40 font-display">
                    Use the buttons above to add signings
                  </p>
                </div>
              )}
            </>
          )}

          {!selectedTeam && (
            <div className="flex flex-col items-center justify-center py-20 bg-white/40 rounded-2xl border-2 border-dashed border-citrus-sage/30">
              <PenLine className="w-8 h-8 text-citrus-sage/30 mb-2" />
              <p className="text-sm text-citrus-charcoal/50 font-display">Select a team to start signing players</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

