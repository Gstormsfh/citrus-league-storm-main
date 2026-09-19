import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const root=new URL('../../../',import.meta.url);
const read=name=>readFileSync(new URL(name,root),'utf8');
test('normal production deploy builds the private-edition-capable image',()=>{
 assert.match(read('.github/workflows/production-deploy.yml'),/-f server\/Dockerfile\.draft-kit/);
 assert.match(read('server/Dockerfile.draft-kit'),/scripts\/ops\/draft-kit-runtime\/bootstrap.py/);
});
test('declarative recovery preserves the same edition and commercial settings',()=>{
 const workflow=read('.github/workflows/production-deploy.yml'),service=read('ops/cloudrun/service.yaml');
 for(const name of ['DRAFT_KIT_DOWNLOAD_ORIGIN','DRAFT_KIT_PDF_READY','DRAFT_KIT_CHECKOUT_ENABLED','DRAFT_KIT_BUNDLE_URI','DRAFT_KIT_BUNDLE_SHA256','DRAFT_KIT_BUNDLE_REVISION','DRAFT_KIT_STRIPE_PRICE_ID','DRAFT_KIT_CURRENCY','DRAFT_KIT_AMOUNT_MINOR','DRAFT_KIT_TIER','DRAFT_KIT_ACCESS_UNTIL','DRAFT_KIT_UPDATES_UNTIL','DRAFT_KIT_SITE_ORIGIN','DRAFT_KIT_TERMS_URL','DRAFT_KIT_TERMS_VERSION','DRAFT_KIT_TAX_MODE']){
  const value=workflow.match(new RegExp('^\\s+'+name+'=(.+)$','m'))?.[1];assert.ok(value,name);
  const deployed=service.match(new RegExp('- name: '+name+'\\n\\s+value: "?([^"\\n]+)"?'))?.[1];assert.equal(deployed,value,name);
 }
 assert.match(workflow,/--timeout=240s/);assert.match(service,/timeoutSeconds: 240/);
});
test('private editions stay outside API build context',()=>{
 const ignores=read('.dockerignore');
 for(const path of ['output/','scripts/draft-guide/review-inputs/','scripts/draft-guide/assets/headshots/'])assert.ok(ignores.includes(path));
});
