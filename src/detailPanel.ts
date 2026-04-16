/**
 * Detail panel: opens when a node is clicked, shows the rich CMS detail
 * data (description, hierarchical path, inclusion/exclusion notes,
 * children) for any chapter, section, or diagnosis.
 */

import type { DetailEntry, DetailMap, HierarchyNode } from './types';

interface PanelContext {
  details: DetailMap;
  /** Map from node id to the HierarchyNode (for fast child/sibling lookup). */
  nodeIndex: Map<string, HierarchyNode>;
}

let ctx: PanelContext | null = null;

const KIND_LABEL: Record<DetailEntry['kind'] | 'root', string> = {
  chapter: 'Chapter',
  section: 'Section',
  diag: 'Diagnosis Code',
  icd11: 'ICD-11 Entity',
  root: 'Classification',
};

const CLASS_KIND_LABEL: Record<string, string> = {
  chapter: 'Chapter',
  block: 'Block',
  category: 'Category',
  grouping: 'Grouping',
  window: 'Window',
};

const REFERENCE_SECTIONS: {
  key: keyof DetailEntry;
  label: string;
  cls: string;
}[] = [
  { key: 'foundationChildElsewhere', label: 'Also grouped under', cls: 'inclusion' },
  { key: 'exclusionRefs', label: 'Exclusions', cls: 'excludes1' },
  { key: 'inclusionRefs', label: 'Inclusions', cls: 'includes' },
  { key: 'relatedPerinatal', label: 'Related in perinatal chapter', cls: '' },
  { key: 'relatedMaternal', label: 'Related in maternal chapter', cls: '' },
];

const NOTE_SECTIONS: { key: keyof DetailEntry; label: string; cls: string }[] = [
  { key: 'includes', label: 'Includes', cls: 'includes' },
  { key: 'inclusionTerms', label: 'Inclusion Terms', cls: 'inclusion' },
  { key: 'excludes1', label: 'Excludes 1 (not coded here)', cls: 'excludes1' },
  { key: 'excludes2', label: 'Excludes 2 (not included here)', cls: 'excludes2' },
  { key: 'useAdditionalCode', label: 'Use Additional Code', cls: 'code-hint' },
  { key: 'codeFirst', label: 'Code First', cls: 'code-hint' },
  { key: 'codeAlso', label: 'Code Also', cls: 'code-hint' },
  { key: 'notes', label: 'Notes', cls: '' },
  { key: 'sevenChrNote', label: '7th Character Notes', cls: '' },
];

export function initDetailPanel(details: DetailMap, root: HierarchyNode): void {
  ctx = {
    details,
    nodeIndex: indexHierarchy(root),
  };

  const closeBtn = document.getElementById('detail-close');
  closeBtn?.addEventListener('click', closeDetailPanel);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDetailPanel();
  });
}

/** Rebuild the node index when the hierarchy is re-rendered (filter change). */
export function refreshIndex(root: HierarchyNode): void {
  if (!ctx) return;
  ctx.nodeIndex = indexHierarchy(root);
}

export function showDetail(node: HierarchyNode): void {
  if (!ctx) return;
  const panel = document.getElementById('detail-panel');
  if (!panel) return;

  const detail = ctx.details[node.id];
  renderHeader(node, detail);
  renderWikiLink(node, detail);
  renderPath(node, detail);
  renderBody(node, detail);

  panel.setAttribute('aria-hidden', 'false');
  panel.scrollTop = 0;
}

export function closeDetailPanel(): void {
  const panel = document.getElementById('detail-panel');
  panel?.setAttribute('aria-hidden', 'true');
}

/**
 * Build a Wikipedia lookup URL. We use Special:Search with go=Go so
 * Wikipedia redirects straight to the article when the cleaned-up
 * description matches a title, and falls back to search results
 * otherwise. The parenthetical code range ("(A00-B99)", "(A00-A09)")
 * is stripped because it confuses the search.
 */
function wikipediaUrlFor(node: HierarchyNode, detail: DetailEntry | undefined): string {
  const raw = detail?.desc || node.description || node.name;
  const query = raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (!query) return '';
  const params = new URLSearchParams({
    search: query,
    title: 'Special:Search',
    go: 'Go',
  });
  return `https://en.wikipedia.org/w/index.php?${params.toString()}`;
}

function renderWikiLink(node: HierarchyNode, detail: DetailEntry | undefined): void {
  const link = document.getElementById('detail-wiki') as HTMLAnchorElement | null;
  if (!link) return;
  const url = wikipediaUrlFor(node, detail);
  if (!url) {
    link.style.display = 'none';
    return;
  }
  link.style.display = '';
  link.href = url;
  link.textContent = 'Look up on Wikipedia →';
}

function renderHeader(node: HierarchyNode, detail: DetailEntry | undefined): void {
  const kindEl = document.getElementById('detail-kind');
  const titleEl = document.getElementById('detail-title');
  const descEl = document.getElementById('detail-desc');

  const kind = detail?.kind ?? (node.level === 0 ? 'root' : 'diag');
  const baseLabel = KIND_LABEL[kind] ?? '';
  // For ICD-11, prefer the more specific classKind ("Block",
  // "Category") over the generic "ICD-11 Entity".
  const label = detail?.classKind
    ? (CLASS_KIND_LABEL[detail.classKind] ?? detail.classKind)
    : baseLabel;
  if (kindEl) kindEl.textContent = label;
  if (titleEl) titleEl.textContent = node.name;
  if (descEl) descEl.textContent = detail?.desc || node.description || '';
}

function renderPath(_node: HierarchyNode, detail: DetailEntry | undefined): void {
  const pathEl = document.getElementById('detail-path');
  if (!pathEl) return;
  pathEl.innerHTML = '';

  const crumbs: { code: string; desc: string }[] = [];
  if (detail?.chapter) {
    const ch = ctx?.details[`chapter_${detail.chapter}`];
    crumbs.push({
      code: `Chapter ${detail.chapter}`,
      desc: ch?.desc ?? '',
    });
  }
  if (detail?.path) {
    crumbs.push(...detail.path);
  }

  if (!crumbs.length) {
    pathEl.style.display = 'none';
    return;
  }
  pathEl.style.display = '';

  for (const c of crumbs) {
    const span = document.createElement('span');
    span.className = 'crumb';
    span.textContent = c.code;
    if (c.desc) span.title = c.desc;
    pathEl.appendChild(span);
  }
}

function renderBody(node: HierarchyNode, detail: DetailEntry | undefined): void {
  const body = document.getElementById('detail-body');
  if (!body) return;
  body.innerHTML = '';

  // ICD-11 definition paragraph, when present.
  if (detail?.definition) {
    const section = document.createElement('section');
    const h = document.createElement('h3');
    h.textContent = 'Definition';
    section.appendChild(h);
    const p = document.createElement('p');
    p.style.lineHeight = '1.5';
    p.style.color = 'rgba(255,255,255,0.88)';
    p.textContent = detail.definition;
    section.appendChild(p);
    body.appendChild(section);
  }

  // ICD-11 link to WHO's official browser.
  if (detail?.browserUrl) {
    const section = document.createElement('section');
    const a = document.createElement('a');
    a.href = detail.browserUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'detail-wiki';
    a.textContent = 'View on WHO ICD-11 Browser →';
    section.appendChild(a);
    body.appendChild(section);
  }

  // ICD-10 note sections.
  for (const { key, label, cls } of NOTE_SECTIONS) {
    const items = detail?.[key] as string[] | undefined;
    if (!items?.length) continue;
    body.appendChild(noteSection(label, items, cls));
  }

  // ICD-11 cross-reference sections (clickable into the graph).
  for (const { key, label, cls } of REFERENCE_SECTIONS) {
    const items = detail?.[key] as { id: string; title: string }[] | undefined;
    if (!items?.length) continue;
    body.appendChild(referenceSection(label, items, cls));
  }

  // 7th character extension definitions, when present.
  if (detail?.sevenChrDef?.length) {
    const section = document.createElement('section');
    const h = document.createElement('h3');
    h.textContent = '7th Character Definitions';
    section.appendChild(h);
    const ul = document.createElement('ul');
    for (const def of detail.sevenChrDef) {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${escape(def.char)}</strong> &mdash; ${escape(def.text)}`;
      ul.appendChild(li);
    }
    section.appendChild(ul);
    body.appendChild(section);
  }

  // Children list (clickable to drill in).
  const children = node.children ?? [];
  if (children.length) {
    const section = document.createElement('section');
    const h = document.createElement('h3');
    h.textContent = `${children.length} Child Code${children.length === 1 ? '' : 's'}`;
    section.appendChild(h);
    section.appendChild(childList(children));
    body.appendChild(section);
  } else if (node.level >= 3) {
    // Leaf code: show siblings for context.
    const siblings = findSiblings(node);
    if (siblings && siblings.length > 1) {
      const section = document.createElement('section');
      const h = document.createElement('h3');
      h.textContent = `Sibling Codes`;
      section.appendChild(h);
      section.appendChild(
        childList(siblings.filter((s) => s.id !== node.id))
      );
      body.appendChild(section);
    }
  }

  if (!body.childNodes.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No additional clinical detail recorded for this node.';
    body.appendChild(p);
  }
}

function noteSection(label: string, items: string[], cls: string): HTMLElement {
  const section = document.createElement('section');
  const h = document.createElement('h3');
  h.textContent = label;
  if (cls) h.classList.add(cls);
  section.appendChild(h);
  const ul = document.createElement('ul');
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    ul.appendChild(li);
  }
  section.appendChild(ul);
  return section;
}

/**
 * Render a list of ICD-11 cross-references. Items that resolve to a
 * node in the current hierarchy become clickable (drill into them);
 * others render as dim static text.
 */
function referenceSection(
  label: string,
  items: { id: string; title: string }[],
  cls: string,
): HTMLElement {
  const section = document.createElement('section');
  const h = document.createElement('h3');
  h.textContent = label;
  if (cls) h.classList.add(cls);
  section.appendChild(h);
  const ul = document.createElement('ul');
  for (const item of items) {
    const node = ctx?.nodeIndex.get(item.id);
    const li = document.createElement('li');
    if (node) {
      li.className = 'child';
      li.tabIndex = 0;
      const codeSpan = document.createElement('span');
      codeSpan.className = 'code';
      codeSpan.textContent = node.name;
      const descSpan = document.createElement('span');
      descSpan.className = 'desc';
      descSpan.textContent = item.title;
      li.appendChild(codeSpan);
      li.appendChild(descSpan);
      li.addEventListener('click', () => showDetail(node));
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          showDetail(node);
        }
      });
    } else {
      li.textContent = item.title;
      li.style.color = 'rgba(255,255,255,0.6)';
    }
    ul.appendChild(li);
  }
  section.appendChild(ul);
  return section;
}

function childList(children: HierarchyNode[]): HTMLElement {
  const ul = document.createElement('ul');
  for (const child of children) {
    const li = document.createElement('li');
    li.className = 'child';
    li.tabIndex = 0;
    const codeSpan = document.createElement('span');
    codeSpan.className = 'code';
    codeSpan.textContent = child.name;
    const descSpan = document.createElement('span');
    descSpan.className = 'desc';
    descSpan.textContent = child.description;
    li.appendChild(codeSpan);
    li.appendChild(descSpan);
    li.addEventListener('click', () => showDetail(child));
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        showDetail(child);
      }
    });
    ul.appendChild(li);
  }
  return ul;
}

function findSiblings(node: HierarchyNode): HierarchyNode[] | null {
  if (!ctx) return null;
  for (const candidate of ctx.nodeIndex.values()) {
    if (candidate.children?.some((c) => c.id === node.id)) {
      return candidate.children;
    }
  }
  return null;
}

function indexHierarchy(root: HierarchyNode): Map<string, HierarchyNode> {
  const map = new Map<string, HierarchyNode>();
  const stack: HierarchyNode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    map.set(n.id, n);
    if (n.children) stack.push(...n.children);
  }
  return map;
}

function escape(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
