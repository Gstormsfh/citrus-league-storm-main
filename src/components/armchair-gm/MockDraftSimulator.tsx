import { useState, useCallback, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Trophy, Play, RotateCcw, ChevronDown, ChevronUp, Users } from 'lucide-react';
import { PlayerService } from '@/services/PlayerService';
import type { Player } from '@/services/PlayerService';

interface MockDraftPick {
  round: number;
  pick: number;
  overall: number;
  teamName: string;
  teamIndex: number;
  player: Player;
}

const MOCK_TEAM_NAMES = [
  'Your Team', 'Aces', 'Blaze', 'Crushers', 'Dynasty',
  'Eagles', 'Fury', 'Grizzlies', 'Hawks', 'Ice Kings',
];

const POSITION_COLORS: Record<string, string> = {
  C: 'bg-primary/10 text-primary border-primary/30',
  LW: 'bg-blue-500/10 text-blue-700 border-blue-500/30',
  RW: 'bg-purple-500/10 text-purple-700 border-purple-500/30',
  D: 'bg-slate-500/10 text-slate-700 border-slate-500/30',
  G: 'bg-amber-500/10 text-amber-700 border-amber-500/30',
};

/**
 * MockDraftSimulator - Practice drafting without affecting any real league.
 * Uses real player data sorted by projected value to simulate AI picks.
 * Supports snake and linear draft types with configurable rounds and teams.
 */
const MockDraftSimulator = () => {
  const [numTeams, setNumTeams] = useState(10);
  const [numRounds, setNumRounds] = useState(15);
  const [draftType, setDraftType] = useState<'snake' | 'linear'>('snake');
  const [userTeamIndex, setUserTeamIndex] = useState(0);
  const [draftStarted, setDraftStarted] = useState(false);
  const [picks, setPicks] = useState<MockDraftPick[]>([]);
  const [currentOverall, setCurrentOverall] = useState(1);
  const [availablePlayers, setAvailablePlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(false);
  const [showBoard, setShowBoard] = useState(false);

  const totalPicks = numTeams * numRounds;

  // Calculate current pick info
  const getCurrentPickInfo = useCallback((overall: number) => {
    const round = Math.ceil(overall / numTeams);
    const pickInRound = ((overall - 1) % numTeams);
    let teamIndex: number;
    if (draftType === 'snake' && round % 2 === 0) {
      teamIndex = numTeams - 1 - pickInRound;
    } else {
      teamIndex = pickInRound;
    }
    return { round, pick: pickInRound + 1, teamIndex };
  }, [numTeams, draftType]);

  const currentPickInfo = useMemo(() => getCurrentPickInfo(currentOverall), [getCurrentPickInfo, currentOverall]);
  const isUserPick = currentPickInfo.teamIndex === userTeamIndex;
  const isDraftComplete = currentOverall > totalPicks;

  // Start draft - load all players, then auto-sim AI picks until user's first turn
  const startDraft = useCallback(async () => {
    setLoading(true);
    try {
      const players = await PlayerService.getAllPlayers();
      // Sort by points descending (best available)
      const sorted = [...players].sort((a, b) => (b.points || 0) - (a.points || 0));

      // Auto-sim AI picks before user's first turn
      const teamNames = MOCK_TEAM_NAMES.slice(0, numTeams);
      const aiPicks: MockDraftPick[] = [];
      let remaining = [...sorted];
      let ov = 1;

      while (ov <= numTeams * numRounds) {
        const info = getCurrentPickInfo(ov);
        if (info.teamIndex === userTeamIndex) break; // User's turn
        if (remaining.length === 0) break;

        const aiPlayer = remaining[0];
        aiPicks.push({
          round: info.round,
          pick: info.pick,
          overall: ov,
          teamName: teamNames[info.teamIndex] || `Team ${info.teamIndex + 1}`,
          teamIndex: info.teamIndex,
          player: aiPlayer,
        });
        remaining = remaining.filter(p => p.id !== aiPlayer.id);
        ov++;
      }

      setPicks(aiPicks);
      setAvailablePlayers(remaining);
      setCurrentOverall(ov);
      setDraftStarted(true);
    } catch {
      // Failed to load players
    } finally {
      setLoading(false);
    }
  }, [numTeams, numRounds, userTeamIndex, getCurrentPickInfo]);

  // AI makes a pick (takes best available player)
  const makeAIPick = useCallback(() => {
    if (availablePlayers.length === 0 || currentOverall > totalPicks) return;

    const info = getCurrentPickInfo(currentOverall);
    const player = availablePlayers[0];
    const teamNames = MOCK_TEAM_NAMES.slice(0, numTeams);

    const pick: MockDraftPick = {
      round: info.round,
      pick: info.pick,
      overall: currentOverall,
      teamName: teamNames[info.teamIndex] || `Team ${info.teamIndex + 1}`,
      teamIndex: info.teamIndex,
      player,
    };

    setPicks(prev => [...prev, pick]);
    setAvailablePlayers(prev => prev.filter(p => p.id !== player.id));
    setCurrentOverall(prev => prev + 1);
  }, [availablePlayers, currentOverall, totalPicks, getCurrentPickInfo, numTeams]);

  // User drafts a specific player, then auto-simulates AI picks until next user turn
  const draftPlayer = useCallback((player: Player) => {
    if (currentOverall > totalPicks || !isUserPick) return;

    const info = getCurrentPickInfo(currentOverall);
    const teamNames = MOCK_TEAM_NAMES.slice(0, numTeams);

    // User's pick
    const userPick: MockDraftPick = {
      round: info.round,
      pick: info.pick,
      overall: currentOverall,
      teamName: teamNames[info.teamIndex] || `Team ${info.teamIndex + 1}`,
      teamIndex: info.teamIndex,
      player,
    };

    // Auto-simulate AI picks until next user turn
    const allNewPicks: MockDraftPick[] = [userPick];
    let remaining = availablePlayers.filter(p => p.id !== player.id);
    let ov = currentOverall + 1;

    while (ov <= totalPicks) {
      const nextInfo = getCurrentPickInfo(ov);
      if (nextInfo.teamIndex === userTeamIndex) break; // Stop at user's next pick
      if (remaining.length === 0) break;

      const aiPlayer = remaining[0];
      allNewPicks.push({
        round: nextInfo.round,
        pick: nextInfo.pick,
        overall: ov,
        teamName: teamNames[nextInfo.teamIndex] || `Team ${nextInfo.teamIndex + 1}`,
        teamIndex: nextInfo.teamIndex,
        player: aiPlayer,
      });
      remaining = remaining.filter(p => p.id !== aiPlayer.id);
      ov++;
    }

    setPicks(prev => [...prev, ...allNewPicks]);
    setAvailablePlayers(remaining);
    setCurrentOverall(ov);
  }, [currentOverall, totalPicks, isUserPick, getCurrentPickInfo, numTeams, availablePlayers, userTeamIndex]);

  // Simulate until next user pick
  const simToMyPick = useCallback(() => {
    let ov = currentOverall;
    const newPicks: MockDraftPick[] = [];
    let remaining = [...availablePlayers];
    const teamNames = MOCK_TEAM_NAMES.slice(0, numTeams);

    while (ov <= totalPicks) {
      const info = getCurrentPickInfo(ov);
      if (info.teamIndex === userTeamIndex) break; // Stop at user's pick
      if (remaining.length === 0) break;

      const player = remaining[0];
      newPicks.push({
        round: info.round,
        pick: info.pick,
        overall: ov,
        teamName: teamNames[info.teamIndex] || `Team ${info.teamIndex + 1}`,
        teamIndex: info.teamIndex,
        player,
      });
      remaining = remaining.filter(p => p.id !== player.id);
      ov++;
    }

    if (newPicks.length > 0) {
      setPicks(prev => [...prev, ...newPicks]);
      setAvailablePlayers(remaining);
      setCurrentOverall(ov);
    }
  }, [currentOverall, totalPicks, availablePlayers, getCurrentPickInfo, userTeamIndex, numTeams]);

  // Reset draft
  const resetDraft = useCallback(() => {
    setDraftStarted(false);
    setPicks([]);
    setCurrentOverall(1);
    setAvailablePlayers([]);
  }, []);

  // User's picks
  const myPicks = useMemo(() => picks.filter(p => p.teamIndex === userTeamIndex), [picks, userTeamIndex]);

  // Position filter for available players
  const normalizePos = (pos: string) => {
    const u = (pos || '').toUpperCase();
    if (['C', 'CENTRE', 'CENTER'].includes(u)) return 'C';
    if (['LW', 'LEFT WING', 'L'].includes(u)) return 'LW';
    if (['RW', 'RIGHT WING', 'R'].includes(u)) return 'RW';
    if (['D', 'DEFENCE', 'DEFENSE'].includes(u)) return 'D';
    if (['G', 'GOALIE'].includes(u)) return 'G';
    return u;
  };

  if (!draftStarted) {
    return (
      <div className="space-y-6">
        <Card className="p-6 bg-white/80 border-2 border-citrus-sage/30">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 rounded-xl bg-citrus-sage/20">
              <Trophy className="w-6 h-6 text-citrus-sage" />
            </div>
            <div>
              <h2 className="font-varsity text-xl text-citrus-forest">Mock Draft Simulator</h2>
              <p className="text-xs text-muted-foreground">Practice your draft strategy with real player data</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Number of Teams</label>
              <Select value={String(numTeams)} onValueChange={v => setNumTeams(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[8, 10, 12, 14].map(n => (
                    <SelectItem key={n} value={String(n)}>{n} Teams</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Rounds</label>
              <Select value={String(numRounds)} onValueChange={v => setNumRounds(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[10, 12, 15, 18, 21].map(n => (
                    <SelectItem key={n} value={String(n)}>{n} Rounds</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Draft Type</label>
              <Select value={draftType} onValueChange={v => setDraftType(v as 'snake' | 'linear')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="snake">Snake</SelectItem>
                  <SelectItem value="linear">Linear</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Your Draft Position</label>
              <Select value={String(userTeamIndex)} onValueChange={v => setUserTeamIndex(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: numTeams }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>Pick #{i + 1}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={startDraft}
            disabled={loading}
            className="w-full bg-citrus-sage hover:bg-citrus-sage/90 text-white font-bold"
          >
            <Play className="w-4 h-4 mr-2" />
            {loading ? 'Loading Players...' : 'Start Mock Draft'}
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Draft Header */}
      <Card className="p-4 bg-white/80 border-2 border-citrus-sage/30">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-citrus-sage" />
              <h2 className="font-varsity text-lg text-citrus-forest">Mock Draft</h2>
              <Badge variant="outline" className="text-[10px]">
                {draftType === 'snake' ? 'Snake' : 'Linear'} • {numTeams} teams • {numRounds} rounds
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isDraftComplete
                ? 'Draft Complete!'
                : `Round ${currentPickInfo.round} • Pick ${currentPickInfo.pick} • ${isUserPick ? 'YOUR PICK' : `${MOCK_TEAM_NAMES[currentPickInfo.teamIndex] || 'AI'} on the clock`}`
              }
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!isDraftComplete && !isUserPick && (
              <Button onClick={simToMyPick} size="sm" variant="outline" className="text-xs">
                Sim to My Pick
              </Button>
            )}
            <Button onClick={resetDraft} size="sm" variant="outline" className="text-xs">
              <RotateCcw className="w-3 h-3 mr-1" />
              Reset
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Available Players */}
        <div className="lg:col-span-2">
          <Card className="p-3 bg-white/80 border-2 border-citrus-sage/30">
            <h3 className="font-bold text-sm mb-2 flex items-center gap-2">
              <Users className="w-4 h-4" />
              Available Players
              <Badge variant="outline" className="text-[10px]">{availablePlayers.length}</Badge>
            </h3>
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto scrollbar-styled">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 sticky top-0 z-10">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Player</th>
                    <th className="px-2 py-1.5 text-center">Pos</th>
                    <th className="px-2 py-1.5 text-center">Team</th>
                    <th className="px-2 py-1.5 text-center">PTS</th>
                    <th className="px-2 py-1.5 text-center">G</th>
                    <th className="px-2 py-1.5 text-center">A</th>
                    <th className="px-2 py-1.5 text-center">GP</th>
                    {isUserPick && <th className="px-2 py-1.5 text-center">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {availablePlayers.slice(0, 100).map(player => {
                    const pos = normalizePos(player.position);
                    return (
                      <tr
                        key={player.id}
                        className={cn(
                          "border-b border-muted/20 hover:bg-citrus-sage/5",
                          isUserPick && "cursor-pointer"
                        )}
                        onClick={isUserPick ? () => draftPlayer(player) : undefined}
                      >
                        <td className="px-2 py-1.5 font-medium">{player.full_name}</td>
                        <td className="px-2 py-1.5 text-center">
                          <Badge variant="outline" className={cn("text-[9px] px-1", POSITION_COLORS[pos])}>
                            {player.eligible_positions && player.eligible_positions.length > 1
                              ? player.eligible_positions.join('/')
                              : pos}
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5 text-center text-muted-foreground">{player.team}</td>
                        <td className="px-2 py-1.5 text-center font-bold">{player.points}</td>
                        <td className="px-2 py-1.5 text-center">{player.goals}</td>
                        <td className="px-2 py-1.5 text-center">{player.assists}</td>
                        <td className="px-2 py-1.5 text-center">{player.games_played}</td>
                        {isUserPick && (
                          <td className="px-2 py-1.5 text-center">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-[10px] h-6 px-2"
                              onClick={(e) => { e.stopPropagation(); draftPlayer(player); }}
                            >
                              Draft
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* My Picks Sidebar */}
        <div>
          <Card className="p-3 bg-white/80 border-2 border-citrus-sage/30 mb-4">
            <h3 className="font-bold text-sm mb-2">Your Roster ({myPicks.length})</h3>
            <div className="space-y-1">
              {myPicks.map(pick => {
                const pos = normalizePos(pick.player.position);
                return (
                  <div key={pick.overall} className="flex items-center gap-2 text-xs bg-muted/20 rounded px-2 py-1.5">
                    <Badge variant="outline" className={cn("text-[9px] px-1 flex-shrink-0", POSITION_COLORS[pos])}>{pos}</Badge>
                    <span className="font-medium truncate">{pick.player.full_name}</span>
                    <span className="text-muted-foreground flex-shrink-0 ml-auto">R{pick.round}</span>
                  </div>
                );
              })}
              {myPicks.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-3">No picks yet</p>
              )}
            </div>
          </Card>

          {/* Draft Board Toggle */}
          <Card className="p-3 bg-white/80 border-2 border-citrus-sage/30">
            <button
              onClick={() => setShowBoard(!showBoard)}
              className="flex items-center justify-between w-full text-sm font-bold"
            >
              <span>Draft Board</span>
              {showBoard ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showBoard && (
              <div className="mt-2 space-y-1 max-h-[400px] overflow-y-auto">
                {picks.map(pick => {
                  const pos = normalizePos(pick.player.position);
                  const isMyPick = pick.teamIndex === userTeamIndex;
                  return (
                    <div
                      key={pick.overall}
                      className={cn(
                        "flex items-center gap-2 text-[10px] rounded px-2 py-1",
                        isMyPick ? "bg-primary/10 font-medium" : "bg-muted/10"
                      )}
                    >
                      <span className="text-muted-foreground w-6 flex-shrink-0">#{pick.overall}</span>
                      <Badge variant="outline" className={cn("text-[8px] px-0.5", POSITION_COLORS[pos])}>{pos}</Badge>
                      <span className="truncate">{pick.player.full_name}</span>
                      <span className="text-muted-foreground flex-shrink-0 ml-auto">{pick.teamName}</span>
                    </div>
                  );
                })}
                {picks.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-3">Draft not started</p>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default MockDraftSimulator;
