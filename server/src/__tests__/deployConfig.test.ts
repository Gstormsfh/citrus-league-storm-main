/**
 * DEPLOY CONFIG GUARD (2026-09-03).
 *
 * This file exists because of a defect class that every other test in this
 * repo is structurally blind to: code that is correct, deployed, and
 * unreachable because a variable was never declared anywhere a machine reads.
 *
 * THE FAILURE IT PREVENTS
 *
 * `GET /api/drafts/:id/server` tells the browser where the draft engine
 * lives, and the client builds `wss://<host>:<port>/ws/draft/<id>` from the
 * answer. `server/src/routes/drafts.ts` reads that host from
 * `DRAFT_WS_HOST`, falling back to `localhost`.
 *
 * On 2026-09-03 an audit found `DRAFT_WS_HOST` in exactly one line of
 * application code and in ZERO repo-tracked deploy files. It had been set by
 * hand in the Cloud Run console. Two things follow, and neither is visible:
 *
 *   1. If it is ever unset, discovery still returns HTTP 200, carrying
 *      `wss://localhost:3002`. Every manager's browser fails to connect,
 *      settles into a permanent reconnect loop, and the draft room reads
 *      "Waiting for draft state..." forever. The API is healthy. The engine
 *      answers. The deploy is green. CI is green. Nothing anywhere says why.
 *   2. `docs/RUNBOOKS/PRE_DRAFT_CHECKLIST.md` told the on-call engineer to
 *      run `gcloud run services replace ops/cloudrun/service.yaml` when
 *      scaling looked wrong. `replace` is declarative: it DELETES any
 *      variable the file omits. The checklist's own remediation, run an hour
 *      before a draft, would have caused failure 1.
 *
 * WHY A TEST AND NOT JUST A COMMENT
 *
 * `server/src/__tests__/drafts.test.ts:26` sets `DRAFT_WS_HOST='localhost'`
 * so its assertions pass. That is correct for a unit test and it is exactly
 * why the whole suite stayed green while production had no such variable:
 * every test that touches this route supplies the value itself. No test
 * asserted the value exists where it actually has to exist. This one reads
 * the deploy files off disk instead.
 *
 * It is a string scan on purpose. Parsing the YAML would need a dependency
 * CLAUDE.md forbids adding for one test, and the question here is not "is
 * this valid YAML" but "does the name appear in the file the deploy reads".
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const REPO = resolve(HERE, '../../..');

/**
 * Every variable the draft engine's discovery answer depends on, and every
 * file that has to declare it for a production deploy to carry it.
 *
 * `production-deploy.yml` is what a push to master runs. `service.yaml` is
 * what `gcloud run services replace` reads, and omitting a name there does
 * not merely fail to set it, it actively removes it.
 */
const REQUIRED_IN_DEPLOY = ['DRAFT_WS_HOST', 'DRAFT_WS_PORT'] as const;

const DEPLOY_FILES = [
  '.github/workflows/production-deploy.yml',
  'ops/cloudrun/service.yaml',
] as const;

function read(rel: string): string {
  const path = resolve(REPO, rel);
  if (!existsSync(path)) throw new Error(`deploy file missing: ${rel}`);
  return readFileSync(path, 'utf8');
}

/**
 * The name must appear somewhere the deploy machinery reads, not only in a
 * comment explaining that it matters. Comments are stripped before the
 * search precisely because this file's own rationale mentions both names
 * many times, and a guard satisfied by its own documentation guards nothing.
 */
function withoutComments(yaml: string): string {
  return yaml
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

describe('the deploy declares where the draft engine lives', () => {
  it.each(DEPLOY_FILES)('%s exists', (rel) => {
    expect(() => read(rel)).not.toThrow();
  });

  for (const rel of DEPLOY_FILES) {
    for (const name of REQUIRED_IN_DEPLOY) {
      it(`${rel} declares ${name} outside a comment`, () => {
        const body = withoutComments(read(rel));
        expect(
          body.includes(name),
          `${name} is not declared in ${rel}. Unset, server/src/routes/drafts.ts ` +
            `falls back to localhost and every draft room in production spins ` +
            `on "Waiting for draft state..." behind a reconnect banner, with ` +
            `every server-side signal reporting healthy.`,
        ).toBe(true);
      });
    }
  }

  // The two files drift apart silently otherwise: a push to master applies
  // production-deploy.yml, and an incident responder applies service.yaml.
  it('both files declare the same set, so a replace cannot narrow the deploy', () => {
    const declared = DEPLOY_FILES.map((rel) => {
      const body = withoutComments(read(rel));
      return REQUIRED_IN_DEPLOY.filter((n) => body.includes(n)).sort().join(',');
    });
    expect(declared[0]).toBe(declared[1]);
  });

  /**
   * THE CORRECTION THIS TEST EXISTS BECAUSE OF (2026-09-03).
   *
   * These two names first shipped in production-deploy.yml as
   * `${{ vars.DRAFT_WS_HOST }}`. No such repository variable existed, and
   * GitHub renders a missing `vars.*` as the EMPTY STRING rather than
   * failing the workflow. So the deploy that introduced the fix set
   * `DRAFT_WS_HOST=`, which is falsy, which falls through to `localhost` in
   * routes/drafts.ts. The change written to prevent the outage caused it,
   * and every check in this file still passed, because the NAME was present
   * exactly as asserted. Only the value was gone.
   *
   * So presence is not the property that matters. A usable value is. A
   * hostname and a port are not secrets; indirection bought nothing here and
   * cost the one guarantee worth having.
   */
  /**
   * PUSH CREDENTIALS REACH CLOUD RUN (2026-09-09, Play build).
   *
   * PushService is dormant per-transport: absent APNs vars mean no iOS push,
   * absent FCM vars mean no Android push, and neither errors. That posture is
   * deliberate and it is also why a missing variable is invisible — the only
   * symptom is a notification nobody receives. So the names are pinned here.
   *
   * FCM_PROJECT_ID is a literal for the DRAFT_WS_HOST reason above: a missing
   * secret renders empty, and an empty project id would put a 404 on every
   * send instead of leaving the transport cleanly dormant.
   */
  it('ships both push transports to Cloud Run, with the FCM project id as a literal', () => {
    const env = withoutComments(read('.github/workflows/production-deploy.yml'));
    const assigned = (name: string) =>
      env.split('\n').find((l) => l.trim().startsWith(`${name}=`));

    for (const name of ['APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_PRIVATE_KEY']) {
      expect(assigned(name), `${name} is not in the env_vars block`).toBeTruthy();
    }
    expect(
      assigned('FCM_PROJECT_ID'),
      'FCM_PROJECT_ID is not in the env_vars block; Android push stays dormant',
    ).toBeTruthy();
    // No key secrets by design: the org forbids creating one, so the runtime
    // service account's own identity is used. If these ever appear here it
    // means someone reintroduced a downloadable credential.
    expect(assigned('FCM_CLIENT_EMAIL'), 'a service-account key crept back into the deploy').toBeFalsy();
    expect(assigned('FCM_PRIVATE_KEY'), 'a service-account key crept back into the deploy').toBeFalsy();

    const projectId = (assigned('FCM_PROJECT_ID') as string).split('=').slice(1).join('=').trim();
    expect(projectId.includes('${{'), 'FCM_PROJECT_ID must be a literal, not an expression').toBe(false);
    expect(projectId).toBe('citrus-fantasy-prod');
  });

  it.each(REQUIRED_IN_DEPLOY)('%s has a literal value, not an interpolation that can render empty', (name) => {
    const wf = read('.github/workflows/production-deploy.yml');
    const line = withoutComments(wf)
      .split('\n')
      .find((l) => l.trim().startsWith(`${name}=`));

    expect(line, `${name} is not assigned in the env_vars block`).toBeTruthy();
    const value = (line as string).split('=').slice(1).join('=').trim();

    expect(value.length, `${name} is assigned an empty value`).toBeGreaterThan(0);
    expect(
      value.includes('${{'),
      `${name} is set from an expression (${value}). A missing vars.* or secret ` +
        `renders as the empty string and the workflow still succeeds, so the ` +
        `deploy silently sets no host and every draft room falls back to localhost. ` +
        `Use a literal: this is a hostname, not a secret.`,
    ).toBe(false);
  });

  it('the deploy and service.yaml name the same engine host', () => {
    // Two files, two paths into production (a push, and a `replace` during an
    // incident). If they disagree, which engine your browsers reach depends on
    // which one ran last, and nothing announces the difference.
    const wf = withoutComments(read('.github/workflows/production-deploy.yml'));
    const yaml = read('ops/cloudrun/service.yaml');
    const fromWf = (wf.split('\n').find((l) => l.trim().startsWith('DRAFT_WS_HOST=')) ?? '')
      .split('=').slice(1).join('=').trim();
    const fromYaml = (yaml.match(/name:\s*DRAFT_WS_HOST\s*\n\s*value:\s*"?([^"\n]+)"?/) ?? [])[1]?.trim();
    expect(fromWf).toBe(fromYaml);
  });

  it('the checklist warns that replace is destructive', () => {
    // The runbook told someone to run a declarative replace against a file
    // that omitted these names. If that instruction ever loses its warning,
    // the landmine is back.
    const checklist = read('docs/RUNBOOKS/PRE_DRAFT_CHECKLIST.md');
    expect(checklist).toMatch(/services replace/);
    expect(checklist.toLowerCase()).toMatch(/declarative/);
    expect(checklist).toMatch(/DRAFT_WS_HOST/);
  });
});

/**
 * SECRETS THE SERVICE CANNOT RUN WITHOUT (2026-09-16).
 *
 * The API was moved to a new Cloud Run service (Montreal, PR #512). The old
 * service carried `SUPABASE_JWT_SECRET` and `SCHEDULED_TRIGGER_SECRET` as
 * hand-set console variables, declared in no repo-tracked file, so the new
 * service was created without them. `issueDraftToken` threw on every
 * discovery call and every draft room in production sat on "Reconnecting..."
 * for two days, found by the founder mid mock draft. The scheduled-jobs
 * router was refusing everything behind the second one; it only kept
 * working because the cron jobs still pointed at the old service.
 *
 * Same defect class as DRAFT_WS_HOST above, same guard: the names must be
 * declared in both files the deploy machinery reads, outside comments. Two
 * extra properties matter for secrets specifically:
 *
 *   - They must come from Secret Manager (`secrets:` block / secretKeyRef),
 *     never from `env_vars` via `${{ secrets.X }}`, because an unset GitHub
 *     secret renders as the empty string and the deploy still goes green.
 *   - The Secret Manager NAME must be the one the engine VM reads
 *     (`infra/gce/draft-engine-startup.sh`, default `supabase-jwt-secret`),
 *     because a token the API signs has to verify on the engine. Two copies
 *     of the same value under two names is the drift this file exists to
 *     prevent.
 */
const REQUIRED_SECRETS = {
  SUPABASE_JWT_SECRET: 'supabase-jwt-secret',
  SCHEDULED_TRIGGER_SECRET: 'scheduled-trigger-secret',
} as const;

const STAGING_DEPLOY_FILES = [
  '.github/workflows/staging-deploy.yml',
  'ops/cloudrun/service-staging.yaml',
] as const;

describe('the deploy mounts the secrets the API cannot run without', () => {
  for (const rel of [...DEPLOY_FILES, ...STAGING_DEPLOY_FILES]) {
    for (const name of Object.keys(REQUIRED_SECRETS)) {
      it(`${rel} declares ${name} outside a comment`, () => {
        const body = withoutComments(read(rel));
        expect(
          body.includes(name),
          `${name} is not declared in ${rel}. A service deployed from this file ` +
            `will answer /api/health with 503 and never take traffic; a service ` +
            `that already had the secret loses it on \`services replace\`.`,
        ).toBe(true);
      });
    }
  }

  it.each(['.github/workflows/production-deploy.yml', '.github/workflows/staging-deploy.yml'])(
    '%s mounts each secret from Secret Manager, not through env_vars',
    (rel) => {
      const wf = withoutComments(read(rel));
      const envBlock = wf.split('env_vars: |')[1]?.split(/\n\s{10}[a-z#-]/)[0] ?? '';
      for (const [name, smName] of Object.entries(REQUIRED_SECRETS)) {
        const mounted = wf.split('\n').some((l) => l.trim() === `${name}=${smName}:latest`);
        expect(mounted, `${name} must appear as "${name}=${smName}:latest" under secrets: |`).toBe(true);
        expect(
          envBlock.includes(`${name}=`),
          `${name} must not be passed through env_vars; an unset GitHub secret renders empty and the deploy stays green`,
        ).toBe(false);
      }
    },
  );

  it.each(['ops/cloudrun/service.yaml', 'ops/cloudrun/service-staging.yaml'])('%s mounts each secret from the same Secret Manager name', (rel) => {
    const yaml = withoutComments(read(rel));
    for (const [name, smName] of Object.entries(REQUIRED_SECRETS)) {
      const idx = yaml.indexOf(`- name: ${name}`);
      expect(idx, `${name} missing from service.yaml`).toBeGreaterThan(-1);
      const stanza = yaml.slice(idx, idx + 220);
      expect(stanza, `${name} must be a secretKeyRef, not a literal value`).toContain('secretKeyRef');
      expect(stanza, `${name} must reference Secret Manager secret ${smName}`).toContain(`name: ${smName}`);
    }
  });

  it('the staging deploy points discovery at the staging engine, not localhost', () => {
    for (const rel of STAGING_DEPLOY_FILES) {
      const body = withoutComments(read(rel));
      expect(body, `${rel} must declare DRAFT_WS_HOST`).toContain('DRAFT_WS_HOST');
      expect(body, `${rel} must point at the staging engine`).toContain('draft-staging.citrusfantasysports.com');
    }
  });

  it('the API signs draft tokens with the same secret the engine VM verifies them with', () => {
    const startup = read('infra/gce/draft-engine-startup.sh');
    expect(startup).toContain(`SECRET_JWT_NAME="\${SECRET_JWT_NAME:-${REQUIRED_SECRETS.SUPABASE_JWT_SECRET}}"`);
  });

  it('the post-deploy health step fails the job when either secret is unusable', () => {
    const wf = read('.github/workflows/production-deploy.yml');
    const step = wf.split('API health check')[1] ?? '';
    expect(step).toContain('.checks.draftToken');
    expect(step).toContain('.checks.scheduledTrigger');
    expect(step, 'a non-200 health response must fail the job, not warn').toContain('exit 1');
    expect(step).not.toContain('::warning::API health check returned');
  });

  it('the deploy points the startup probe at /api/health so an unhealthy revision never takes traffic', () => {
    const wf = withoutComments(read('.github/workflows/production-deploy.yml'));
    expect(wf).toContain('--startup-probe=httpGet.path=/api/health');
    const yaml = withoutComments(read('ops/cloudrun/service.yaml'));
    expect(yaml).toContain('path: /api/health');
  });
});

// ---------------------------------------------------------------------------
// The workflow files must stay parseable (2026-09-16, PR #519).
//
// The string scans above passed while `.github/workflows/production-deploy.yml`
// was invalid YAML: a step was named
//   `API health check (fatal: secrets must be usable on the serving revision)`
// and an unquoted plain scalar cannot contain ": ". GitHub refused the
// whole file, both runs failed in zero seconds with no job and no log
// (`gh run view --log-failed` says "log not found"), and the fix that
// mounts the draft-token secret as code never deployed. This file cannot
// parse YAML without a dependency, so it checks for the one construct that
// breaks a plain scalar. Verified against every workflow in the repo: it
// flags nothing else.
// ---------------------------------------------------------------------------
const WORKFLOWS_DIR = resolve(REPO, '.github/workflows');

/** Lines whose value is an unquoted plain scalar containing ": " (fatal in YAML). */
export function unquotedColonSpaceLines(yaml: string): Array<{ line: number; text: string }> {
  const rule = /^\s*(?:- )?[A-Za-z0-9_.-]+:\s+(?!["'|>])(.*: .*)$/;
  const out: Array<{ line: number; text: string }> = [];
  yaml.split('\n').forEach((raw, i) => {
    if (raw.trimStart().startsWith('#')) return;
    const m = rule.exec(raw);
    if (!m) return;
    const value = m[1].split(/\s#/)[0]; // ": " inside a trailing comment is fine
    if (value.includes(': ')) out.push({ line: i + 1, text: raw.trim() });
  });
  return out;
}

describe('every workflow file is YAML GitHub will accept', () => {
  const files = readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

  it('finds the workflow files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} has no unquoted value containing ": "`, () => {
      const bad = unquotedColonSpaceLines(readFileSync(resolve(WORKFLOWS_DIR, file), 'utf8'));
      expect(
        bad,
        `quote the value (single quotes are enough): ${bad.map((b) => `line ${b.line}: ${b.text}`).join('; ')}`,
      ).toEqual([]);
    });
  }

  it('the rule catches the exact line that broke PR #519', () => {
    const broken = '      - name: API health check (fatal: secrets must be usable on the serving revision)';
    expect(unquotedColonSpaceLines(broken)).toHaveLength(1);
    expect(unquotedColonSpaceLines(`      - name: 'API health check (fatal: secrets)'`)).toEqual([]);
    expect(unquotedColonSpaceLines('      - name: "API health check (fatal: secrets)"')).toEqual([]);
    expect(unquotedColonSpaceLines('        run: |\n          echo "a: b"')).toEqual([]);
    expect(unquotedColonSpaceLines('        url: https://example.com/x')).toEqual([]);
    expect(unquotedColonSpaceLines('        # a comment with: colon')).toEqual([]);
    expect(unquotedColonSpaceLines('        key: value # trailing: comment')).toEqual([]);
  });
});

describe('the guard bites', () => {
  // A scan that cannot fail is a scan that proves nothing. These pin the
  // detector itself rather than the repo's current state.
  it('a file that only mentions the name in a comment does not count', () => {
    const yaml = ['# DRAFT_WS_HOST is important', 'env:', '  - name: NODE_ENV'].join('\n');
    expect(withoutComments(yaml).includes('DRAFT_WS_HOST')).toBe(false);
  });

  it('a file that actually declares it does count', () => {
    const yaml = ['# sets the engine host', 'env:', '  - name: DRAFT_WS_HOST'].join('\n');
    expect(withoutComments(yaml).includes('DRAFT_WS_HOST')).toBe(true);
  });

  it('an indented comment is still a comment', () => {
    expect(withoutComments('    # DRAFT_WS_PORT=443').includes('DRAFT_WS_PORT')).toBe(false);
  });
});

describe('the fallback that makes this dangerous is still the fallback', () => {
  // If someone makes drafts.ts throw on a missing host instead of defaulting
  // to localhost, the silent-failure mode is gone and this guard matters
  // less. Until then it matters exactly this much, and this test documents
  // the coupling so the two are read together.
  it('drafts.ts still defaults DRAFT_WS_HOST to localhost', () => {
    const route = readFileSync(resolve(REPO, 'server/src/routes/drafts.ts'), 'utf8');
    expect(route).toMatch(/DRAFT_WS_HOST\s*\|\|\s*'localhost'/);
  });
});

/**
 * THE OTHER HALF OF THE SAME FAILURE.
 *
 * Setting `DRAFT_WS_HOST` correctly is necessary and not sufficient. The
 * browser also has to be ALLOWED to open that socket, and that permission
 * lives somewhere else entirely: the `connect-src` directive of the CSP
 * header in `firebase.json`.
 *
 * This has already cost a live draft. From the 2026 incident log: a draft
 * room sat on "waiting for draft state" with the console reading
 * `Connecting to 'wss://draft-staging...' violates connect-src`, because
 * there are TWO firebase.json files and only the root one had been updated.
 * The note on that entry is exact: "The browser has NEVER once connected to
 * the engine, every acceptance run was Node rigs (no CSP)."
 *
 * A Node test rig does not enforce CSP. Neither does any other test in this
 * repo. So the two files are compared to each other here, and every host the
 * deploy can hand a browser is checked against the list the browser will
 * accept. That is the only place these three facts meet.
 */
describe('the browser is allowed to open the socket the deploy points it at', () => {
  const CSP_FILES = ['firebase.json', 'apps/web/firebase.json'] as const;

  function connectSrc(rel: string): string {
    const csp = read(rel);
    const m = csp.match(/connect-src ([^;"]+)/);
    if (!m) throw new Error(`no connect-src directive in ${rel}`);
    return m[1];
  }

  function draftHosts(rel: string): string[] {
    const hosts = connectSrc(rel).match(/wss:\/\/[A-Za-z0-9.-]*citrusfantasysports\.com/g) ?? [];
    return [...new Set(hosts)].sort();
  }

  it.each(CSP_FILES)('%s has a connect-src directive', (rel) => {
    expect(() => connectSrc(rel)).not.toThrow();
  });

  // The root file is what production hosting deploys (no entryPoint in
  // production-deploy.yml, so it runs from the repo root). apps/web is what
  // the staging deploy ships. They drifted once and it cost a draft night.
  it('both firebase.json files allow the same draft engine hosts', () => {
    const [rootHosts, webHosts] = CSP_FILES.map(draftHosts);
    expect(webHosts, 'apps/web/firebase.json connect-src has drifted from the root one').toEqual(rootHosts);
  });

  it('allows both the production and the staging engine', () => {
    for (const rel of CSP_FILES) {
      const hosts = draftHosts(rel);
      expect(hosts, `${rel} must allow the production engine`).toContain('wss://draft.citrusfantasysports.com');
      expect(hosts, `${rel} must allow the staging engine`).toContain('wss://draft-staging.citrusfantasysports.com');
    }
  });

  // UNIVERSAL LINKS (2026-09-09). The AASA work landed in apps/web/firebase.json
  // (stop ignoring dotfiles, appAssociation NONE, a rewrite and a JSON header)
  // and production kept serving Firebase's auto-generated empty stub,
  // {"applinks":{"apps":[],"details":[]}}, because the root file is what
  // deploys and it had none of it. Invite links opened Safari instead of the
  // app. Every one of these is required in BOTH files, so the deploy that
  // actually runs serves the file the repo carries.
  // PRERENDER ROUTES (2026-09-09, deploy #542). dist/about/index.html was
  // built and uploaded, and the post-deploy check still failed: with
  // trailingSlash unset Hosting answers /about with a 301 to /about/, so a
  // bare curl saw an empty redirect body. Both files pin it off so the
  // canonical, sitemap'd /about serves the prerendered page directly.
  describe('both firebase.json files serve prerendered /route paths without a trailing slash', () => {
    it.each(CSP_FILES)('%s', (rel) => {
      const hosting = JSON.parse(read(rel)).hosting as { trailingSlash?: boolean };
      expect(hosting.trailingSlash, `${rel}: trailingSlash must be false or /about 301s to /about/`).toBe(false);
    });
  });

  describe('both firebase.json files serve the repo AASA, not the auto-generated stub', () => {
    it.each(CSP_FILES)('%s', (rel) => {
      const hosting = JSON.parse(read(rel)).hosting as {
        appAssociation?: string;
        ignore?: string[];
        rewrites?: Array<{ source?: string; destination?: string }>;
        headers?: Array<{ source?: string; headers?: Array<{ key: string; value: string }> }>;
      };
      expect(hosting.appAssociation, `${rel}: Firebase generates an empty AASA unless appAssociation is NONE`).toBe('NONE');
      expect(hosting.ignore ?? [], `${rel}: ignoring **/.* drops .well-known from the upload`).not.toContain('**/.*');
      const rewrite = (hosting.rewrites ?? []).find((r) => r.source === '/.well-known/apple-app-site-association');
      expect(rewrite?.destination, `${rel}: the AASA rewrite must sit ahead of the SPA catch-all`).toBe('/.well-known/apple-app-site-association');
      const header = (hosting.headers ?? []).find((h) => h.source === '/.well-known/apple-app-site-association');
      expect(header?.headers?.find((h) => h.key === 'Content-Type')?.value, `${rel}: AASA must be served as JSON`).toBe('application/json');
      // ANDROID APP LINKS (2026-09-09): the same treatment for assetlinks.json,
      // or Play's install-time verification reads the SPA shell and every
      // invite link opens the browser on Android.
      const alRewrite = (hosting.rewrites ?? []).find((r) => r.source === '/.well-known/assetlinks.json');
      expect(alRewrite?.destination, `${rel}: assetlinks.json rewrite must sit ahead of the SPA catch-all`).toBe('/.well-known/assetlinks.json');
      const alHeader = (hosting.headers ?? []).find((h) => h.source === '/.well-known/assetlinks.json');
      expect(alHeader?.headers?.find((h) => h.key === 'Content-Type')?.value, `${rel}: assetlinks.json must be served as JSON`).toBe('application/json');
    });
  });

  describe('assetlinks.json names the Play package and a real fingerprint slot', () => {
    it('is valid JSON for com.citrussports.app with handle_all_urls', () => {
      const raw = read('apps/web/public/.well-known/assetlinks.json');
      const links = JSON.parse(raw) as Array<{ relation: string[]; target: { package_name: string; sha256_cert_fingerprints: string[] } }>;
      expect(links[0].relation).toContain('delegate_permission/common.handle_all_urls');
      expect(links[0].target.package_name).toBe('com.citrussports.app');
      expect(links[0].target.sha256_cert_fingerprints.length).toBeGreaterThan(0);
    });
  });

  /**
   * The load-bearing one. Whatever hostname `ops/cloudrun/service.yaml`
   * hands to a browser must appear in the CSP, or discovery returns a
   * perfectly good answer that the browser then refuses to dial, and the
   * symptom is indistinguishable from the variable being unset.
   */
  it('the host service.yaml declares is one the CSP permits', () => {
    const yaml = read('ops/cloudrun/service.yaml');
    const m = yaml.match(/name:\s*DRAFT_WS_HOST\s*\n\s*value:\s*"?([^"\n]+)"?/);
    expect(m, 'DRAFT_WS_HOST has no literal value in service.yaml').toBeTruthy();
    const host = (m as RegExpMatchArray)[1].trim();

    for (const rel of CSP_FILES) {
      expect(
        draftHosts(rel),
        `service.yaml points browsers at ${host}, which ${rel} does not allow in connect-src. ` +
          `The room will sit on "waiting for draft state" with a CSP violation in the console.`,
      ).toContain(`wss://${host}`);
    }
  });
});

/**
 * THE /go/ LINK GUARD (2026-09-10).
 *
 * Every tracked outreach link Citrus has sent this launch — 25 email threads
 * by the time this was found, plus the live Meta/Instagram ad — points at
 * `citrusfantasysports.com/go/<handle>`. The handle is the attribution: it is
 * how a reply from a creator is told apart from a cold click.
 *
 * Nothing served that path. `rewrites` sends `**` to `/index.html`, the SPA
 * matches no route for `/go/anything`, and it renders its own 404. So the
 * request returned HTTP 200, the page painted, and every recipient — a signed
 * five-figure podcast partner included — was told the page had been called for
 * a penalty. Hosting logs show a healthy site. The ad account shows delivery.
 * Nothing anywhere says why nobody arrived.
 *
 * A redirect rather than a client route on purpose: the emails are already
 * delivered and cannot be edited, so the fix has to sit in front of the bundle,
 * where it also rescues links sent before it existed.
 *
 * The destination keeps the handle as `?ref=`. Dropping people on a bare
 * homepage would fix the 404 and throw away the only reason the links are
 * per-creator in the first place.
 */
describe('the tracked outreach links resolve', () => {
  const HOSTING_FILES = ['firebase.json', 'apps/web/firebase.json'] as const;

  type Redirect = { source: string; destination: string; type?: number };

  function redirects(rel: string): Redirect[] {
    const cfg = JSON.parse(read(rel)) as { hosting?: { redirects?: Redirect[] } };
    return cfg.hosting?.redirects ?? [];
  }

  it.each(HOSTING_FILES)('%s redirects /go/:handle instead of letting the SPA 404 it', (rel) => {
    expect(
      redirects(rel).find((r) => r.source === '/go/:handle'),
      `${rel} has no /go/:handle redirect. Every link in every pitch email — and any ad ` +
        `pointed at /go/ — lands on the app's own 404 while returning HTTP 200, so neither ` +
        `hosting logs nor the ad account will ever report a problem.`,
    ).toBeTruthy();
  });

  it.each(HOSTING_FILES)('%s carries the handle through to the landing page', (rel) => {
    expect(
      redirects(rel).find((r) => r.source === '/go/:handle')?.destination,
      `${rel} drops the handle. The point of a per-creator link is knowing which creator ` +
        `sent the person, and a redirect to bare "/" throws that away silently.`,
    ).toContain(':handle');
  });

  // Same reason as the connect-src pair above: root ships production, apps/web
  // ships staging, and a fix applied to one of them stops existing the moment
  // someone verifies against the other.
  it('both hosting files carry the same redirects', () => {
    const [root, web] = HOSTING_FILES.map(redirects);
    expect(web, 'apps/web/firebase.json redirects have drifted from the root ones').toEqual(root);
  });
});
