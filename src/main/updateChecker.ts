/**
 * Update checker — fetches https://sei.gg/version.json on startup and
 * notifies the renderer if a newer version is available.
 *
 * version.json schema:
 *   { "version": "0.1.1", "downloadUrl": "https://sei.gg/#download", "notes": "..." }
 *
 * Failure modes (no network, bad JSON, timeout) are swallowed — update
 * notification is best-effort and never blocks app startup.
 */
import { net } from 'electron';
import { app } from 'electron';

const VERSION_URL = 'https://sei.gg/version.json';
const TIMEOUT_MS = 5000;

export interface UpdateInfo {
  latestVersion: string;
  currentVersion: string;
  downloadUrl: string;
  notes?: string;
}

function parseVersion(v: string): number[] {
  return v.replace(/^v/, '').split('.').map((p) => parseInt(p, 10) || 0);
}

function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

function fetchVersionJson(): Promise<{ version: string; downloadUrl?: string; notes?: string } | null> {
  return new Promise((resolve) => {
    const req = net.request({ url: VERSION_URL, method: 'GET', redirect: 'follow' });
    const timer = setTimeout(() => {
      try { req.abort(); } catch {}
      resolve(null);
    }, TIMEOUT_MS);

    let body = '';
    req.on('response', (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        clearTimeout(timer);
        resolve(null);
        return;
      }
      res.on('data', (chunk) => { body += chunk.toString('utf8'); });
      res.on('end', () => {
        clearTimeout(timer);
        try {
          const json = JSON.parse(body);
          if (typeof json?.version === 'string') {
            resolve({ version: json.version, downloadUrl: json.downloadUrl, notes: json.notes });
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => { clearTimeout(timer); resolve(null); });
    req.end();
  });
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const currentVersion = app.getVersion();
  const remote = await fetchVersionJson();
  if (!remote) return null;
  if (!isNewer(remote.version, currentVersion)) return null;
  return {
    latestVersion: remote.version,
    currentVersion,
    downloadUrl: remote.downloadUrl ?? 'https://sei.gg/',
    notes: remote.notes,
  };
}
