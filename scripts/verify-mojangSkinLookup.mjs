#!/usr/bin/env tsx
// scripts/verify-mojangSkinLookup.mjs
//
// Phase 9 Plan 03 Task 3B — stub-server end-to-end harness for
// src/main/mojangSkinLookup.ts. Spins up a local Node http server that
// pretends to be api.mojang.com / sessionserver.mojang.com /
// textures.minecraft.net, monkey-patches globalThis.fetch so production
// code's calls to those hosts rewrite to the stub, and exercises five cases:
//
//   T1  happy path (modern 64×64 skin)
//   T2  legacy 64×32 normalization (WARNING 8 regression guard)
//   T3  no such user (HTTP 204)
//   T4  rate limited (HTTP 429)
//   T5  invalid input (regex-rejected before any network call)
//
// Run via `npm run verify:phase9-mojang` (which uses the local tsx
// devDependency) or directly: `npx tsx scripts/verify-mojangSkinLookup.mjs`.
//
// Exits 0 on PASS 5/5; non-zero on any failure.

import http from 'node:http';
import { deflateSync } from 'node:zlib';
import { lookupMojangSkin } from '../src/main/mojangSkinLookup';
import { parsePngIhdr } from '../src/main/skinImageUtil';

// ─── Inline PNG encoder (parameterized dimensions, mirrors scripts/build-default-skins.mjs) ─

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
/** Build a valid RGBA8 PNG of the given dimensions. Pixels: solid color. */
function buildPng(width, height, fillRgba = [128, 128, 128, 255]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);
  const rowBytes = width * 4;
  const raw = Buffer.alloc(height * (1 + rowBytes));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + rowBytes)] = 0; // filter byte (None)
    for (let x = 0; x < width; x++) {
      const off = y * (1 + rowBytes) + 1 + x * 4;
      raw[off]     = fillRgba[0];
      raw[off + 1] = fillRgba[1];
      raw[off + 2] = fillRgba[2];
      raw[off + 3] = fillRgba[3];
    }
  }
  const idat = deflateSync(raw);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Stub server ──────────────────────────────────────────────────────────

const MODERN_PNG = buildPng(64, 64, [100, 150, 200, 255]); // modern 64×64
const LEGACY_PNG = buildPng(64, 32, [200, 100, 100, 255]); // legacy 64×32 (WARNING 8 fixture)

// Pre-computed sessionserver responses (base64-encoded JSON payload in the
// `value` field, per Mojang's docs / RESEARCH.md §4).
function buildTexturesValue(skinUrl, model) {
  const decoded = {
    textures: { SKIN: { url: skinUrl, metadata: { model } } },
  };
  return Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64');
}

let stubPort = 0;
function stubBase() {
  return `http://127.0.0.1:${stubPort}`;
}

const server = http.createServer((req, res) => {
  const url = req.url || '';
  const send = (status, body, ct = 'application/json') => {
    res.writeHead(status, { 'content-type': ct });
    res.end(body);
  };

  // /users/profiles/minecraft/<name>
  if (url === '/users/profiles/minecraft/Notch') {
    return send(200, JSON.stringify({ id: '069a79f444e94726a5befca90e38aaf5', name: 'Notch' }));
  }
  if (url === '/users/profiles/minecraft/Legacy32') {
    return send(200, JSON.stringify({ id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'Legacy32' }));
  }
  if (url === '/users/profiles/minecraft/NoSuchUser_zzz_1') {
    res.writeHead(204);
    return res.end();
  }
  if (url === '/users/profiles/minecraft/RateLimited') {
    res.writeHead(429);
    return res.end();
  }

  // /session/minecraft/profile/<uuid>
  if (url === '/session/minecraft/profile/069a79f444e94726a5befca90e38aaf5') {
    const texturesValue = buildTexturesValue(`${stubBase()}/textures/modern`, 'classic');
    return send(200, JSON.stringify({
      id: '069a79f444e94726a5befca90e38aaf5',
      name: 'Notch',
      properties: [{ name: 'textures', value: texturesValue }],
    }));
  }
  if (url === '/session/minecraft/profile/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') {
    const texturesValue = buildTexturesValue(`${stubBase()}/textures/legacy`, 'classic');
    return send(200, JSON.stringify({
      id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      name: 'Legacy32',
      properties: [{ name: 'textures', value: texturesValue }],
    }));
  }

  // /textures/<modern|legacy>  (after URL rewrite — see below)
  if (url === '/textures/modern' || url === '/textures/textures/modern') {
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(MODERN_PNG.length) });
    return res.end(MODERN_PNG);
  }
  if (url === '/textures/legacy' || url === '/textures/textures/legacy') {
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(LEGACY_PNG.length) });
    return res.end(LEGACY_PNG);
  }

  send(404, 'not found', 'text/plain');
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
stubPort = server.address().port;
console.log(`stub server on http://127.0.0.1:${stubPort}`);

// ─── fetch monkey-patch ──────────────────────────────────────────────────
//
// Production code calls fetch('https://api.mojang.com/...'), fetch
// ('https://sessionserver.mojang.com/...'), and fetch(<textureUrl>). We
// rewrite those targets to point at the stub server. The textureUrl in the
// stubbed sessionserver response already points at http://127.0.0.1:<stubPort>/textures/...
// so it would work even without this rewrite — but if Mojang ever returned
// https://textures.minecraft.net/..., the same rewrite catches it.

const origFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  const rewritten = url
    .replace('https://api.mojang.com', stubBase())
    .replace('https://sessionserver.mojang.com', stubBase())
    .replace('http://textures.minecraft.net', `${stubBase()}/textures`);
  return origFetch(rewritten, init);
};

// ─── Assertion helpers ───────────────────────────────────────────────────

let passed = 0;
let failed = 0;
function assertTrue(cond, label) {
  if (cond) {
    console.log(`OK   ${label}`);
    passed++;
  } else {
    console.error(`FAIL ${label}`);
    failed++;
  }
}
function assertEq(actual, expected, label) {
  assertTrue(actual === expected, `${label} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

// ─── Test cases ──────────────────────────────────────────────────────────

try {
  // T1 — happy path (modern 64×64)
  {
    const r = await lookupMojangSkin('Notch');
    assertEq(r.resolvedUsername, 'Notch', 'T1 resolvedUsername=Notch');
    assertTrue(r.pngBytes.length > 0, 'T1 pngBytes non-empty');
    assertEq(r.pngBytes.slice(0, 4).toString('hex'), '89504e47', 'T1 PNG magic');
    const h = parsePngIhdr(r.pngBytes);
    assertEq(h.width, 64, 'T1 width=64');
    assertEq(h.height, 64, 'T1 height=64');
    assertEq(r.model, 'classic', 'T1 model=classic');
  }

  // T2 — legacy 64×32 normalization (WARNING 8 regression guard)
  {
    const r = await lookupMojangSkin('Legacy32');
    assertEq(r.pngBytes.slice(0, 4).toString('hex'), '89504e47', 'T2 PNG magic');
    const h = parsePngIhdr(r.pngBytes);
    assertEq(h.width, 64, 'T2 width=64 after normalization');
    assertEq(h.height, 64, 'T2 height=64 after normalization (was 32 on the wire)');
  }

  // T3 — no such user (HTTP 204)
  {
    const e = await lookupMojangSkin('NoSuchUser_zzz_1').catch((x) => x);
    assertTrue(e instanceof Error, 'T3 throws an Error');
    assertTrue(
      e instanceof Error && e.message.startsWith('MOJANG_LOOKUP_FAILED: no Minecraft account named'),
      `T3 error prefix (got: ${e instanceof Error ? e.message : String(e)})`,
    );
  }

  // T4 — rate limited (HTTP 429)
  {
    const e = await lookupMojangSkin('RateLimited').catch((x) => x);
    assertTrue(e instanceof Error, 'T4 throws an Error');
    assertTrue(
      e instanceof Error && e.message.startsWith('MOJANG_LOOKUP_FAILED: Mojang rate-limited'),
      `T4 error prefix (got: ${e instanceof Error ? e.message : String(e)})`,
    );
  }

  // T5 — invalid input (regex-rejected; should NOT contact the server)
  {
    const e = await lookupMojangSkin('!!!').catch((x) => x);
    assertTrue(e instanceof Error, 'T5 throws an Error');
    assertTrue(
      e instanceof Error && e.message.startsWith('MOJANG_LOOKUP_FAILED: invalid characters'),
      `T5 error prefix (got: ${e instanceof Error ? e.message : String(e)})`,
    );
  }
} finally {
  // Restore the original fetch (idempotent — running this script twice in the
  // same Node process should not stack-rewrite). Stop the stub server.
  globalThis.fetch = origFetch;
  server.close();
}

if (failed === 0) {
  console.log(`PASS 5/5`);
  process.exit(0);
} else {
  console.error(`FAIL ${failed} (${passed} passed)`);
  process.exit(1);
}
