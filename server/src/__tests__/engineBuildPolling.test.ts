import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync(resolve(import.meta.dirname, '../../../.github/workflows/deploy-engine.yml'), 'utf8');
const block = workflow.split('      - name: Cloud Build\n')[1].split('        run: |\n')[1].split('\n      # Trap 1')[0]
  .split('\n').map(line => line.replace(/^          /, '')).join('\n');

function run(status: string, submitId = '12345678-1234-1234-1234-123456789abc', denied = false) {
  return spawnSync('bash', ['-s'], {
    encoding: 'utf8',
    env: { ...process.env, STATUS_REPLY: status, SUBMIT_ID: submitId, DENIED: String(denied) },
    input: `
IMAGE=example/image:test
GCP_PROJECT=test-project
gcloud() {
  case "$*" in
    'builds submit '*)
      case "$*" in *--async*) ;; *) return 9 ;; esac
      printf '%s' "$SUBMIT_ID" ;;
    'builds describe '*)
      [ "$DENIED" != true ] || return 1
      printf '%s' "$STATUS_REPLY" ;;
    *) return 9 ;;
  esac
}
sleep() { STATUS_REPLY=SUCCESS; }
${block}
printf 'BUILD_GATE_PASSED'
`,
  });
}

describe('engine Cloud Build status gate', () => {
  it.each(['SUCCESS', 'WORKING', 'QUEUED', 'PENDING'])('allows %s only after verified success', status => {
    const result = run(status);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('BUILD_GATE_PASSED');
  });
  it.each(['FAILURE', 'CANCELLED', 'TIMEOUT', 'INTERNAL_ERROR', ''])('blocks unsuccessful or unknown status %j', status => {
    const result = run(status);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('BUILD_GATE_PASSED');
  });
  it('fails closed when build status cannot be read', () => {
    expect(run('SUCCESS', undefined, true).status).not.toBe(0);
  });
  it('rejects a missing build ID before polling', () => {
    expect(run('SUCCESS', '').status).not.toBe(0);
  });
});
