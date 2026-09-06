import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishedLoopbackPort } from './local_port_contract.mjs';
const fixture = binding => ({ NetworkSettings: { Ports: { '5432/tcp': binding } } });
test('requires an actual assigned loopback port', () => {
  assert.equal(publishedLoopbackPort(fixture([{ HostIp: '127.0.0.1', HostPort: '51234' }]), '5432/tcp'), 51234);
});
for (const [name, binding] of Object.entries({ missing: undefined, empty: [],
  external: [{ HostIp: '0.0.0.0', HostPort: '51234' }],
  unassigned: [{ HostIp: '127.0.0.1', HostPort: '' }],
  privileged: [{ HostIp: '127.0.0.1', HostPort: '22' }],
  outOfRange: [{ HostIp: '127.0.0.1', HostPort: '99999' }],
  duplicate: [{ HostIp: '127.0.0.1', HostPort: '51234' }, { HostIp: '127.0.0.1', HostPort: '51235' }],
})) test('rejects ' + name, () => assert.throws(() => publishedLoopbackPort(fixture(binding), '5432/tcp')));
