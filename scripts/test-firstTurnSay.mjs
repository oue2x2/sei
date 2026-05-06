// Plan 03.1-05 Task 1: Hard-enforce first-turn say() at orchestrator level
// (D-1, D-H-1). Pure-function predicate is exported so this test exercises the
// enforcement decision without spinning up an LLM round-trip.
//
// Test path is scripts/test-firstTurnSay.mjs (not test/firstTurnSay.test.js as
// the plan literally specified) — `test/` is gitignored at project root
// (.gitignore line 6). scripts/ is the canonical home for ad-hoc executable
// test runners (alongside test-postProcessSay.mjs, test-affectLog.mjs).
import assert from 'node:assert/strict'
import { shouldRepromptForFirstTurnSay } from '../src/brain/orchestrator.js'

// Owner-triggered, first turn, no say(), tool_use present: SHOULD reprompt
assert.equal(shouldRepromptForFirstTurnSay({
  triggerEvent: 'sei:chat_received', ownerSpoke: true, iterationCount: 1,
  toolUses: [{ name: 'follow' }, { name: 'attackEntity' }], alreadyReprompted: false,
}), true, 'D-H-1: hunt — follow+attackEntity without say() must reprompt')

// Owner-triggered, first turn, includes say(): NO reprompt (good path)
assert.equal(shouldRepromptForFirstTurnSay({
  triggerEvent: 'sei:chat_received', ownerSpoke: true, iterationCount: 1,
  toolUses: [{ name: 'say' }, { name: 'dig' }], alreadyReprompted: false,
}), false, 'good path: say + dig')

// Idle event (not owner-triggered): NEVER reprompt
assert.equal(shouldRepromptForFirstTurnSay({
  triggerEvent: 'sei:idle', ownerSpoke: false, iterationCount: 1,
  toolUses: [{ name: 'goTo' }], alreadyReprompted: false,
}), false, 'idle does not trigger first-turn rule')

// Second iteration: NEVER reprompt (only first)
assert.equal(shouldRepromptForFirstTurnSay({
  triggerEvent: 'sei:chat_received', ownerSpoke: true, iterationCount: 2,
  toolUses: [{ name: 'dig' }], alreadyReprompted: false,
}), false, 'second iteration not enforced')

// Already reprompted: do NOT reprompt again
assert.equal(shouldRepromptForFirstTurnSay({
  triggerEvent: 'sei:chat_received', ownerSpoke: true, iterationCount: 1,
  toolUses: [{ name: 'dig' }], alreadyReprompted: true,
}), false, 'one reprompt max per loop')

// Empty toolUses: NEVER reprompt (text-only turn handled by other rule)
assert.equal(shouldRepromptForFirstTurnSay({
  triggerEvent: 'sei:chat_received', ownerSpoke: true, iterationCount: 1,
  toolUses: [], alreadyReprompted: false,
}), false, 'empty toolUses does not trigger')

// Owner-triggered but ownerSpoke=false (edge case): no reprompt
assert.equal(shouldRepromptForFirstTurnSay({
  triggerEvent: 'sei:chat_received', ownerSpoke: false, iterationCount: 1,
  toolUses: [{ name: 'dig' }], alreadyReprompted: false,
}), false, 'ownerSpoke=false does not trigger')

console.log('firstTurnSay: all 7 cases passed')
