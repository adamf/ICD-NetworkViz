#!/usr/bin/env node
/**
 * Walk the WHO ICD-11 MMS linearization via the public ICD API and
 * cache each entity's JSON to .cache/icd11/<id>.json.
 *
 * The walk is BFS from the MMS root. Every time we read an entity we
 * enqueue its `child` URLs we haven't seen before. Fetches run with a
 * small concurrency pool and a per-request delay so we stay polite to
 * WHO's infrastructure. Cached entities are skipped on re-run, so the
 * script is resumable.
 *
 * Credentials come from the environment:
 *   WHO_ICD_CLIENT_ID, WHO_ICD_CLIENT_SECRET
 *
 * Usage:
 *   node scripts/fetch-icd11.mjs                # walk (default)
 *   node scripts/fetch-icd11.mjs --release 2024-01
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE_DIR = join(ROOT, '.cache', 'icd11');
const PROGRESS_FILE = join(ROOT, '.cache', 'icd11-progress.json');

const RELEASE = (() => {
  const i = process.argv.indexOf('--release');
  return i >= 0 ? process.argv[i + 1] : '2024-01';
})();

const TOKEN_URL = 'https://icdaccessmanagement.who.int/connect/token';
const ROOT_URL = `https://id.who.int/icd/release/11/${RELEASE}/mms`;

const CONCURRENCY = 8;
const REQUEST_DELAY_MS = 40;

// Load .env (simple parser — we only need WHO_ICD_* vars).
function loadDotenv() {
  const p = join(ROOT, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadDotenv();

const CLIENT_ID = process.env.WHO_ICD_CLIENT_ID;
const CLIENT_SECRET = process.env.WHO_ICD_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing WHO_ICD_CLIENT_ID / WHO_ICD_CLIENT_SECRET in environment or .env');
  process.exit(1);
}

/** OAuth token state. Refreshed when expiring. */
let tokenCache = { access_token: null, expires_at: 0 };

async function getToken() {
  const now = Date.now();
  if (tokenCache.access_token && tokenCache.expires_at > now + 60_000) {
    return tokenCache.access_token;
  }
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'client_credentials',
    scope: 'icdapi_access',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`token fetch failed: ${res.status}`);
  const json = await res.json();
  tokenCache = {
    access_token: json.access_token,
    expires_at: now + json.expires_in * 1000,
  };
  return tokenCache.access_token;
}

function idFromUrl(url) {
  const m = url.match(/\/mms\/([^/?#]+)(?:\/([^/?#]+))?$/);
  if (!m) return null;
  // Residual "unspecified" nodes under a parent share the parent id + suffix.
  return m[2] ? `${m[1]}__${m[2]}` : m[1];
}

function cachePathFor(id) {
  return join(CACHE_DIR, `${id}.json`);
}

async function fetchEntity(url) {
  const token = await getToken();
  // WHO's entity URLs use http:// scheme, but the server redirects to
  // https and Node's fetch drops the Authorization header across the
  // redirect. Upgrade to https ourselves so the token survives.
  const httpsUrl = url.replace(/^http:\/\//i, 'https://');
  const res = await fetch(httpsUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Accept-Language': 'en',
      'API-Version': 'v2',
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetch ${httpsUrl} -> ${res.status}`);
  return await res.json();
}

/**
 * Simple bounded concurrency queue. Workers pull URLs, fetch, cache,
 * and enqueue children. Exits when the queue is empty AND no worker
 * is still processing.
 */
async function walk() {
  mkdirSync(CACHE_DIR, { recursive: true });

  const seen = new Set();
  const queue = [];

  // Resume: anything already cached is "seen". Still need to enqueue
  // their children in case the walk was interrupted mid-layer.
  const existing = readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json'));
  for (const f of existing) {
    const id = f.replace(/\.json$/, '');
    seen.add(id);
    try {
      const data = JSON.parse(readFileSync(join(CACHE_DIR, f), 'utf8'));
      for (const c of data.child ?? []) {
        const cid = idFromUrl(c);
        if (cid && !seen.has(cid)) queue.push(c);
      }
    } catch {
      // ignore corrupt file — will be re-fetched
      seen.delete(id);
    }
  }
  console.log(`Resuming: ${seen.size} entities already cached, ${queue.length} queued.`);

  // Seed: root if not cached.
  const rootId = 'mms_root';
  const rootCachePath = join(CACHE_DIR, `${rootId}.json`);
  if (!existsSync(rootCachePath)) {
    console.log('Fetching MMS root...');
    const rootData = await fetchEntity(ROOT_URL);
    writeFileSync(rootCachePath, JSON.stringify(rootData));
    for (const c of rootData.child ?? []) queue.push(c);
    seen.add(rootId);
  } else {
    const rootData = JSON.parse(readFileSync(rootCachePath, 'utf8'));
    for (const c of rootData.child ?? []) {
      const cid = idFromUrl(c);
      if (cid && !seen.has(cid)) queue.push(c);
    }
  }

  let processed = 0;
  let failed = 0;
  const started = Date.now();

  async function worker() {
    while (queue.length > 0) {
      const url = queue.shift();
      if (!url) break;
      const id = idFromUrl(url);
      if (!id || seen.has(id)) continue;
      seen.add(id);

      try {
        await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
        const data = await fetchEntity(url);
        if (data) {
          writeFileSync(cachePathFor(id), JSON.stringify(data));
          for (const c of data.child ?? []) {
            const cid = idFromUrl(c);
            if (cid && !seen.has(cid)) queue.push(c);
          }
        }
        processed++;
        if (processed % 100 === 0) {
          const rate = processed / ((Date.now() - started) / 1000);
          console.log(
            `  ${processed} fetched (queue=${queue.length}, seen=${seen.size}, ${rate.toFixed(1)}/s)`,
          );
          writeFileSync(
            PROGRESS_FILE,
            JSON.stringify({ processed, seen: seen.size, queued: queue.length }),
          );
        }
      } catch (err) {
        failed++;
        console.error(`  ! ${url}: ${err.message}`);
        // On transient errors, retry later by re-enqueuing.
        if (failed < 100) queue.push(url);
        seen.delete(id);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`Done. ${processed} fetched, ${failed} failures, ${seen.size} total cached in ${elapsed}s.`);
}

walk().catch((err) => {
  console.error(err);
  process.exit(1);
});
