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

type D3Node = d3.HierarchyPointNode<HierarchyNode>;

let svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
let g: d3.Selection<SVGGElement, unknown, null, undefined>;
let zoom: d3.ZoomBehavior<SVGSVGElement, unknown>;

// State that persists between renders so focus/reveal operations can
// find the current layout positions without re-rendering.
let currentLayout: LayoutType = 'tree';
let currentRoot: D3Node | null = null;
let currentContainer: HTMLElement | null = null;
let focusedNodeId: string | null = null;

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
    .scaleExtent([0.1, 6])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });

  svg.call(zoom);
  // We use dblclick on nodes to focus a subtree, so disable d3's default
  // "double-click to zoom" gesture that would otherwise fight ours.
  svg.on('dblclick.zoom', null);

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

  // Clear previous content and reset focus (since the tree just changed).
  g.selectAll('*').remove();
  focusedNodeId = null;
  currentLayout = layoutType;
  currentContainer = container;

  // Create hierarchy
  const root = d3.hierarchy(data);

  // Apply the selected layout; d3.tree/d3.cluster mutate nodes with x/y.
  let nodes: D3Node[];
  let links: d3.HierarchyPointLink<HierarchyNode>[];

  switch (layoutType) {
    case 'radial':
      nodes = createRadialLayout(root, width, height);
      break;
    case 'cluster':
      nodes = createClusterLayout(root, width, height);
      break;
    case 'tree':
    default:
      nodes = createTreeLayout(root, width, height);
      break;
  }
  // After layout, root is a HierarchyPointNode.
  currentRoot = nodes[0];
  links = (currentRoot as D3Node).links() as d3.HierarchyPointLink<HierarchyNode>[];

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
    .selectAll<SVGGElement, D3Node>('g')
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
    .on('click', handleClick)
    .on('dblclick', handleDoubleClick);

  // Add labels for every node. Visibility is then controlled by
  // `updateLabelVisibility` based on focus state — by default only
  // levels 0-2 are shown so the baseline view stays legible.
  const labels = nodeGroups
    .append('text')
    .attr('class', 'node-label')
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

  // Primary label. Shift up half a line when a short label exists so
  // the pair stays visually balanced around the node center.
  labels
    .append('tspan')
    .attr('class', 'label-primary')
    .attr('x', function () {
      return (this.parentNode as SVGTextElement).getAttribute('x');
    })
    .attr('dy', d => (d.data.shortLabel ? '-0.25em' : '0.31em'))
    .text(d => d.data.name);

  // Secondary short label.
  labels
    .filter(d => !!d.data.shortLabel)
    .append('tspan')
    .attr('class', 'label-secondary')
    .attr('x', function () {
      return (this.parentNode as SVGTextElement).getAttribute('x');
    })
    .attr('dy', '1.1em')
    .text(d => d.data.shortLabel ?? '');

  updateLabelVisibility();

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
 * Handle double-click event - zoom to the node's subtree and reveal
 * labels for the node and its direct children.
 */
function handleDoubleClick(
  event: MouseEvent,
  d: D3Node
): void {
  event.stopPropagation();
  event.preventDefault();
  focusOnNode(d.data.id);
}

/**
 * Zoom to fit a node's subtree and reveal labels for that node and
 * its direct children (so the user can read where they are and what
 * codes are reachable from here).
 */
function focusOnNode(nodeId: string): void {
  if (!currentRoot || !currentContainer) return;
  const focus = findNodeById(nodeId);
  if (!focus) return;

  focusedNodeId = nodeId;
  updateLabelVisibility();

  // Collect screen-space positions (pre-zoom) of the focus and every
  // descendant, so we can fit a bounding box to the viewport.
  const xs: number[] = [];
  const ys: number[] = [];
  focus.each((d) => {
    const [sx, sy] = layoutToScreen(d as D3Node);
    xs.push(sx);
    ys.push(sy);
  });

  // Pad so labels aren't flush against the viewport edges. The x axis
  // (horizontal in screen space) gets more padding to accommodate the
  // long sibling labels that extend leftward.
  const padX = 180;
  const padY = 60;
  const minX = Math.min(...xs) - padX;
  const maxX = Math.max(...xs) + padX;
  const minY = Math.min(...ys) - padY;
  const maxY = Math.max(...ys) + padY;

  const w = currentContainer.clientWidth;
  const h = currentContainer.clientHeight;
  const boxW = Math.max(1, maxX - minX);
  const boxH = Math.max(1, maxY - minY);

  // Cap zoom-in so single leaves don't blow up to absurd sizes.
  const scale = Math.min(w / boxW, h / boxH, 3.5);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const t = d3.zoomIdentity
    .translate(w / 2 - cx * scale, h / 2 - cy * scale)
    .scale(scale);

  svg.transition().duration(750).call(zoom.transform, t);
}

/**
 * Show labels for the focused node + its ancestors + its direct
 * children. When nothing is focused, show labels for levels 0-2.
 */
function updateLabelVisibility(): void {
  if (!currentRoot) return;
  const visible = new Set<string>();

  if (focusedNodeId === null) {
    currentRoot.each((d) => {
      if (d.data.level <= 2) visible.add(d.data.id);
    });
  } else {
    const focus = findNodeById(focusedNodeId);
    if (focus) {
      // Ancestors (including the focus itself) so the user keeps context.
      let n: d3.HierarchyNode<HierarchyNode> | null = focus;
      while (n) {
        visible.add(n.data.id);
        n = n.parent;
      }
      // Direct children.
      for (const c of focus.children ?? []) {
        visible.add(c.data.id);
      }
    }
  }

  g.selectAll<SVGTextElement, D3Node>('.node-label')
    .style('display', (d) => (visible.has(d.data.id) ? null : 'none'));
}

function findNodeById(id: string): D3Node | null {
  if (!currentRoot) return null;
  let found: D3Node | null = null;
  currentRoot.each((d) => {
    if (d.data.id === id) found = d as D3Node;
  });
  return found;
}

/**
 * Convert a node's layout coordinates to the pre-zoom screen
 * coordinates used by the zoom transform. For the horizontal tree
 * layouts d3 stores cross-axis in `x` and depth in `y`, so we transpose.
 * For the radial layout `x` is an angle (rad) and `y` is a radius.
 */
function layoutToScreen(d: D3Node): [number, number] {
  if (currentLayout === 'radial') {
    const angle = d.x - Math.PI / 2;
    return [d.y * Math.cos(angle), d.y * Math.sin(angle)];
  }
  return [d.y, d.x];
}

/**
 * Reset the zoom to initial state and clear any focus.
 */
export function resetZoom(container: HTMLElement, layoutType: LayoutType): void {
  focusedNodeId = null;
  updateLabelVisibility();
  centerVisualization(container.clientWidth, container.clientHeight, layoutType);
}
