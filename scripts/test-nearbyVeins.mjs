#!/usr/bin/env node
// scripts/test-nearbyVeins.mjs — D-NEW-SCAV-1 unit test for nearbyVeins.
//
// Covers four scenarios:
//   A) 3x1x3 oak_log slab + adjacent spruce_log -> 2 veins (same-name-only)
//   B) NaN origin -> empty result, no throw
//   C) veinCap=64 truncates flood-fill mid-vein on a 100-block cube
//   D) maxVeins=2 with 4 single-block veins -> 2 closest + more=2

import assert from 'node:assert/strict'
import { Vec3 } from 'vec3'
import { nearbyVeins } from '../src/bot/adapter/minecraft/observers/veins.js'

// Stub a mineflayer Bot.
// `blocks` is a Map<"x,y,z", string blockName>. Missing keys read as air.
// Air is exposed-friendly (boundingBox==='empty'), so any non-air block whose
// neighbors are mostly missing-from-map will be treated as exposed.
function makeBot({ blocks, originPos = { x: 0, y: 64, z: 0 }, version = '1.20.4' }) {
  const air = { name: 'air', boundingBox: 'empty' }
  function blockAt(p) {
    const k = `${p.x},${p.y},${p.z}`
    const name = blocks.get(k)
    if (!name) {
      // Treat undefined coords as air so isExposed sees see-through neighbors.
      // (Real bot returns null for unloaded chunks; the test-author opts in to
      //  "everything around the scene is air" by leaving slots unset.)
      return air
    }
    return { name, position: new Vec3(p.x, p.y, p.z), boundingBox: 'block', diggable: true }
  }
  function findBlocks({ matching, maxDistance, count, point }) {
    const origin = point ?? originPos
    const isMatch = typeof matching === 'function'
      ? (b) => matching(b)
      : (b) => Array.isArray(matching) ? matching.includes(b._id ?? -1) : false
    const hits = []
    for (const [k, name] of blocks.entries()) {
      const [x, y, z] = k.split(',').map(Number)
      // Synthetic _id derived from name hash so id-array matching works in test.
      // We don't use mcData here — fallback to function-form path is fine.
      // Force function-form: nearbyVeins falls back when mcData lookup yields no ids.
      // We achieve this by setting bot.version to an unparseable value below, OR
      // by making the matching path always a function. Since nearbyVeins tries
      // mcDataLib(version) first, easiest is to honor whatever it passes us.
      const block = { name, _id: 0 }
      const ok = typeof matching === 'function' ? matching(block) : false
      if (!ok) continue
      const dx = x - origin.x, dy = y - origin.y, dz = z - origin.z
      const d = Math.hypot(dx, dy, dz)
      if (d > maxDistance) continue
      const v = new Vec3(x, y, z)
      hits.push({ v, d })
    }
    hits.sort((a, b) => a.d - b.d)
    return hits.slice(0, count).map(h => h.v)
  }
  return {
    // Use an obviously-invalid version so mcDataLib throws inside nearbyVeins,
    // forcing the function-form `matching` fallback. This keeps the test stub
    // small (no minecraft-data id juggling).
    version,
    entity: { position: originPos },
    blockAt,
    findBlocks,
  }
}

let fails = 0
function pass(name) { console.log(`[test-nearbyVeins] PASS ${name}`) }
function fail(name, err) { fails++; console.error(`[test-nearbyVeins] FAIL ${name}: ${err?.message ?? err}`) }

// --- Test A: 3x1x3 oak_log slab + adjacent spruce_log -> 2 veins
try {
  const blocks = new Map()
  // 3x3 slab of oak_log at y=64, x=2..4, z=2..4 (9 blocks)
  for (let x = 2; x <= 4; x++) {
    for (let z = 2; z <= 4; z++) {
      blocks.set(`${x},64,${z}`, 'oak_log')
    }
  }
  // One spruce_log adjacent to the slab at (5,64,4) — 6-neighbor of (4,64,4)
  blocks.set(`5,64,4`, 'spruce_log')

  const bot = makeBot({ blocks, version: 'not-a-real-version' })
  const r = nearbyVeins(bot, { radius: 16 })

  assert.equal(r.veins.length, 2, `expected 2 veins, got ${r.veins.length}`)
  assert.equal(r.more, 0)
  const oak = r.veins.find(v => v.name === 'oak_log')
  const spruce = r.veins.find(v => v.name === 'spruce_log')
  assert.ok(oak, 'oak vein present')
  assert.ok(spruce, 'spruce vein present')
  assert.equal(oak.count, 9, `oak count=${oak.count}`)
  assert.equal(spruce.count, 1, `spruce count=${spruce.count}`)
  pass('A (two veins, same-name-only connectivity)')
} catch (e) { fail('A', e) }

// --- Test B: NaN origin -> empty result, no throw
try {
  const bot = makeBot({
    blocks: new Map([['1,64,1', 'oak_log']]),
    originPos: { x: NaN, y: NaN, z: NaN },
    version: 'not-a-real-version',
  })
  const r = nearbyVeins(bot, { radius: 16 })
  assert.deepEqual(r, { veins: [], more: 0 })
  pass('B (NaN origin guard)')
} catch (e) { fail('B', e) }

// --- Test C: 100-block cobblestone cube -> veinCap truncation
try {
  const blocks = new Map()
  // 5x5x5 cube of cobblestone (125 blocks total) at x=5..9, y=64..68, z=5..9
  for (let x = 5; x <= 9; x++) {
    for (let y = 64; y <= 68; y++) {
      for (let z = 5; z <= 9; z++) {
        blocks.set(`${x},${y},${z}`, 'cobblestone')
      }
    }
  }
  const bot = makeBot({ blocks, version: 'not-a-real-version' })
  // 'cobblestone' is in INTERESTING_BLOCK_NAMES (TERRAIN includes it).
  const r = nearbyVeins(bot, { radius: 32 })

  assert.equal(r.veins.length, 1, `expected 1 vein, got ${r.veins.length}`)
  assert.equal(r.veins[0].name, 'cobblestone')
  assert.equal(r.veins[0].count, 64, `expected veinCap=64, got ${r.veins[0].count}`)
  // more=0 because there is only one (truncated) vein; the cube is one component.
  assert.equal(r.more, 0)
  pass('C (veinCap=64 truncates flood-fill)')
} catch (e) { fail('C', e) }

// --- Test D: maxVeins=2 with 4 single-block veins -> 2 closest, more=2
try {
  const blocks = new Map()
  // Four isolated oak_logs at varying distances from origin (0,64,0).
  // Place them with at least 2 blocks of air between to prevent flood-fill merging.
  blocks.set(`2,64,0`, 'oak_log')   // d ~2
  blocks.set(`5,64,0`, 'oak_log')   // d ~5
  blocks.set(`8,64,0`, 'oak_log')   // d ~8
  blocks.set(`11,64,0`, 'oak_log')  // d ~11

  const bot = makeBot({ blocks, version: 'not-a-real-version' })
  const r = nearbyVeins(bot, { radius: 16, maxVeins: 2 })

  assert.equal(r.veins.length, 2, `expected 2 veins, got ${r.veins.length}`)
  assert.equal(r.more, 2, `expected more=2, got ${r.more}`)
  // Closest two: x=2 and x=5
  assert.equal(r.veins[0].anchor.x, 2)
  assert.equal(r.veins[1].anchor.x, 5)
  pass('D (maxVeins cap + more counter)')
} catch (e) { fail('D', e) }

if (fails > 0) {
  console.error(`[test-nearbyVeins] ${fails} FAILED`)
  process.exit(1)
}
console.log('[test-nearbyVeins] all tests passed')
process.exit(0)
