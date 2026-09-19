// No provider credentials or scoring engine. This envelope carries a purchased
// Citrus board and reviewed ID mappings; the UI also validates the full DeskFile.
export function validateCompanionBundle(raw){
  const bad=()=>{throw Error('Invalid companion bundle.');};
  if(!raw||JSON.stringify(raw).length>1000000||raw.version!==1||!['espn','yahoo'].includes(raw.platform)
    ||raw.file?.kind!=='citrus-connected-desk'||raw.file.version!==1||!Array.isArray(raw.file.kit?.players)
    ||!Array.isArray(raw.mappings)||raw.mappings.length>300||!Array.isArray(raw.file.progress?.rows)
    ||raw.file.progress.rows.length>300||typeof raw.scoringVerified!=='boolean')return bad();
  const players=raw.file.kit.players;
  if(players.length<1||players.length>300||new Set(players.map(p=>p.key)).size!==players.length)return bad();
  const ids=new Set(),canonical=new Set();
  for(const m of raw.mappings){
    if(!/^[1-9]\d{0,11}$/.test(m.externalPlayerId)||!/^canonical:[1-9]\d{0,9}$/.test(m.key)
      ||!players.some(p=>p.key===m.key)||ids.has(m.externalPlayerId)||canonical.has(m.key))return bad();
    ids.add(m.externalPlayerId);canonical.add(m.key);
  }
  // Complete board mapping is mandatory. Unknown picks may be outside the top
  // 300, but no player on this board may have an unknown provider identity.
  if(canonical.size!==players.length)return bad();
  return {version:1,platform:raw.platform,file:raw.file,mappings:raw.mappings.map(m=>({externalPlayerId:m.externalPlayerId,key:m.key})),scoringVerified:raw.scoringVerified};
}
