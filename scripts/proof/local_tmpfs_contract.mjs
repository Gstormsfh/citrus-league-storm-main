import assert from 'node:assert/strict';
export function verifyDatabaseTmpfs(info, kernelMountInfo) {
  const target = '/var/lib/postgresql/data';
  assert(Array.isArray(info.Mounts) && Array.isArray(info.HostConfig?.Mounts));
  assert(info.Mounts.every(m => m.Type !== 'bind' && m.Type !== 'volume'), 'No persistent or host mounts');
  const configured = info.HostConfig.Mounts.filter(m => m.Target === target);
  assert.equal(configured.length, 1);
  assert.equal(configured[0].Type, 'tmpfs');
  assert.equal(configured[0].TmpfsOptions?.SizeBytes, 1073741824);
  const actual = info.Mounts.filter(m => m.Destination === target);
  assert.equal(actual.length, 1);
  assert.equal(actual[0].Type, 'tmpfs');
  const kernel = kernelMountInfo.trim().split('\n').map(line => line.split(' ')).filter(fields => fields[4] === target);
  assert.equal(kernel.length, 1, 'Exact live database mount required');
  const separator = kernel[0].indexOf('-');
  assert(separator > 5 && kernel[0][separator + 1] === 'tmpfs', 'Live database filesystem must be tmpfs');
  return { configured_mounts: configured, inspected_mounts: actual, kernel_mount: kernel[0].join(' '),
    live_tmpfs_verified: true, persistent_or_host_mounts: false };
}
