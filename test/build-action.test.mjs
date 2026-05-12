// test/build-action.test.mjs — Plan 07-02 stub-bot tests for buildAction.
//
// No live mineflayer. Stub bot implements blockAt, inventory.items(),
// entity.position, setControlState, placeBlock, equip — enough for buildAction
// and scaffoldUp to exercise their branches.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  BUILD_DESCRIPTION,
  ITERATION_ORDER,
  enumerateBuildCells,
  isOccupied,
  pickReferenceFace,
  withinReach,
  buildAction,
  scaffoldUp,
} from '../src/bot/adapter/minecraft/behaviors/build.js'

// ---- Task 1: enumerator + description ---------------------------------------

test('enumerate: 2x2x2 returns 8 cells, first cell at lowest y', () => {
  const cells = enumerateBuildCells({ x: 0, y: 64, z: 0 }, { x: 1, y: 65, z: 1 }, false)
  assert.equal(cells.length, 8)
  assert.equal(cells[0].y, 64)
  assert.equal(cells[cells.length - 1].y, 65)
})

test('enumerate: Y↑→X↑→Z↑ ordering', () => {
  const cells = enumerateBuildCells({ x: 0, y: 64, z: 0 }, { x: 1, y: 65, z: 1 }, false)
  // first cell = (0,64,0)
  assert.deepEqual(cells[0], { x: 0, y: 64, z: 0 })
  // second cell = (0,64,1) — Z advances first within same x,y
  assert.deepEqual(cells[1], { x: 0, y: 64, z: 1 })
  // third = (1,64,0) — X advances after Z exhausted
  assert.deepEqual(cells[2], { x: 1, y: 64, z: 0 })
  // fifth = (0,65,0) — Y advances after X,Z exhausted
  assert.deepEqual(cells[4], { x: 0, y: 65, z: 0 })
})

test('enumerate: hollow walls-only — 4×3×4 → 36 wall cells', () => {
  const cells = enumerateBuildCells({ x: 0, y: 64, z: 0 }, { x: 3, y: 66, z: 3 }, true)
  assert.equal(cells.length, 36)
  // every cell must be on a wall (x=0|3 or z=0|3)
  for (const c of cells) {
    assert.ok(c.x === 0 || c.x === 3 || c.z === 0 || c.z === 3, `cell ${JSON.stringify(c)} not on wall`)
  }
})

test('enumerate: single-cell case returns 1 cell', () => {
  const cells = enumerateBuildCells({ x: 5, y: 64, z: 5 }, { x: 5, y: 64, z: 5 }, false)
  assert.equal(cells.length, 1)
  assert.deepEqual(cells[0], { x: 5, y: 64, z: 5 })
})

test('enumerate: reversed corners normalized', () => {
  const cells = enumerateBuildCells({ x: 3, y: 66, z: 3 }, { x: 0, y: 64, z: 0 }, false)
  assert.equal(cells.length, 4 * 3 * 4) // 48
  assert.deepEqual(cells[0], { x: 0, y: 64, z: 0 })
})

test('BUILD_DESCRIPTION contains required tokens', () => {
  assert.ok(BUILD_DESCRIPTION.includes('cuboid'))
  assert.ok(BUILD_DESCRIPTION.includes('from'))
  assert.ok(BUILD_DESCRIPTION.includes('to'))
  assert.ok(BUILD_DESCRIPTION.includes('block'))
  assert.ok(BUILD_DESCRIPTION.includes('256'))
  assert.ok(BUILD_DESCRIPTION.includes('seed_cuboid_grammar'))
})

test('ITERATION_ORDER exported', () => {
  assert.ok(typeof ITERATION_ORDER === 'string' && ITERATION_ORDER.length > 0)
})

// ---- Stub bot helpers --------------------------------------------------------

function makeStubBot({ occupied = new Set(), inventoryNames = ['dirt'], botPos = { x: 0.5, y: 64, z: 0.5 }, floorY = 63 } = {}) {
  const placed = []
  const jumps = []
  let signalAbortedChecks = 0
  const bot = {
    _placed: placed,
    _jumps: jumps,
    entity: { position: { ...botPos }, onGround: true },
    inventory: { items: () => inventoryNames.map(n => ({ name: n })) },
    blockAt(v) {
      const key = `${v.x},${v.y},${v.z}`
      if (occupied.has(key)) return { name: 'stone', position: v }
      // floor support — anything at floorY or below is solid stone
      if (v.y <= floorY) return { name: 'stone', position: v }
      return { name: 'air', position: v }
    },
    setControlState(k, v) { if (k === 'jump') jumps.push({ v, t: Date.now() }) },
    async placeBlock(ref, face) {
      placed.push({ ref: { ...ref.position }, face: { x: face.x, y: face.y, z: face.z } })
      // simulate block existing now at face position
      const np = { x: ref.position.x + face.x, y: ref.position.y + face.y, z: ref.position.z + face.z }
      occupied.add(`${np.x},${np.y},${np.z}`)
    },
    async equip() {},
  }
  return { bot, get signalAbortedChecks() { return signalAbortedChecks } }
}

// AbortSignal-like with counter
function makeSignal({ abortAfter = -1 } = {}) {
  let aborted = false
  let checks = 0
  let calls = 0
  const listeners = []
  return {
    get aborted() {
      checks++
      calls++
      if (abortAfter >= 0 && calls > abortAfter) aborted = true
      return aborted
    },
    addEventListener(_ev, _fn) { listeners.push(_fn) },
    get _checks() { return checks },
    _trigger() {
      aborted = true
      for (const fn of listeners) fn()
    },
  }
}

// ---- Task 2: buildAction tests ----------------------------------------------

test('buildAction: 2x1x2 all-air → built 4 placed, 0 skipped, of 4', async () => {
  const { bot } = makeStubBot()
  const r = await buildAction(
    { from: { x: 0, y: 64, z: 0 }, to: { x: 1, y: 64, z: 1 }, block: 'dirt' },
    bot,
    {},
  )
  assert.equal(r, 'built 4 placed, 0 skipped, of 4 cells')
  assert.equal(bot._placed.length, 4)
})

test('buildAction: occupied skip (D-05) — 2 occupied of 4', async () => {
  const occupied = new Set(['0,64,0', '1,64,1'])
  const { bot } = makeStubBot({ occupied })
  const r = await buildAction(
    { from: { x: 0, y: 64, z: 0 }, to: { x: 1, y: 64, z: 1 }, block: 'dirt' },
    bot,
    {},
  )
  assert.equal(r, 'built 2 placed, 2 skipped, of 4 cells')
  assert.equal(bot._placed.length, 2)
})

test('buildAction: abort mid-loop returns aborted-after-K format', async () => {
  const { bot } = makeStubBot()
  // Allow first 5 signal checks (entry + 2 cells worth) then abort.
  // Loop pattern: entry check (1), then per-cell: aborted-check (1 each).
  // After 2 placements, 3 signal reads = entry+2 cells.
  const signal = makeSignal({ abortAfter: 4 })
  const r = await buildAction(
    { from: { x: 0, y: 64, z: 0 }, to: { x: 1, y: 64, z: 1 }, block: 'dirt' },
    bot,
    { signal },
  )
  assert.match(r, /^aborted after \d+ placed of 4 cells$/)
})

test('buildAction: no block in inventory — returns BEFORE any placeBlock', async () => {
  const { bot } = makeStubBot({ inventoryNames: [] })
  const r = await buildAction(
    { from: { x: 0, y: 64, z: 0 }, to: { x: 1, y: 64, z: 1 }, block: 'dirt' },
    bot,
    {},
  )
  assert.equal(r, 'no dirt in inventory')
  assert.equal(bot._placed.length, 0)
})

test('buildAction: scaffoldUp triggers when next cell above reach', async () => {
  // Bot stands at y=64; target cell at y=70 (dy=6 > REACH 4.5). Single-cell build.
  // Stub physics: jump moves bot up by 1 (we patch entity.position.y).
  const { bot } = makeStubBot({ botPos: { x: 0.5, y: 64, z: 0.5 }, floorY: 63 })
  let jumpCount = 0
  const realSet = bot.setControlState
  bot.setControlState = (k, v) => {
    realSet.call(bot, k, v)
    if (k === 'jump' && v === true) {
      jumpCount++
      // simulate apex: bump y by 1, set onGround false briefly
      bot.entity.position.y += 1
      bot.entity.onGround = false
    }
    if (k === 'jump' && v === false) {
      // landing: onGround true again
      bot.entity.onGround = true
    }
  }
  // Override placeBlock to also act as scaffold-floor extender:
  const realPlace = bot.placeBlock
  bot.placeBlock = async (ref, face) => {
    await realPlace.call(bot, ref, face)
  }
  const r = await buildAction(
    { from: { x: 0, y: 70, z: 0 }, to: { x: 0, y: 70, z: 0 }, block: 'dirt' },
    bot,
    {},
  )
  assert.ok(jumpCount >= 1, `expected at least 1 jump, got ${jumpCount}; result=${r}`)
})

test('buildAction: per-cell signal check happens for each cell', async () => {
  const { bot } = makeStubBot()
  const signal = makeSignal()
  await buildAction(
    { from: { x: 0, y: 64, z: 0 }, to: { x: 1, y: 64, z: 1 }, block: 'dirt' },
    bot,
    { signal },
  )
  // Entry check + per-cell checks (4 cells) = at least 5
  assert.ok(signal._checks >= 4, `expected ≥4 signal.aborted reads, got ${signal._checks}`)
})

test('scaffoldUp: no inventory short-circuit', async () => {
  const { bot } = makeStubBot({ inventoryNames: [], botPos: { x: 0, y: 64, z: 0 } })
  const r = await scaffoldUp(bot, 'dirt', 70, {})
  assert.equal(r, 'no dirt in inventory')
})
