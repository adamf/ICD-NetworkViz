/**
 * D3.js visualization module for ICD-10 hierarchy
 */

import * as d3 from 'd3';
import type { HierarchyNode, LayoutType, CrossRef, CrossRefKind } from './types';
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
 * Extra node ids whose labels should be forced visible on top of
 * whatever the current focus rule already reveals. Populated by
 * panToNode when the user clicks a related entry in the detail panel
 * — they want that node labeled without losing the rest of the view.
 */
let extraVisibleIds = new Set<string>();

/**
 * Optional callback that rebuilds the hierarchy so the subtree rooted
 * at `nodeId` is fully available for focus-zoom. Used by ICD-11 to
 * expand on-demand when the user drills past the default depth cap.
 * Returning null means "nothing to expand".
 */
export type HierarchyExpander = (nodeId: string) => HierarchyNode | null;
let expander: HierarchyExpander | null = null;

export function setHierarchyExpander(fn: HierarchyExpander | null): void {
  expander = fn;
}

/**
 * Optional callback providing cross-reference edges for a node in the
 * force-directed graph layout. Returns an array of { targetId, kind }
 * tuples; edges to targets not in the current hierarchy are skipped.
 */
export type CrossRefProvider = (nodeId: string) => CrossRef[];
let crossRefProvider: CrossRefProvider | null = null;

export function setCrossRefProvider(fn: CrossRefProvider | null): void {
  crossRefProvider = fn;
}

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
  extraVisibleIds = new Set();
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

  if (currentLayout === 'graph') {
    renderGraphMode(width, height);
    return;
  }

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
 * Force-directed graph layout.
 *
 * Flattens the current hierarchy into a node set, builds tree edges
 * (parent -> child) plus any in-scope cross-reference edges from the
 * CrossRefProvider, and runs a d3.forceSimulation. The simulation is
 * pre-ticked synchronously so the layout is settled by the time we
 * render.
 */
function renderGraphMode(width: number, height: number): void {
  if (!currentData) return;

  const hierarchy = d3.hierarchy(currentData) as D3Node;
  const nodes = hierarchy.descendants() as D3Node[];
  const byId = new Map<string, D3Node>();
  for (const n of nodes) byId.set(n.data.id, n);

  // Seed initial positions in a small disc around the center so the
  // simulation has somewhere to start.
  const cx = width / 2;
  const cy = height / 2;
  for (const n of nodes) {
    if (n.data.level === 0) {
      n.x = cx;
      n.y = cy;
    } else {
      n.x = cx + (Math.random() - 0.5) * 200;
      n.y = cy + (Math.random() - 0.5) * 200;
    }
  }

  // Edges: tree parent/child plus any cross-refs (ICD-11).
  type Link = {
    source: D3Node;
    target: D3Node;
    kind: 'tree' | CrossRefKind;
  };
  const links: Link[] = hierarchy.links().map((l) => ({
    source: l.source as D3Node,
    target: l.target as D3Node,
    kind: 'tree',
  }));

  if (crossRefProvider) {
    for (const n of nodes) {
      const refs = crossRefProvider(n.data.id);
      for (const { targetId, kind } of refs) {
        const tgt = byId.get(targetId);
        if (tgt && tgt !== n) {
          links.push({ source: n, target: tgt, kind });
        }
      }
    }
  }

  // Simulation. Tree links are strong (short + firm) so the parent/
  // child backbone stays intact; cross-refs are long + weak hints.
  const sim = d3
    .forceSimulation<D3Node>(nodes)
    .force(
      'link',
      d3
        .forceLink<D3Node, Link>(links)
        .id((d) => d.data.id)
        .distance((l) => (l.kind === 'tree' ? 75 : 160))
        .strength((l) => (l.kind === 'tree' ? 0.65 : 0.05)),
    )
    .force('charge', d3.forceManyBody<D3Node>().strength(-260))
    .force('center', d3.forceCenter(cx, cy))
    .force('collide', d3.forceCollide<D3Node>().radius(24))
    .stop();

  for (let i = 0; i < 500; i++) sim.tick();

  currentRoot = hierarchy;

  // Tree links first (muted), cross-ref links on top (colored).
  const linkGroup = g.append('g').attr('class', 'links');
  linkGroup
    .selectAll<SVGLineElement, Link>('line')
    .data(links)
    .join('line')
    .attr('class', (d) => (d.kind === 'tree' ? 'link' : `link xref xref-${d.kind}`))
    .attr('x1', (d) => d.source.x ?? 0)
    .attr('y1', (d) => d.source.y ?? 0)
    .attr('x2', (d) => d.target.x ?? 0)
    .attr('y2', (d) => d.target.y ?? 0);

  // Nodes.
  const nodeGroups = g
    .append('g')
    .attr('class', 'nodes')
    .selectAll<SVGGElement, D3Node>('g')
    .data(nodes)
    .join('g')
    .attr('class', 'node')
    .attr('transform', (d) => `translate(${d.x ?? 0}, ${d.y ?? 0})`);

  nodeGroups
    .append('circle')
    .attr('r', (d) => levelSizes[d.data.level] || 4)
    .attr('fill', (d) => levelColors[d.data.level] || '#607d8b')
    .attr(
      'stroke',
      (d) =>
        d3.color(levelColors[d.data.level] || '#607d8b')?.darker(0.5)?.toString() ||
        '#333',
    )
    .on('mouseover', handleMouseOver)
    .on('mouseout', handleMouseOut)
    .on('click', handleClick)
    .on('dblclick', handleDoubleClick);

  // Labels always to the right of the node.
  const labels = nodeGroups
    .append('text')
    .attr('class', 'node-label')
    .attr('x', 12)
    .attr('text-anchor', 'start');

  labels
    .append('tspan')
    .attr('class', 'label-primary')
    .attr('x', 12)
    .attr('dy', (d) => (d.data.shortLabel ? '-0.25em' : '0.31em'))
    .text((d) => d.data.name);

  labels
    .filter((d) => !!d.data.shortLabel)
    .append('tspan')
    .attr('class', 'label-secondary')
    .attr('x', 12)
    .attr('dy', '1.1em')
    .text((d) => d.data.shortLabel ?? '');

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
  } else if (currentLayout === 'graph' && currentRoot) {
    // Force simulation places nodes around (width/2, height/2). Fit
    // the resulting cloud with a little margin.
    initialTransform = fitToNodes(currentRoot.descendants() as D3Node[], width, height, {
      maxScale: 1,
      padX: 80,
      padY: 80,
    });
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

  // Always update the detail panel so it reflects whichever node the
  // user is engaging with, even when they double-click a new node
  // with the panel already open on a different one.
  showDetail(d.data);

  // If an expander is set (ICD-11 mode), rebuild the hierarchy with
  // this node's subtree unfolded before focusing. Returning a new
  // tree means "this node has deeper content; drill in".
  if (expander) {
    const expanded = expander(d.data.id);
    if (expanded) {
      currentData = expanded;
      focusOnNode(d.data.id);
      return;
    }
  }

  // Fallback: zoom only when the node is a direct parent of leaves
  // in the currently rendered tree (e.g. A17 -> A17.0...A17.9).
  if (isLeafParent(d)) {
    focusOnNode(d.data.id);
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
  extraVisibleIds = new Set();

  // For the graph layout we can't re-layout meaningfully — nodes are
  // already placed by the force simulation — so just update labels
  // and pan to the target.
  if (currentLayout === 'graph') {
    updateLabelVisibility();
    const focus = findNodeById(nodeId);
    if (!focus) return;
    const [sx, sy] = layoutToScreen(focus);
    const w = currentContainer.clientWidth;
    const h = currentContainer.clientHeight;
    const current = d3.zoomTransform(svg.node() as SVGSVGElement);
    const scale = Math.max(current.k, 1.8);
    const t = d3.zoomIdentity
      .translate(w / 2 - sx * scale, h / 2 - sy * scale)
      .scale(scale);
    svg.transition().duration(750).call(zoom.transform, t);
    return;
  }

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
    // Graph mode packs hundreds of nodes into the same area, so show
    // fewer labels by default to avoid an unreadable pile of text.
    // Hover tooltips still reveal the rest on demand.
    const defaultMaxLabelLevel = currentLayout === 'graph' ? 1 : 2;
    currentRoot.each((d) => {
      if (d.data.level <= defaultMaxLabelLevel) visible.add(d.data.id);
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

  // Union in the extra-visible set (populated by panToNode) so pans
  // from the detail panel never hide labels the user could see before.
  for (const id of extraVisibleIds) visible.add(id);

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
  if (currentLayout === 'graph') {
    // Graph uses native (x, y) coordinates from the force simulation.
    return [d.x ?? 0, d.y ?? 0];
  }
  return [d.y, d.x];
}

/**
 * Pan the viewport so `nodeId` sits in the center, preserving the
 * current zoom scale. Used when the user clicks a related node in
 * the detail panel — we want to show them where it lives without
 * yanking the zoom.
 *
 * Reveals the pan target's label (and its direct children) via the
 * extra-visible set, without touching the current focus. This way
 * the wider context — chapter/section labels that were visible
 * before — stays on screen.
 */
export function panToNode(nodeId: string): void {
  if (!currentContainer || !svg) return;
  const node = findNodeById(nodeId);
  if (!node) return;

  extraVisibleIds.add(nodeId);
  for (const c of node.children ?? []) extraVisibleIds.add(c.data.id);
  updateLabelVisibility();

  const [sx, sy] = layoutToScreen(node);
  const w = currentContainer.clientWidth;
  const h = currentContainer.clientHeight;
  const current = d3.zoomTransform(svg.node() as SVGSVGElement);
  const scale = current.k;
  const t = d3.zoomIdentity
    .translate(w / 2 - sx * scale, h / 2 - sy * scale)
    .scale(scale);
  svg.transition().duration(500).call(zoom.transform, t);
}

/** Clear focus, rebuild in compact mode, return to the overview. */
export function resetZoom(container: HTMLElement, _layoutType: LayoutType): void {
  focusedNodeId = null;
  extraVisibleIds = new Set();
  currentContainer = container;
  // Tree/cluster: only re-render if we were in spacious mode.
  // Graph: no spacious mode; just re-center and restore labels.
  if (currentLayout !== 'graph' && currentMode !== 'compact') {
    renderInternal('compact');
  } else {
    updateLabelVisibility();
  }
  centerOnOverview();
}
