#!/usr/bin/env node
// Plan 06-02 Task 2 — resolveTerm() unit tests (D-NEW-SCAV-2).
// Covers known loose-term expansions, alias equivalence, case-insensitivity,
// exact-ID fallthrough, empty-input handling, and LOOSE_TERMS coverage.
import assert from 'node:assert/strict'
import { resolveTerm, LOOSE_TERMS } from '../src/bot/adapter/minecraft/loose-terms.js'

const sorted = (a) => [...a].sort()

function pass(name) {
  console.log(`PASS ${name}`)
}

// 1. resolveTerm('wood') has 8 entries, includes oak_log and cherry_log.
{
  const r = resolveTerm('wood')
  assert.equal(r.length, 8, `wood length: got ${r.length}`)
  assert.ok(r.includes('oak_log'), 'wood includes oak_log')
  assert.ok(r.includes('cherry_log'), 'wood includes cherry_log')
  pass("resolveTerm('wood') → 8 IDs incl. oak_log + cherry_log")
}

// 2. resolveTerm('log') === resolveTerm('wood') (alias)
{
  assert.deepStrictEqual(sorted(resolveTerm('log')), sorted(resolveTerm('wood')))
  pass("resolveTerm('log') aliases 'wood'")
}

// 3. resolveTerm('ore') has 16 entries (8 surface + 8 deepslate)
{
  const r = resolveTerm('ore')
  assert.equal(r.length, 16, `ore length: got ${r.length}`)
  assert.ok(r.includes('coal_ore'), 'ore includes coal_ore')
  assert.ok(r.includes('deepslate_diamond_ore'), 'ore includes deepslate_diamond_ore')
  pass("resolveTerm('ore') → 16 IDs incl. coal_ore + deepslate_diamond_ore")
}

// 4. resolveTerm('stone') includes cobblestone + deepslate
{
  const r = resolveTerm('stone')
  assert.ok(r.includes('cobblestone'), 'stone includes cobblestone')
  assert.ok(r.includes('deepslate'), 'stone includes deepslate')
  pass("resolveTerm('stone') includes cobblestone + deepslate")
}

// 5. resolveTerm('oak_log') → ['oak_log'] (exact-ID passthrough)
{
  assert.deepStrictEqual(resolveTerm('oak_log'), ['oak_log'])
  pass("resolveTerm('oak_log') → ['oak_log'] (exact passthrough)")
}

// 6. Unknown term lowercased + returned as single-element exact ID.
{
  assert.deepStrictEqual(resolveTerm('NONESUCH_BLOCK'), ['nonesuch_block'])
  pass("resolveTerm('NONESUCH_BLOCK') → ['nonesuch_block'] (fallthrough)")
}

// 7. Case-insensitive on known keys.
{
  assert.deepStrictEqual(sorted(resolveTerm('WOOD')), sorted(resolveTerm('wood')))
  pass("resolveTerm('WOOD') equals resolveTerm('wood') (case-insensitive)")
}

// 8. Empty input returns [].
{
  assert.deepStrictEqual(resolveTerm(''), [])
  assert.deepStrictEqual(resolveTerm(null), [])
  assert.deepStrictEqual(resolveTerm(undefined), [])
  pass("resolveTerm('') / null / undefined → []")
}

// 9. LOOSE_TERMS covers the documented keys.
{
  for (const key of ['wood', 'log', 'planks', 'leaves', 'ore', 'stone', 'dirt', 'sand']) {
    assert.ok(LOOSE_TERMS.includes(key), `LOOSE_TERMS missing ${key}`)
  }
  pass('LOOSE_TERMS includes wood/log/planks/leaves/ore/stone/dirt/sand')
}

console.log('\nALL TESTS PASSED')
