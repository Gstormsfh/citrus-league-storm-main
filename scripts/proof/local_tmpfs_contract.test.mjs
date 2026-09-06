import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyDatabaseTmpfs } from './local_tmpfs_contract.mjs';
const target = '/var/lib/postgresql/data';
const fixture = () => ({ Mounts: [{ Type: 'tmpfs', Destination: target }],
  HostConfig: { Mounts: [{ Type: 'tmpfs', Target: target, TmpfsOptions: { SizeBytes: 1073741824 } }] } });
const kernel = `152 151 0:77 / ${target} rw,nosuid,nodev - tmpfs tmpfs rw,size=1048576k`;
test('declared, inspected and kernel tmpfs all required', () => {
  assert.equal(verifyDatabaseTmpfs(fixture(), kernel).live_tmpfs_verified, true);
});
for (const bad of ['bind', 'volume', 'missing', 'duplicate', 'unbounded', 'wrong-config', 'wrong-kernel', 'missing-kernel']) {
  test('rejects ' + bad, () => {
    const info = fixture(); let live = kernel;
    if (bad === 'bind' || bad === 'volume') info.Mounts.push({ Type: bad, Destination: '/extra' });
    if (bad === 'missing') info.Mounts = [];
    if (bad === 'duplicate') info.Mounts.push(info.Mounts[0]);
    if (bad === 'unbounded') delete info.HostConfig.Mounts[0].TmpfsOptions;
    if (bad === 'wrong-config') info.HostConfig.Mounts[0].Type = 'volume';
    if (bad === 'wrong-kernel') live = kernel.replace('- tmpfs', '- overlay');
    if (bad === 'missing-kernel') live = '';
    assert.throws(() => verifyDatabaseTmpfs(info, live));
  });
}
