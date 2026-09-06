import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';

const script = readFileSync(resolve(import.meta.dirname, '../../../infra/gce/draft-engine-startup.sh'), 'utf8');
const block = script.split('# BEGIN APNS CONFIG\n')[1].split('# END APNS CONFIG')[0];
const pem = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trimEnd();

function run(overrides: Record<string, string> = {}) {
  return spawnSync('bash', ['-s'], {
    encoding: 'utf8',
    env: { ...process.env, TEST_ENABLED: 'true', TEST_PRODUCTION: 'false', TEST_KEY: pem, TEST_DENIED: '', ...overrides },
    input: `set -euo pipefail
PROJECT_ID=citrus-fantasy-staging
metadata_get() {
  case "$1" in
    apns-enabled) printf '%s' "$TEST_ENABLED" ;;
    apns-production) printf '%s' "$TEST_PRODUCTION" ;;
  esac
}
gcloud() {
  [ "$TEST_DENIED" != yes ] || return 1
  case "$*" in
    *--secret=APNS_KEY_ID*) printf ABCDE12345 ;;
    *--secret=APNS_TEAM_ID*) printf TFMG57326Z ;;
    *--secret=APNS_PRIVATE_KEY*) printf '%s' "$TEST_KEY" ;;
    *) return 1 ;;
  esac
}
${block}
if [ "$APNS_ENABLED" = true ]; then
  [ "$APNS_PRIVATE_KEY" = "$TEST_KEY" ] || exit 2
  bash -c '[ -n "$APNS_PRIVATE_KEY" ]' || exit 3
fi
printf 'configured=%s production=%s topic=%s' "$APNS_ENABLED" "$APNS_PRODUCTION" "$APNS_BUNDLE_ID"
`,
  });
}

describe('draft engine APNs startup configuration', () => {
  it('loads and exports an intact multiline key without logging it', () => {
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('configured=true production=false topic=com.citrussports.app');
    expect(result.stdout + result.stderr).not.toContain('PRIVATE KEY');
  });
  it('supports explicitly selected production delivery', () => {
    expect(run({ TEST_PRODUCTION: 'true' }).stdout).toContain('production=true');
  });
  it('leaves unconfigured VMs dormant without accessing secrets', () => {
    const result = run({ TEST_ENABLED: '', TEST_DENIED: 'yes' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('configured=false');
  });
  it.each(['', 'production', 'TRUE'])('rejects an ambiguous APNs environment %j', (value) => {
    expect(run({ TEST_PRODUCTION: value }).status).not.toBe(0);
  });
  it('fails before replacement when Secret Manager denies access', () => {
    const result = run({ TEST_DENIED: 'yes' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('cannot load APNS_KEY_ID');
  });
  it.each(['', 'invalid-private-key'])('rejects missing or malformed private material', (value) => {
    expect(run({ TEST_KEY: value }).status).not.toBe(0);
  });
  it('includes APNs changes in the container replacement fingerprint', () => {
    const fingerprint = script.split('\n').find(line => line.startsWith('SECRETS_SHA='))!;
    for (const name of ['APNS_ENABLED', 'APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_PRIVATE_KEY', 'APNS_BUNDLE_ID', 'APNS_PRODUCTION']) {
      expect(fingerprint).toContain('${' + name + '}');
    }
    expect(script.indexOf('# END APNS CONFIG')).toBeLessThan(script.indexOf('\ndocker rm -f'));
    expect(script).toContain('-e APNS_KEY_ID -e APNS_TEAM_ID -e APNS_PRIVATE_KEY');
  });
});
