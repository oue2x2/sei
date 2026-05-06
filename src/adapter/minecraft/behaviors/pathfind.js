import pkg from 'mineflayer-pathfinder'
const { Movements, goals } = pkg

/** @typedef {'reached' | 'cant_reach' | 'timeout' | 'no_bot'} PathfindResult */

/**
 * Navigate bot to (x, y, z) within `range` blocks.
 * Returns a PathfindResult — never throws or hangs.
 * @param {object} bot - mineflayer bot instance
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} range - acceptable distance from target
 * @param {number} timeoutMs - wall-clock timeout in ms
 * @returns {Promise<PathfindResult>}
 */
export async function goTo(bot, x, y, z, range = 1, timeoutMs = 12000) {
  if (!bot) return 'no_bot'

  const movements = new Movements(bot)
  bot.pathfinder.setMovements(movements)
  const goal = new goals.GoalNear(x, y, z, range)

  // Plan 03.1-05 Task 3 (D-E-1, D-W-7): closest-distance hint on cant_reach.
  // The LLM was getting bare 'cant_reach' and either retrying identically or
  // giving up; a one-number hint ("closest=8.4m to target X,Y,Z") tells it
  // whether the destination is plausibly reachable from a different angle or
  // genuinely walled off.
  function cantReachWithDistance() {
    try {
      const bp = bot.entity?.position
      if (!bp || typeof bp.x !== 'number') return 'cant_reach'
      const dx = bp.x - x, dy = bp.y - y, dz = bp.z - z
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz).toFixed(1)
      return `cant_reach (closest=${dist}m to target ${x},${y},${z})`
    } catch {
      return 'cant_reach'
    }
  }

  const navigationPromise = new Promise((resolve) => {
    bot.pathfinder.goto(goal)
      .then(() => resolve('reached'))
      .catch((err) => {
        const msg = String(err?.message || err).toLowerCase()
        if (msg.includes('timeout') || msg.includes('stop')) resolve(cantReachWithDistance())
        else resolve(cantReachWithDistance())
      })
  })

  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => {
      bot.pathfinder.stop()
      resolve('timeout')
    }, timeoutMs)
  })

  return Promise.race([navigationPromise, timeoutPromise])
}

export const PathfindResult = /** @type {const} */ ({
  REACHED: 'reached',
  CANT_REACH: 'cant_reach',
  TIMEOUT: 'timeout',
  NO_BOT: 'no_bot',
})
