// scripts/test-followOpenEnded.mjs
//
// 260516-0yw: assert the follow registry handler is OPEN-ENDED on the
// supplied AbortSignal — it must NOT resolve synchronously once the target
// is installed. Pre-260516-0yw, the handler returned `following ${label}`
// synchronously, action_complete fired immediately, and the bot entered a
// "following you" spam loop on every iteration. The fix is verified by:
//
//   (a) with a never-aborted signal, the promise stays pending past 100ms,
//   (b) once `controller.abort()` is called, the promise resolves with
//       `aborted: follow ${label}`,
//   (c) setFollowTarget(null) is called on abort (target cleared),
//   (d) when NO signal is passed (test/legacy fallback), the handler
//       resolves synchronously with `following ${label}` so existing
//       unit tests that don't plumb a signal don't hang.
//
// Run: node scripts/test-followOpenEnded.mjs

import assert from 'node:assert/strict'
import { createDefaultRegistry } from '../src/bot/adapter/minecraft/registry.js'
import { getFollowTargetLabel } from '../src/bot/adapter/minecraft/behaviors/follow.js'

function makeBot() {
  return {
    players: { alice: { entity: { id: 1, type: 'player', username: 'alice' } } },
    entities: {},
    entity: { position: { x: 0, y: 64, z: 0 } },
  }
}

async function withTimeout(promise, ms, label) {
  let timer
  const t = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout: ${label} (${ms}ms)`)), ms)
  })
  try {
    return await Promise.race([promise, t])
  } finally {
    clearTimeout(timer)
  }
}

async function expectPending(promise, ms, label) {
  let pendingFlag = true
  // Attach a then handler that flips the flag if the promise settles
  // early. The handler also catches rejection so an aborted promise
  // doesn't surface as an unhandled rejection while we're waiting.
  promise.then(() => { pendingFlag = false }, () => { pendingFlag = false })
  await new Promise(r => setTimeout(r, ms))
  assert.equal(pendingFlag, true, `expected ${label} to be PENDING after ${ms}ms`)
  // Do NOT return the promise — that would deadlock the caller who
  // awaits us. Caller still has a reference and can abort + await.
}

async function main() {
  const registry = createDefaultRegistry()

  // (a) PENDING with active signal
  {
    const bot = makeBot()
    const ac = new AbortController()
    const p = registry.execute('follow', { player: 'alice' }, bot, { signal: ac.signal })
    await expectPending(p, 100, '(a) follow with active signal')
    // Target should be installed by now.
    assert.equal(getFollowTargetLabel(), 'alice', '(a) follow target installed')
    // Now abort
    ac.abort()
    const r = await withTimeout(p, 1000, '(a) abort resolves')
    assert.equal(r, 'aborted: follow alice', '(a) resolves with aborted message')
    assert.equal(getFollowTargetLabel(), null, '(a) follow target cleared on abort')
  }

  // (b) already-aborted signal: resolves immediately with aborted message
  {
    const bot = makeBot()
    const ac = new AbortController()
    ac.abort()
    const r = await withTimeout(
      registry.execute('follow', { player: 'alice' }, bot, { signal: ac.signal }),
      500,
      '(b) preaborted'
    )
    assert.equal(r, 'aborted: follow alice', '(b) preaborted signal resolves')
    assert.equal(getFollowTargetLabel(), null, '(b) target cleared')
  }

  // (c) no-signal compat path: returns synchronously with `following ${label}`
  {
    const bot = makeBot()
    const r = await withTimeout(
      registry.execute('follow', { player: 'alice' }, bot, {}),
      200,
      '(c) no-signal'
    )
    assert.equal(r, 'following alice', '(c) no-signal returns sync compat string')
    // Target should still be installed (legacy semantics).
    assert.equal(getFollowTargetLabel(), 'alice', '(c) no-signal still installs target')
  }

  // (d) bad player → returns synchronously with error, no promise hang
  {
    const bot = makeBot()
    const ac = new AbortController()
    const r = await withTimeout(
      registry.execute('follow', { player: 'bob' }, bot, { signal: ac.signal }),
      500,
      '(d) unknown player'
    )
    assert.equal(r, 'no such player: bob', '(d) unknown player resolves with error')
    // Don't abort — proves the handler bailed out BEFORE attaching the
    // signal listener (otherwise the promise would still be pending).
  }

  console.log('PASS: test-followOpenEnded.mjs')
}

main().catch(err => {
  console.error('FAIL:', err)
  process.exit(1)
})
