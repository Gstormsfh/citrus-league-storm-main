// Operator-only acceptance against the existing Stripe sandbox and staging API.
// Secrets remain in memory/private local state, never console output or receipts.
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import Stripe from 'stripe';
const project='citrus-fantasy-staging';
const api='https://citrus-api-3azzwszd2q-uc.a.run.app';
const [phase,folder]=process.argv.slice(2);
assert.ok(folder?.startsWith('/tmp/citrus-'));
const secret=name=>execFileSync('gcloud',['secrets','versions','access','latest','--secret='+name,'--project='+project],{encoding:'utf8'}).trim();
const url=secret('SUPABASE_URL');assert.equal(new URL(url).hostname,'jjgspcpvqaiitloglxbb.supabase.co');
const anon=secret('SUPABASE_ANON_KEY');
const admin=createClient(url,secret('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
const stripeKey=secret('STRIPE_SECRET_KEY');assert.match(stripeKey,/^(sk|rk)_test_/);
const stripe=new Stripe(stripeKey,{maxNetworkRetries:0});
const statePath=folder+'/private-state.json';
const save=(name,data)=>writeFileSync(folder+'/'+name,JSON.stringify(data,null,2),{mode:0o600});
let state=existsSync(statePath)?JSON.parse(readFileSync(statePath,'utf8')):{};
async function request(path,user,body,headers={}){
 const result=await fetch(api+path,{method:body===undefined?'GET':'POST',headers:{...headers,...(user?{Authorization:'Bearer '+user.token}:{}),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(200000)});
 return {status:result.status,body:await result.json()};
}
if(phase==='prepare'){
 assert.ok(!existsSync(folder));mkdirSync(folder,{mode:0o700});
 const price=await stripe.prices.retrieve('price_1UHA6CKzkJQAEbwjCUtJDIKc');
 assert.equal(price.livemode,false);assert.equal(price.unit_amount,799);assert.equal(price.currency,'cad');assert.equal(price.tax_behavior,'exclusive');
 state={createdAt:new Date().toISOString(),api,users:[],priceId:price.id};save('private-state.json',state);
 for(const role of ['buyer','nonbuyer']){
  const email=`citrus-kit-qa-${role}-${randomUUID()}@example.invalid`,password=randomUUID()+randomUUID();
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:'Citrus disposable '+role+' QA'}});
  assert.ifError(created.error);const user={role,id:created.data.user.id,email,password};state.users.push(user);save('private-state.json',state);
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const signed=await auth.auth.signInWithPassword({email,password});assert.ifError(signed.error);
  user.token=signed.data.session.access_token;save('private-state.json',state);
 }
 console.log(JSON.stringify({prepared:true,users:state.users.map(({role,id})=>({role,id})),priceId:price.id}));
}else if(phase==='checkout'){
 const [buyer,nonbuyer]=state.users;
 for(const user of [buyer,nonbuyer]){
  const denied=await request('/api/draft-kit/pdf/configuration',user);assert.equal(denied.status,403);
 }
 const offer=await request('/api/draft-kit/checkout/offer');assert.equal(offer.body.data.available,true);
 state.attemptId??=randomUUID();save('private-state.json',state);
 const result=await request('/api/draft-kit/checkout/session',buyer,{}, {'x-checkout-attempt':state.attemptId});assert.equal(result.status,200,JSON.stringify(result.body));
 state.checkoutUrl=result.body.data.url;save('private-state.json',state);
 console.log(JSON.stringify({checkoutUrl:state.checkoutUrl,nonbuyerDenied:true}));
}else if(phase==='downloads'){
 const [buyer,nonbuyer]=state.users;
 const access=await request('/api/draft-kit/pdf/access',buyer);assert.equal(access.body.data.active,true,JSON.stringify(access));
 const configuration=await request('/api/draft-kit/pdf/configuration',buyer);assert.equal(configuration.status,200);
 const config=configuration.body.data,files=[];
 const denied=await request('/api/draft-kit/pdf/configuration',nonbuyer);assert.equal(denied.status,403);
 for(const format of ['csv','desk','tracker','cheatsheet','pdf']){
  const started=Date.now(),result=await request('/api/draft-kit/pdf/download',buyer,{format,league:'Citrus paid staging acceptance',weights:config.weights});
  assert.equal(result.status,200,JSON.stringify(result.body));
  const data=result.body.data,bytes=Buffer.from(data.base64,'base64');
  assert.ok(!data.filename.includes('/'));writeFileSync(folder+'/'+data.filename,bytes,{mode:0o600,flag:'wx'});
  files.push({format,filename:data.filename,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),milliseconds:Date.now()-started});
  save('downloads.json',{revision:config.revision,files,nonbuyerDenied:true});console.log(JSON.stringify(files.at(-1)));
 }
 const records=await admin.from('draft_kit_checkout_payments').select('checkout_session_id,payment_intent_id,status').eq('user_id',buyer.id);
 assert.ifError(records.error);state.payments=records.data;save('private-state.json',state);
 console.log(JSON.stringify({status:'DOWNLOADS_PASS',revision:config.revision,files:files.length}));
}else if(phase==='inspect-payment'){
 const records=await admin.from('draft_kit_checkout_payments').select('*').eq('user_id',state.users[0].id);
 assert.ifError(records.error);
 for(const record of records.data){
  const session=await stripe.checkout.sessions.retrieve(record.checkout_session_id,{expand:['payment_intent']});
  assert.equal(session.livemode,false);
  const receipt={session:session.id,status:session.status,payment_status:session.payment_status,subtotal:session.amount_subtotal,total:session.amount_total,tax:session.total_details.amount_tax,tax_status:session.automatic_tax.status,payment_intent:session.payment_intent.id,accessRecord:record.status};
  save('payment.json',receipt);console.log(JSON.stringify(receipt));
 }
}else if(phase==='revoked'){
 const access=await request('/api/draft-kit/pdf/access',state.users[0]);assert.equal(access.body.data.active,false,JSON.stringify(access));
 const config=await request('/api/draft-kit/pdf/configuration',state.users[0]);assert.equal(config.status,403);
 save('revocation.json',{checkedAt:new Date().toISOString(),active:false,configurationStatus:config.status});console.log('REVOCATION_PASS');
}else throw Error('Unknown phase');
