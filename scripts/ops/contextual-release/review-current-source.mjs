// Re-inspect exact current evidence. This does not renew dates or publish.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {hash} from './rehearse-production.mjs';
const [base,overlay,sourcePath,out]=process.argv.slice(2);
assert.ok(base&&overlay&&sourcePath&&out&&!existsSync(out));
const raw=readFileSync(resolve(overlay,'production-policy.json'));
assert.equal(hash(raw),'26893b8573829ac1b52f4b9be8284eae416f7d1a0d648b9f2a8fceaa06226bbd');
const policy=JSON.parse(raw), verified={};
for(const group of ['methods_sha256','inputs_sha256','review_evidence_sha256'])for(const [path,sha]of Object.entries(policy[group])){
 const runtime=resolve(overlay,'runtime',path.split('/').at(-1));
 const file=path.startsWith('scripts/ops/')&&existsSync(runtime)?runtime:resolve(base,path);
 assert.ok(file.startsWith(resolve(base)+'/')||file.startsWith(resolve(overlay)+'/'));
 assert.equal(hash(readFileSync(file)),sha,'Changed bound artifact: '+path);verified[path]=sha;
}
const sourceRaw=readFileSync(sourcePath),source=JSON.parse(sourceRaw);
const originalRaw=readFileSync(resolve(base,'output/qa/reviewed-source-release-20260918-v1/canonical.json'));
assert.equal(hash(sourceRaw),hash(originalRaw),'Effective exported source changed');
assert.equal(source.revision,policy.source_revision);
assert.deepEqual(source.players,JSON.parse(originalRaw).players);
const evaluation=JSON.parse(readFileSync(resolve(base,'output/qa/matchup-rebuild/finishing-evaluation-reconciled-2025-v1.json')));
const stability=JSON.parse(readFileSync(resolve(base,'output/qa/matchup-rebuild/finishing-stability-2025-v1.json')));
assert.equal(evaluation.status,'retrospective_diagnostic');assert.equal(stability.status,'retrospective_diagnostic');
const report={schema:'citrus.current-source-evidence-review.v1',status:'CURRENT_EVIDENCE_REVERIFIED',
 checkedAt:new Date().toISOString(),sourceRevision:source.revision,sourceSha256:hash(sourceRaw),verified,
 allPlayerRecordsUnchanged:true,playersCompared:source.players.length,numericalChanges:false,datesRenewed:false,
 methodAssessment:'Retain the existing bounded preseason method and explicit limitations. Combined source repair and finishing improve the inspected aggregate squared error. Incremental finishing uncertainty includes zero. No new tuning or claim of prospective validation.',
 limitations:[...evaluation.limitations,...stability.limitations],
 manualCalendarReview:source.players.filter(p=>p.availability_scenario).map(p=>({playerId:p.player_id,name:p.name,...p.availability_scenario,
   action:'Review current evidence and obtain a real owner confirmation where required. This receipt does not confirm recovery or renew the scenario.'})),
 recommendation:'Current evidence remains the same evidence underpinning the verified release. Keep its bounded validity. Maintain the accepted review process and 24-hour notice; future review dates are not external permissions or prerequisites to knowing future facts.',
 commercialAcceptance:false};
writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({status:report.status,out,sha256:hash(readFileSync(out)),artifacts:Object.keys(verified).length,
 playersCompared:report.playersCompared,numericalChanges:false,datesRenewed:false}));
