import { goTo } from './pathfind.js'
import pkg from 'mineflayer-pathfinder'
const { pathfinder } = pkg

let _followInterval = null
let _paused = false
/** Optional provider — returns truthy when a *blocking* action is in flight.
 *  When set, the follow tick yields whenever the provider says so. This is
 *  the primary lifecycle gate (replaces the per-dispatch pauseFollow bracket
 *  the orchestrator used to set in its `finally`). */
let _inflightProvider = null

/** Pause/resume follow ticks. Hard override — used by combat.js when an
 *  attack starts. The inflight provider is the soft default. */
export function pauseFollow(p) { _paused = !!p }

/** Inject a function that returns truthy iff a movement action is currently
 *  running. The follow tick will yield while this returns truthy. */
export function setInflightProvider(fn) {
  _inflightProvider = (typeof fn === 'function') ? fn : null
}

export function startFollow(bot, config) {
  if (!bot.hasPlugin(pathfinder)) bot.loadPlugin(pathfinder)

  _followInterval = setInterval(async () => {
    if (_paused) return
    // Yield while a movement action is in flight (dig, place, attack, …).
    // This replaces the orchestrator's pauseFollow bracket — pause now lasts
    // for the *action* lifecycle, not the dispatch lifecycle, so dig's
    // approach + swing + pickup walk all complete without follow stealing
    // the pathfinder mid-action.
    if (_inflightProvider && _inflightProvider()) return
    // Yield to any in-progress pathfind (e.g. dig walk-to-drop, attack chase).
    // Without this, follow clobbers other goals every 1s.
    if (bot.pathfinder?.isMoving?.()) return

    const owner = bot.players[config.owner_username]
    if (!owner?.entity) return  // owner not in render distance

    const ownerPos = owner.entity.position
    const botPos = bot.entity.position
    const dist = botPos.distanceTo(ownerPos)

    if (dist > config.follow_range) {
      await goTo(bot, ownerPos.x, ownerPos.y, ownerPos.z, config.follow_range, config.pathfinder_timeout_ms)
    }
  }, 1000)  // re-evaluate every 1s
}

export function stopFollow() {
  clearInterval(_followInterval)
  _followInterval = null
}
