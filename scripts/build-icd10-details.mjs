#!/usr/bin/env node
/**
 * Build data/icd10_details.json from the CDC's ICD-10-CM tabular XML.
 *
 * - Downloads the CDC ZIP into .cache/ if not already present.
 * - Extracts notes (inclusionTerm, includes, excludes1, excludes2,
 *   useAdditionalCode, codeFirst, codeAlso, notes, sevenChrDef/sevenChrNote)
 *   for every chapter, section, and diagnosis code that appears in our CSVs.
 * - Writes a flat JSON map keyed by node id, matching the ids used by
 *   src/data.ts: `chapter_<n>`, `<section-id>`, `<diag-code>`.
 *
 * Run with: npm run build:details
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { XMLParser } from 'fast-xml-parser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const CACHE_DIR = join(ROOT, '.cache');
const ZIP_PATH = join(CACHE_DIR, 'icd10cm-table-and-index-2026.zip');
const UNZIP_DIR = join(CACHE_DIR, 'icd10cm-2026');
const XML_PATH = join(UNZIP_DIR, 'icd10cm-tabular-2026.xml');
const ZIP_URL =
  'https://ftp.cdc.gov/pub/health_statistics/nchs/publications/ICD10CM/2026/icd10cm-table%20and%20index-2026.zip';
const OUT_PATH = join(DATA_DIR, 'icd10_details.json');

function ensureXml() {
  if (existsSync(XML_PATH)) return;
  mkdirSync(CACHE_DIR, { recursive: true });
  if (!existsSync(ZIP_PATH)) {
    console.log(`Downloading CDC ICD-10-CM 2026 bundle (~18MB)...`);
    const r = spawnSync('curl', ['-sL', '-o', ZIP_PATH, ZIP_URL], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('curl failed');
  }
  console.log(`Unzipping...`);
  const r = spawnSync('unzip', ['-o', ZIP_PATH, '-d', UNZIP_DIR], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('unzip failed');
}

function loadCsvCodes() {
  const chapters = new Set();
  const sections = new Set();
  const diagnoses = new Set();

  for (const line of readFileSync(join(DATA_DIR, 'chapters.csv'), 'utf8').split(/\r?\n/).slice(1)) {
    const m = line.match(/^(\d+),/);
    if (m) chapters.add(m[1]);
  }
  for (const line of readFileSync(join(DATA_DIR, 'sections.csv'), 'utf8').split(/\r?\n/).slice(1)) {
    const m = line.match(/^([^,]+),/);
    if (m) sections.add(m[1]);
  }
  for (const line of readFileSync(join(DATA_DIR, 'diagnoses.csv'), 'utf8').split(/\r?\n/).slice(1)) {
    const m = line.match(/^([^,]+),/);
    if (m) diagnoses.add(m[1]);
  }
  return { chapters, sections, diagnoses };
}

// fast-xml-parser returns a single object when one child exists, or an array
// when multiple children exist with the same tag. Normalise to an array.
function arr(x) {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

// Extract <note>... entries from a parent's named child element (e.g. excludes1).
// Each note may be a string or { '#text': string }.
function extractNotes(parent, key) {
  const container = parent?.[key];
  if (!container) return [];
  return arr(container)
    .flatMap((c) => arr(c?.note))
    .map((n) => (typeof n === 'string' ? n : n?.['#text'] ?? ''))
    .map((s) => s.trim())
    .filter(Boolean);
}

const NOTE_KEYS = [
  ['includes', 'includes'],
  ['inclusionTerm', 'inclusionTerms'],
  ['excludes1', 'excludes1'],
  ['excludes2', 'excludes2'],
  ['useAdditionalCode', 'useAdditionalCode'],
  ['codeFirst', 'codeFirst'],
  ['codeAlso', 'codeAlso'],
  ['notes', 'notes'],
];

function extractAllNotes(parent) {
  const out = {};
  for (const [xmlKey, jsonKey] of NOTE_KEYS) {
    const notes = extractNotes(parent, xmlKey);
    if (notes.length) out[jsonKey] = notes;
  }
  // 7th-character extension definitions, useful as detail.
  const sevenChrNotes = arr(parent?.sevenChrNote)
    .flatMap((s) => arr(s?.note))
    .map((n) => (typeof n === 'string' ? n : n?.['#text'] ?? ''))
    .map((s) => s.trim())
    .filter(Boolean);
  if (sevenChrNotes.length) out.sevenChrNote = sevenChrNotes;

  const sevenChrDef = arr(parent?.sevenChrDef)
    .flatMap((s) => arr(s?.extension))
    .map((e) => ({
      char: e?.['@_char'] ?? '',
      text: typeof e === 'string' ? e : (e?.['#text'] ?? '').trim(),
    }))
    .filter((e) => e.text);
  if (sevenChrDef.length) out.sevenChrDef = sevenChrDef;

  return out;
}

// Recursively walk <diag> tree, emitting entries for any code in `wanted`.
function walkDiag(diag, parentPath, sectionId, chapterName, wanted, out) {
  const code = diag?.name;
  if (!code) return;
  const desc = (typeof diag.desc === 'string' ? diag.desc : diag.desc?.['#text'] ?? '').trim();
  const path = [...parentPath, { code, desc }];

  if (wanted.diagnoses.has(code)) {
    const detail = {
      kind: 'diag',
      code,
      desc,
      chapter: chapterName,
      section: sectionId,
      path: parentPath.map(({ code, desc }) => ({ code, desc })),
      ...extractAllNotes(diag),
    };
    out[code] = detail;
  }

  for (const child of arr(diag.diag)) {
    walkDiag(child, path, sectionId, chapterName, wanted, out);
  }
}

function build() {
  ensureXml();
  const wanted = loadCsvCodes();

  console.log(`Parsing tabular XML...`);
  const xml = readFileSync(XML_PATH, 'utf8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
    parseTagValue: false,
  });
  const doc = parser.parse(xml);

  const out = {};
  let chapterCount = 0;
  let sectionCount = 0;

  for (const chapter of arr(doc?.['ICD10CM.tabular']?.chapter)) {
    const chapterName = String(chapter?.name ?? '');
    if (!wanted.chapters.has(chapterName)) continue;
    const chapterDesc = (chapter?.desc ?? '').toString().trim();

    out[`chapter_${chapterName}`] = {
      kind: 'chapter',
      code: chapterName,
      desc: chapterDesc,
      ...extractAllNotes(chapter),
    };
    chapterCount++;

    for (const section of arr(chapter?.section)) {
      const sectionId = section?.['@_id'];
      if (!sectionId) continue;
      const sectionDesc = (section?.desc ?? '').toString().trim();

      // Only emit a section detail entry if our CSV references this section id.
      // (Section boundaries can shift across CMS revisions, so we still walk
      // every section's diagnoses to find any matching codes underneath.)
      if (wanted.sections.has(sectionId)) {
        out[sectionId] = {
          kind: 'section',
          code: sectionId,
          desc: sectionDesc,
          chapter: chapterName,
          ...extractAllNotes(section),
        };
        sectionCount++;
      }

      for (const diag of arr(section?.diag)) {
        walkDiag(
          diag,
          [{ code: sectionId, desc: sectionDesc }],
          sectionId,
          chapterName,
          wanted,
          out,
        );
      }
    }
  }

  const diagCount = Object.values(out).filter((d) => d.kind === 'diag').length;
  console.log(
    `Extracted ${chapterCount} chapters, ${sectionCount} sections, ${diagCount} diagnoses.`,
  );

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`Wrote ${OUT_PATH}`);
}

build();
