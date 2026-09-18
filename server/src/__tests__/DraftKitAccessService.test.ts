import {describe,expect,it,vi} from 'vitest';
import {DraftKitAccessService} from '../services/DraftKitAccessService';
const USER='11111111-1111-4111-8111-111111111111';
function setup(data:unknown){
 const query:any={};
 for(const k of ['select','eq','in','lte','or','order','limit'])query[k]=vi.fn(()=>query);
 query.maybeSingle=vi.fn().mockResolvedValue({data,error:null});
 const db={from:vi.fn(()=>query)};
 return {query,db,service:new DraftKitAccessService(db as any)};
}
const grant={user_id:USER,tier:'kit',granted_at:'2026-01-01T00:00:00Z',expires_at:'2099-07-01T00:00:00Z'};
describe('Single checkout entitlement authority',()=>{
 it('uses an owner-scoped, live grant without looking at the old PDF ledger',async()=>{
  const {service,db,query}=setup(grant);
  expect(await service.access(USER)).toEqual({active:true,accessUntil:grant.expires_at});
  expect(db.from).toHaveBeenCalledExactlyOnceWith('draft_kit_entitlements');
  expect(query.eq).toHaveBeenCalledWith('user_id',USER);
  expect(query.in).toHaveBeenCalledWith('tier',['kit','suite']);
  expect(query.lte).toHaveBeenCalledWith('granted_at',expect.any(String));
  expect(query.or).toHaveBeenCalledWith(expect.stringMatching(/^expires_at.is.null,expires_at.gt./));
 });
 it('allows explicit non-expiring founder grants and denies no grant',async()=>{
  expect(await setup({...grant,tier:'suite',expires_at:null}).service.access(USER)).toEqual({active:true,accessUntil:null});
  expect(await setup(null).service.access(USER)).toEqual({active:false,accessUntil:null});
 });
 it.each([{user_id:'other'},{tier:'free'},{expires_at:'invalid'},{expires_at:'2000-01-01'},
  {granted_at:'invalid'},{granted_at:'2100-01-01'}])('rejects invalid or expired results %j',async(change)=>{
  await expect(setup({...grant,...change}).service.access(USER)).rejects.toMatchObject({status:503});
 });
 it('fails closed on errors and rechecks refund/expiry on every access',async()=>{
  const{service,query,db}=setup(grant);
  expect((await service.access(USER)).active).toBe(true);
  query.maybeSingle.mockResolvedValueOnce({data:null,error:null});
  expect((await service.access(USER)).active).toBe(false);
  query.maybeSingle.mockResolvedValueOnce({data:null,error:{message:'offline'}});
  await expect(service.access(USER)).rejects.toMatchObject({status:503});
  expect(db.from).toHaveBeenCalledTimes(3);
  await expect(service.access('forged')).rejects.toMatchObject({status:401});
  expect(db.from).toHaveBeenCalledTimes(3);
 });
});
