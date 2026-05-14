/**
 * In-flight action tracker.
 *
 * Snapshot of "what is the bot doing right now" — populated when an action
 * starts, cleared when it ends. composeSnapshot renders an `in_flight:` line
 * so the LLM knows not to fire duplicate or competing actions.
 *
 * Single-flight is enforced inside individual action handlers (e.g. dig's
 * `bot.targetDigBlock` guard). This tracker only captures the most recent
 * action so the snapshot reflects ground truth.
 */

let _nextId = 1

export function createInflightTracker() {
  /** @type {{ id:number, name:string, args:any, startedAt:number, progress:any } | null} */
  let entry = null

  function start({ name, args }) {
    const handle = { id: _nextId++, name, args, startedAt: Date.now(), progress: null }
    entry = handle
    return handle
  }

  function end(handle) {
    if (entry && handle && entry.id === handle.id) entry = null
  }

  function current() {
    return entry
  }

  // Phase 7 D-10 (Option A): cuboid actions push progress ticks via this
  // setter so the next snapshot's `in_flight:` line includes a `placed/total`
  // (or `dug/total`) suffix. Stale handles (different id) are ignored to
  // avoid late ticks from a previous action overwriting fresh state.
  function updateProgress(handle, progress) {
    if (entry && handle && entry.id === handle.id) {
      entry.progress = progress
    }
  }

  return { start, end, current, updateProgress }
}

/**
 * Compact human-readable arg blurb for the in_flight: snapshot line.
 * Picks the most identifying fields and truncates the rest so a long
 * arg blob doesn't blow context.
 */
export function describeArgs(name, args) {
  if (!args || typeof args !== 'object') return ''
  const parts = []
  if (typeof args.block === 'string') parts.push(args.block)
  else if (typeof args.target === 'string') parts.push(args.target)
  else if (typeof args.item === 'string') parts.push(args.item)
  else if (typeof args.entity === 'string') parts.push(args.entity)

  if (typeof args.x === 'number' && typeof args.y === 'number' && typeof args.z === 'number') {
    parts.push(`@${args.x},${args.y},${args.z}`)
  }
  return parts.join(' ').slice(0, 64)
}
