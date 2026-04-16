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

// "compact" packs the whole tree into the viewport (overview mode).
// "spacious" gives each sibling a fixed 16px of layout room so leaves
// get enough vertical space for labels — used when a node is focused.
type LayoutMode = 'compact' | 'spacious';

// Spacious-mode sibling spacing. A label pair (primary name + short
// description on a second line) is ~22 layout units tall at our font
// sizes, so DY must exceed that to keep labels from touching.
const SPACIOUS_DY = 30;
const SPACIOUS_DX = 260;

let svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
let g: d3.Selection<SVGGElement, unknown, null, undefined>;
let zoom: d3.ZoomBehavior<SVGSVGElement, unknown>;

// Persisted state so focus/reset can re-render without the caller
// needing to thread the data/layout/container through again.
let currentLayout: LayoutType = 'tree';
let currentData: HierarchyNode | null = null;
let currentRoot: D3Node | null = null;
let currentContainer: HTMLElement | null = null;
let currentMode: LayoutMode = 'compact';
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
 * Render the visualization with the given data and layout. Public
 * entry point called from main.ts on layout/filter changes; always
 * starts in compact mode with no focus.
 */
export function renderVisualization(
  data: HierarchyNode,
  layoutType: LayoutType,
  container: HTMLElement
): void {
  currentData = data;
  currentLayout = layoutType;
  currentContainer = container;
  focusedNodeId = null;
  renderInternal('compact');
  centerOnOverview();
}

/**
 * Rebuild the SVG using the current data/layout/mode. Does not
 * transition the zoom — callers control that separately so the
 * transition can target either the overview or a focused subtree.
 */
function renderInternal(mode: LayoutMode): void {
  if (!currentData || !currentContainer) return;
  const width = currentContainer.clientWidth;
  const height = currentContainer.clientHeight;
  currentMode = mode;

  g.selectAll('*').remove();

  const root = d3.hierarchy(currentData);

  let nodes: D3Node[];
  switch (currentLayout) {
    case 'radial':
      nodes = createRadialLayout(root, width, height, mode);
      break;
    case 'cluster':
      nodes = createClusterLayout(root, width, height, mode);
      break;
    case 'tree':
    default:
      nodes = createTreeLayout(root, width, height, mode);
      break;
  }
  currentRoot = nodes[0];
  const links = (currentRoot as D3Node).links() as d3.HierarchyPointLink<HierarchyNode>[];

  // Draw links
  const linkGenerator = currentLayout === 'radial'
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
      if (currentLayout === 'radial') {
        return `rotate(${(d.x * 180) / Math.PI - 90}) translate(${d.y}, 0)`;
      }
      return `translate(${d.y}, ${d.x})`;
    });

  nodeGroups.append('circle')
    .attr('r', d => levelSizes[d.data.level] || 4)
    .attr('fill', d => levelColors[d.data.level] || '#607d8b')
    .attr('stroke', d => d3.color(levelColors[d.data.level] || '#607d8b')?.darker(0.5)?.toString() || '#333')
    .on('mouseover', handleMouseOver)
    .on('mouseout', handleMouseOut)
    .on('click', handleClick)
    .on('dblclick', handleDoubleClick);

  // Add labels for every node. `updateLabelVisibility` then hides
  // levels 3-4 by default so the baseline view stays legible.
  const labels = nodeGroups
    .append('text')
    .attr('class', 'node-label')
    .attr('x', d => {
      if (currentLayout === 'radial') return d.x < Math.PI ? 15 : -15;
      return d.children ? -15 : 15;
    })
    .attr('text-anchor', d => {
      if (currentLayout === 'radial') return d.x < Math.PI ? 'start' : 'end';
      return d.children ? 'end' : 'start';
    })
    .attr('transform', d => {
      if (currentLayout === 'radial' && d.x >= Math.PI) return 'rotate(180)';
      return '';
    });

  labels
    .append('tspan')
    .attr('class', 'label-primary')
    .attr('x', function () {
      return (this.parentNode as SVGTextElement).getAttribute('x');
    })
    .attr('dy', d => (d.data.shortLabel ? '-0.25em' : '0.31em'))
    .text(d => d.data.name);

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
}

/**
 * Horizontal tree layout. In compact mode we use .size() so the whole
 * tree fits into the viewport; in spacious mode we use .nodeSize() so
 * every sibling gets a fixed amount of vertical room — used when a
 * node is focused so its leaves can show readable labels.
 */
function createTreeLayout(
  root: d3.HierarchyNode<HierarchyNode>,
  width: number,
  height: number,
  mode: LayoutMode,
): D3Node[] {
  const layout = d3.tree<HierarchyNode>();
  if (mode === 'spacious') {
    layout.nodeSize([SPACIOUS_DY, SPACIOUS_DX]);
  } else {
    layout.size([height - 100, width - 200]);
  }
  return layout(root).descendants() as D3Node[];
}

function createClusterLayout(
  root: d3.HierarchyNode<HierarchyNode>,
  width: number,
  height: number,
  mode: LayoutMode,
): D3Node[] {
  const layout = d3.cluster<HierarchyNode>();
  if (mode === 'spacious') {
    layout.nodeSize([SPACIOUS_DY, SPACIOUS_DX]);
  } else {
    layout.size([height - 100, width - 200]);
  }
  return layout(root).descendants() as D3Node[];
}

/**
 * Radial tree.
 *
 * Compact mode packs the full tree into a single ring that fits the
 * viewport (used for overview). Spacious mode inflates the radius
 * ~4x and flattens the depth-based separation so leaves get enough
 * arc length for their labels when the user focuses on a leaf parent.
 * The overall ring becomes much larger than the viewport; the focus
 * fit transform zooms to just the focused subtree.
 */
function createRadialLayout(
  root: d3.HierarchyNode<HierarchyNode>,
  width: number,
  height: number,
  mode: LayoutMode,
): D3Node[] {
  const baseRadius = Math.min(width, height) / 2 - 100;
  const layout = d3.tree<HierarchyNode>();

  if (mode === 'spacious') {
    layout
      .size([2 * Math.PI, baseRadius * 4])
      .separation((a, b) => (a.parent === b.parent ? 1.5 : 3));
  } else {
    layout
      .size([2 * Math.PI, baseRadius])
      .separation((a, b) => (a.parent === b.parent ? 1 : 2) / a.depth);
  }

  return layout(root).descendants() as D3Node[];
}

function createRadialLinkGenerator() {
  return d3.linkRadial<d3.HierarchyPointLink<HierarchyNode>, d3.HierarchyPointNode<HierarchyNode>>()
    .angle(d => d.x)
    .radius(d => d.y);
}

/** Transition the viewport to the overview for the current layout. */
function centerOnOverview(): void {
  if (!currentContainer) return;
  const width = currentContainer.clientWidth;
  const height = currentContainer.clientHeight;
  let initialTransform: d3.ZoomTransform;

  if (currentLayout === 'radial') {
    initialTransform = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(0.8);
  } else {
    // In compact mode the tree fills (width-200) x (height-100) starting
    // at (0, 0); translate right so root labels aren't clipped.
    initialTransform = d3.zoomIdentity
      .translate(210, 50)
      .scale(0.9);
  }

  svg.transition()
    .duration(750)
    .call(zoom.transform, initialTransform);
}

/**
 * Compute a zoom transform that fits a set of layout-space nodes to
 * the viewport with padding. `maxScale` caps zoom-in for small sets.
 */
function fitToNodes(
  nodes: D3Node[],
  width: number,
  height: number,
  opts: { maxScale: number; padX: number; padY: number },
): d3.ZoomTransform {
  if (!nodes.length) return d3.zoomIdentity;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const d of nodes) {
    const [sx, sy] = layoutToScreen(d);
    xs.push(sx);
    ys.push(sy);
  }
  const minX = Math.min(...xs) - opts.padX;
  const maxX = Math.max(...xs) + opts.padX;
  const minY = Math.min(...ys) - opts.padY;
  const maxY = Math.max(...ys) + opts.padY;
  const boxW = Math.max(1, maxX - minX);
  const boxH = Math.max(1, maxY - minY);
  const scale = Math.min(width / boxW, height / boxH, opts.maxScale);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return d3.zoomIdentity
    .translate(width / 2 - cx * scale, height / 2 - cy * scale)
    .scale(scale);
}

function handleMouseOver(event: MouseEvent, d: D3Node): void {
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

function handleMouseOut(): void {
  const tooltip = document.getElementById('tooltip');
  if (tooltip) tooltip.classList.remove('visible');
}

// Delay opening the detail panel on single-click so a follow-up
// double-click (focus/zoom) can cancel it. Otherwise the panel pops
// up between the two clicks and can swallow the second click —
// particularly bad for nodes on the right side of the screen where
// the panel appears.
const DOUBLE_CLICK_WINDOW_MS = 260;
let pendingClick: { timer: number } | null = null;

function cancelPendingClick(): void {
  if (pendingClick) {
    window.clearTimeout(pendingClick.timer);
    pendingClick = null;
  }
}

function handleClick(event: MouseEvent, d: D3Node): void {
  event.stopPropagation();
  cancelPendingClick();
  const data = d.data;
  pendingClick = {
    timer: window.setTimeout(() => {
      pendingClick = null;
      showDetail(data);
    }, DOUBLE_CLICK_WINDOW_MS),
  };
}

function handleDoubleClick(event: MouseEvent, d: D3Node): void {
  event.stopPropagation();
  event.preventDefault();
  cancelPendingClick();

  // Only re-layout + zoom when the clicked node is a direct parent of
  // leaves (e.g. A17 -> A17.0...A17.9). For higher-up nodes the zoom
  // view sprawls and is hard to read, so skip straight to the detail
  // panel instead.
  if (isLeafParent(d)) {
    focusOnNode(d.data.id);
  } else {
    showDetail(d.data);
  }
}

function isLeafParent(d: D3Node): boolean {
  const kids = d.children ?? [];
  if (kids.length === 0) return false;
  return kids.every((c) => !c.children || c.children.length === 0);
}

/**
 * Re-render in spacious mode so leaves get room, then zoom to fit
 * the focused subtree. Ancestors stay laid out normally so the path
 * from root to focus is still intact.
 */
function focusOnNode(nodeId: string): void {
  if (!currentContainer) return;
  focusedNodeId = nodeId;

  // Re-render with spacious spacing so leaves under the focused node
  // are far enough apart for their labels to be legible.
  renderInternal('spacious');

  const focus = findNodeById(nodeId);
  if (!focus) return;
  const w = currentContainer.clientWidth;
  const h = currentContainer.clientHeight;
  const subtree = focus.descendants() as D3Node[];
  const t = fitToNodes(subtree, w, h, { maxScale: 3.5, padX: 220, padY: 60 });
  svg.transition().duration(750).call(zoom.transform, t);
}

/**
 * Visibility rule:
 * - No focus: show labels for levels 0-2 (overview).
 * - Focused: show focus + its ancestors (context) + its direct
 *   children (what you just drilled into).
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
      let n: d3.HierarchyNode<HierarchyNode> | null = focus;
      while (n) {
        visible.add(n.data.id);
        n = n.parent;
      }
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
 * Convert a node's layout coordinates to pre-zoom screen coords. For
 * the horizontal tree layouts d3 stores cross-axis in `x` and depth
 * in `y`, so we transpose. For radial, `x` is an angle and `y` is a
 * radius.
 */
function layoutToScreen(d: D3Node): [number, number] {
  if (currentLayout === 'radial') {
    const angle = d.x - Math.PI / 2;
    return [d.y * Math.cos(angle), d.y * Math.sin(angle)];
  }
  return [d.y, d.x];
}

/** Clear focus, rebuild in compact mode, return to the overview. */
export function resetZoom(container: HTMLElement, _layoutType: LayoutType): void {
  focusedNodeId = null;
  currentContainer = container;
  // Only re-render if we were in spacious mode; otherwise just re-center.
  if (currentMode !== 'compact') {
    renderInternal('compact');
  } else {
    updateLabelVisibility();
  }
  centerOnOverview();
}
