/**
 * Two-state Ollama circuit (D-13/D-14). No half-open: D-14 says no flapping.
 */
export function createOllamaCircuit({ tripAt = 3 } = {}) {
  let state = 'qwen'  // or 'haiku-fallback'
  let consecutiveFailures = 0
  return {
    get state() { return state },
    isOpen() { return state === 'haiku-fallback' },
    recordSuccess() { consecutiveFailures = 0 },
    recordFailure() {
      consecutiveFailures += 1
      if (consecutiveFailures >= tripAt) state = 'haiku-fallback'
      return state
    },
    /** Force open (used by startup-probe failure, D-13). */
    trip(reason) { state = 'haiku-fallback'; return reason },
  }
}
