import test from 'node:test';
import assert from 'node:assert/strict';
import {channels,monitoringProposal} from './monitoring.mjs';
test('monitoring proposal is disabled and reuses only the two existing production routes',()=>{
 const p=monitoringProposal();assert.equal(p.deploymentReady,false);
 for(const policy of p.policies){assert.equal(policy.enabled,false);assert.deepEqual(policy.notificationChannels,channels);}
 assert.ok(!JSON.stringify(p).includes('@'));assert.equal(p.policies.length,2);
});
test('both healthy and unhealthy runs count as checker liveness; separate policy reports failed checks',()=>{
 const p=monitoringProposal();assert.ok(!p.metric.filter.includes('healthy'));
 assert.ok(p.policies[0].conditions[0].conditionMatchedLog.filter.includes('healthy=false'));
 assert.equal(p.policies[1].conditions[0].conditionAbsent.duration,'1200s');
 assert.equal(p.policies[1].conditions[1].conditionThreshold.comparison,'COMPARISON_LT');
 assert.equal(p.policies[1].conditions[1].conditionThreshold.thresholdValue,1);
 assert.ok(p.activationRequirements.some(x=>x.includes('actual heartbeat metric point')));
});
