import { describe, expect, it } from 'vitest';
import { AnalyticsPublicationService, type MetricSelector } from '../services/AnalyticsPublicationService';
import { createChain, createMockSupabase } from './helpers';

const selector: MetricSelector = {metric:'avg_toi_per_game',variant:'official-reconciled',unit:'minutes_per_appearance',
  season:2025,game_type:'regular',population:'skaters',feature_version:'v2',model_version:'none'};
const batch = {...selector,id:'batch',source_snapshot_id:'source',data_cutoff:'2026-09-05T00:00:00Z',
  expected_entities:2,validation:{status:'passed',entity_ids:[1,2],freshness_observed_at:'2026-09-05T00:00:00Z',
    gate_version:'official-appearance-v2',evidence_sha256:'a'.repeat(64)},code_revision:'0'.repeat(40)};
const rows = [{entity_id:1,value:0,availability:'available',reason:'verified'},
  {entity_id:2,value:null,availability:'unavailable',reason:'source_mismatch'}];
function service(values = rows, count = 2, metadata = batch) {
  const db=createMockSupabase({analytics_publications:createChain({data:{batch:metadata},error:null}),
    analytics_metric_values:createChain({data:values,count,error:null})});
  return new AnalyticsPublicationService(db,()=>Date.parse('2026-09-05T01:00:00Z'));
}
describe('published metric availability',()=>{
  it('rejects missing gate identity and malformed evidence fingerprints',async()=>{
    for (const validation of [{...batch.validation,gate_version:''},{...batch.validation,evidence_sha256:'invalid'}]) {
      await expect(service(rows,2,{...batch,validation}).readLatest(selector,7200000)).rejects.toThrow('evidence');
    }
  });
  it('keeps measured zero and unavailable values distinct',async()=>{
    const result=await service().readLatest(selector,7200000);
    expect(result?.values[0]).toEqual({entityId:1,value:0,availability:'available',reason:'verified'});
    expect(result?.values[1].value).toBeNull();
  });
  it('never serves stale preserved values as current',async()=>{
    const result=await service().readLatest(selector,1000);
    expect(result?.values.every(v=>v.value===null && v.reason==='stale_source')).toBe(true);
  });
  it('rejects incomplete reads and equally sized wrong identities',async()=>{
    await expect(service(rows.slice(0,1)).readLatest(selector,7200000)).rejects.toThrow('Incomplete');
    await expect(service([rows[0],{...rows[1],entity_id:3}]).readLatest(selector,7200000)).rejects.toThrow('identity');
  });
  it('rejects a different model variant',async()=>{
    await expect(service(rows,2,{...batch,model_version:'other'}).readLatest(selector,7200000)).rejects.toThrow('variant/version');
  });
  it('does not refresh old source data by giving it a newer computation cutoff',async()=>{
    const oldSource = {...batch,validation:{...batch.validation,freshness_observed_at:'2026-08-01T00:00:00Z'}};
    const result=await service(rows,2,oldSource).readLatest(selector,7200000);
    expect(result?.values.every(v=>v.value===null && v.reason==='stale_source')).toBe(true);
  });
  it('rejects future or missing source freshness evidence',async()=>{
    const bad = {...batch,validation:{...batch.validation,freshness_observed_at:''}};
    await expect(service(rows,2,bad).readLatest(selector,7200000)).rejects.toThrow('freshness');
  });
});
