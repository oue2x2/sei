/**
 * Per-key 500ms coalescer. Last payload wins; one fire per key per window.
 */
export function createDebouncer(windowMs) {
  /** @type {Map<string,{timer:any,payload:any,fire:Function}>} */
  const pending = new Map()
  return {
    /** Coalesce events with the same `key`; `fire(payload)` is called once after windowMs of quiet. */
    debounce(key, payload, fire) {
      const existing = pending.get(key)
      if (existing) { clearTimeout(existing.timer); existing.payload = payload; existing.fire = fire }
      const entry = existing ?? { payload, fire, timer: null }
      entry.timer = setTimeout(() => { pending.delete(key); entry.fire(entry.payload) }, windowMs)
      pending.set(key, entry)
    },
    /** Cancel all pending. */
    flushCancel() { for (const e of pending.values()) clearTimeout(e.timer); pending.clear() },
  }
}
