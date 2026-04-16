/**
 * Data loading utilities for ICD-10 CSV files
 */

import * as d3 from 'd3';
import type {
  Chapter,
  Section,
  Diagnosis,
  HierarchyNode,
  DetailMap,
  ICD11Bundle,
  ChordData,
} from './types';

/**
 * Curated 2-3 word labels for each ICD-10-CM chapter. Shown beneath the
 * "Chapter N" primary label so users can see what each chapter covers
 * without needing to hover.
 */
const CHAPTER_SHORT_LABELS: Record<string, string> = {
  '1': 'Infectious diseases',
  '2': 'Neoplasms',
  '3': 'Blood disorders',
  '4': 'Endocrine & metabolic',
  '5': 'Mental & behavioral',
  '6': 'Nervous system',
  '7': 'Eye & adnexa',
  '8': 'Ear & mastoid',
  '9': 'Circulatory system',
  '10': 'Respiratory system',
  '11': 'Digestive system',
  '12': 'Skin & subcutaneous',
  '13': 'Musculoskeletal',
  '14': 'Genitourinary',
  '15': 'Pregnancy & childbirth',
  '16': 'Perinatal conditions',
  '17': 'Congenital malformations',
  '18': 'Symptoms & signs',
  '19': 'Injury & poisoning',
  '20': 'External causes',
  '21': 'Health factors',
};

/**
 * Trim a description to a short label on a word boundary so it fits
 * beside a node in the visualization. `max` differs by level: section
 * subtitles sit under chapter headers in the compact overview and
 * need to stay short, but root-code / specific-code subtitles only
 * appear when the user has zoomed in, so they can run longer.
 */
function shorten(desc: string, max: number): string {
  const cleaned = desc.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 10 ? cut.slice(0, lastSpace) : cut) + '…';
}

/**
 * Load all ICD-10 data from CSV + JSON files
 */
export async function loadICD10Data(): Promise<{
  chapters: Chapter[];
  sections: Section[];
  diagnoses: Diagnosis[];
  details: DetailMap;
}> {
  const [chapters, sections, diagnoses, details] = await Promise.all([
    d3.csv('chapters.csv') as Promise<Chapter[]>,
    d3.csv('sections.csv') as Promise<Section[]>,
    d3.csv('diagnoses.csv') as Promise<Diagnosis[]>,
    d3.json<DetailMap>('icd10_details.json').then((d) => d ?? {})
  ]);

  return { chapters, sections, diagnoses, details };
}

/**
 * Build hierarchical data structure for D3 visualization
 */
export function buildHierarchy(
  chapters: Chapter[],
  sections: Section[],
  diagnoses: Diagnosis[],
  chapterFilter: string = 'all'
): HierarchyNode {
  // Filter diagnoses to only DESC types
  const descDiagnoses = diagnoses.filter(d => d.xref_type === 'DESC');
  
  // Filter chapters if needed
  const filteredChapters = chapterFilter === 'all' 
    ? chapters 
    : chapters.filter(c => c.chapter_name === chapterFilter);
  
  // Build the hierarchy
  const root: HierarchyNode = {
    id: 'ICD-10',
    name: 'ICD-10',
    description: 'International Classification of Diseases, 10th Revision',
    shortLabel: 'Classification of Diseases',
    level: 0,
    children: []
  };

  for (const chapter of filteredChapters) {
    const chapterNode: HierarchyNode = {
      id: `chapter_${chapter.chapter_name}`,
      name: `Chapter ${chapter.chapter_name}`,
      description: chapter.description,
      shortLabel: CHAPTER_SHORT_LABELS[chapter.chapter_name],
      level: 1,
      children: []
    };

    // Get sections for this chapter
    const chapterSections = sections.filter(s => s.chapter_name === chapter.chapter_name);
    
    for (const section of chapterSections) {
      const sectionNode: HierarchyNode = {
        id: section.section_name,
        name: section.section_name,
        description: section.description,
        shortLabel: shorten(section.description, 28),
        level: 2,
        children: []
      };

      // Get diagnoses for this section
      const sectionDiagnoses = descDiagnoses.filter(d => d.section_name === section.section_name);
      
      // Group by root diagnosis code (before the dot)
      const rootCodes = new Map<string, Diagnosis[]>();
      
      for (const diag of sectionDiagnoses) {
        const rootCode = diag.diagnosis_name.split('.')[0];
        if (!rootCodes.has(rootCode)) {
          rootCodes.set(rootCode, []);
        }
        rootCodes.get(rootCode)!.push(diag);
      }

      // Add root codes as children of section
      for (const [rootCode, diagList] of rootCodes) {
        const rootDiag = diagList.find(d => d.diagnosis_name === rootCode);
        const rootDesc = rootDiag?.text || rootCode;
        const rootNode: HierarchyNode = {
          id: rootCode,
          name: rootCode,
          description: rootDesc,
          shortLabel: shorten(rootDesc, 48),
          level: 3,
          children: []
        };

        // Add specific codes as children of root code
        for (const diag of diagList) {
          if (diag.diagnosis_name !== rootCode) {
            rootNode.children!.push({
              id: diag.diagnosis_name,
              name: diag.diagnosis_name,
              description: diag.text,
              shortLabel: shorten(diag.text, 48),
              level: 4
            });
          }
        }

        // Only add if has children or is a root code
        if (rootNode.children!.length > 0 || rootDiag) {
          sectionNode.children!.push(rootNode);
        }
      }

      // Only add section if it has children
      if (sectionNode.children!.length > 0) {
        chapterNode.children!.push(sectionNode);
      }
    }

    // Only add chapter if it has children
    if (chapterNode.children!.length > 0) {
      root.children!.push(chapterNode);
    }
  }

  return root;
}

/**
 * Count total nodes in hierarchy
 */
export function countNodes(node: HierarchyNode): number {
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countNodes(child);
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// ICD-11
// ---------------------------------------------------------------------------

/** Lazy-load the ICD-11 bundle (fetched only when the user switches to it). */
export async function loadICD11Bundle(): Promise<ICD11Bundle> {
  const bundle = await d3.json<ICD11Bundle>('icd11.json');
  if (!bundle) throw new Error('Failed to load icd11.json');
  return bundle;
}

/**
 * Default depth cap when building the ICD-11 hierarchy. The full tree
 * has ~36k nodes across 11 levels — rendering all of them as SVG
 * bogs the browser down. At depth 2 we render root + chapters +
 * blocks (~353 nodes), which gives a clean overview comparable to
 * ICD-10's root+chapters+sections. Double-clicking drills deeper by
 * rebuilding the hierarchy with `expandId` set to the clicked node
 * (see the `opts.expandId` branch below).
 */
const ICD11_DEFAULT_MAX_DEPTH = 2;

/**
 * How many levels to unfold below the expand target on focus. One
 * level is enough: a double-click on a chapter reveals its blocks
 * (not blocks + categories). Users drill further by double-clicking
 * again.
 */
const ICD11_EXPAND_EXTRA_DEPTH = 1;

/**
 * Build a HierarchyNode tree from an ICD-11 bundle. Uses the MMS
 * linearization's `children[]` arrays as the primary parent-child
 * relation. Cross-reference edges (foundationChildElsewhere etc.)
 * are not part of the tree — they're surfaced in the detail panel
 * and the force-graph layout instead.
 *
 * `chapterFilter` is either 'all' or a specific chapter entity id.
 * `opts.expandId`, when set, allows the subtree rooted at that
 * entity to extend beyond the depth cap (used when the user focuses
 * on a node and wants to see its descendants).
 */
export function buildICD11Hierarchy(
  bundle: ICD11Bundle,
  chapterFilter: string = 'all',
  opts: {
    maxDepth?: number;
    expandId?: string;
    expandExtraDepth?: number;
  } = {},
): HierarchyNode {
  const rootEntity = bundle.entities[bundle.rootId];
  if (!rootEntity) {
    throw new Error(`Root entity ${bundle.rootId} not found in ICD-11 bundle`);
  }

  const maxDepth = opts.maxDepth ?? ICD11_DEFAULT_MAX_DEPTH;
  const expandId = opts.expandId;
  const expandExtraDepth = opts.expandExtraDepth ?? ICD11_EXPAND_EXTRA_DEPTH;

  // Precompute the path from root down to expandId via each entity's
  // primary parent. We need this so that when the expand target lives
  // deeper than maxDepth, we can still descend to it along one narrow
  // path (rather than rendering every branch at every level).
  const expandPath = new Set<string>();
  if (expandId && bundle.entities[expandId]) {
    let cur: string | undefined = expandId;
    const safety = 50;
    for (let i = 0; cur && i < safety; i++) {
      expandPath.add(cur);
      if (cur === bundle.rootId) break;
      cur = bundle.entities[cur]?.parents?.[0];
    }
  }

  /**
   * `expansionLeft` is the number of levels we're still allowed to
   * descend into the expanded subtree. It becomes `expandExtraDepth`
   * at the expand target, and decrements as we descend from there.
   * Zero means "can't descend based on expansion" — but the normal
   * maxDepth and on-path rules may still allow descent.
   */
  const walk = (
    id: string,
    level: number,
    ancestors: Set<string>,
    expansionLeft: number,
  ): HierarchyNode | null => {
    if (ancestors.has(id)) return null; // polyhierarchy cycle guard
    const e = bundle.entities[id];
    if (!e) return null;

    const name = e.code || e.title.slice(0, 18);
    const node: HierarchyNode = {
      id,
      name,
      description: e.title || id,
      shortLabel: shortenIcd11(e.title, level),
      level,
    };

    const isExpandTarget = id === expandId;
    const isOnPath = expandPath.has(id);
    const withinCap = level < maxDepth;
    const hasExpansion = expansionLeft > 0;

    // Decide whether to descend, and how.
    //
    //  - within maxDepth: include all children (normal tree walk)
    //  - at expand target (even beyond maxDepth): fan out and start
    //    the expansion countdown
    //  - already within an expanded subtree with budget left: fan out
    //  - on the path to the expand target but past maxDepth: descend
    //    only the single path child, so we don't spray branches above
    //    the expand point.
    const shouldDescend = withinCap || isExpandTarget || hasExpansion || isOnPath;
    if (shouldDescend) {
      const pathOnly = isOnPath && !isExpandTarget && !withinCap && !hasExpansion;
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(id);
      const childExpansionLeft = isExpandTarget
        ? expandExtraDepth
        : hasExpansion
          ? expansionLeft - 1
          : 0;
      const children: HierarchyNode[] = [];
      for (const cid of e.children) {
        if (pathOnly && !expandPath.has(cid)) continue;
        const child = walk(cid, level + 1, nextAncestors, childExpansionLeft);
        if (child) children.push(child);
      }
      if (children.length) node.children = children;
    }
    return node;
  };

  const root: HierarchyNode = {
    id: bundle.rootId,
    name: 'ICD-11',
    description: rootEntity.title || 'International Classification of Diseases, 11th Revision',
    shortLabel: 'Mortality & Morbidity Statistics',
    level: 0,
    children: [],
  };

  for (const chapterId of rootEntity.children) {
    if (chapterFilter !== 'all' && chapterId !== chapterFilter) continue;
    const subtree = walk(chapterId, 1, new Set([bundle.rootId]), 0);
    if (subtree) root.children!.push(subtree);
  }

  return root;
}

function shortenIcd11(title: string, level: number): string | undefined {
  if (!title) return undefined;
  // Chapters: keep the full title so the overview is readable.
  const max = level <= 1 ? 36 : level === 2 ? 32 : 44;
  return shorten(title, max);
}

/**
 * Aggregate ICD-11 cross-references by chapter for a chord diagram.
 * Walks every entity's primary linearization parent chain up to a
 * chapter, then bins each cross-reference edge into a matrix cell.
 */
export function buildICD11ChordData(bundle: ICD11Bundle): ChordData {
  const rootChildren = bundle.entities[bundle.rootId]?.children ?? [];
  const chapters = rootChildren
    .map((id) => {
      const e = bundle.entities[id];
      if (!e) return null;
      return { id, code: e.code ?? '', title: e.title ?? '' };
    })
    .filter((c): c is { id: string; code: string; title: string } => c !== null);

  const chapterIdxById = new Map<string, number>();
  chapters.forEach((c, i) => chapterIdxById.set(c.id, i));

  // Tag every entity with the index of its chapter (via primary parents).
  const chapterOf = new Map<string, number>();
  for (let i = 0; i < chapters.length; i++) {
    const stack = [chapters[i].id];
    while (stack.length) {
      const id = stack.pop()!;
      if (chapterOf.has(id)) continue;
      chapterOf.set(id, i);
      const e = bundle.entities[id];
      if (e) for (const c of e.children) stack.push(c);
    }
  }

  const n = chapters.length;
  const matrix: number[][] = Array.from({ length: n }, () =>
    new Array<number>(n).fill(0),
  );

  const kinds: (keyof ICD11Bundle['entities'][string])[] = [
    'foundationChildElsewhere',
    'exclusion',
    'inclusion',
    'relatedPerinatal',
    'relatedMaternal',
  ];

  for (const [id, ent] of Object.entries(bundle.entities)) {
    const src = chapterOf.get(id);
    if (src === undefined) continue;
    for (const k of kinds) {
      const refs = (ent as unknown as Record<string, unknown>)[k];
      if (!Array.isArray(refs)) continue;
      for (const tgtId of refs as string[]) {
        const tgt = chapterOf.get(tgtId);
        if (tgt === undefined || tgt === src) continue;
        matrix[src][tgt] += 1;
      }
    }
  }

  return { chapters, matrix };
}

/**
 * Build a DetailMap from an ICD-11 bundle so the detail panel can
 * lookup entries the same way it does for ICD-10. Cross-reference
 * ids are resolved to { id, title } pairs so the panel can render
 * them as clickable links into the graph.
 */
export function buildICD11Details(bundle: ICD11Bundle): DetailMap {
  const out: DetailMap = {};
  const titleOf = (id: string): string =>
    bundle.entities[id]?.title ?? id;

  for (const [id, e] of Object.entries(bundle.entities)) {
    const refs = (ids: string[]) => ids.map((ref) => ({ id: ref, title: titleOf(ref) }));
    out[id] = {
      kind: 'icd11',
      code: e.code ?? '',
      desc: e.title,
      definition: e.definition ?? undefined,
      classKind: e.classKind ?? undefined,
      browserUrl: e.browserUrl ?? undefined,
      foundationChildElsewhere: refs(e.foundationChildElsewhere),
      exclusionRefs: refs(e.exclusion),
      inclusionRefs: refs(e.inclusion),
      relatedPerinatal: refs(e.relatedPerinatal),
      relatedMaternal: refs(e.relatedMaternal),
    };
  }
  return out;
}
