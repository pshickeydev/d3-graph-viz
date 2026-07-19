/**
 * layouts.js — Discrete graph layout algorithms.
 *
 * Each layout is a pure function that takes an array of node objects
 * (mutating x/y/vx/vy) plus dimensions and produces a static layout.
 * No D3 dependency, so these are unit-testable in Node.
 *
 * Force-directed layout is handled separately by the renderer's
 * d3-force simulation and is not defined here.
 */

/* ------------------------------------------------------------------ */
/*  Circle layout                                                      */
/* ------------------------------------------------------------------ */

/**
 * Place nodes evenly around a circle.
 * @param {Object[]} nodes — objects with x/y/vx/vy writable
 * @param {number}   width
 * @param {number}   height
 * @param {{ radius?: number, startAngle?: number }} [opts]
 */
export function circleLayout(nodes, width, height, opts = {}) {
  const n = nodes.length;
  if (n === 0) return;
  const cx = width / 2;
  const cy = height / 2;
  const radius = opts.radius ?? Math.min(width, height) * 0.4;
  const startAngle = opts.startAngle ?? -Math.PI / 2;
  if (n === 1) {
    nodes[0].x = cx; nodes[0].y = cy;
    nodes[0].vx = 0; nodes[0].vy = 0;
    return;
  }
  for (let i = 0; i < n; i++) {
    const angle = startAngle + (i / n) * 2 * Math.PI;
    nodes[i].x = cx + Math.cos(angle) * radius;
    nodes[i].y = cy + Math.sin(angle) * radius;
    nodes[i].vx = 0;
    nodes[i].vy = 0;
  }
}

/* ------------------------------------------------------------------ */
/*  Grid layout                                                        */
/* ------------------------------------------------------------------ */

/**
 * Place nodes in a rectangular grid, left-to-right, top-to-bottom.
 * @param {Object[]} nodes
 * @param {number}   width
 * @param {number}   height
 * @param {{ cols?: number }} [opts]
 */
export function gridLayout(nodes, width, height, opts = {}) {
  const n = nodes.length;
  if (n === 0) return;
  const cols = opts.cols ?? Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const cellW = width / (cols + 1);
  const cellH = height / (rows + 1);
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    nodes[i].x = cellW * (col + 1);
    nodes[i].y = cellH * (row + 1);
    nodes[i].vx = 0;
    nodes[i].vy = 0;
  }
}

/* ------------------------------------------------------------------ */
/*  Concentric layout                                                  */
/* ------------------------------------------------------------------ */

/**
 * Place nodes in concentric circles ordered by a metric (default:
 * node degree). Highest-metric nodes occupy the innermost ring.
 * @param {Object[]} nodes
 * @param {Object[]} edges — visible edges, used for degree computation
 * @param {number}   width
 * @param {number}   height
 * @param {{ metric?: Map<string, number>, ringCount?: number }} [opts]
 */
export function concentricLayout(nodes, edges, width, height, opts = {}) {
  const n = nodes.length;
  if (n === 0) return;
  const cx = width / 2;
  const cy = height / 2;
  const maxRadius = Math.min(width, height) * 0.45;

  let metric = opts.metric;
  if (!metric) {
    metric = new Map();
    for (const node of nodes) metric.set(node.id, 0);
    for (const e of edges) {
      if (metric.has(e.from)) metric.set(e.from, metric.get(e.from) + 1);
      if (metric.has(e.to)) metric.set(e.to, metric.get(e.to) + 1);
    }
  }

  const sorted = nodes.slice().sort(
    (a, b) => (metric.get(b.id) || 0) - (metric.get(a.id) || 0),
  );

  const ringCount = opts.ringCount ?? Math.max(1, Math.ceil(Math.sqrt(n)));
  const ringSize = Math.max(1, Math.ceil(n / ringCount));

  let idx = 0;
  for (let ring = 0; ring < ringCount && idx < n; ring++) {
    const count = Math.min(ringSize, n - idx);
    const r = ring === 0 && count === 1
      ? 0
      : maxRadius * (ring + 0.5) / ringCount;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
      const node = sorted[idx++];
      node.x = cx + Math.cos(angle) * r;
      node.y = cy + Math.sin(angle) * r;
      node.vx = 0;
      node.vy = 0;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Radial tree layout                                                 */
/* ------------------------------------------------------------------ */

/**
 * Place nodes as a radial tree (roots at center, leaves on the outer
 * ring). Angular space is allocated proportionally to subtree leaf
 * count, producing a tidy radial layout similar to d3.tree.
 *
 * For DAGs (nodes with multiple parents), the first visible parent
 * is used to form the tree structure.
 *
 * @param {Object[]}                 nodes
 * @param {Map<string, string[]>}    parentsOf — child-id → [parent-ids]
 * @param {number}                   width
 * @param {number}                   height
 */
export function radialTreeLayout(nodes, parentsOf, width, height) {
  const n = nodes.length;
  if (n === 0) return;
  const cx = width / 2;
  const cy = height / 2;
  if (n === 1) {
    nodes[0].x = cx; nodes[0].y = cy;
    nodes[0].vx = 0; nodes[0].vy = 0;
    return;
  }

  const nodeSet = new Set(nodes.map((node) => node.id));

  // Build tree: each node → first visible parent
  const treeChildren = new Map();
  const roots = [];
  for (const node of nodes) {
    const parents = (parentsOf.get(node.id) || []).filter((p) => nodeSet.has(p));
    if (parents.length === 0) {
      roots.push(node.id);
    } else {
      const p = parents[0];
      if (!treeChildren.has(p)) treeChildren.set(p, []);
      treeChildren.get(p).push(node.id);
    }
  }

  // Count leaves per subtree (post-order)
  const leafCount = new Map();
  function countLeaves(id, seen) {
    if (seen.has(id)) return 0;
    seen.add(id);
    const children = treeChildren.get(id) || [];
    if (children.length === 0) {
      leafCount.set(id, 1);
      return 1;
    }
    let total = 0;
    for (const cid of children) total += countLeaves(cid, seen);
    leafCount.set(id, total);
    return total;
  }

  let totalLeaves = 0;
  for (const r of roots) totalLeaves += countLeaves(r, new Set());

  // Assign angles and depths via proportional allocation
  const angle = new Map();
  const depth = new Map();

  function assign(id, startA, endA, d) {
    depth.set(id, d);
    angle.set(id, (startA + endA) / 2);
    const children = treeChildren.get(id) || [];
    if (children.length === 0) return;
    const myLeaves = leafCount.get(id) || 1;
    let cursor = startA;
    for (const cid of children) {
      const childLeaves = leafCount.get(cid) || 1;
      const span = (endA - startA) * (childLeaves / myLeaves);
      assign(cid, cursor, cursor + span, d + 1);
      cursor += span;
    }
  }

  let cursor = 0;
  for (const r of roots) {
    const rLeaves = leafCount.get(r) || 1;
    const span = 2 * Math.PI * (rLeaves / Math.max(totalLeaves, 1));
    assign(r, cursor, cursor + span, 0);
    cursor += span;
  }

  let maxDepth = 0;
  for (const d of depth.values()) if (d > maxDepth) maxDepth = d;

  const maxRadius = Math.min(width, height) * 0.45;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const [id, a] of angle) {
    const node = nodeById.get(id);
    if (!node) continue;
    const d = depth.get(id) ?? 0;
    const r = maxDepth === 0 ? 0 : (d / maxDepth) * maxRadius;
    const theta = a - Math.PI / 2;
    node.x = cx + r * Math.cos(theta);
    node.y = cy + r * Math.sin(theta);
    node.vx = 0;
    node.vy = 0;
  }
}

/* ------------------------------------------------------------------ */
/*  Layout registry                                                    */
/* ------------------------------------------------------------------ */

export const DISCRETE_LAYOUTS = ['circle', 'grid', 'concentric', 'radial'];

export const LAYOUT_LABELS = {
  force: 'Force-directed',
  circle: 'Circle',
  grid: 'Grid',
  concentric: 'Concentric',
  radial: 'Radial tree',
};

export const ALL_LAYOUTS = ['force', ...DISCRETE_LAYOUTS];
