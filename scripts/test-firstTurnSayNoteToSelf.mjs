#!/usr/bin/env node
// Plan 03.1-08 Task 2 (D-NEW-MEM-2 RED).
// Validates: shouldRepromptForFirstTurnSay carves out noteToSelf-only first
// turns. Mixed action+memory turns still reprompt.
//
// Run: `node scripts/test-firstTurnSayNoteToSelf.mjs` — exits 0 on full pass.

import assert from 'node:assert/strict'
import { shouldRepromptForFirstTurnSay } from '../src/brain/orchestrator.js'

const baseArgs = {
  triggerEvent: 'sei:chat_received',
  ownerSpoke: true,
  iterationCount: 1,
  alreadyReprompted: false,
}

// T1: only noteToSelf — exempt (was: reprompt; now: don't)
assert.equal(
  shouldRepromptForFirstTurnSay({ ...baseArgs, toolUses: [{ name: 'noteToSelf' }] }),
  false,
  'T1 noteToSelf-only first turn must NOT reprompt (D-NEW-MEM-2)',
)

// T2: dig + noteToSelf — still reprompt (mixed action requires say)
assert.equal(
  shouldRepromptForFirstTurnSay({ ...baseArgs, toolUses: [{ name: 'dig' }, { name: 'noteToSelf' }] }),
  true,
  'T2 mixed dig+noteToSelf must still reprompt',
)

// T3: dig only — still reprompt (regression check)
assert.equal(
  shouldRepromptForFirstTurnSay({ ...baseArgs, toolUses: [{ name: 'dig' }] }),
  true,
  'T3 dig-only must still reprompt',
)

// T4: say + noteToSelf — already has say, no reprompt (regression)
assert.equal(
  shouldRepromptForFirstTurnSay({ ...baseArgs, toolUses: [{ name: 'say' }, { name: 'noteToSelf' }] }),
  false,
  'T4 say+noteToSelf must NOT reprompt',
)

// T5: empty toolUses — no reprompt (regression)
assert.equal(
  shouldRepromptForFirstTurnSay({ ...baseArgs, toolUses: [] }),
  false,
  'T5 empty toolUses must NOT reprompt',
)

// T6: two noteToSelf — exempt
assert.equal(
  shouldRepromptForFirstTurnSay({ ...baseArgs, toolUses: [{ name: 'noteToSelf' }, { name: 'noteToSelf' }] }),
  false,
  'T6 multi-noteToSelf must NOT reprompt',
)

console.log('firstTurnSayNoteToSelf: all cases passed')
