// Phase 03.1 Plan 04 Task 1 (TDD).
// Validates:
//   - src/brain/memory/affectLog.js → appendAffect / readAffectFull / createAffectLog
//   - src/brain/memory/owner.js     → setPreferredName / appendNote
//
// Run: `node scripts/test-affectLog.mjs` — exits 0 on full pass.
//
// Test plan (from 03.1-04-PLAN.md Task 1):
//   1. cold-read creates the AFFECT header
//   2. appending a praise entry shows up verbatim in the file
//   3. appending a milestone entry shows up verbatim in the file
//   4. setPreferredName updates OWNER.md `preferred_name:` in frontmatter
//   5. appendNote inserts a timestamped line under `## Notes` (creating
//      the heading if missing — but the existing OWNER store always emits
//      `## Notes` so the heading exists in practice)

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import {
  createAffectLog,
  appendAffect,
  readAffectFull,
} from '../src/brain/memory/affectLog.js'
import {
  setPreferredName,
  appendNote,
  loadOwner,
  saveOwner,
} from '../src/brain/memory/owner.js'

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sei-affect-'))
const affPath = path.join(tmpDir, 'AFFECT.md')
const ownerPath = path.join(tmpDir, 'OWNER.md')

// ── affectLog ────────────────────────────────────────────────────────

// 1. cold-read creates the file with the header
let body = await readAffectFull(affPath)
assert.match(body, /^# Affect Log/, 'cold-read creates header')
const stat1 = await fs.stat(affPath)
assert.ok(stat1.size > 0, 'file actually written on cold read')

// 2. append praise
await appendAffect(affPath, {
  kind: 'praise',
  summary: 'sskitz said good job',
  when: new Date('2026-05-06T07:00:00Z'),
})
body = await readAffectFull(affPath)
assert.match(body, /\(praise\) sskitz said good job/, 'praise appended')
assert.match(
  body,
  /\[2026-05-06T07:00:00\.000Z\] \(praise\) sskitz said good job/,
  'praise has explicit timestamp'
)

// 3. append milestone (no `when` provided — uses Date.now())
await appendAffect(affPath, { kind: 'milestone', summary: 'first house built' })
body = await readAffectFull(affPath)
assert.match(body, /\(milestone\) first house built/, 'milestone appended')

// 4. createAffectLog factory shape
const store = createAffectLog({ path: affPath })
assert.equal(store.path, affPath, 'factory exposes path')
assert.equal(typeof store.append, 'function', 'factory exposes append()')
assert.equal(typeof store.readAll, 'function', 'factory exposes readAll()')
const viaFactory = await store.readAll()
assert.match(viaFactory, /\(praise\) sskitz said good job/, 'factory readAll returns existing log')

// ── owner ─────────────────────────────────────────────────────────────

// Seed an OWNER.md file in the structured format the existing store uses.
await saveOwner(ownerPath, {
  exists: true,
  owner_uuid: 'uuid-1',
  owner_username: 'sskitz',
  first_seen: '2026-05-06T00:00:00Z',
  last_seen: '2026-05-06T00:00:00Z',
  total_sessions: 1,
  preferred_name: null,
  pronouns: null,
  notes: '',
})

// 5. setPreferredName upserts the frontmatter line
await setPreferredName(ownerPath, 'Shawn')
let owner = await fs.readFile(ownerPath, 'utf8')
assert.match(owner, /^preferred_name:\s*Shawn\s*$/m, 'preferred_name set')

// loadOwner round-trip: parser still understands the file
const parsed = await loadOwner(ownerPath)
assert.equal(parsed.preferred_name, 'Shawn', 'loadOwner round-trips the new name')
assert.equal(parsed.owner_uuid, 'uuid-1', 'unrelated frontmatter survives')
assert.equal(parsed.total_sessions, 1, 'total_sessions survives')

// 6. appendNote adds a timestamped line under the notes heading.
//    NOTE: the on-disk OWNER.md uses `# Notes` (heading 1) per the existing
//    saveOwner serializer (owner.js line 142). The seed_owner block sent to
//    the LLM transforms this to `## Notes` (heading 2) via formatOwnerSeedBlock.
//    The plan's spec referenced `## Notes`; on inspection the heading-level
//    detail is internal to the on-disk format and the plan's underlying
//    intent (note appears under a notes section) is satisfied by the
//    existing serializer. We assert against what saveOwner actually writes.
await appendNote(ownerPath, 'praises with "good job"')
owner = await fs.readFile(ownerPath, 'utf8')
assert.match(owner, /^# Notes$/m, 'notes heading present (on-disk: "# Notes" per saveOwner)')
assert.match(owner, /praises with "good job"/, 'note appended')
assert.match(owner, /^- \[\d{4}-\d{2}-\d{2}T/m, 'note has ISO timestamp')

// loadOwner still parses cleanly after note append
const parsed2 = await loadOwner(ownerPath)
assert.match(parsed2.notes, /praises with "good job"/, 'note visible via loadOwner')

// 7. setPreferredName works against an OWNER file with no preferred_name line
//    (idempotency / upsert semantics — write twice, verify single line)
await setPreferredName(ownerPath, 'Shawn')
const owner2 = await fs.readFile(ownerPath, 'utf8')
const matches = owner2.match(/^preferred_name:/gm) ?? []
assert.equal(matches.length, 1, 'setPreferredName is idempotent (no duplicate frontmatter line)')

// 8. cleanup
await fs.rm(tmpDir, { recursive: true, force: true })

console.log('affectLog + owner: all cases passed')
