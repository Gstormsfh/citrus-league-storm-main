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
import { readFileSync, existsSync } from 'node:fs';
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
