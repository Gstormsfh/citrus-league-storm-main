/**
 * INVITE ACCEPT (2026-09-09, #19).
 *
 * The screen an invite link opens: who is inviting you, to which league, how
 * full it is, and one Accept button. Joining happens on Accept, never on
 * arrival. Before this, a tapped link auto-joined the moment a signed-in
 * user landed on /create-league?tab=join&code=... (that path still works for
 * links already sent). The share link now points here (utils/inviteShare.ts),
 * and /join/* is a universal link in the AASA so it opens inside the app.
 *
 * Signed-out invitees never reach this component: the route is wrapped in
 * ProtectedRoute, which sends them through /auth with this destination as the
 * redirect, so the code survives sign-in.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Loader2, Users } from 'lucide-react';
import { moderationError } from '@citrus/shared';
import Navbar from '@/components/Navbar';
import { DarkLayout, MascotAvatar } from '@/components/citrus2';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import { leagueApi, type InvitePreview } from '@/api/leagues';
import { LeagueService } from '@/services/LeagueService';
import { leagueSwitchDestination } from '@/utils/leagueTypeHelpers';
import { userMessage } from '@/lib/userMessage';

type Phase = 'loading' | 'ready' | 'joining' | 'missing' | 'failed';

const phoneButton =
  'w-full max-lg:h-12 max-lg:rounded-[12px] max-lg:border-0 max-lg:outline-none max-lg:shadow-none max-lg:font-plex max-lg:font-semibold max-lg:text-[12px] max-lg:tracking-[0.08em] max-lg:uppercase';

export default function InviteAccept() {
  const { code = '' } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { refreshLeagues } = useLeague();

  const [phase, setPhase] = useState<Phase>('loading');
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [teamName, setTeamName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setError(null);
    leagueApi
      .getInvite(code)
      .then((res) => {
        if (cancelled) return;
        if (!res.data) {
          setPhase('missing');
          return;
        }
        setInvite(res.data);
        setPhase('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const status = (err as { status?: number } | null)?.status;
        if (status === 404 || status === 400) {
          setPhase('missing');
        } else {
          setError(userMessage(err, 'Could not load this invite. Try again in a moment.'));
          setPhase('failed');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const openSeats = invite ? Math.max(0, invite.maxTeams - invite.filled) : 0;
  const isFull = !!invite && openSeats === 0 && !invite.alreadyMember;
  const teamNameProblem = teamName.trim() ? moderationError(teamName) : null;
  const destination = invite ? leagueSwitchDestination(invite.leagueId, invite.leagueType, '/join') : '/gm-office';

  const accept = async () => {
    if (!invite || !user) return;
    if (teamNameProblem) {
      setError(teamNameProblem);
      return;
    }
    setPhase('joining');
    setError(null);
    const { league, error: joinError } = await LeagueService.joinLeagueByCode(code, user.id, teamName.trim() || undefined);
    if (joinError || !league) {
      setError(userMessage(joinError, 'Could not join this league. Try again in a moment.'));
      setPhase('ready');
      return;
    }
    await refreshLeagues();
    navigate(leagueSwitchDestination(league.id, invite.leagueType, '/join'), { replace: true });
  };

  const title =
    phase === 'missing'
      ? 'That invite does not match a league'
      : invite?.alreadyMember
        ? `You are already in ${invite.name}`
        : invite
          ? `Join ${invite.name}?`
          : 'Opening your invite';

  return (
    <DarkLayout>
      <div className="hidden lg:block"><Navbar /></div>
      <main
        className="pb-type-phone relative flex items-center justify-center p-4 py-12 min-h-[calc(100vh-68px)] max-lg:min-h-screen max-lg:bg-pressbox-surface max-lg:text-pressbox-text max-lg:px-5 max-lg:pt-[calc(2.5rem+var(--safe-area-inset-top,env(safe-area-inset-top)))]"
        data-testid="invite-accept"
      >
        <Card className="w-full max-w-md bg-pastel-surface-tile border-white/10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)] max-lg:bg-transparent max-lg:border-0 max-lg:ring-0 max-lg:shadow-none max-lg:rounded-none">
          <CardHeader className="text-center max-lg:p-0 max-lg:pb-5">
            <div className="flex justify-center mb-2">
              <MascotAvatar id="stormy" size="lg" />
            </div>
            <CardTitle className="text-2xl font-bold max-lg:font-condensed max-lg:font-extrabold max-lg:text-[28px] max-lg:uppercase max-lg:tracking-[0.02em] max-lg:text-pressbox-text">
              {title}
            </CardTitle>
            {invite && !invite.alreadyMember && (
              <CardDescription className="max-lg:font-barlow max-lg:text-[13px] max-lg:text-pressbox-text/60">
                {invite.commissionerName ? `${invite.commissionerName} invited you.` : 'You have been invited.'}
              </CardDescription>
            )}
          </CardHeader>

          <CardContent className="space-y-4 max-lg:p-0">
            {phase === 'loading' && (
              <div className="flex justify-center py-6" role="status" aria-label="Loading invite">
                <Loader2 className="h-6 w-6 animate-spin text-pastel-orange" aria-hidden="true" />
              </div>
            )}

            {phase === 'missing' && (
              <>
                <p className="text-center text-sm text-muted-foreground max-lg:font-barlow max-lg:text-[13px] max-lg:text-pressbox-text/60">
                  Check the link with whoever sent it, or type the code in yourself.
                </p>
                <Button asChild className={phoneButton}>
                  <Link to="/create-league?tab=join">Enter a code</Link>
                </Button>
              </>
            )}

            {phase === 'failed' && (
              <>
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <Button variant="outline" className={phoneButton} onClick={() => navigate(0)}>
                  Try again
                </Button>
              </>
            )}

            {invite && (phase === 'ready' || phase === 'joining') && (
              <>
                <div
                  className="flex items-center justify-center gap-2 rounded-[12px] bg-white/5 px-3 py-2 text-sm text-pastel-cream max-lg:font-plex max-lg:text-[12px]"
                  data-testid="invite-seats"
                >
                  <Users className="h-4 w-4 text-pastel-orange" aria-hidden="true" />
                  <span>
                    {invite.filled} of {invite.maxTeams} teams in
                    {openSeats > 0 && !invite.alreadyMember ? ` · ${openSeats} ${openSeats === 1 ? 'seat' : 'seats'} open` : ''}
                  </span>
                </div>

                {invite.alreadyMember ? (
                  <Button asChild className={phoneButton}>
                    <Link to={destination}>Open the league</Link>
                  </Button>
                ) : isFull ? (
                  <>
                    <p className="text-center text-sm text-muted-foreground max-lg:font-barlow max-lg:text-[13px] max-lg:text-pressbox-text/60">
                      Every seat is taken. Ask the commissioner to open one up.
                    </p>
                    <Button asChild variant="outline" className={phoneButton}>
                      <Link to="/gm-office">Back to GM Office</Link>
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="invite-team-name" className="max-lg:font-plex max-lg:text-[11px] max-lg:uppercase max-lg:tracking-[0.1em] max-lg:text-pressbox-text/60">
                        Team name <span className="text-muted-foreground">(optional)</span>
                      </Label>
                      <Input
                        id="invite-team-name"
                        placeholder="You can change it later"
                        value={teamName}
                        onChange={(e) => setTeamName(e.target.value)}
                        disabled={phase === 'joining'}
                        aria-describedby={teamNameProblem ? 'invite-team-name-moderation' : undefined}
                        className="max-lg:h-12 max-lg:rounded-[12px] max-lg:bg-white/5 max-lg:border-white/10"
                      />
                      {teamNameProblem && (
                        <p id="invite-team-name-moderation" role="alert" className="text-sm text-red-300">
                          {teamNameProblem}
                        </p>
                      )}
                    </div>

                    {error && (
                      <Alert variant="destructive">
                        <AlertDescription>{error}</AlertDescription>
                      </Alert>
                    )}

                    <Button
                      onClick={accept}
                      disabled={phase === 'joining' || !!teamNameProblem}
                      className={`${phoneButton} max-lg:bg-pressbox-orange max-lg:text-pressbox-orange-ink`}
                    >
                      {phase === 'joining' ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                          Joining
                        </>
                      ) : (
                        'Accept and join'
                      )}
                    </Button>
                    <Button asChild variant="ghost" className={phoneButton}>
                      <Link to="/gm-office">Not now</Link>
                    </Button>
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </DarkLayout>
  );
}
