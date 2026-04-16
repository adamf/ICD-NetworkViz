/**
 * D3.js visualization module for ICD-10 hierarchy
 */

import * as d3 from 'd3';
import type { HierarchyNode, LayoutType } from './types';
import { showDetail } from './detailPanel';

// Color scheme for different levels
const levelColors: Record<number, string> = {
  0: '#e91e63',  // Root - Pink
  1: '#9c27b0',  // Chapters - Purple
  2: '#3f51b5',  // Sections - Indigo
  3: '#00bcd4',  // Root diagnoses - Cyan
  4: '#4caf50'   // Specific diagnoses - Green
};

// Size scale for different levels
const levelSizes: Record<number, number> = {
  0: 20,
  1: 12,
  2: 8,
  3: 6,
  4: 4
};

interface D3Node extends d3.HierarchyPointNode<HierarchyNode> {
  x0?: number;
  y0?: number;
}

let svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
let g: d3.Selection<SVGGElement, unknown, null, undefined>;
let zoom: d3.ZoomBehavior<SVGSVGElement, unknown>;

/**
 * Initialize the D3 visualization
 */
export function initVisualization(container: HTMLElement): void {
  const width = container.clientWidth;
  const height = container.clientHeight;

  // Clear any existing SVG
  d3.select(container).selectAll('svg').remove();

  svg = d3.select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', [0, 0, width, height]);

  g = svg.append('g');

  // Set up zoom behavior
  zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.1, 4])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });

  svg.call(zoom);

  // Handle window resize
  window.addEventListener('resize', () => {
    const newWidth = container.clientWidth;
    const newHeight = container.clientHeight;
    svg.attr('width', newWidth).attr('height', newHeight);
  });
}

/**
 * Render the visualization with the given data and layout
 */
export function renderVisualization(
  data: HierarchyNode,
  layoutType: LayoutType,
  container: HTMLElement
): void {
  const width = container.clientWidth;
  const height = container.clientHeight;

  // Clear previous content
  g.selectAll('*').remove();

  // Create hierarchy
  const root = d3.hierarchy(data);

  // Create layout based on type
  let nodes: D3Node[];
  let links: d3.HierarchyPointLink<HierarchyNode>[];

  switch (layoutType) {
    case 'radial':
      nodes = createRadialLayout(root, width, height);
      links = root.links() as d3.HierarchyPointLink<HierarchyNode>[];
      break;
    case 'cluster':
      nodes = createClusterLayout(root, width, height);
      links = root.links() as d3.HierarchyPointLink<HierarchyNode>[];
      break;
    case 'tree':
    default:
      nodes = createTreeLayout(root, width, height);
      links = root.links() as d3.HierarchyPointLink<HierarchyNode>[];
      break;
  }

  // Draw links
  const linkGenerator = layoutType === 'radial' 
    ? createRadialLinkGenerator()
    : d3.linkHorizontal<d3.HierarchyPointLink<HierarchyNode>, d3.HierarchyPointNode<HierarchyNode>>()
        .x(d => d.y)
        .y(d => d.x);

  g.append('g')
    .attr('class', 'links')
    .selectAll('path')
    .data(links)
    .join('path')
    .attr('class', 'link')
    .attr('d', linkGenerator as d3.Link<unknown, d3.HierarchyPointLink<HierarchyNode>, d3.HierarchyPointNode<HierarchyNode>>);

  // Draw nodes
  const nodeGroups = g.append('g')
    .attr('class', 'nodes')
    .selectAll('g')
    .data(nodes)
    .join('g')
    .attr('class', 'node')
    .attr('transform', d => {
      if (layoutType === 'radial') {
        return `rotate(${(d.x * 180) / Math.PI - 90}) translate(${d.y}, 0)`;
      }
      return `translate(${d.y}, ${d.x})`;
    });

  // Add circles
  nodeGroups.append('circle')
    .attr('r', d => levelSizes[d.data.level] || 4)
    .attr('fill', d => levelColors[d.data.level] || '#607d8b')
    .attr('stroke', d => d3.color(levelColors[d.data.level] || '#607d8b')?.darker(0.5)?.toString() || '#333')
    .on('mouseover', handleMouseOver)
    .on('mouseout', handleMouseOut)
    .on('click', handleClick);

  // Add labels for top-level nodes. Each label is a <text> element with
  // two <tspan>s so the primary name sits above a shorter descriptive
  // subtitle (when one exists), without needing a hover.
  const labels = nodeGroups
    .filter(d => d.data.level <= 2)
    .append('text')
    .attr('x', d => {
      if (layoutType === 'radial') {
        return d.x < Math.PI ? 15 : -15;
      }
      return d.children ? -15 : 15;
    })
    .attr('text-anchor', d => {
      if (layoutType === 'radial') {
        return d.x < Math.PI ? 'start' : 'end';
      }
      return d.children ? 'end' : 'start';
    })
    .attr('transform', d => {
      if (layoutType === 'radial' && d.x >= Math.PI) {
        return 'rotate(180)';
      }
      return '';
    });

  // Primary label (e.g. "Chapter 1"). Shift up half a line when a
  // short label is present so the pair stays visually balanced.
  labels
    .append('tspan')
    .attr('class', 'label-primary')
    .attr('x', function () {
      // Inherit x from parent <text> so both tspans align.
      return (this.parentNode as SVGTextElement).getAttribute('x');
    })
    .attr('dy', d => (d.data.shortLabel ? '-0.25em' : '0.31em'))
    .text(d => d.data.name);

  // Secondary short label (e.g. "Infectious diseases").
  labels
    .filter(d => !!d.data.shortLabel)
    .append('tspan')
    .attr('class', 'label-secondary')
    .attr('x', function () {
      return (this.parentNode as SVGTextElement).getAttribute('x');
    })
    .attr('dy', '1.1em')
    .text(d => d.data.shortLabel ?? '');

  // Center the visualization
  centerVisualization(width, height, layoutType);
}

/**
 * Create tree layout
 */
function createTreeLayout(
  root: d3.HierarchyNode<HierarchyNode>,
  width: number,
  height: number
): D3Node[] {
  const treeLayout = d3.tree<HierarchyNode>()
    .size([height - 100, width - 200]);

  return treeLayout(root).descendants() as D3Node[];
}

/**
 * Create cluster layout
 */
function createClusterLayout(
  root: d3.HierarchyNode<HierarchyNode>,
  width: number,
  height: number
): D3Node[] {
  const clusterLayout = d3.cluster<HierarchyNode>()
    .size([height - 100, width - 200]);

  return clusterLayout(root).descendants() as D3Node[];
}

/**
 * Create radial layout
 */
function createRadialLayout(
  root: d3.HierarchyNode<HierarchyNode>,
  width: number,
  height: number
): D3Node[] {
  const radius = Math.min(width, height) / 2 - 100;
  
  const treeLayout = d3.tree<HierarchyNode>()
    .size([2 * Math.PI, radius])
    .separation((a, b) => (a.parent === b.parent ? 1 : 2) / a.depth);

  return treeLayout(root).descendants() as D3Node[];
}

/**
 * Create radial link generator
 */
function createRadialLinkGenerator() {
  return d3.linkRadial<d3.HierarchyPointLink<HierarchyNode>, d3.HierarchyPointNode<HierarchyNode>>()
    .angle(d => d.x)
    .radius(d => d.y);
}

/**
 * Center the visualization in the viewport
 */
function centerVisualization(width: number, height: number, layoutType: LayoutType): void {
  let initialTransform: d3.ZoomTransform;

  if (layoutType === 'radial') {
    initialTransform = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(0.8);
  } else {
    // Root sits at screen x = 0, and its label extends leftward (text-anchor
    // "end") with a two-line subtitle that's ~150px wide at font-size 8.5.
    // Leave enough left margin so the subtitle isn't clipped.
    initialTransform = d3.zoomIdentity
      .translate(210, 50)
      .scale(0.9);
  }

  svg.transition()
    .duration(750)
    .call(zoom.transform, initialTransform);
}

/**
 * Handle mouse over event
 */
function handleMouseOver(
  event: MouseEvent,
  d: D3Node
): void {
  const tooltip = document.getElementById('tooltip');
  if (!tooltip) return;

  tooltip.innerHTML = `
    <div class="tooltip-title">${d.data.name}</div>
    <div class="tooltip-text">${d.data.description}</div>
  `;
  
  tooltip.style.left = `${event.pageX + 15}px`;
  tooltip.style.top = `${event.pageY - 10}px`;
  tooltip.classList.add('visible');
}

/**
 * Handle mouse out event
 */
function handleMouseOut(): void {
  const tooltip = document.getElementById('tooltip');
  if (tooltip) {
    tooltip.classList.remove('visible');
  }
}

/**
 * Handle click event - open the detail panel for the clicked node.
 */
function handleClick(
  event: MouseEvent,
  d: D3Node
): void {
  event.stopPropagation();
  showDetail(d.data);
}

/**
 * Reset the zoom to initial state
 */
export function resetZoom(container: HTMLElement, layoutType: LayoutType): void {
  const width = container.clientWidth;
  const height = container.clientHeight;
  centerVisualization(width, height, layoutType);
}
