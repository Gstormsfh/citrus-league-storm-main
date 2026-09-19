import {describe,it,expect} from 'vitest';
import {readSettings,scoringProblem,supportedWeights} from '../savedSettings';
const template={skater:{goals:6},goalie:{wins:5}};
const weights={skater:{goals:'6'},goalie:{wins:'0'}};
describe('Saved league settings',()=>{
  it('supports skater-only scoring, but rejects all-zero and goalie-only boards',()=>{
    expect(scoringProblem(weights)).toBeNull();
    expect(scoringProblem({skater:{goals:'0'},goalie:{wins:'0'}})).toMatch(/Every scoring weight/);
    expect(scoringProblem({skater:{goals:'0'},goalie:{wins:'5'}})).toMatch(/goalie-only/);
  });
  it('rejects corrupt storage and unknown or missing categories',()=>{
    expect(readSettings({getItem:()=>'{invalid'},template)).toBeNull();
    expect(readSettings({getItem:()=>{throw Error('unavailable');}},template)).toBeNull();
    expect(supportedWeights({...weights,skater:{faceoffs:'1'}},template)).toBe(false);
    expect(supportedWeights({...weights,goalie:{}},template)).toBe(false);
    expect(supportedWeights({...weights,skater:{goals:'Infinity'}},template)).toBe(false);
  });
  it('loads only supported versioned settings and never an entitlement',()=>{
    expect(readSettings({getItem:()=>JSON.stringify({version:1,league:'My league',weights,paid:true})},template)).toEqual({league:'My league',weights});
  });
});
