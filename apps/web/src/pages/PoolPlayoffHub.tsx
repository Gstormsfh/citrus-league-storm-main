/**
 * Playoff Pool Hub — the homepage for a created playoff pool.
 *
 * Shows:
 *  - League name + format label
 *  - All members who have joined (teams)
 *  - Join code for inviting friends
 *  - Lock deadline countdown
 *  - CTA for each member to go submit their picks/roster
 *  - Commissioner controls (if applicable)
 */

import { useEffect, useState, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Trophy, Users, Clock, Copy, Check, Lock, ChevronRight, Crown, Target,
  Mail, MessageSquare, Link as LinkIcon,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { NHL_TEAMS } from '@/types/captracker';

interface Team {
  id: string;
  team_name: string;
  owner_id: string;
  owner_name?: string;
}

interface League {
  id: string;
  name: string;
  commissioner_id: string;
  join_code: string;
  settings: {
    leagueType?: string;
    playoffRosterLockedAt?: string;
    playoffRosterSize?: number;
    playoffBracketPointsPerRound?: Record<string, number>;
    playoffConfidenceVariant?: string;
  };
}

const POOL_TYPE_LABELS: Record<string, string> = {
  'playoff-bracket-pickem': 'Playoff Bracket Challenge',
  'playoff-confidence-pool': 'Playoff Confidence Pool',
  'playoff-roster-pool': 'Playoff Roster Pool',
};

const POOL_TYPE_ROUTES: Record<string, string> = {
  'playoff-bracket-pickem': '/pool/playoff-bracket',
  'playoff-confidence-pool': '/pool/playoff-confidence',
  'playoff-roster-pool': '/pool/playoff-roster',
};

export default function PoolPlayoffHub() {
  const [params] = useSearchParams();
  const leagueId = params.get('league') || '';
  const { user } = useAuth();
  const { toast } = useToast();

  const [league, setLeague] = useState<League | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [userPicks, setUserPicks] = useState<Array<{ series_slot: number; picked_team_id: number; predicted_games?: number; confidence_value?: number; points_earned?: number; is_correct?: boolean | null }>>([]);
  const [bracketSeeds, setBracketSeeds] = useState<Array<{ team_id: number; team_abbrev: string | null; seed: number; conference: string }>>([]);
  const [bracketSeries, setBracketSeries] = useState<Array<{ series_id: string; bracket_slot: number; round: number; series_status: string; winner_team_id: number | null; high_seed_team_id: number | null; low_seed_team_id: number | null }>>([]);

  useEffect(() => {
    if (!leagueId) return;
    const load = async () => {
      try {
        const session = (await (await import('@/integrations/supabase/client')).supabase.auth.getSession()).data.session;
        const headers: Record<string, string> = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
        const [leagueRes, teamsRes, bracketRes] = await Promise.all([
          fetch(`/api/leagues/${leagueId}`, { headers }).then(r => r.json()).catch(() => null),
          fetch(`/api/leagues/${leagueId}/teams`, { headers }).then(r => r.json()).catch(() => null),
          fetch('/api/nhl-playoffs/bracket?season=2025').then(r => r.json()).catch(() => null),
        ]);
        const leagueData = leagueRes?.data || leagueRes;
        setLeague(leagueData);
        const teamList = teamsRes?.data?.teams || teamsRes?.teams || teamsRes?.data || [];
        setTeams(Array.isArray(teamList) ? teamList : []);

        // Fetch user's picks based on league type
        const lgType = leagueData?.settings?.leagueType;
        const pickType = lgType === 'playoff-bracket-pickem' ? 'bracket'
                      : lgType === 'playoff-confidence-pool' ? 'confidence'
                      : lgType === 'playoff-roster-pool' ? 'roster' : null;
        if (pickType && session?.access_token) {
          const picksRes = await fetch(`/api/playoff-pools/${leagueId}/picks?type=${pickType}`, { headers }).then(r => r.json()).catch(() => null);
          const rawPicks = picksRes?.data?.picks || picksRes?.picks || [];
          const myPicks = Array.isArray(rawPicks) ? rawPicks.filter((p: { user_id: string }) => p.user_id === session.user?.id) : [];
          setUserPicks(myPicks);
        }

        // Parse bracket data for team/series lookups
        const br = bracketRes?.data || bracketRes;
        if (br) {
          setBracketSeeds(br.seeds || []);
          setBracketSeries(br.series || []);
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [leagueId]);

  const leagueType = league?.settings?.leagueType || 'playoff-bracket-pickem';
  const poolLabel = POOL_TYPE_LABELS[leagueType] || 'Playoff Pool';
  const makePicksRoute = POOL_TYPE_ROUTES[leagueType] || '/pool/playoff-bracket';
  const isCommissioner = user?.id === league?.commissioner_id;

  // Lock deadline
  const lockAt = league?.settings?.playoffRosterLockedAt;
  const lockCountdown = useMemo(() => {
    if (!lockAt) return null;
    const ms = new Date(lockAt).getTime() - Date.now();
    if (ms <= 0) return { locked: true, label: 'Rosters locked' };
    const hours = Math.floor(ms / 3600000);
    const days = Math.floor(hours / 24);
    if (days > 0) return { locked: false, label: `Locks in ${days}d ${hours % 24}h` };
    if (hours > 0) return { locked: false, label: `Locks in ${hours}h` };
    const minutes = Math.floor(ms / 60000);
    return { locked: false, label: `Locks in ${minutes}m` };
  }, [lockAt]);

  const copyJoinCode = () => {
    if (!league?.join_code) return;
    navigator.clipboard.writeText(league.join_code);
    setCopied(true);
    toast({ title: 'Join code copied!', description: 'Send it to your friends to invite them.' });
    setTimeout(() => setCopied(false), 2000);
  };

  // Shareable invite URL.
  // /auth honors ?redirect= so if the invitee is signed out, they go through
  // auth, then come back here and auto-join via the ?code= handler in CreateLeague.
  const joinPath = `/create-league?tab=join&code=${league?.join_code || ''}`;
  const shareUrl = `${window.location.origin}/auth?redirect=${encodeURIComponent(joinPath)}`;

  // Invite template includes BOTH the tappable link AND the raw code as a
  // fallback for mail clients that strip URLs.
  const inviteText = league
    ? `You're invited to join "${league.name}" on Citrus Fantasy Sports!\n\n` +
      `Tap to join: ${shareUrl}\n\n` +
      `Or enter this code manually at citrusfantasysports.com:\n` +
      `${league.join_code}`
    : '';

  const copyShareLink = () => {
    navigator.clipboard.writeText(shareUrl);
    toast({ title: 'Link copied!', description: 'Paste it anywhere to invite friends.' });
  };

  const emailInvite = () => {
    if (!league) return;
    const subject = encodeURIComponent(`Join ${league.name} on Citrus Fantasy Sports`);
    const body = encodeURIComponent(inviteText);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const smsInvite = () => {
    const body = encodeURIComponent(inviteText);
    // iOS requires sms:&body= while Android uses sms:?body=
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const separator = isIOS ? '&' : '?';
    window.location.href = `sms:${separator}body=${body}`;
  };

  if (loading) {
    return <><Navbar /><div className="min-h-screen pt-24 flex items-center justify-center text-citrus-charcoal/60">Loading pool...</div></>;
  }

  if (!league) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen pt-24 flex items-center justify-center">
          <Card className="p-6 text-center">
            <p className="text-sm">Pool not found.</p>
            <Button asChild className="mt-3"><Link to="/nhl/playoffs">Back to NHL Playoffs</Link></Button>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gradient-to-b from-white to-[#F5F8ED] pt-24 pb-12 px-4">
        <div className="max-w-5xl mx-auto">
          {/* Hero */}
          <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Trophy className="h-6 w-6 text-citrus-orange" />
                <h1 className="text-2xl sm:text-3xl font-varsity font-black uppercase text-citrus-forest tracking-tight">{league.name}</h1>
              </div>
              <div className="flex items-center gap-2 text-sm text-citrus-charcoal/70">
                <Badge variant="outline" className="border-citrus-sage">{poolLabel}</Badge>
                {isCommissioner && <Badge className="bg-citrus-orange/20 text-citrus-orange border-citrus-orange/30"><Crown className="h-3 w-3 mr-1" />Commissioner</Badge>}
              </div>
            </div>
            {lockCountdown && (
              <div className="text-right">
                <div className="text-[10px] font-display uppercase text-citrus-charcoal/60">
                  {lockCountdown.locked ? 'Status' : 'Pick deadline'}
                </div>
                <div className={cn(
                  'text-base font-bold flex items-center gap-1 justify-end',
                  lockCountdown.locked ? 'text-red-500' : 'text-citrus-orange'
                )}>
                  {lockCountdown.locked ? <Lock className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                  {lockCountdown.label}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
            {/* Main */}
            <div className="space-y-4">
              {/* Your Picks CTA */}
              <Card className="border-citrus-orange/30 bg-gradient-to-br from-citrus-orange/5 to-citrus-sage/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Target className="h-4 w-4 text-citrus-orange" />
                    Your Picks
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-citrus-charcoal/70 mb-3">
                    {lockCountdown?.locked
                      ? 'Rosters are locked — check your lineup and watch live scoring.'
                      : leagueType === 'playoff-roster-pool'
                        ? 'Build your roster from players across all 16 playoff teams.'
                        : leagueType === 'playoff-confidence-pool'
                          ? 'Pick winners and assign confidence values to each series.'
                          : 'Pick the winner and # of games for each playoff series.'}
                  </p>
                  <Button asChild className="bg-citrus-orange hover:bg-citrus-orange/90 text-white font-display font-bold">
                    <Link to={`${makePicksRoute}?league=${leagueId}`}>
                      {lockCountdown?.locked ? 'View Picks' : 'Make My Picks'} <ChevronRight className="h-4 w-4 ml-1" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>

              {/* Picks Overview — bracket + confidence pools */}
              {(leagueType === 'playoff-bracket-pickem' || leagueType === 'playoff-confidence-pool') && userPicks.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Target className="h-4 w-4 text-citrus-sage" />
                      Your Picks ({userPicks.length}/{bracketSeries.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {bracketSeries.map(s => {
                        const pick = userPicks.find(p => p.series_slot === s.bracket_slot);
                        const high = s.high_seed_team_id ? bracketSeeds.find(seed => seed.team_id === s.high_seed_team_id) : null;
                        const low = s.low_seed_team_id ? bracketSeeds.find(seed => seed.team_id === s.low_seed_team_id) : null;
                        const pickedTeam = pick ? (pick.picked_team_id === s.high_seed_team_id ? high : pick.picked_team_id === s.low_seed_team_id ? low : null) : null;
                        const pickedInfo = pickedTeam ? NHL_TEAMS.find(t => t.abbrev === pickedTeam.team_abbrev) : null;
                        const isFinal = s.series_status === 'final';
                        const isCorrect = isFinal && pick && s.winner_team_id === pick.picked_team_id;
                        const isWrong = isFinal && pick && s.winner_team_id && s.winner_team_id !== pick.picked_team_id;
                        const roundName = s.round === 1 ? 'R1' : s.round === 2 ? 'R2' : s.round === 3 ? 'CF' : 'SCF';
                        return (
                          <div key={s.series_id} className={cn(
                            'flex items-center gap-2 p-2 rounded border',
                            isCorrect && 'border-green-400 bg-green-50/50',
                            isWrong && 'border-red-300 bg-red-50/30',
                            !isFinal && pick && 'border-citrus-sage/30 bg-citrus-sage/5',
                            !pick && 'border-dashed border-fantasy-border/50 bg-muted/20'
                          )}>
                            <span className="text-[9px] font-mono text-citrus-charcoal/50 w-8">{roundName}-{String.fromCharCode(64 + s.bracket_slot)}</span>
                            {pick && pickedInfo ? (
                              <>
                                <div
                                  className="w-7 h-7 rounded flex items-center justify-center text-[9px] font-varsity font-black text-white flex-shrink-0"
                                  style={{ background: pickedInfo.primaryColor }}
                                >
                                  {pickedInfo.abbrev}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-semibold truncate" style={{ color: pickedInfo.primaryColor }}>{pickedInfo.name}</div>
                                  <div className="text-[9px] text-citrus-charcoal/60">
                                    {leagueType === 'playoff-confidence-pool' && pick.confidence_value && `Confidence: ${pick.confidence_value}`}
                                    {leagueType === 'playoff-bracket-pickem' && pick.predicted_games && `in ${pick.predicted_games}`}
                                  </div>
                                </div>
                                {isCorrect && <Check className="h-4 w-4 text-green-500 flex-shrink-0" />}
                                {isFinal && pick.points_earned != null && (
                                  <span className={cn('text-xs font-bold flex-shrink-0', isCorrect ? 'text-green-600' : 'text-citrus-charcoal/40')}>
                                    +{pick.points_earned}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-[11px] text-citrus-charcoal/40 italic flex-1">No pick yet</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Members */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="h-4 w-4 text-citrus-sage" />
                    Members ({teams.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {teams.length === 0 ? (
                    <p className="text-xs text-citrus-charcoal/60 italic">No members yet — invite friends with the join code →</p>
                  ) : (
                    <div className="space-y-1.5">
                      {teams.map((t) => (
                        <div key={t.id} className="flex items-center justify-between p-2 rounded border border-citrus-sage/20 bg-white">
                          <div className="flex items-center gap-2">
                            <div className="h-7 w-7 rounded-full bg-citrus-sage/20 flex items-center justify-center text-xs font-bold text-citrus-forest">
                              {(t.team_name || '?').charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="text-sm font-medium">{t.team_name}</div>
                              {t.owner_id === league.commissioner_id && (
                                <div className="text-[10px] text-citrus-orange flex items-center gap-0.5"><Crown className="h-2.5 w-2.5" />Commissioner</div>
                              )}
                              {t.owner_id === user?.id && t.owner_id !== league.commissioner_id && (
                                <div className="text-[10px] text-citrus-sage">You</div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Standings — shows all members with current points (0 until games start) */}
              <Card className="border-citrus-sage/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-citrus-orange" />
                    Standings
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {teams.length === 0 ? (
                    <p className="text-xs text-citrus-charcoal/60 italic">Invite players to populate standings.</p>
                  ) : (
                    <>
                      <div className="rounded border border-citrus-sage/20 overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-citrus-sage/10 border-b border-citrus-sage/20">
                            <tr>
                              <th className="px-2 py-1.5 text-left text-[10px] uppercase font-display font-bold text-citrus-charcoal/60 w-10">#</th>
                              <th className="px-2 py-1.5 text-left text-[10px] uppercase font-display font-bold text-citrus-charcoal/60">Team</th>
                              <th className="px-2 py-1.5 text-right text-[10px] uppercase font-display font-bold text-citrus-charcoal/60">Points</th>
                            </tr>
                          </thead>
                          <tbody>
                            {teams.map((t, i) => (
                              <tr key={t.id} className={cn("border-b border-citrus-sage/10 last:border-b-0", t.owner_id === user?.id && "bg-citrus-sage/5")}>
                                <td className="px-2 py-1.5 text-xs font-mono text-citrus-charcoal/50">{i + 1}</td>
                                <td className="px-2 py-1.5 text-sm">
                                  <span className="font-medium">{t.team_name}</span>
                                  {t.owner_id === user?.id && <span className="text-[10px] text-citrus-sage ml-1">(You)</span>}
                                </td>
                                <td className="px-2 py-1.5 text-sm text-right font-bold text-citrus-forest">0</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-[10px] text-citrus-charcoal/50 mt-2 italic">Rankings update live as playoff games complete.</p>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Sidebar */}
            <div className="space-y-3">
              {/* Invite */}
              <Card className="border-citrus-orange/30 bg-white">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-display">Invite Friends</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-[10px] uppercase font-display text-citrus-charcoal/50">Join Code</div>
                  <button
                    onClick={copyJoinCode}
                    className="w-full flex items-center justify-between p-2 rounded border border-citrus-sage/30 bg-citrus-sage/5 hover:bg-citrus-sage/10 transition-colors"
                  >
                    <span className="text-lg font-mono font-bold text-citrus-forest tracking-wider">{league.join_code}</span>
                    {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4 text-citrus-charcoal/50" />}
                  </button>

                  <div className="pt-2 grid grid-cols-1 gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyShareLink}
                      className="w-full justify-start gap-2 text-xs h-8"
                    >
                      <LinkIcon className="h-3.5 w-3.5" />
                      Copy Invite Link
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={emailInvite}
                      className="w-full justify-start gap-2 text-xs h-8"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      Send via Email
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={smsInvite}
                      className="w-full justify-start gap-2 text-xs h-8"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      Send via Text
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Rules recap */}
              <Card className="border-citrus-sage/20 bg-citrus-sage/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-display">Pool Rules</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-[11px] text-citrus-charcoal/70 space-y-1 list-disc pl-3">
                    {leagueType === 'playoff-roster-pool' && (
                      <>
                        <li>Pick {league.settings?.playoffRosterSize || 17} players from the 16 playoff teams</li>
                        <li>Max 3 players per NHL team</li>
                        <li>Total fantasy points across all playoff games</li>
                        <li>Scoring uses your league's custom point values</li>
                      </>
                    )}
                    {leagueType === 'playoff-bracket-pickem' && (
                      <>
                        <li>Pick the winner of all 15 playoff series</li>
                        <li>Points double each round (2 / 4 / 8 / 16)</li>
                        <li>+1 bonus for correctly predicting number of games</li>
                      </>
                    )}
                    {leagueType === 'playoff-confidence-pool' && (
                      <>
                        <li>Pick series winners + assign confidence 1-15</li>
                        <li>Each confidence value used exactly once</li>
                        <li>Correct pick = you earn that many points</li>
                      </>
                    )}
                    <li>Picks lock {lockAt ? `at ${new Date(lockAt).toLocaleString()}` : 'at puck drop of Round 1 Game 1'}</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
