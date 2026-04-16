/**
 * ICD-10 Network Visualization
 * 
 * Main entry point for the TypeScript/D3.js visualization application.
 * Loads ICD-10 data from CSV files and renders interactive hierarchical visualizations.
 */

import './styles.css';
import { loadICD10Data, buildHierarchy, countNodes } from './data';
import { initVisualization, renderVisualization, resetZoom } from './visualization';
import { initDetailPanel, refreshIndex, closeDetailPanel } from './detailPanel';
import type { LayoutType, Chapter } from './types';

// State
let currentLayout: LayoutType = 'tree';
let currentChapterFilter = 'all';
let chapters: Chapter[] = [];

/**
 * Mirror the active layout as a body class so layout-dependent UI
 * (like the detail panel's left/right docking) can react via CSS.
 */
function applyLayoutClass(layout: LayoutType): void {
  const body = document.body;
  body.classList.remove('layout-tree', 'layout-cluster', 'layout-radial');
  body.classList.add(`layout-${layout}`);
}

/**
 * Initialize the application
 */
async function init(): Promise<void> {
  const container = document.getElementById('visualization');
  const loading = document.getElementById('loading');
  
  if (!container || !loading) {
    console.error('Required DOM elements not found');
    return;
  }

  try {
    // Load data
    const data = await loadICD10Data();
    chapters = data.chapters;

    // Hide loading indicator
    loading.classList.add('hidden');

    // Populate chapter filter dropdown
    populateChapterFilter(data.chapters);

    // Initialize visualization
    initVisualization(container);

    // Build hierarchy and render
    const hierarchy = buildHierarchy(
      data.chapters,
      data.sections,
      data.diagnoses,
      currentChapterFilter
    );

    // Initialize the detail panel with the lookup table + first hierarchy.
    initDetailPanel(data.details, hierarchy);

    applyLayoutClass(currentLayout);
    renderVisualization(hierarchy, currentLayout, container);

    // Update stats
    updateStats(hierarchy, data.chapters.length);

    // Set up event listeners
    setupEventListeners(container, data);

  } catch (error) {
    console.error('Failed to load ICD-10 data:', error);
    loading.textContent = 'Failed to load data. Please refresh the page.';
  }
}

/**
 * Populate the chapter filter dropdown
 */
function populateChapterFilter(chapterList: Chapter[]): void {
  const select = document.getElementById('chapter-filter') as HTMLSelectElement;
  if (!select) return;

  for (const chapter of chapterList) {
    const option = document.createElement('option');
    option.value = chapter.chapter_name;
    option.textContent = `Ch ${chapter.chapter_name}: ${chapter.description.slice(0, 40)}...`;
    select.appendChild(option);
  }
}

/**
 * Update the statistics display
 */
function updateStats(hierarchy: ReturnType<typeof buildHierarchy>, chapterCount: number): void {
  const nodeCountEl = document.getElementById('node-count');
  const chapterCountEl = document.getElementById('chapter-count');

  if (nodeCountEl) {
    nodeCountEl.textContent = countNodes(hierarchy).toString();
  }
  if (chapterCountEl) {
    chapterCountEl.textContent = chapterCount.toString();
  }
}

/**
 * Set up event listeners for controls
 */
function setupEventListeners(
  container: HTMLElement,
  data: Awaited<ReturnType<typeof loadICD10Data>>
): void {
  // Layout selector
  const layoutSelect = document.getElementById('layout-select') as HTMLSelectElement;
  if (layoutSelect) {
    layoutSelect.addEventListener('change', (e) => {
      currentLayout = (e.target as HTMLSelectElement).value as LayoutType;
      const hierarchy = buildHierarchy(
        data.chapters,
        data.sections,
        data.diagnoses,
        currentChapterFilter
      );
      refreshIndex(hierarchy);
      closeDetailPanel();
      applyLayoutClass(currentLayout);
      renderVisualization(hierarchy, currentLayout, container);
    });
  }

  // Chapter filter
  const chapterFilter = document.getElementById('chapter-filter') as HTMLSelectElement;
  if (chapterFilter) {
    chapterFilter.addEventListener('change', (e) => {
      currentChapterFilter = (e.target as HTMLSelectElement).value;
      const hierarchy = buildHierarchy(
        data.chapters,
        data.sections,
        data.diagnoses,
        currentChapterFilter
      );
      refreshIndex(hierarchy);
      closeDetailPanel();
      renderVisualization(hierarchy, currentLayout, container);
      updateStats(hierarchy, currentChapterFilter === 'all' ? chapters.length : 1);
    });
  }

  // Reset button
  const resetBtn = document.getElementById('reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetZoom(container, currentLayout);
    });
  }
}

// Start the application
init();
