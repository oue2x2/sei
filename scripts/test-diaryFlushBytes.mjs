#!/usr/bin/env node
// Plan 03.1-08 Task 2 + Task 3.
// Validates:
//   - sessionState onLoopTerminal byte-cap flush fires on ANY event (not only
//     idle) when batch has affect/mutation (D-NEW-MEM-3, T6/T7).
//   - consolidationLock is released even when consolidateOlderHalf throws
//     synchronously (WR-05, T8).
//   - diary.countOversizeEntries skips consolidated blocks and counts only
//     non-consolidated entries whose body exceeds maxWords (D-W-9, T9).
//
// Run: `node scripts/test-diaryFlushBytes.mjs` — exits 0 on full pass.

import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createSessionState } from '../src/brain/sessionState.js'

const tmp = await mkdtemp(join(tmpdir(), 'sei-flushBytes-'))
const ownerPath = join(tmp, 'OWNER.md')
await writeFile(
  ownerPath,
  '---\nowner_uuid: u\nowner_username: tester\nfirst_seen: 2026-05-06\n' +
    'last_seen: 2026-05-06\ntotal_sessions: 1\npreferred_name: \npronouns: \n' +
    '---\n# Notes\n',
)

const diary = {
  async appendEntry() {},
  async getFileSizeBytes() { return 0 },
  async readAll() { return [] },
}

let summarizeCalls = 0
let throwOnConsolidate = false
const compactor = {
  async summarizeLoopBatch() { summarizeCalls += 1; return { topic: 't', body: 'b' } },
  consolidateOlderHalf: () => {
    if (throwOnConsolidate) throw new Error('sync-fail')
    return Promise.resolve(true)
  },
}
const config = {
  owner_username: 'tester',
  memory: {
    loop_batch_loop_count_cap: 999,            // disable loop-cap path
    loop_batch_context_cap_bytes: 32768,
    diary_size_cap_bytes: 999_999_999,         // T6/T7 keep size-pressure off
    sessions_per_consolidation: 999_999,
    spawn_settle_delay_ms: 0,
  },
}
const bot = { players: {}, once: () => {}, uuidToUsername: {} }
const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

const ss = await createSessionState({
  ownerMdPath: ownerPath,
  diary,
  compactor,
  config,
  bot,
  logger: silentLogger,
})

// T6 (D-NEW-MEM-3): 11 non-idle loop_terminals, each 4096 bytes, with affect
// signal. Cap (32768 bytes) trips on tick 8 and fires exactly one flush;
// counters reset; remaining 3 ticks accumulate 12288 bytes under cap.
const loopMsgsAffect = [{
  role: 'assistant',
  content: [{ type: 'tool_use', name: 'noteToSelf', id: 'n1', input: {} }],
}]
for (let i = 0; i < 11; i++) {
  await ss.onLoopTerminal({
    messagesByteSize: 4096,
    loopMessages: loopMsgsAffect,
    event: 'sei:chat_received',  // NOT idle
  })
}
assert.equal(
  summarizeCalls,
  1,
  `T6 expected 1 byte-cap flush in continuous-chat session, got ${summarizeCalls}`,
)

// T7: 11 non-idle loop_terminals, each 4096 bytes, with NO mutation/affect.
// bytesCap is exceeded but the batch carries no signal worth writing — the
// mutation-OR-affect gate keeps the diary clean of confabulated entries.
// Use a fresh sessionState so T6 leftover counters/flags don't leak in.
summarizeCalls = 0
const ss7 = await createSessionState({
  ownerMdPath: ownerPath,
  diary,
  compactor,
  config,
  bot,
  logger: silentLogger,
})
const loopMsgsEmpty = [{
  role: 'assistant',
  content: [{ type: 'text', text: 'just thinking' }],
}]
for (let i = 0; i < 11; i++) {
  await ss7.onLoopTerminal({
    messagesByteSize: 4096,
    loopMessages: loopMsgsEmpty,
    event: 'sei:chat_received',
  })
}
assert.equal(
  summarizeCalls,
  0,
  `T7 expected 0 flushes in chat-only session with no affect/mutation, got ${summarizeCalls}`,
)

// T8 (WR-05): synchronous throw out of consolidateOlderHalf releases lock.
// We probe by issuing two idle terminals: the first throws, the second runs
// only if the lock was released. Fresh sessionState so prior T6/T7 state
// does not affect the size-pressure path.
diary.getFileSizeBytes = async () => 999_999_999_999
config.memory.diary_size_cap_bytes = 1024
throwOnConsolidate = true
const ss8 = await createSessionState({
  ownerMdPath: ownerPath,
  diary,
  compactor,
  config,
  bot,
  logger: silentLogger,
})
const mutMsg = [{
  role: 'assistant',
  content: [{ type: 'tool_use', name: 'dig', id: 'd1', input: {} }],
}]
await ss8.onLoopTerminal({ messagesByteSize: 100, loopMessages: mutMsg, event: 'sei:idle' })

throwOnConsolidate = false
let consolidateRan = false
compactor.consolidateOlderHalf = () => { consolidateRan = true; return Promise.resolve(true) }
await ss8.onLoopTerminal({ messagesByteSize: 100, loopMessages: mutMsg, event: 'sei:idle' })
assert.equal(
  consolidateRan,
  true,
  'T8 WR-05: lock released after sync throw, second consolidate ran',
)

// T9 (D-W-9): countOversizeEntries returns N for non-consolidated entries
// whose body exceeds 80 whitespace-separated words. Consolidated `## Earlier`
// blocks are excluded so the startup recompact does not rewrite its own output.
{
  const tmp2 = await mkdtemp(join(tmpdir(), 'sei-oversize-'))
  const dpath = join(tmp2, 'DIARY.md')
  const longBody = 'word '.repeat(85).trim()  // 85 words > 80
  const shortBody = 'word '.repeat(10).trim() // 10 words ≤ 80
  const fileText =
    `## 2026-05-06 12:00 — long\n${longBody}\n\n` +
    `## 2026-05-05 12:00 — short\n${shortBody}\n\n` +
    `## Earlier (consolidated through 2026-05-04)\n${longBody}\n\n`
  await writeFile(dpath, fileText)
  const { createDiary } = await import('../src/brain/memory/diary.js')
  const d = createDiary({ path: dpath, seedDiaryBudgetBytes: 4096 })
  const c = await d.countOversizeEntries(80)
  assert.equal(c, 1, `T9 expected 1 oversize (long, consolidated excluded), got ${c}`)
  await rm(tmp2, { recursive: true, force: true })
}

await rm(tmp, { recursive: true, force: true })
console.log('diaryFlushBytes: all cases passed')
