/** Disposable accounts against staging only. Only fixture accounts receive test messages; no emails are sent.
 * Requires staging service credentials in environment; never logs credentials.
 */
import { createClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
const supabaseUrl = process.env.SUPABASE_URL;
const api = 'https://citrus-fantasy-staging.web.app';
assert.equal(supabaseUrl, 'https://jjgspcpvqaiitloglxbb.supabase.co', 'Staging Supabase required');
assert.ok(process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY, 'Staging keys required');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const users = [];
let leagueId;
const avatarPaths = [];
function checked(result, operation) {
  if (result.error) throw new Error(operation + ' failed: ' + (result.error.code || 'provider error'));
  return result.data;
}
async function account() {
  const email = `apple-readiness-${randomUUID()}@example.invalid`;
  const password = randomBytes(24).toString('base64url');
  const { user } = checked(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'Create test account');
  users.push(user.id);
  const client = createClient(supabaseUrl, process.env.SUPABASE_ANON_KEY, options);
  const { session } = checked(await client.auth.signInWithPassword({ email, password }), 'Sign in test account');
  return { id: user.id, token: session.access_token, client };
}
async function request(user, path, body, expected = 200, method = body ? 'POST' : 'GET') {
  const response = await fetch(api + path, { method,
    headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
  const result = await response.json();
  assert.equal(response.status, expected, `${method} ${path.split('?')[0]}: ${result.error?.code || 'unexpected status'}`);
  return result.data;
}
try {
  const buckets = checked(await admin.storage.listBuckets(), 'Read staging storage buckets');
  if (!buckets.some((bucket) => bucket.id === 'avatars')) {
    checked(await admin.storage.createBucket('avatars', { public: true }), 'Create staging avatar bucket');
  }
  const alice = await account();
  const bob = await account();
  const outsider = await account();
  const policies = await request(bob, '/api/account/consent');
  assert.ok(policies.length >= 2, 'Required policies available');
  for (const policy of policies) {
    assert.equal(policy.status, 'never_given');
    await request(bob, '/api/account/consent', { policyType: policy.policy_type, version: '2025-01-01' });
  }
  assert.ok((await request(bob, '/api/account/consent')).every((policy) => policy.status === 'outdated'));
  for (const policy of policies) {
    await request(bob, '/api/account/consent', { policyType: policy.policy_type, version: policy.required_version });
  }
  assert.ok((await request(bob, '/api/account/consent')).every((policy) => policy.status === 'current'));
  console.log('PASS: missing and outdated consent stay outstanding until the test account accepts current versions');
  checked(await admin.from('profiles').update({ is_admin: true }).eq('id', alice.id), 'Grant test moderator');
  const league = checked(await admin.from('leagues').insert({ name: 'Disposable Apple readiness check', commissioner_id: alice.id }).select('id').single(), 'Create test league');
  leagueId = league.id;
  checked(await admin.from('teams').insert([{ league_id: leagueId, owner_id: alice.id, team_name: 'Review commissioner' },
    { league_id: leagueId, owner_id: bob.id, team_name: 'Review member' }]), 'Create test teams');
  assert.equal((await request(bob, '/api/account/profile')).id, bob.id);
  await request(outsider, '/api/notifications/chat', { leagueId, message: 'Must not arrive' }, 403);
  await request(bob, '/api/notifications/chat', { leagueId, message: 'Readiness message', senderName: 'Spoofed identity' });
  const messages = await request(alice, '/api/notifications?leagueId=' + leagueId);
  const message = messages.find((entry) => entry.type === 'CHAT' && entry.metadata?.sender_id === bob.id);
  assert.ok(message, 'Chat delivered');
  assert.notEqual(message.metadata.sender_name, 'Spoofed identity');
  await request(alice, '/api/notifications/report', { notificationId: message.id, reason: 'Automated disposable test report' });
  await request(bob, '/api/admin/content-reports', undefined, 403);
  const queue = await request(alice, '/api/admin/content-reports');
  const report = queue.find((entry) => entry.reported_user_id === bob.id);
  assert.ok(report, 'Report reached moderator queue');
  await request(alice, '/api/notifications/block', { notificationId: message.id });
  assert.ok((await request(alice, '/api/notifications/blocks')).some((entry) => entry.blocked_id === bob.id));
  await request(bob, '/api/notifications/chat', { leagueId, message: 'Must be hidden by block' });
  assert.ok(!(await request(alice, '/api/notifications?leagueId=' + leagueId)).some((entry) => entry.type === 'CHAT' && entry.metadata?.sender_id === bob.id));
  await request(alice, '/api/notifications/blocks/' + bob.id, undefined, 200, 'DELETE');
  await request(alice, '/api/admin/content-reports/' + report.id, { action: 'suspend' });
  await request(bob, '/api/notifications/chat', { leagueId, message: 'Suspension must reject this' }, 400);
  assert.ok(!(await request(alice, '/api/notifications?leagueId=' + leagueId)).some((entry) => entry.id === message.id));
  console.log('PASS: membership, sender identity, report queue, admin denial, block/unblock, removal and suspension');

  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3XcAAAAASUVORK5CYII=', 'base64');
  const imagePath = bob.id + '/readiness.png';
  avatarPaths.push(imagePath);
  avatarPaths.push(bob.id + '/unauthorized.png');
  checked(await bob.client.storage.from('avatars').upload(imagePath, image, { contentType: 'image/png' }), 'Upload owned test avatar');
  const imageUrl = admin.storage.from('avatars').getPublicUrl(imagePath).data.publicUrl;
  const uploaded = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
  assert.equal(uploaded.status, 200, 'Uploaded avatar downloadable');
  assert.deepEqual(Buffer.from(await uploaded.arrayBuffer()), image);
  assert.ok((await alice.client.storage.from('avatars').upload(bob.id + '/unauthorized.png', image,
    { contentType: 'image/png' })).error, 'Cross-account avatar upload denied');
  await request(bob, '/api/account/delete', {});
  assert.equal((await admin.auth.admin.getUserById(bob.id)).error?.status, 404, 'Deleted auth identity absent');
  assert.equal(checked(await admin.from('profiles').select('id').eq('id', bob.id), 'Read deleted profile').length, 0);
  assert.equal(checked(await admin.storage.from('avatars').list(bob.id), 'Read deleted avatar folder').length, 0);
  // Supabase documents up to 60s for Smart CDN deletion invalidation.
  // Check the previously fetched URL, allowing propagation rather than bypassing its cache.
  const deletionCheckStarted = Date.now();
  let removedImage;
  do {
    removedImage = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
    if (removedImage.status !== 200) break;
    await removedImage.arrayBuffer();
    await delay(5000);
  } while (Date.now() - deletionCheckStarted < 75_000);
  const missingObject = await removedImage.json().catch(() => ({}));
  assert.ok(removedImage.status === 404 || (removedImage.status === 400 && String(missingObject.statusCode) === '404'),
    'Deleted avatar must return not-found, received HTTP ' + removedImage.status);
  console.log('PASS: cached avatar URL stops serving after ' + Math.round((Date.now() - deletionCheckStarted) / 1000) + ' seconds');
  assert.equal(checked(await admin.from('content_reports').select('id').eq('reported_user_id', bob.id), 'Read deleted reports').length, 0);
  assert.equal(checked(await admin.from('chat_suspensions').select('user_id').eq('user_id', bob.id), 'Read deleted suspension').length, 0);
  assert.ok(checked(await admin.from('leagues').select('id').eq('id', leagueId), 'Read surviving shared league').length);
  console.log('PASS: account deletion removes avatar bytes, identity, profile, reports and suspension; shared league preserved');
  checked(await admin.from('teams').insert({ league_id: leagueId, owner_id: outsider.id, team_name: 'Review successor' }), 'Create successor team');
  await request(alice, '/api/account/delete', {});
  assert.equal(checked(await admin.from('leagues').select('commissioner_id').eq('id', leagueId).single(), 'Read successor').commissioner_id, outsider.id);
  await request(outsider, '/api/account/delete', {});
  for (const id of [alice.id, outsider.id]) {
    assert.equal((await admin.auth.admin.getUserById(id)).error?.status, 404, 'Deleted owner identity absent');
  }
  assert.equal(checked(await admin.from('leagues').select('id').eq('id', leagueId), 'Read orphan cleanup').length, 0);
  console.log('PASS: commissioner deletion transfers shared ownership; last-member deletion removes orphaned league');
} finally {
  // Explicitly clean only resources created above, even after failed assertions.
  const failures = [];
  if (avatarPaths.length) {
    const result = await admin.storage.from('avatars').remove(avatarPaths);
    if (result.error) failures.push('avatar cleanup');
  }
  if (leagueId) {
    const result = await admin.from('leagues').delete().eq('id', leagueId);
    if (result.error) failures.push('league cleanup');
  }
  for (const id of users) {
    const existing = await admin.auth.admin.getUserById(id);
    if (existing.error && existing.error.status !== 404) failures.push('test identity lookup');
    if (existing.data?.user) {
      const result = await admin.auth.admin.deleteUser(id);
      if (result.error) failures.push('test identity cleanup');
    }
  }
  assert.equal(failures.length, 0, 'Disposable fixture cleanup requires attention: ' + failures.join(', '));
  console.log('PASS: disposable staging fixtures cleaned up');
}
