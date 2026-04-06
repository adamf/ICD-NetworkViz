/**
 * Data loading utilities for ICD-10 CSV files
 */

import * as d3 from 'd3';
import type { Chapter, Section, Diagnosis, HierarchyNode } from './types';

/**
 * Load all ICD-10 data from CSV files
 */
export async function loadICD10Data(): Promise<{
  chapters: Chapter[];
  sections: Section[];
  diagnoses: Diagnosis[];
}> {
  const [chapters, sections, diagnoses] = await Promise.all([
    d3.csv('chapters.csv') as Promise<Chapter[]>,
    d3.csv('sections.csv') as Promise<Section[]>,
    d3.csv('diagnoses.csv') as Promise<Diagnosis[]>
  ]);

  return { chapters, sections, diagnoses };
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
    level: 0,
    children: []
  };

  for (const chapter of filteredChapters) {
    const chapterNode: HierarchyNode = {
      id: `chapter_${chapter.chapter_name}`,
      name: `Chapter ${chapter.chapter_name}`,
      description: chapter.description,
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
        const rootNode: HierarchyNode = {
          id: rootCode,
          name: rootCode,
          description: rootDiag?.text || rootCode,
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
