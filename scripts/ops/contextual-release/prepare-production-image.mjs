// Produce a small operational overlay on the exact passed staging image.
// No numerical file is copied from a mutable working tree.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {hash} from './rehearse-production.mjs';
const [base,out]=process.argv.slice(2);assert.ok(base&&out&&!existsSync(out));
const raw=readFileSync(resolve(base,'release/policy.json'),'utf8');
assert.equal(hash(raw),'5611dc80886dc1fadc65dcdfeba5f33bd198b0094e1f512606c297ef60af77c6');
const policy=JSON.parse(raw);assert.equal(policy.source_revision,'70fd8899e67480cf7cd061a3b88e4a4110bc5a2f27ae756c300f48635fec8255');
for(const group of ['methods_sha256','inputs_sha256','review_evidence_sha256'])for(const [file,sha]of Object.entries(policy[group])){
 const path=resolve(base,file);assert.ok(path.startsWith(resolve(base)+'/'));assert.equal(hash(readFileSync(path)),sha,'Verified base artifact changed: '+file);
}
policy.project='iezwazccqqrhrjupxzvf';policy.production_authorized=true;policy.customer_release_ready=false;
policy.production_operational_amendment={
 prior_staging_policy_sha256:hash(raw),base_image_digest:'sha256:83eccb8044257d05792d6825cf0cb2d124ba4133e5591d9c212e039b097bf092',
 scope:'Production-bound operational entrypoint; first run prepares without publication; subsequent publication requires matching active source and disabled legacy cron.',
 numerical_methods_changed:false,approval_window_extended:false,goalie_calendar_enabled:false,
 authorization:'User requested production readiness and cutover; coordinated September 19 release preparation.',
};
mkdirSync(resolve(out,'runtime'),{recursive:true,mode:0o700});
const runtime=new URL('./runtime/',import.meta.url);
for(const name of readdirSync(runtime).filter(n=>n.endsWith('.py')).sort()){
 const contents=readFileSync(new URL(name,runtime));
 policy.methods_sha256['scripts/ops/'+name]=hash(contents);
 copyFileSync(new URL(name,runtime),resolve(out,'runtime',name));
}
const policyText=JSON.stringify(policy,null,2)+'\n';
writeFileSync(resolve(out,'production-policy.json'),policyText,{flag:'wx',mode:0o600});
copyFileSync(new URL('./Dockerfile.production',import.meta.url),resolve(out,'Dockerfile'));
writeFileSync(resolve(out,'overlay-manifest.json'),JSON.stringify({baseImage:policy.production_operational_amendment.base_image_digest,
 policySha256:hash(policyText),files:Object.fromEntries(readdirSync(resolve(out,'runtime')).map(name=>[name,hash(readFileSync(resolve(out,'runtime',name)))]))},null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({status:'PREPARED',policySha256:hash(policyText),numericalMethodsChanged:false,publicationReady:false}));
