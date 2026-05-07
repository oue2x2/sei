#!/usr/bin/env node
// Plan 03.1-08 Task 1 (WR-06).
// Validates:
//   - src/brain/storage/fileLock.js → withFileLock
//   - appendAffect / appendNote / saveOwner serialize through the lock so
//     concurrent calls do not lose updates.
//
// Run: `node scripts/test-fileLock.mjs` — exits 0 on full pass.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { appendAffect } from '../src/brain/memory/affectLog.js'
import { appendNote, saveOwner, loadOwner } from '../src/brain/memory/owner.js'
import { withFileLock } from '../src/brain/storage/fileLock.js'

const tmp = await mkdtemp(join(tmpdir(), 'sei-fileLock-'))
const affectPath = join(tmp, 'AFFECT.md')
const ownerPath = join(tmp, 'OWNER.md')

// Cold-create owner so appendNote has a baseline.
await saveOwner(ownerPath, {
  exists: true,
  owner_uuid: 'u',
  owner_username: 'tester',
  first_seen: '2026-05-06',
  last_seen: '2026-05-06',
  total_sessions: 1,
  preferred_name: null,
  pronouns: null,
  notes: '',
})

// T1: 20 concurrent appendAffect — all 20 lines must persist.
await Promise.all(Array.from({ length: 20 }, (_, i) =>
  appendAffect(affectPath, { kind: 'moment', summary: `affect-${i}` })
))
const affectText = await readFile(affectPath, 'utf8')
const affectLines = affectText.split('\n').filter(l => l.includes('(moment) affect-'))
assert.equal(affectLines.length, 20, `T1 expected 20 affect lines, got ${affectLines.length}`)

// T2: 20 concurrent appendNote — all 20 lines must persist.
await Promise.all(Array.from({ length: 20 }, (_, i) =>
  appendNote(ownerPath, `note-${i}`)
))
const owner = await loadOwner(ownerPath)
const noteCount = (owner.notes ?? '').split('\n').filter(l => /\bnote-\d+\b/.test(l)).length
assert.equal(noteCount, 20, `T2 expected 20 owner notes, got ${noteCount}`)

// T3: withFileLock orders FIFO within the same path. Each block waits 5ms
// between its start and end markers — a working lock keeps them paired,
// a broken lock interleaves them.
const order = []
const orderPath = join(tmp, 'order.txt')
await Promise.all(Array.from({ length: 5 }, (_, i) =>
  withFileLock(orderPath, async () => {
    order.push(`start-${i}`)
    await new Promise(r => setTimeout(r, 5))
    order.push(`end-${i}`)
  })
))
for (let i = 0; i < 5; i++) {
  const startMark = order[i * 2]
  const endMark = order[i * 2 + 1]
  assert.ok(startMark.startsWith('start-'), `T3 slot ${i*2} expected start-*, got ${startMark}`)
  assert.equal(
    endMark.replace('end-', ''),
    startMark.replace('start-', ''),
    `T3 mismatched start/end at slot ${i}: ${startMark} / ${endMark}`,
  )
}

// T4: an error inside one withFileLock callback does not block the next
// call on the same path.
const errPath = join(tmp, 'err.txt')
let secondRan = false
const firstP = withFileLock(errPath, async () => {
  await new Promise(r => setTimeout(r, 2))
  throw new Error('expected')
})
const secondP = withFileLock(errPath, async () => {
  secondRan = true
})
let firstThrew = false
try { await firstP } catch { firstThrew = true }
await secondP
assert.ok(firstThrew, 'T4 first callback rejected as expected')
assert.equal(secondRan, true, 'T4 second callback ran after first rejected')

await rm(tmp, { recursive: true, force: true })
console.log('fileLock: all cases passed')
