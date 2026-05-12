// src/bot/brain/log.js — transparent live logging for debugging.
//
// Phase 5 (D-1, D-3, D-9): event-per-line multi-line emission.
//   - Each event opens with `[ts] [tag] begin` and closes with `[ts] [tag] end`,
//     sharing ONE timestamp captured at the start of the call.
//   - Continuation lines are indented exactly 2 spaces; multi-line section
//     bodies get 4 spaces total (2 for the section + 2 for nesting).
//   - Inline truncation is gone — long payloads print in full.
//
// Public API is stable: every existing emitter keeps its old call signature.
// `logHaikuQuery` additively accepts `systemBlocks` and `namedUserBlocks`
// (consumed in Task 2; this Task 1 implementation falls back to printing the
// last message content via safeStringify).

function safeStringify(v) {
  try { return JSON.stringify(v) } catch { return String(v) }
}

function ts() {
  return new Date().toISOString().slice(11, 23)  // HH:MM:SS.mmm
}

// ─── Multi-line emit primitive (D-1, D-3) ────────────────────────────────
// `sections` is `Array<{label: string, body: string}>`.
// Output:
//   [ts] [tag] begin
//     label1: body-first-line
//       body-continuation-line
//     label2: body
//   [ts] [tag] end
//
// All output lines are joined with `\n` and written through a SINGLE
// console.log call so the block is atomic from Node's perspective.
function emitBlock(tag, sections) {
  try {
    const t = ts()
    const lines = [`[${t}] ${tag} begin`]
    for (const { label, body } of sections) {
      const bodyStr = body == null ? '' : (typeof body === 'string' ? body : safeStringify(body))
      const bodyLines = bodyStr.split('\n')
      lines.push(`  ${label}: ${bodyLines[0]}`)
      for (let i = 1; i < bodyLines.length; i++) {
        lines.push(`    ${bodyLines[i]}`)
      }
    }
    lines.push(`[${t}] ${tag} end`)
    console.log(lines.join('\n'))
  } catch {}
}

// ─── Chat ────────────────────────────────────────────────────────────────
export function logChatIn(username, message) {
  emitBlock('[chat<-]', [
    { label: 'from', body: String(username ?? '') },
    { label: 'text', body: typeof message === 'string' ? message : safeStringify(message) },
  ])
}

export function logChatOut(text) {
  emitBlock('[chat->]', [
    { label: 'text', body: typeof text === 'string' ? text : safeStringify(text) },
  ])
}

// ─── Personality LLM (Anthropic / Haiku) ─────────────────────────────────
/**
 * @param {object} req
 * @param {Array<any>} req.messages
 * @param {Array<{name:string}>} [req.tools]
 * @param {Array<{type:string,text?:string}>} [req.systemBlocks]  // Task 2 consumes
 * @param {Array<any>} [req.namedUserBlocks]                       // Task 2 consumes
 */
export function logHaikuQuery({ messages, tools, systemBlocks, namedUserBlocks }) {
  void systemBlocks; void namedUserBlocks  // Task 2 will use these
  const toolNames = (tools ?? []).map(t => t.name).join(', ')
  const userBody = safeStringify(messages?.[messages.length - 1]?.content)
  emitBlock('[haiku?]', [
    { label: 'tools', body: toolNames },
    { label: 'user', body: userBody },
  ])
}

export function logHaikuResponse({ text, toolUses, usage, stopReason }) {
  const calls = (toolUses ?? []).map(u => `${u.name}(${safeStringify(u.input)})`)
  const callsBody = calls.length === 0 ? '(none)' : calls.join('\n')
  emitBlock('[haiku!]', [
    { label: 'stop', body: String(stopReason ?? '') },
    { label: 'text', body: text && text.length > 0 ? text : '(empty)' },
    { label: 'calls', body: callsBody },
    { label: 'usage', body: safeStringify(usage) },
  ])
}

// ─── Position healer ─────────────────────────────────────────────────────
export function logHeal({ pos, vel, yaw, pitch }) {
  emitBlock('[heal]', [
    { label: 'pos', body: String(pos) },
    { label: 'vel', body: String(vel) },
    { label: 'yaw', body: String(yaw) },
    { label: 'pitch', body: String(pitch) },
  ])
}

// ─── Action results (echo for visibility) ────────────────────────────────
export function logActionResult(name, result) {
  const resultStr = typeof result === 'string' ? result : safeStringify(result)
  emitBlock('[act!]', [
    { label: 'action', body: String(name) },
    { label: 'result', body: resultStr },
  ])
}
