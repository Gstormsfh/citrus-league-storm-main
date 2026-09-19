import type {SupabaseClient} from '@supabase/supabase-js';
import {AppError} from '../lib/errors';
import {PublishedDraftDeskService,DESK_SUPPORTED_WEIGHTS,type ConnectedKit} from './PublishedDraftDeskService';
import {roomDeskWeights} from './DraftKitDeskService';
import {BrowserDraftResearchService} from './BrowserDraftResearchService';

type Mapping={external_player_id:string;nhl_player_id:number|null;match_method:string;is_ambiguous:boolean};
/** Require a complete one-to-one reviewed mapping of THIS board. We do not need
 * to resolve picks outside it, but an unmapped board player cannot be called available. */
export function browserBoardMappings(kit:ConnectedKit,rows:Mapping[]){
  const needed=new Set(kit.players.map(p=>p.key)),ids=new Set<string>(),keys=new Set<string>();
  const mappings:Array<{externalPlayerId:string;key:string}>=[];
  for(const row of rows){
    const key=`canonical:${row.nhl_player_id}`;
    if(!needed.has(key))continue;
    if(row.is_ambiguous||!['manual','exact_name_team_number','name_team'].includes(row.match_method))continue;
    if(!/^[1-9]\d{0,11}$/.test(row.external_player_id)||ids.has(row.external_player_id)||keys.has(key))throw AppError.conflict('Provider player IDs are ambiguous. This companion cannot safely follow this board yet.');
    ids.add(row.external_player_id);keys.add(key);mappings.push({externalPlayerId:row.external_player_id,key});
  }
  if(keys.size!==needed.size)throw AppError.conflict(`${needed.size-keys.size} board players still need verified provider IDs. We cannot safely mark this board available yet.`);
  return mappings;
}

/** Purchaser's custom board, not a claim of provider membership or a league
 * import. Only public player mappings and published projections are read.
 * Route must verify purchase before and after; no provider cookie/API access. */
export class BrowserDraftKitService {
  constructor(private db:SupabaseClient,private admin:SupabaseClient,private publisher=new PublishedDraftDeskService(db),private research=new BrowserDraftResearchService()){}
  async open(platform:'espn'|'yahoo',league:string,rawWeights:unknown){
    const weights=roomDeskWeights(rawWeights,DESK_SUPPORTED_WEIGHTS,{scoringFormat:'h2h-points'});
    const publication=await this.publisher.connected(league,weights);
    const {kit,warning:researchWarning}=await this.research.attach(publication.kit);
    const {data,error}=await this.admin.from('external_player_ids')
      .select('external_player_id,nhl_player_id,match_method,is_ambiguous')
      .eq('platform',platform).in('nhl_player_id',kit.players.map(p=>Number(p.key.slice('canonical:'.length)))).limit(1000);
    if(error||!data||data.length===1000)throw AppError.serviceUnavailable('Provider player identities could not be checked. Please retry.');
    const mappings=browserBoardMappings(kit,data);
    return {bundle:{version:1,platform,scoringVerified:false,
      file:{kind:'citrus-connected-desk',version:1,kit,progress:{version:1,fingerprint:kit.fingerprint,rows:[]}},mappings},warning:[publication.warning,researchWarning].filter(Boolean).join(' ')||null};
  }
}
