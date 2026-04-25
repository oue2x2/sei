/**
 * Chain tracker for LLM-04 hop cap. A "chain" is a logical reasoning sequence
 * that may span multiple handleDispatch invocations (because FSM completion
 * events re-enter the orchestrator). Each chain has its own hop counter.
 *
 * Lifecycle:
 *   - begin(seedEvent)            -> chainId, hops=0, deadline=now+ttlMs
 *   - continue(chainId)           -> existing chain (idempotent fetch)
 *   - increment(chainId)          -> hops += 1; returns { hops, capped }
 *   - end(chainId)                -> drop record
 *   - sweep()                     -> drop records past deadline (auto-called)
 *
 * TTL prevents leaks if `end()` is missed (e.g. orchestrator crash mid-chain).
 *
 * @param {{maxHops:number, ttlMs?:number}} opts
 */
export function createChainTracker({ maxHops, ttlMs = 60_000 }) {
  /** @type {Map<string,{hops:number,deadline:number,seedEvent:string}>} */
  const chains = new Map()
  let counter = 0

  function sweep() {
    const now = Date.now()
    for (const [id, rec] of chains) if (rec.deadline < now) chains.delete(id)
  }

  function begin(seedEvent) {
    sweep()
    const id = `chain-${Date.now().toString(36)}-${(counter++).toString(36)}`
    chains.set(id, { hops: 0, deadline: Date.now() + ttlMs, seedEvent })
    return id
  }

  function continueChain(chainId) {
    sweep()
    return chains.get(chainId) ?? null
  }

  function increment(chainId) {
    const rec = chains.get(chainId)
    if (!rec) return { hops: 0, capped: false, missing: true }
    rec.hops += 1
    rec.deadline = Date.now() + ttlMs  // refresh on activity
    return { hops: rec.hops, capped: rec.hops > maxHops, missing: false }
  }

  function end(chainId) { chains.delete(chainId) }

  function size() { return chains.size }

  return { begin, continue: continueChain, increment, end, size, _internal: { chains } }
}
