// UUIDv5 (RFC 4122 §4.3) — name-based, SHA-1 hashed.
//
// Deno-native, zero external dependencies. We avoid both
// `npm:uuid` and `https://deno.land/std/uuid` to stay independent
// of the Supabase Edge Function runtime's npm-resolution and Deno
// std version drift. The implementation is ~30 lines and matches
// well-known reference implementations bit-for-bit.
//
// Used by the Phase 4 autopick worker for idempotency-key
// derivation:
//   const key = await uuidv5(
//     AUTOPICK_NAMESPACE_UUID,
//     `${league_id}|${pick_number}|${generation}|autopick`,
//   );
// Same `(namespace, name)` always produces the same UUID — that's
// what makes pgmq redelivery + worker retry safe at the
// submit_pick_v2 idempotency layer.

/**
 * Compute UUIDv5 = sha1(namespaceBytes ‖ nameBytes), with version
 * (5) and IETF variant bits set. Returns the canonical
 * 8-4-4-4-12 hex string.
 */
export async function uuidv5(
  namespace: string,
  name: string,
): Promise<string> {
  const namespaceBytes = uuidStringToBytes(namespace);
  const nameBytes      = new TextEncoder().encode(name);

  const buf = new Uint8Array(namespaceBytes.length + nameBytes.length);
  buf.set(namespaceBytes, 0);
  buf.set(nameBytes,      namespaceBytes.length);

  const sha1 = await globalThis.crypto.subtle.digest('SHA-1', buf);
  const out  = new Uint8Array(sha1, 0, 16);  // first 16 bytes only

  // Set version 5 (top 4 bits of byte 6).
  out[6] = (out[6] & 0x0f) | 0x50;
  // Set IETF variant (top 2 bits of byte 8 = 10).
  out[8] = (out[8] & 0x3f) | 0x80;

  return formatUuidBytes(out);
}

function uuidStringToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) {
    throw new Error(`uuidv5: namespace must be a UUID, got "${uuid}"`);
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function formatUuidBytes(bytes: Uint8Array): string {
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
