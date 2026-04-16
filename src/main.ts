/**
 * ICD-10 / ICD-11 Network Visualization
 *
 * Main entry point. Loads ICD-10 from CSVs on startup, lazily loads
 * the ICD-11 bundle when the user toggles to it, and re-renders the
 * visualization on layout / chapter / revision changes.
 */

import './styles.css';
import {
  loadICD10Data,
  buildHierarchy,
  loadICD11Bundle,
  buildICD11Hierarchy,
  buildICD11Details,
  buildICD11ChordData,
} from './data';
import {
  initVisualization,
  renderVisualization,
  resetZoom,
  setHierarchyExpander,
  setCrossRefProvider,
  setChordDataProvider,
  setFullHierarchyProvider,
} from './visualization';
import { initDetailPanel, refreshIndex, closeDetailPanel } from './detailPanel';
import type {
  LayoutType,
  Chapter,
  Revision,
  HierarchyNode,
  DetailMap,
  ICD11Bundle,
  ChordData,
  CrossRef,
  CrossRefKind,
} from './types';

interface ICD10Data {
  chapters: Chapter[];
  sections: Awaited<ReturnType<typeof loadICD10Data>>['sections'];
  diagnoses: Awaited<ReturnType<typeof loadICD10Data>>['diagnoses'];
  details: DetailMap;
}

// State
let currentLayout: LayoutType = 'tree';
let currentRevision: Revision = 'icd10';
let currentChapterFilter = 'all';
let containerRef: HTMLElement | null = null;
let icd10: ICD10Data | null = null;
let icd11: ICD11Bundle | null = null;
let icd11Details: DetailMap | null = null;
let icd11Chord: ChordData | null = null;

/**
 * Mirror the active layout as a body class so layout-dependent UI
 * (like the detail panel's left/right docking) can react via CSS.
 */
function applyLayoutClass(layout: LayoutType): void {
  const body = document.body;
  body.classList.remove('layout-tree', 'layout-cluster', 'layout-radial', 'layout-graph');
  body.classList.add(`layout-${layout}`);

  // Cross-ref legend is only meaningful in the force-graph layout.
  const xrefLegend = document.getElementById('xref-legend');
  if (xrefLegend) xrefLegend.hidden = layout !== 'graph';
}

async function init(): Promise<void> {
  const container = document.getElementById('visualization');
  const loading = document.getElementById('loading');
  if (!container || !loading) {
    console.error('Required DOM elements not found');
    return;
  }
  containerRef = container;

  try {
    const data = await loadICD10Data();
    icd10 = data;
    loading.classList.add('hidden');

    populateChapterFilter(icd10ChapterOptions(data.chapters));
    initVisualization(container);

    const hierarchy = buildHierarchy(
      data.chapters,
      data.sections,
      data.diagnoses,
      currentChapterFilter,
    );

    initDetailPanel(data.details, hierarchy);
    applyLayoutClass(currentLayout);
    renderVisualization(hierarchy, currentLayout, container);
    setupEventListeners();
  } catch (error) {
    console.error('Failed to load ICD-10 data:', error);
    loading.textContent = 'Failed to load data. Please refresh the page.';
  }
}

function populateChapterFilter(items: { name: string; description: string }[]): void {
  const select = document.getElementById('chapter-filter') as HTMLSelectElement | null;
  if (!select) return;
  // Keep the "all" option, replace the rest.
  select.innerHTML = '<option value="all">All Chapters</option>';
  for (const item of items) {
    const option = document.createElement('option');
    option.value = item.name;
    option.textContent = item.description;
    select.appendChild(option);
  }
  select.value = 'all';
}

/** ICD-10 chapters (a Chapter[]) mapped to the filter-option shape. */
function icd10ChapterOptions(chapters: Chapter[]): { name: string; description: string }[] {
  return chapters.map((c) => ({
    name: c.chapter_name,
    description: `Ch ${c.chapter_name}: ${c.description.slice(0, 44)}…`,
  }));
}

/** ICD-11 chapters mapped to the filter-option shape. */
function icd11ChapterOptions(bundle: ICD11Bundle): { name: string; description: string }[] {
  const root = bundle.entities[bundle.rootId];
  if (!root) return [];
  return root.children
    .map((id) => {
      const e = bundle.entities[id];
      if (!e) return null;
      const chapterCode = e.code ?? '';
      const label = chapterCode ? `Ch ${chapterCode}: ${e.title}` : e.title;
      return { name: id, description: label };
    })
    .filter((v): v is { name: string; description: string } => v !== null);
}

function currentHierarchy(): HierarchyNode | null {
  if (currentRevision === 'icd10') {
    if (!icd10) return null;
    return buildHierarchy(
      icd10.chapters,
      icd10.sections,
      icd10.diagnoses,
      currentChapterFilter,
    );
  }
  if (!icd11) return null;
  return buildICD11Hierarchy(icd11, currentChapterFilter);
}

function rerender(): void {
  if (!containerRef) return;
  const hierarchy = currentHierarchy();
  if (!hierarchy) return;
  refreshIndex(hierarchy);
  closeDetailPanel();
  applyLayoutClass(currentLayout);
  renderVisualization(hierarchy, currentLayout, containerRef);
}

/** Switch the active revision. Lazy-loads ICD-11 on first switch. */
async function switchRevision(revision: Revision): Promise<void> {
  if (revision === currentRevision) return;
  currentRevision = revision;
  currentChapterFilter = 'all';

  document.querySelectorAll<HTMLButtonElement>('.rev-btn').forEach((btn) => {
    const active = btn.dataset.revision === revision;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  const titleEl = document.getElementById('app-title');
  if (titleEl) {
    titleEl.textContent = revision === 'icd11'
      ? 'ICD-11 Classification Network'
      : 'ICD-10 Classification Network';
  }

  if (revision === 'icd11' && !icd11) {
    setRevisionButtonsDisabled(true);
    try {
      const bundle = await loadICD11Bundle();
      icd11 = bundle;
      icd11Details = buildICD11Details(bundle);
      icd11Chord = buildICD11ChordData(bundle);
    } finally {
      setRevisionButtonsDisabled(false);
    }
  }

  // Populate chapter filter + detail panel data for the active revision.
  // Also install the ICD-11 expander so focus-zoom can drill deeper
  // than the default depth cap; in ICD-10 mode there's no expander.
  if (revision === 'icd11' && icd11 && icd11Details) {
    populateChapterFilter(icd11ChapterOptions(icd11));
    const hierarchy = buildICD11Hierarchy(icd11, 'all');
    initDetailPanel(icd11Details, hierarchy);
    setHierarchyExpander((nodeId) => {
      if (!icd11) return null;
      const entity = icd11.entities[nodeId];
      if (!entity || !entity.children.length) return null;
      return buildICD11Hierarchy(icd11, currentChapterFilter, { expandId: nodeId });
    });
    setCrossRefProvider(icd11CrossRefProvider);
    setChordDataProvider(() => icd11Chord);
    setFullHierarchyProvider(() => {
      if (!icd11) return null;
      // Full tree, no depth cap — used by sugiyama's drill-down.
      return buildICD11Hierarchy(icd11, currentChapterFilter, {
        maxDepth: 99,
      });
    });
  } else if (icd10) {
    populateChapterFilter(icd10ChapterOptions(icd10.chapters));
    const hierarchy = buildHierarchy(
      icd10.chapters,
      icd10.sections,
      icd10.diagnoses,
      'all',
    );
    initDetailPanel(icd10.details, hierarchy);
    setHierarchyExpander(null);
    setCrossRefProvider(null);
    setChordDataProvider(null);
    setFullHierarchyProvider(() => hierarchy);
  }

  rerender();
}

/**
 * Aggregate the ICD-11 entity's polyhierarchy-style references into
 * the uniform { targetId, kind } shape consumed by the force-graph.
 */
function icd11CrossRefProvider(nodeId: string): CrossRef[] {
  if (!icd11) return [];
  const e = icd11.entities[nodeId];
  if (!e) return [];
  const out: CrossRef[] = [];
  const add = (ids: string[], kind: CrossRefKind) => {
    for (const id of ids) out.push({ targetId: id, kind });
  };
  add(e.foundationChildElsewhere, 'foundationChildElsewhere');
  add(e.exclusion, 'exclusion');
  add(e.inclusion, 'inclusion');
  add(e.relatedPerinatal, 'relatedPerinatal');
  add(e.relatedMaternal, 'relatedMaternal');
  return out;
}

function setRevisionButtonsDisabled(disabled: boolean): void {
  document.querySelectorAll<HTMLButtonElement>('.rev-btn').forEach((btn) => {
    btn.disabled = disabled;
  });
}

function setupEventListeners(): void {
  const layoutSelect = document.getElementById('layout-select') as HTMLSelectElement | null;
  layoutSelect?.addEventListener('change', (e) => {
    currentLayout = (e.target as HTMLSelectElement).value as LayoutType;
    rerender();
  });

  const chapterFilter = document.getElementById('chapter-filter') as HTMLSelectElement | null;
  chapterFilter?.addEventListener('change', (e) => {
    currentChapterFilter = (e.target as HTMLSelectElement).value;
    rerender();
  });

  const resetBtn = document.getElementById('reset-btn');
  resetBtn?.addEventListener('click', () => {
    if (!containerRef) return;
    resetZoom(containerRef, currentLayout);
  });

  document.querySelectorAll<HTMLButtonElement>('.rev-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const rev = btn.dataset.revision as Revision | undefined;
      if (!rev) return;
      void switchRevision(rev);
    });
  });

  // Replace the initial chapter-filter with the ICD-10 chapter set
  // once icd10 is loaded (it was already populated by init(), but we
  // consolidate formatting here).
  if (icd10) populateChapterFilter(icd10ChapterOptions(icd10.chapters));
}

init();
