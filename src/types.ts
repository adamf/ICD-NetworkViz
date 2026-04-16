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
  level: number;
  children?: HierarchyNode[];
}

export type LayoutType = 'tree' | 'radial' | 'cluster';

/**
 * Per-code clinical detail extracted from the CDC ICD-10-CM tabular XML.
 * See scripts/build-icd10-details.mjs.
 */
export interface DetailEntry {
  kind: 'chapter' | 'section' | 'diag';
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
}

export type DetailMap = Record<string, DetailEntry>;
