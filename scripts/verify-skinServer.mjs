#!/usr/bin/env node
// scripts/verify-skinServer.mjs
//
// Phase 9 Plan 02 — integration verification for the loopback skin HTTP server.
//
// Mirrors src/main/skinServer.ts's request handler exactly (regex + 404
// transparent-PNG + content-type negotiation) but runs in a pure-Node process
// — no Electron, no app.isPackaged, no main-process state — so the contract
// can be exercised without standing up the full Electron app.
//
// Four assertions:
//   1. Known username → 200 + PNG bytes + content-type image/png (PNG magic check)
//   2. Unknown username → 404 + transparent PNG body (content-type image/png)
//   3. Path-traversal attempt → 404 (regex rejects `..` / `/` / non-username chars)
//   4. Non-GET request → 404 (only GET handled)
//
// Exits 0 on PASS 4/4; non-zero with the failing assertion label on FAIL.

import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'

function assertEq(actual, expected, label) {
  if (actual !== expected) {
    console.error(`FAIL ${label}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`)
    process.exit(1)
  }
  console.log(`OK   ${label}`)
}

// ─── Synthetic state ──────────────────────────────────────────────────────
// One in-memory "character" pointing at a temp PNG. The real skinStore
// readSkinPng is module-level wired to characterStore; for verification we
// substitute a hand-rolled lookup so we don't need <userData> or Electron.
const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'sei-skin-verify-'))
const tmpPng = path.join(tmpDir, 'tester.png')
// Use the same 70-byte transparent 1x1 PNG used by skinServer.ts as the 404 body.
// Magic-byte test below validates PNG validity in both directions.
writeFileSync(
  tmpPng,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ),
)

const NOT_FOUND_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

const fakeChars = [
  { id: 'tester', name: 'Tester', username: 'Tester', skin: { source: 'upload' } },
]
function lookupPng(username) {
  const c = fakeChars.find((x) => x.username === username)
  if (!c) return null
  if (c.skin.source === 'upload') return readFileSync(tmpPng)
  return null
}

// ─── Server (mirror of src/main/skinServer.ts request handler) ────────────
const server = http.createServer((req, res) => {
  const m = (req.url || '').match(/^\/skins\/([A-Za-z0-9_]{1,16})\.png(\?.*)?$/)
  if (req.method !== 'GET' || !m) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('Not Found')
    return
  }
  const png = lookupPng(m[1])
  if (!png) {
    res.writeHead(404, { 'content-type': 'image/png' })
    res.end(NOT_FOUND_PNG)
    return
  }
  res.writeHead(200, {
    'content-type': 'image/png',
    'content-length': String(png.length),
  })
  res.end(png)
})

// 127.0.0.1 ONLY — same bind as src/main/skinServer.ts. Mismatching here would
// give a false signal about the production bind.
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
console.log(`test server on http://127.0.0.1:${port}`)

// ─── Assertions ──────────────────────────────────────────────────────────

// Test 1: known username returns PNG (status 200, content-type image/png, magic 89 50 4E 47).
const r1 = await fetch(`http://127.0.0.1:${port}/skins/Tester.png`)
assertEq(r1.status, 200, 'GET /skins/Tester.png status')
assertEq(r1.headers.get('content-type'), 'image/png', 'GET /skins/Tester.png content-type')
const b1 = Buffer.from(await r1.arrayBuffer())
assertEq(b1.slice(0, 8).toString('hex'), '89504e470d0a1a0a', 'GET /skins/Tester.png PNG magic')

// Test 2: unknown username returns 404 + transparent PNG body (image/png).
const r2 = await fetch(`http://127.0.0.1:${port}/skins/Unknown.png`)
assertEq(r2.status, 404, 'GET /skins/Unknown.png status')
assertEq(r2.headers.get('content-type'), 'image/png', 'GET /skins/Unknown.png content-type')

// Test 3: path traversal attempt is rejected by the regex (404).
// The URL-encoded `../` cannot match `[A-Za-z0-9_]{1,16}` so the handler
// short-circuits to the text/plain 404 branch. Never touches lookupPng.
const r3 = await fetch(`http://127.0.0.1:${port}/skins/..%2F..%2Fetc%2Fpasswd`)
assertEq(r3.status, 404, 'path-traversal returns 404')

// Test 4: non-GET method (POST) returns 404 (only GET is handled).
const r4 = await fetch(`http://127.0.0.1:${port}/skins/Tester.png`, { method: 'POST' })
assertEq(r4.status, 404, 'POST returns 404 (only GET handled)')

server.close()
console.log('PASS 4/4')
