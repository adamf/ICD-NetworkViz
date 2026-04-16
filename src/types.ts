/**
 * Type definitions for ICD-10 data structures
 */

export interface Chapter {
  chapter_name: string;
  description: string;
}

export interface Section {
  section_name: string;
  chapter_name: string;
  description: string;
}

export interface Diagnosis {
  diagnosis_name: string;
  section_name: string;
  chapter_name: string;
  xref_type: string;
  text: string;
  refers_to: string;
}

export interface HierarchyNode {
  id: string;
  name: string;
  description: string;
  /** Short (2-4 word) secondary label rendered beneath `name` in the viz. */
  shortLabel?: string;
  level: number;
  children?: HierarchyNode[];
}

export type LayoutType = 'tree' | 'radial' | 'cluster';

export type Revision = 'icd10' | 'icd11';

/**
 * ICD-11 data shape as written by scripts/build-icd11.mjs. One
 * bundle object is served as data/icd11.json.
 */
export interface ICD11Entity {
  code: string | null;
  title: string;
  definition: string | null;
  classKind: string | null;
  parents: string[];
  children: string[];
  /** Cross-reference edges that make ICD-11 a polyhierarchy. */
  foundationChildElsewhere: string[];
  exclusion: string[];
  inclusion: string[];
  relatedPerinatal: string[];
  relatedMaternal: string[];
  browserUrl: string | null;
}

export interface ICD11Bundle {
  release: string;
  rootId: string;
  entities: Record<string, ICD11Entity>;
}

/**
 * Per-code clinical detail extracted from the CDC ICD-10-CM tabular
 * XML, or generated from an ICD-11 bundle entry.
 *
 * Fields are optional because the two sources populate overlapping
 * but non-identical subsets.
 */
export interface DetailEntry {
  kind: 'chapter' | 'section' | 'diag' | 'icd11';
  code: string;
  desc: string;
  chapter?: string;
  section?: string;
  /** Ancestors from section down to (but not including) this code. */
  path?: { code: string; desc: string }[];
  includes?: string[];
  inclusionTerms?: string[];
  excludes1?: string[];
  excludes2?: string[];
  useAdditionalCode?: string[];
  codeFirst?: string[];
  codeAlso?: string[];
  notes?: string[];
  sevenChrNote?: string[];
  sevenChrDef?: { char: string; text: string }[];
  // ICD-11-specific fields.
  /** Natural-language definition from WHO. */
  definition?: string;
  /** "chapter" | "block" | "category" | "grouping". */
  classKind?: string;
  /** https://icd.who.int/browse/... link for this entity. */
  browserUrl?: string;
  /** Cross-reference edges: list of entity ids with their titles. */
  foundationChildElsewhere?: { id: string; title: string }[];
  exclusionRefs?: { id: string; title: string }[];
  inclusionRefs?: { id: string; title: string }[];
  relatedPerinatal?: { id: string; title: string }[];
  relatedMaternal?: { id: string; title: string }[];
}

export type DetailMap = Record<string, DetailEntry>;
