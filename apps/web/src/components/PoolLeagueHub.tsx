/**
 * PoolLeagueHub — League management tab for pool pages.
 * Shows: members list, join code, invite button, commissioner controls.
 */
import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { leagueApi } from '@/api/leagues';
import { InvitePlayersButton } from '@/components/InvitePlayersButton';
import { Users, Crown, Copy, Loader2, Play, Settings, Shield } from 'lucide-react';
import { getPoolLabel } from '@/utils/leagueTypeHelpers';
import { logger } from '@/utils/logger';

interface PoolLeagueHubProps {
  leagueId: string;
  league: {
    id: string;
    name: string;
    commissioner_id: string;
    join_code?: string;
    settings?: Record<string, unknown>;
    pool_status?: string;
    created_at?: string;
  };
}

interface TeamMember {
  id: string;
  team_name: string;
  owner_id: string;
  owner_name?: string;
  owner_username?: string;
  created_at?: string;
}

export const PoolLeagueHub = ({ leagueId, league }: PoolLeagueHubProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  const isCommissioner = user?.id === league.commissioner_id;
  const leagueType = (league.settings?.leagueType as string) || 'pickem';
  const teamsCount = (league.settings?.teamsCount as number) || 0;
  const poolStatus = (league as any).pool_status || 'active';

  useEffect(() => {
    const load = async () => {
      try {
        const response = await leagueApi.getTeams(leagueId, true);
        setMembers((response.data || []) as TeamMember[]);
      } catch (err) {
        logger.error('[PoolLeagueHub] Error loading members:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [leagueId]);

  const handleCopyCode = () => {
    if (league.join_code) {
      navigator.clipboard.writeText(league.join_code);
      toast({ title: 'Copied!', description: 'Join code copied to clipboard' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-citrus-sage" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* League info card */}
      <Card className="border-none shadow-lg bg-[#1A2A20] overflow-hidden">
        <div className="bg-gradient-to-r from-citrus-forest to-citrus-sage p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <Badge className="bg-white/20 text-white border-0 mb-2 text-xs">{getPoolLabel(leagueType)} Pool</Badge>
              <h2 className="text-2xl font-varsity font-black uppercase tracking-tight">{league.name}</h2>
              <p className="text-white/70 text-sm font-display mt-1">
                {members.length}{teamsCount ? ` / ${teamsCount}` : ''} members joined
              </p>
            </div>
            {poolStatus === 'completed' && (
              <Badge className="bg-amber-400 text-amber-900 border-0 text-sm">Completed</Badge>
            )}
          </div>
        </div>

        <CardContent className="p-6">
          {/* Join code + invite */}
          <div className="flex items-center gap-3 mb-6 p-3 bg-white/5 rounded-xl">
            <div className="flex-1">
              <span className="text-xs font-display text-white/55 uppercase tracking-wider">Join Code</span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="font-mono text-lg font-bold text-pastel-cream tracking-widest">
                  {league.join_code || 'N/A'}
                </span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopyCode}>
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            {league.join_code && (
              <InvitePlayersButton joinCode={league.join_code} leagueName={league.name} />
            )}
          </div>

          {/* League settings summary */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            <div className="p-3 bg-white/5 rounded-lg text-center">
              <div className="text-xs font-display text-white/55 uppercase">Type</div>
              <div className="font-display font-bold text-sm text-pastel-cream">{getPoolLabel(leagueType)}</div>
            </div>
            <div className="p-3 bg-white/5 rounded-lg text-center">
              <div className="text-xs font-display text-white/55 uppercase">Members</div>
              <div className="font-display font-bold text-sm text-pastel-cream">{members.length}{teamsCount ? ` / ${teamsCount}` : ''}</div>
            </div>
            <div className="p-3 bg-white/5 rounded-lg text-center">
              <div className="text-xs font-display text-white/55 uppercase">Status</div>
              <div className="font-display font-bold text-sm text-pastel-cream capitalize">{poolStatus}</div>
            </div>
            {leagueType === 'pickem' && league.settings?.picksPerWeek && (
              <div className="p-3 bg-white/5 rounded-lg text-center">
                <div className="text-xs font-display text-white/55 uppercase">Picks/Week</div>
                <div className="font-display font-bold text-sm text-pastel-cream">
                  {(league.settings.picksPerWeek as number) === 0 ? 'All' : league.settings.picksPerWeek as number}
                </div>
              </div>
            )}
            {leagueType === 'survivor' && league.settings?.survivorLives && (
              <div className="p-3 bg-white/5 rounded-lg text-center">
                <div className="text-xs font-display text-white/55 uppercase">Lives</div>
                <div className="font-display font-bold text-sm text-pastel-cream">{league.settings.survivorLives as number}</div>
              </div>
            )}
            {leagueType === 'confidence-pool' && league.settings?.confidenceMaxPoints && (
              <div className="p-3 bg-white/5 rounded-lg text-center">
                <div className="text-xs font-display text-white/55 uppercase">Max Points</div>
                <div className="font-display font-bold text-sm text-pastel-cream">{league.settings.confidenceMaxPoints as number}</div>
              </div>
            )}
          </div>

          {/* Members list */}
          <div>
            <h3 className="font-display font-bold text-sm text-white/70 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Users className="w-4 h-4" /> Members
            </h3>
            <div className="space-y-2">
              {members.map((m, i) => {
                const isComm = m.owner_id === league.commissioner_id;
                const isYou = m.owner_id === user?.id;
                const name = m.owner_name || m.owner_username || m.team_name;
                return (
                  <div key={m.id} className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${
                    isYou ? 'bg-citrus-sage/10 border border-citrus-sage/20' : 'bg-white/5'
                  }`}>
                    {/* Rank / avatar */}
                    <div className="w-8 h-8 rounded-full bg-citrus-forest flex items-center justify-center text-white font-varsity font-bold text-xs shrink-0">
                      {i + 1}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="font-display font-bold text-sm text-pastel-cream truncate flex items-center gap-1.5">
                        {name}
                        {isComm && (
                          <Crown className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        )}
                        {isYou && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0">You</Badge>
                        )}
                      </div>
                      <div className="text-[11px] font-display text-white/55 truncate">
                        {m.team_name}{isComm ? ' · Commissioner' : ''}
                      </div>
                    </div>
                    {/* Commissioner actions */}
                    {isCommissioner && !isComm && (
                      <Button variant="ghost" size="sm" className="text-xs text-white/55 hover:text-red-500 shrink-0">
                        Remove
                      </Button>
                    )}
                  </div>
                );
              })}

              {members.length === 0 && (
                <div className="text-center py-8 text-white/55">
                  <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No members yet. Share the join code to invite players!</p>
                </div>
              )}
            </div>
          </div>

          {/* Commissioner controls */}
          {isCommissioner && (
            <div className="mt-6 pt-6 border-t border-white/10">
              <h3 className="font-display font-bold text-sm text-white/70 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Shield className="w-4 h-4" /> Commissioner Controls
              </h3>
              <div className="flex flex-wrap gap-2">
                {poolStatus === 'active' && (
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                    <Settings className="w-3.5 h-3.5" />
                    Edit Settings
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
