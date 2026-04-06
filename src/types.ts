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
