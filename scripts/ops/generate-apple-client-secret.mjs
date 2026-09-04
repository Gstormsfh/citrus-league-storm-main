#!/usr/bin/env node
// CITRUS-CLASSIFICATION ────────────────────────────────────────────────────
// CATEGORY: ACTIVE
// Purpose:     Mint the Apple "client secret" JWT that Supabase's Apple
//              auth provider requires.
// Invoked:     by hand, whenever the secret is created or has expired.
// Reads:       an Apple Sign in with Apple key (.p8) named on the command line
// Writes:      one JWT to stdout. Nothing else, nowhere else.
// ──────────────────────────────────────────────────────────────────────────
/**
 * WHY THIS EXISTS, AND THE TRAP IT IS HERE TO CATCH.
 *
 * Apple does not issue a client secret for Sign in with Apple. You mint one
 * yourself: an ES256 JWT signed with the .p8 key, and **Apple caps its
 * lifetime at six months**. So the day this is first pasted into Supabase, a
 * silent expiry is scheduled for six months later. Nothing warns you. Apple
 * starts refusing the token exchange, and Sign in with Apple simply stops
 * working for everyone at once, with no deploy and no code change to blame.
 *
 * That is the whole reason this is a committed script rather than a snippet
 * pasted once into a terminal at midnight: when it fails in six months, the
 * fix has to be findable. Run this again with the same .p8 and paste the new
 * value into Supabase -- Auth -> Providers -> Apple -> Secret Key (for OAuth).
 * Nothing else changes; the key, the Services ID and the Team ID all stay.
 *
 * No dependencies, on purpose. Node's built-in crypto signs ES256 against a
 * PKCS#8 EC key, which is exactly what a .p8 is. `dsaEncoding: 'ieee-p1363'`
 * is the load-bearing option: it emits the raw r||s pair JWS requires. The
 * default DER encoding produces a token Apple rejects with a signature error
 * that says nothing about encoding.
 *
 * USAGE
 *   node scripts/ops/generate-apple-client-secret.mjs ~/Downloads/AuthKey_XXXXXXXXXX.p8 XXXXXXXXXX
 *                                                     ^ the key file          ^ the Key ID
 *
 * The Key ID is the ten characters in the filename, and is shown on the key's
 * page in the Apple developer portal.
 *
 * The .p8 itself is a credential. It is downloadable exactly once, it is not
 * in this repo, and it must not be committed or pasted into chat. Keep it in
 * the password manager next to the App Store Connect credentials.
 */

import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Both are public identifiers, not secrets.
const TEAM_ID = 'TFMG57326Z';                 // Apple Developer -> Membership
const SERVICE_ID = 'com.citrussports.web';    // the Services ID, NOT the bundle id

const [, , keyFile, keyId] = process.argv;

if (!keyFile || !keyId) {
  console.error('usage: node scripts/ops/generate-apple-client-secret.mjs <path-to.p8> <key-id>');
  process.exit(2);
}
if (!/^[A-Z0-9]{10}$/.test(keyId)) {
  console.error(`error: "${keyId}" does not look like an Apple Key ID (ten characters, A-Z and 0-9).`);
  console.error('       It is the XXXXXXXXXX in AuthKey_XXXXXXXXXX.p8.');
  process.exit(2);
}

let pem;
try {
  pem = readFileSync(keyFile);
} catch (e) {
  console.error(`error: cannot read ${keyFile} -- ${e.message}`);
  process.exit(2);
}
if (!pem.toString().includes('BEGIN PRIVATE KEY')) {
  console.error('error: that file is not a PKCS#8 private key. Apple .p8 files start with');
  console.error('       "-----BEGIN PRIVATE KEY-----".');
  process.exit(2);
}

const SIX_MONTHS_SECONDS = 15_777_000;        // Apple's maximum. Do not raise it.
const now = Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

const signingInput = `${b64({ alg: 'ES256', kid: keyId })}.${b64({
  iss: TEAM_ID,
  iat: now,
  exp: now + SIX_MONTHS_SECONDS,
  aud: 'https://appleid.apple.com',
  sub: SERVICE_ID,
})}`;

let signature;
try {
  signature = sign('sha256', Buffer.from(signingInput), {
    key: createPrivateKey(pem),
    dsaEncoding: 'ieee-p1363',
  });
} catch (e) {
  console.error(`error: could not sign with that key -- ${e.message}`);
  process.exit(1);
}

const expires = new Date((now + SIX_MONTHS_SECONDS) * 1000).toISOString().slice(0, 10);
console.error(`Apple client secret for ${SERVICE_ID}, team ${TEAM_ID}, key ${keyId}.`);
console.error(`EXPIRES ${expires} -- Sign in with Apple stops working that day unless this is`);
console.error('regenerated and re-pasted into Supabase. Put it in the calendar now.\n');
console.log(`${signingInput}.${signature.toString('base64url')}`);
