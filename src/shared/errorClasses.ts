/**
 * Plain-English error narration surface (GUI-05).
 *
 * Each variant maps to a copy entry in src/renderer/src/lib/errors.ts (plan 09).
 * Sources:
 *   - UI-SPEC §"Plain-English error copy" — 9 seeded classes
 *   - RESEARCH §"Pitfall 3" — KEYCHAIN_FALLBACK_PLAINTEXT (Linux fallback warning)
 *
 * Adding a new ErrorClass: also add a row to ERROR_COPY in lib/errors.ts.
 */

export type ErrorClass =
  | 'BOT_START_TIMEOUT'
  | 'LAN_NOT_OPEN'
  | 'INVALID_API_KEY'
  | 'RATE_LIMITED'
  | 'NETWORK_OFFLINE'
  | 'BOT_CRASH'
  | 'LAN_UNAVAILABLE'
  | 'KEYCHAIN_LOCKED'
  | 'KEYCHAIN_FALLBACK_PLAINTEXT'
  | 'NATIVE_MODULE_MISMATCH';

export const ALL_ERROR_CLASSES: readonly ErrorClass[] = Object.freeze([
  'BOT_START_TIMEOUT',
  'LAN_NOT_OPEN',
  'INVALID_API_KEY',
  'RATE_LIMITED',
  'NETWORK_OFFLINE',
  'BOT_CRASH',
  'LAN_UNAVAILABLE',
  'KEYCHAIN_LOCKED',
  'KEYCHAIN_FALLBACK_PLAINTEXT',
  'NATIVE_MODULE_MISMATCH',
]);
