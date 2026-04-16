#!/usr/bin/env node
/**
 * Read every cached ICD-11 entity in .cache/icd11/ and produce a
 * single compact JSON at data/icd11.json keyed by entity id. The
 * bundle keeps what the site needs:
 *
 *   {
 *     "release": "2024-01",
 *     "rootId": "mms_root",
 *     "entities": {
 *       "<id>": {
 *         code: string | null,
 *         title: string,
 *         definition: string | null,
 *         classKind: "chapter" | "block" | "category" | "grouping" | ...,
 *         parents: string[],               // ids
 *         children: string[],              // ids
 *         // Polyhierarchy / cross-reference edges that make ICD-11
 *         // a graph rather than a tree. Each is a list of ids into
 *         // `entities`, where resolvable.
 *         foundationChildElsewhere: string[],
 *         exclusion: string[],
 *         inclusion: string[],
 *         relatedPerinatal: string[],
 *         relatedMaternal: string[],
 *         browserUrl: string | null,
 *       }
 *     }
 *   }
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE_DIR = join(ROOT, '.cache', 'icd11');
const OUT_PATH = join(ROOT, 'data', 'icd11.json');
const RELEASE = '2024-01';

function idFromUrl(url) {
  if (!url) return null;
  const m = url.match(/\/mms\/([^/?#]+)(?:\/([^/?#]+))?$/);
  if (!m) return null;
  return m[2] ? `${m[1]}__${m[2]}` : m[1];
}

/** Some reference arrays are plain URL strings; others are
 *  { foundationReference, linearizationReference, label } objects. */
function refsToIds(arr) {
  if (!Array.isArray(arr)) return [];
  const ids = [];
  for (const r of arr) {
    if (typeof r === 'string') {
      const id = idFromUrl(r);
      if (id) ids.push(id);
    } else if (r && typeof r === 'object') {
      const id = idFromUrl(r.linearizationReference || r.foundationReference);
      if (id) ids.push(id);
    }
  }
  return ids;
}

function valueOf(field) {
  if (!field) return null;
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && '@value' in field) return field['@value'];
  return null;
}

function build() {
  const files = readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json'));
  console.log(`Processing ${files.length} cached entities...`);

  const entities = {};
  let skipped = 0;

  for (const f of files) {
    const id = f.replace(/\.json$/, '');
    let data;
    try {
      data = JSON.parse(readFileSync(join(CACHE_DIR, f), 'utf8'));
    } catch {
      skipped++;
      continue;
    }
    entities[id] = {
      code: data.code ?? null,
      title: valueOf(data.title) ?? '',
      definition: valueOf(data.definition),
      classKind: data.classKind ?? null,
      parents: refsToIds(data.parent),
      children: refsToIds(data.child),
      foundationChildElsewhere: refsToIds(data.foundationChildElsewhere),
      exclusion: refsToIds(data.exclusion),
      inclusion: refsToIds(data.inclusion),
      relatedPerinatal: refsToIds(data.relatedEntitiesInPerinatalChapter),
      relatedMaternal: refsToIds(data.relatedEntitiesInMaternalChapter),
      browserUrl: data.browserUrl ?? null,
    };
  }

  const bundle = {
    release: RELEASE,
    rootId: 'mms_root',
    entities,
  };

  writeFileSync(OUT_PATH, JSON.stringify(bundle));
  const size = (JSON.stringify(bundle).length / 1024 / 1024).toFixed(2);
  console.log(
    `Wrote ${OUT_PATH} (${Object.keys(entities).length} entities, ${size} MB${skipped ? `, ${skipped} skipped` : ''}).`,
  );
}

build();
