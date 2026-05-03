// test/observers/blocks.test.js — unit tests for exposure predicate, aroundFeet,
// nearbyBlocks xray fix, sparse-expand fallback, and INTERESTING_BLOCK_NAMES set.
//
// Run:  node --test test/observers/blocks.test.js
//
// Uses Node's built-in test runner — no new dependencies.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isExposed,
  aroundFeet,
  nearbyBlocks,
  INTERESTING_BLOCK_NAMES,
} from '../../src/observers/blocks.js'

const key = (p) => `${p.x},${p.y},${p.z}`

/**
 * Build a fake bot whose `blockAt` reads from a hand-rolled store.
 * Default block (when not in the store) is air.
 *
 * @param {{ store?: Record<string, {name:string, boundingBox?:string}>,
 *           pos?: {x:number,y:number,z:number},
 *           findBlocksImpl?: (q:any)=>Array<{x:number,y:number,z:number, distanceTo?:(p:any)=>number}>
 *         }} [opts]
 */
function makeFakeBot(opts = {}) {
  const store = opts.store ?? {}
  const pos = opts.pos ?? { x: 0, y: 64, z: 0 }
  return {
    entity: { position: { x: pos.x, y: pos.y, z: pos.z } },
    version: '1.20.4',
    blockAt: (p) => {
      if (!p) return null
      const k = key(p)
      return store[k] ?? { name: 'air', boundingBox: 'empty' }
    },
    findBlocks: opts.findBlocksImpl ?? (() => []),
  }
}

// -------- isExposed --------

test('isExposed: block fully encased in stone is not exposed', () => {
  const center = { x: 0, y: 64, z: 0 }
  const store = {}
  // Encase center on all 6 sides with stone (full cube).
  for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
    store[key({ x: dx, y: 64+dy, z: dz })] = { name: 'stone', boundingBox: 'block' }
  }
  const bot = makeFakeBot({ store })
  assert.equal(isExposed(bot, center), false)
})

test('isExposed: one air neighbor → exposed', () => {
  const center = { x: 0, y: 64, z: 0 }
  const store = {
    [key({x:1,y:64,z:0})]: { name: 'stone', boundingBox: 'block' },
    [key({x:-1,y:64,z:0})]: { name: 'stone', boundingBox: 'block' },
    [key({x:0,y:65,z:0})]: { name: 'air', boundingBox: 'empty' }, // air neighbor
    [key({x:0,y:63,z:0})]: { name: 'stone', boundingBox: 'block' },
    [key({x:0,y:64,z:1})]: { name: 'stone', boundingBox: 'block' },
    [key({x:0,y:64,z:-1})]: { name: 'stone', boundingBox: 'block' },
  }
  const bot = makeFakeBot({ store })
  assert.equal(isExposed(bot, center), true)
})

test('isExposed: water neighbor → exposed (see-through per D-1sk-01)', () => {
  const center = { x: 0, y: 64, z: 0 }
  const store = {}
  for (const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
    store[key({x:dx,y:64+dy,z:dz})] = { name: 'stone', boundingBox: 'block' }
  }
  // override one neighbor with water
  store[key({x:1,y:64,z:0})] = { name: 'water', boundingBox: 'block' }
  const bot = makeFakeBot({ store })
  assert.equal(isExposed(bot, center), true)
})

test('isExposed: torch neighbor (boundingBox=empty) → exposed', () => {
  const center = { x: 0, y: 64, z: 0 }
  const store = {}
  for (const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
    store[key({x:dx,y:64+dy,z:dz})] = { name: 'stone', boundingBox: 'block' }
  }
  // a torch occupies a block but has empty boundingBox — see-through
  store[key({x:1,y:64,z:0})] = { name: 'torch', boundingBox: 'empty' }
  const bot = makeFakeBot({ store })
  assert.equal(isExposed(bot, center), true)
})

// -------- aroundFeet --------

test('aroundFeet: 6 sand + 2 grass_block → groups sorted by count desc', () => {
  // Bot stands at (0, 64, 0). Cube spans x=-2..2, y=63..66, z=-2..2.
  const store = {}
  // Plant 6 sand at six lower-cube positions.
  const sandSpots = [
    {x:-2,y:63,z:-2}, {x:-1,y:63,z:-2}, {x:0,y:63,z:-2},
    {x:1,y:63,z:-2}, {x:2,y:63,z:-2}, {x:-2,y:63,z:-1},
  ]
  for (const p of sandSpots) store[key(p)] = { name: 'sand', boundingBox: 'block' }
  // 2 grass_block elsewhere in cube
  store[key({x:0,y:63,z:0})] = { name: 'grass_block', boundingBox: 'block' }
  store[key({x:1,y:63,z:0})] = { name: 'grass_block', boundingBox: 'block' }

  const bot = makeFakeBot({ store, pos: { x: 0.5, y: 64.5, z: 0.5 } })
  const r = aroundFeet(bot)
  assert.equal(r.total, 8)
  assert.equal(r.more, 0)
  assert.equal(r.groups.length, 2)
  assert.deepEqual(r.groups[0], { name: 'sand', count: 6 })
  assert.deepEqual(r.groups[1], { name: 'grass_block', count: 2 })
})

test('aroundFeet: empty cube (all air) → empty groups', () => {
  const bot = makeFakeBot({ store: {}, pos: { x: 0, y: 64, z: 0 } })
  const r = aroundFeet(bot)
  assert.deepEqual(r, { groups: [], total: 0, more: 0 })
})

test('aroundFeet: more than 8 distinct names → capped at 8 with `more`', () => {
  const store = {}
  const names = ['stone','dirt','sand','grass_block','gravel','clay','snow','ice','sandstone','obsidian']
  // place each name once, in distinct cube voxels
  let i = 0
  for (let dx = -2; dx <= 2 && i < names.length; dx++) {
    for (let dz = -2; dz <= 2 && i < names.length; dz++) {
      store[key({x: dx, y: 63, z: dz})] = { name: names[i], boundingBox: 'block' }
      i++
    }
  }
  const bot = makeFakeBot({ store, pos: { x: 0, y: 64, z: 0 } })
  const r = aroundFeet(bot)
  assert.equal(r.total, 10)
  assert.equal(r.groups.length, 8)
  assert.equal(r.more, 2)
})

// -------- nearbyBlocks xray + sparse-expand --------

test('nearbyBlocks: targets fully encased in stone are filtered out (no xray)', () => {
  // findBlocks returns 1 candidate at (5,64,0); but its 6 neighbors are stone.
  const candidatePos = { x: 5, y: 64, z: 0 }
  const store = {
    [key(candidatePos)]: { name: 'iron_ore', boundingBox: 'block' },
  }
  // surround with stone
  for (const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
    store[key({x:5+dx,y:64+dy,z:dz})] = { name: 'stone', boundingBox: 'block' }
  }
  const bot = makeFakeBot({
    store,
    pos: { x: 0, y: 64, z: 0 },
    findBlocksImpl: () => [{
      x: candidatePos.x, y: candidatePos.y, z: candidatePos.z,
      distanceTo: () => 5,
    }],
  })
  const r = nearbyBlocks(bot, { count: 8 })
  assert.equal(r.positions.length, 0)
  assert.equal(r.more, 0)
})

test('nearbyBlocks: sparse-expand fallback fires when initial radius is empty', () => {
  // First call (radius=16) returns 0 candidates. Second call (radius=32) returns 2.
  // Both candidates have an air neighbor so they pass the exposure filter.
  const store = {
    // candidate A at (20,64,0) with air to the +y
    [key({x:20,y:64,z:0})]: { name: 'sand', boundingBox: 'block' },
    [key({x:20,y:65,z:0})]: { name: 'air', boundingBox: 'empty' },
    // candidate B at (-25,64,0) with air to the +y
    [key({x:-25,y:64,z:0})]: { name: 'sand', boundingBox: 'block' },
    [key({x:-25,y:65,z:0})]: { name: 'air', boundingBox: 'empty' },
  }
  let calls = 0
  const findBlocksImpl = (q) => {
    calls++
    if (calls === 1) return [] // first attempt at radius 16
    // second attempt at radius 32
    return [
      { x: 20, y: 64, z: 0, distanceTo: () => 20 },
      { x: -25, y: 64, z: 0, distanceTo: () => 25 },
    ]
  }
  const bot = makeFakeBot({ store, pos: { x: 0, y: 64, z: 0 }, findBlocksImpl })
  const r = nearbyBlocks(bot, { count: 8 })
  assert.equal(r.positions.length, 2)
  assert.ok(calls >= 2, `expected at least 2 findBlocks calls (sparse-expand), got ${calls}`)
})

// -------- INTERESTING_BLOCK_NAMES expansion --------

test('INTERESTING_BLOCK_NAMES includes new terrain names (D-1sk-05)', () => {
  for (const name of ['sand','sandstone','gravel','grass_block','dirt','stone']) {
    assert.ok(INTERESTING_BLOCK_NAMES.has(name), `expected INTERESTING_BLOCK_NAMES to include '${name}'`)
  }
})
