#!/usr/bin/env tsx
/**
 * Bulk-provision test accounts for k6 load-test scenarios.
 *
 * Creates N real Supabase users via the Admin API, optionally adds them
 * to a specified league, and writes a JSON file suitable for
 * `export TEST_ACCOUNTS=$(cat accounts.json)`.
 *
 * DO NOT run against production Supabase. Use a staging project.
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_KEY=eyJ... \
 *     npx tsx scripts/load-test/provision-test-accounts.ts \
 *       --count 200 \
 *       --league <LEAGUE_UUID> \
 *       --prefix loadtest \
 *       --output accounts.json
 *
 * Flags:
 *   --count N         Number of accounts to create (required)
 *   --league UUID     League to add every account to (optional)
 *   --prefix STR      Email prefix; emails are prefix+N@loadtest.citrus (default: loadtest)
 *   --output FILE     Output JSON path (default: accounts.json)
 *
 * The output file is a JSON array shaped like:
 *   [{ email, password, userId }, ...]
 *
 * Cleanup:
 *   To delete these accounts later, feed the same file back in:
 *     npx tsx scripts/load-test/provision-test-accounts.ts --cleanup accounts.json
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

type Account = { email: string; password: string; userId: string };

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    count: get('--count') ? parseInt(get('--count')!, 10) : 0,
    league: get('--league'),
    prefix: get('--prefix') ?? 'loadtest',
    output: get('--output') ?? 'accounts.json',
    cleanup: get('--cleanup'),
  };
}

async function main() {
  const { count, league, prefix, output, cleanup } = parseArgs();

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env var.');
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (cleanup) {
    await cleanupAccounts(admin, cleanup);
    return;
  }

  if (!count || count < 1) {
    console.error('Pass --count N (≥ 1).');
    process.exit(1);
  }
  if (count > 500) {
    console.error(`Refusing to create > 500 accounts. Got ${count}.`);
    process.exit(1);
  }

  console.log(`Provisioning ${count} test accounts…`);
  if (league) console.log(`  League: ${league}`);
  console.log(`  Email prefix: ${prefix}@loadtest.citrus`);
  console.log(`  Output: ${output}\n`);

  const accounts: Account[] = [];
  for (let i = 0; i < count; i++) {
    const email = `${prefix}+${i + 1}-${randomBytes(3).toString('hex')}@loadtest.citrus`;
    // Strong per-account password. Stored only in the output file — treat
    // that file as a secret (gitignore'd).
    const password = randomBytes(16).toString('base64url');

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // skip the confirmation email flow
      user_metadata: { loadtest: true, provisioned_at: new Date().toISOString() },
    });

    if (error || !data.user) {
      console.error(`  [${i + 1}/${count}] failed: ${error?.message}`);
      continue;
    }

    accounts.push({ email, password, userId: data.user.id });

    // Optional: add this user to the specified league so authenticated
    // scenarios (draft-simulation, notification-storm) actually find
    // league data.
    if (league) {
      const { error: memberErr } = await admin
        .from('league_memberships')
        .insert({
          league_id: league,
          user_id: data.user.id,
          role: 'member',
          joined_at: new Date().toISOString(),
        });
      if (memberErr) {
        console.warn(
          `  [${i + 1}/${count}] created user ${email} but failed league join: ${memberErr.message}`,
        );
      }
    }

    if ((i + 1) % 25 === 0 || i + 1 === count) {
      console.log(`  [${i + 1}/${count}] provisioned`);
    }
  }

  writeFileSync(output, JSON.stringify(accounts, null, 2));
  console.log(`\n✓ Wrote ${accounts.length} accounts to ${output}`);
  console.log(`\nNext: export TEST_ACCOUNTS="$(cat ${output})"`);
  console.log(
    `\nReminder: ${output} contains plaintext passwords — gitignore it.`,
  );
}

async function cleanupAccounts(admin: ReturnType<typeof createClient>, file: string) {
  const raw = readFileSync(file, 'utf8');
  const accounts: Account[] = JSON.parse(raw);
  console.log(`Cleaning up ${accounts.length} accounts from ${file}…`);

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < accounts.length; i++) {
    const { error } = await admin.auth.admin.deleteUser(accounts[i].userId);
    if (error) {
      console.error(`  [${i + 1}] ${accounts[i].email}: ${error.message}`);
      fail++;
    } else {
      ok++;
    }
    if ((i + 1) % 25 === 0 || i + 1 === accounts.length) {
      console.log(`  [${i + 1}/${accounts.length}] deleted`);
    }
  }

  console.log(`\n✓ Deleted ${ok} accounts (${fail} failed)`);
  if (fail === 0) {
    console.log(`\nYou can safely delete ${file} now.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
