import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../lib/errors';
import { YahooClient } from '../import/yahoo/client';
import { EspnClient, type EspnCredentials } from '../import/espn/client';
import { asList } from '../import/yahoo/normalize';
import { parseYahooSeason } from '../import/yahoo/parse';
import { parseEspnSeason } from '../import/espn/parse';
import { YahooConnectionService } from './import/YahooConnectionService';
import { PlayerCrosswalkService } from './import/PlayerCrosswalkService';
import { ScoringTranslationService } from './import/ScoringTranslationService';
import { PublishedDraftDeskService, DESK_SUPPORTED_WEIGHTS } from './PublishedDraftDeskService';
import { roomDeskWeights } from './DraftKitDeskService';
import { espnDraftSnapshot, yahooDraftSnapshot, resolveDraftSnapshot, type ExternalDraftPlatform } from './ExternalDraftSnapshotService';
import type { ImportedSettings } from '../import/types';

export interface ExternalDraftRequest { platform: ExternalDraftPlatform; leagueId: string; season: number; credentials?: EspnCredentials }
type ObjectValue = Record<string, unknown>;
const object = (v: unknown): v is ObjectValue => !!v && typeof v === 'object' && !Array.isArray(v);

export function externalDraftWeights(settings: ImportedSettings) {
  // ESPN includes disabled point categories as enabled records with a zero
  // weight. They do not affect points; category leagues still remain blocked.
  const pointsLeague = ['h2h_points', 'points'].includes(settings.scoringType);
  const translated = new ScoringTranslationService().translate(pointsLeague
    ? { ...settings, scoringItems: settings.scoringItems.filter(item => item.points !== 0) }
    : settings);
  if (!translated.scoringFormat || !['h2h-points','total-points'].includes(translated.scoringFormat) || translated.unmapped.length)
    throw AppError.badRequest('This companion cannot match all of this league’s scoring rules. Category leagues and unsupported point categories cannot use this edition.');
  // Missing source weights mean zero, never Citrus defaults.
  const weights = Object.fromEntries(Object.entries(DESK_SUPPORTED_WEIGHTS).map(([group,values]) =>
    [group,{...Object.fromEntries(Object.keys(values).map(k=>[k,0])),...translated.scoringSettings[group as 'skater'|'goalie']}])) ;
  return roomDeskWeights(weights,DESK_SUPPORTED_WEIGHTS,{scoringFormat:translated.scoringFormat});
}

/** External reads never create a Citrus league or write to either draft. Disabled
 * at the route until authenticated live acceptance and OAuth concurrency review.
 * No provider session credentials are persisted by this service.
 */
export class ExternalDraftGatewayService {
  constructor(private db: SupabaseClient, private admin: SupabaseClient,
    private connection = new YahooConnectionService(admin), private espn = new EspnClient(),
    private publisher = new PublishedDraftDeskService(db)) {}

  private async read(userId: string, request: ExternalDraftRequest) {
    if(request.platform==='yahoo') {
      const status=await this.connection.status(userId);
      if(!this.connection.isConfigured()||!status.connected||!status.guid)throw AppError.conflict('Connect your Yahoo account before opening its draft.');
      const client=new YahooClient(this.connection.tokenProvider(userId));
      const response=await client.league(request.leagueId,['metadata','settings','teams','draftresults']);
      if(!object(response.content)||!object(response.content.league))throw AppError.badGateway('Yahoo did not return the requested league.');
      const league=response.content.league;
      const member=asList<unknown>(league.teams).some(t=>object(t)&&asList<unknown>(t.managers).some(m=>object(m)&&m.guid===status.guid));
      if(!member)throw AppError.forbidden('Your connected Yahoo account is not a member of this league.');
      const keepers=await client.keepers(request.leagueId);
      const snapshot=yahooDraftSnapshot(response.content,keepers.content,request.leagueId,request.season);
      return {snapshot,settings:parseYahooSeason({league}).settings};
    }
    const response=await this.espn.fetchSeason(request.leagueId,request.season+1,['mDraftDetail','mTeam','mSettings'],request.credentials);
    if(!object(response.body)||!object(response.body.settings))throw AppError.badGateway('ESPN did not return league settings.');
    const body=response.body;
    // Public league information is readable. Private reads must establish that
    // the supplied identity is a member, not just that a session exists.
    if((body.settings as ObjectValue).isPublic!==true) {
      const swid=request.credentials?.swid?.toUpperCase();
      const member=swid&&asList<unknown>(body.teams).some(t=>object(t)&&Array.isArray(t.owners)&&t.owners.some(o=>typeof o==='string'&&o.toUpperCase()===swid));
      if(!member)throw AppError.forbidden('A member’s ESPN connection is required for this private league.');
    }
    const snapshot=espnDraftSnapshot(body,request.leagueId,request.season);
    return {snapshot,settings:parseEspnSeason(request.leagueId,{core:body}).settings};
  }

  async snapshot(userId: string, request: ExternalDraftRequest) {
    const {snapshot,settings}=await this.read(userId,request);
    const known=await new PlayerCrosswalkService(this.admin).lookupKnown(request.platform,snapshot.picks.map(p=>p.externalPlayerId));
    return {...resolveDraftSnapshot(snapshot,known,new Date().toISOString()),weights:externalDraftWeights(settings)};
  }

  async open(userId: string, request: ExternalDraftRequest) {
    const snapshot=await this.snapshot(userId,request);
    if(!snapshot.complete)throw AppError.conflict('Some drafted player identities are unresolved. This board cannot safely follow picks yet.');
    const {kit,warning}=await this.publisher.connected(`${request.platform==='yahoo'?'Yahoo':'ESPN'} league ${request.leagueId}`,snapshot.weights,request.season);
    return {file:{kind:'citrus-connected-desk',version:1,kit,progress:{version:1,fingerprint:kit.fingerprint,rows:[]}},snapshot,warning};
  }
}
