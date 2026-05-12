// src/bot/adapter/minecraft/observers/veins.js — pure observer.
//
// Groups nearby "interesting" blocks into 6-neighbor connected components
// (same exact MC block ID only) and returns the top-K veins by anchor distance.
// Replaces the per-block "16 nearest" snapshot semantics with mining-shaped
// information so the Haiku LLM can tell one tree from N adjacent logs.
//
// Design rules (D-NEW-SCAV-1, locked in 06-CONTEXT.md):
// - Same-name-only connectivity. spruce_log next to oak_log = two veins.
// - 6-neighbor flood-fill, face-adjacent only.
// - Exposure-gated seeds (matches nearbyBlocks conservatism — no buried xray).
// - veinCap (default 64) bounds per-vein flood-fill; maxVeins (default 8)
//   bounds the returned list.
// - Pure data; no handle minting, no string formatting. snapshot.js owns those.
// - NaN-poisoning-safe origin (see posHealer.js).
// - Cross-chunk veins silently undercount — bot.blockAt returns null across
//   unloaded chunks, branch terminates cleanly. Reported count is "visible
//   vein", not "true vein". Matches blocks.js L62 conservatism.

import { Vec3 } from 'vec3'
import mcDataLib from 'minecraft-data'
import { getHealedPos } from './posHealer.js'
import { isExposed, INTERESTING_BLOCK_NAMES } from './blocks.js'

const NEIGHBOR_OFFSETS = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
]

/**
 * Group nearby interesting blocks into 6-neighbor connected components
 * (same exact block ID only) and return the top-K veins by anchor distance.
 *
 * Cross-chunk caveat: bot.blockAt returns null for unloaded neighbors; the
 * flood-fill terminates that branch cleanly, so a vein straddling a chunk
 * boundary is undercounted. The reported `count` is "visible vein", not
 * "true vein" (matches blocks.js isExposed conservatism).
 *
 * @param {import('mineflayer').Bot} bot
 * @param {{ radius?:number, maxVeins?:number, veinCap?:number, interesting?:Set<string> }} [opts]
 * @returns {{ veins: Array<{name:string, anchor:{x:number,y:number,z:number}, count:number, distance:number}>, more:number }}
 */
export function nearbyVeins(bot, opts = {}) {
  const radius = opts.radius ?? 16
  const maxVeins = opts.maxVeins ?? 8
  const veinCap = opts.veinCap ?? 64
  const interesting = opts.interesting ?? INTERESTING_BLOCK_NAMES

  // NaN-healed origin — matches blocks.js L104-107.
  const origin = getHealedPos(bot) ?? bot.entity?.position
  if (!origin || !Number.isFinite(origin.x)) return { veins: [], more: 0 }

  // mcData id-array matching (faster than function form on large radii).
  // Mirrors blocks.js L88-102 verbatim pattern.
  let mcData
  try { mcData = mcDataLib(bot.version) } catch { mcData = null }
  let matching
  if (mcData?.blocksByName) {
    const ids = []
    for (const name of interesting) {
      const b = mcData.blocksByName[name]
      if (b) ids.push(b.id)
    }
    matching = ids.length ? ids : ((b) => interesting.has(b.name))
  } else {
    matching = (b) => interesting.has(b.name)
  }

  // Generous seed list — flood-fill dedupes via visited set. 256 is plenty
  // for a 16-radius scan after vein-grouping collapses runs.
  const seeds = bot.findBlocks({ matching, maxDistance: radius, count: 256, point: origin })

  const visited = new Set()
  const key = (x, y, z) => `${x},${y},${z}`
  const veins = []

  for (const seed of seeds) {
    const sk = key(seed.x, seed.y, seed.z)
    if (visited.has(sk)) continue

    const seedBlk = bot.blockAt(seed)
    if (!seedBlk || !interesting.has(seedBlk.name)) { visited.add(sk); continue }
    if (!isExposed(bot, seed)) { visited.add(sk); continue }

    const veinName = seedBlk.name
    const stack = [seed]
    const veinPositions = []
    // Per-vein "tried" set tracks positions we've already popped during THIS
    // flood-fill (prevents stack thrash). Differs from the outer `visited`
    // set which only records same-name vein members so wrong-name neighbors
    // remain available as seeds for their own veins.
    const tried = new Set()

    while (stack.length && veinPositions.length < veinCap) {
      const p = stack.pop()
      const pk = key(p.x, p.y, p.z)
      if (tried.has(pk)) continue
      tried.add(pk)
      const blk = bot.blockAt(p)
      if (!blk || blk.name !== veinName) continue
      visited.add(pk)
      veinPositions.push(p)
      for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
        const nx = p.x + dx, ny = p.y + dy, nz = p.z + dz
        if (!tried.has(key(nx, ny, nz))) {
          stack.push(new Vec3(nx, ny, nz))
        }
      }
    }

    // If we hit the veinCap, drain the rest of the stack into `visited` so
    // unreached members of THIS connected component don't restart as a new
    // truncated vein on the next seed iteration. (Same-name only — we
    // confirm the neighbor matches before marking.)
    if (veinPositions.length >= veinCap) {
      while (stack.length) {
        const p = stack.pop()
        const pk = key(p.x, p.y, p.z)
        if (tried.has(pk) || visited.has(pk)) continue
        const blk = bot.blockAt(p)
        if (!blk || blk.name !== veinName) continue
        visited.add(pk)
        tried.add(pk)
        for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
          const nx = p.x + dx, ny = p.y + dy, nz = p.z + dz
          if (!tried.has(key(nx, ny, nz))) {
            stack.push(new Vec3(nx, ny, nz))
          }
        }
      }
    }

    if (veinPositions.length === 0) continue

    // Anchor = member closest to bot's healed origin.
    let anchor = veinPositions[0]
    let bestD = typeof anchor.distanceTo === 'function'
      ? anchor.distanceTo(origin)
      : Math.hypot(anchor.x - origin.x, anchor.y - origin.y, anchor.z - origin.z)
    for (let i = 1; i < veinPositions.length; i++) {
      const p = veinPositions[i]
      const d = typeof p.distanceTo === 'function'
        ? p.distanceTo(origin)
        : Math.hypot(p.x - origin.x, p.y - origin.y, p.z - origin.z)
      if (d < bestD) { bestD = d; anchor = p }
    }

    veins.push({
      name: veinName,
      anchor: { x: anchor.x, y: anchor.y, z: anchor.z },
      count: veinPositions.length,
      distance: bestD,
    })
  }

  veins.sort((a, b) => a.distance - b.distance)
  const head = veins.slice(0, maxVeins)
  const more = Math.max(0, veins.length - maxVeins)
  return { veins: head, more }
}
