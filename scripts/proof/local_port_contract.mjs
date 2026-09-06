import assert from 'node:assert/strict';
export function publishedLoopbackPort(info, containerPort) {
  const bindings = info.NetworkSettings?.Ports?.[containerPort];
  assert(Array.isArray(bindings) && bindings.length === 1, 'Exactly one published loopback binding required');
  assert.equal(bindings[0].HostIp, '127.0.0.1', 'No externally bound fixture port');
  assert(/^[0-9]+$/.test(bindings[0].HostPort));
  const port = Number(bindings[0].HostPort);
  assert(Number.isSafeInteger(port) && port >= 1024 && port <= 65535);
  return port;
}
