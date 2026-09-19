export type StringWeights = Record<string,Record<string,string>>;
export const SETTINGS_KEY='citrus-draft-kit-settings:2026-27:v1';
export function supportedWeights(value:unknown,template:Record<string,Record<string,number>>):value is StringWeights {
  if(!value || typeof value!=='object' || Array.isArray(value))return false;
  const v=value as StringWeights;
  if(Object.keys(v).sort().join()!==Object.keys(template).sort().join())return false;
  return Object.entries(template).every(([group,fields])=>v[group] && typeof v[group]==='object'
    && !Array.isArray(v[group]) && Object.keys(v[group]).sort().join()===Object.keys(fields).sort().join()
    && Object.values(v[group]).every(x=>typeof x==='string'&&x.trim()!==''&&Number.isFinite(Number(x))&&Math.abs(Number(x))<=10000));
}
export function readSettings(storage:Pick<Storage,'getItem'>,template:Record<string,Record<string,number>>) {
  try {
    const raw=storage.getItem(SETTINGS_KEY);if(!raw || raw.length>16000)return null;
    const value=JSON.parse(raw);
    if(value.version!==1 || typeof value.league!=='string' || !value.league.trim() || value.league.length>64 || !supportedWeights(value.weights,template))return null;
    return {league:value.league,weights:value.weights as StringWeights};
  }catch{return null;}
}
export function scoringProblem(weights:StringWeights):string|null {
  const all=Object.values(weights).flatMap(group=>Object.values(group));
  if(!all.length || all.some(v=>v.trim()===''||!Number.isFinite(Number(v))||Math.abs(Number(v))>10000))return 'Enter a valid number for every scoring category.';
  if(all.every(v=>Number(v)===0))return 'Every scoring weight is zero. Add your league scoring to build a meaningful board.';
  if(!Object.values(weights.skater??{}).some(v=>Number(v)!==0))return 'This Top 300 kit needs skater scoring. A goalie-only pool cannot fill 300 places.';
  return null;
}
