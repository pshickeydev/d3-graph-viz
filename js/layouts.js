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
/*  AVSDF circular layout (He & Sykora)                                */
/* ------------------------------------------------------------------ */

/**
 * Place nodes on a circle using the AVSDF (Adjacent Vertex with
 * Smallest Degree First) algorithm of He & Sykora. A DFS-style
 * traversal always visits the smallest-degree unplaced neighbour
 * next, which produces a zero-crossing ordering for any tree and
 * low-crossing orderings for general graphs. An optional local
 * "adjusting" pass (Algorithm 2 in the paper) moves each vertex to
 * the slot among its neighbours that yields the fewest crossings.
 *
 * The graph is treated as undirected, since the circular (one-page)
 * crossing number is defined on undirected graphs.
 *
 * Reference: He, H. & Sykora, O., "New Circular Drawing Algorithms",
 * WG 2004, Loughborough University.
 *
 * @param {Object[]} nodes
 * @param {Object[]} edges — visible edges
 * @param {number}   width
 * @param {number}   height
 * @param {{ radius?: number, startAngle?: number, adjust?: boolean, adjustThreshold?: number }} [opts]
 */
export function avsdfLayout(nodes, edges, width, height, opts = {}) {
  const n = nodes.length;
  if (n === 0) return;
  const cx = width / 2;
  const cy = height / 2;
  if (n === 1) {
    nodes[0].x = cx; nodes[0].y = cy;
    nodes[0].vx = 0; nodes[0].vy = 0;
    return;
  }

  const radius = opts.radius ?? Math.min(width, height) * 0.4;
  const startAngle = opts.startAngle ?? -Math.PI / 2;

  // Build undirected adjacency restricted to visible nodes.
  const idSet = new Set(nodes.map((node) => node.id));
  const adj = new Map();
  for (const id of idSet) adj.set(id, new Set());
  for (const e of edges) {
    if (e.from === e.to) continue;
    if (!idSet.has(e.from) || !idSet.has(e.to)) continue;
    adj.get(e.from).add(e.to);
    adj.get(e.to).add(e.from);
  }

  // --- AVSDF ordering (Algorithm 1) ---
  let order = avsdfOrder(idSet, adj);

  // --- Local adjusting (Algorithm 2), gated by size for performance ---
  const adjustEnabled = opts.adjust !== false;
  const threshold = opts.adjustThreshold ?? 100;
  if (adjustEnabled && order.length > 2 && order.length <= threshold) {
    order = avsdfAdjust(order, adj);
  }

  // --- Place nodes on the circle in computed order ---
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const N = order.length;
  for (let i = 0; i < N; i++) {
    const node = nodeById.get(order[i]);
    if (!node) continue;
    const angle = startAngle + (i / N) * 2 * Math.PI;
    node.x = cx + Math.cos(angle) * radius;
    node.y = cy + Math.sin(angle) * radius;
    node.vx = 0;
    node.vy = 0;
  }
}

/**
 * AVSDF ordering (Algorithm 1). Start from the smallest-degree vertex
 * and always push unplaced neighbours onto the stack so the smallest
 * degree is on top. Handles disconnected graphs by restarting from the
 * smallest-degree vertex of each remaining component.
 *
 * @param {Set<string>} ids
 * @param {Map<string, Set<string>>} adj
 * @returns {string[]}
 */
function avsdfOrder(ids, adj) {
  const order = [];
  const placed = new Set();
  const stack = [];

  while (order.length < ids.size) {
    // Seed this component with the smallest-degree unplaced vertex;
    // break ties by id for deterministic output.
    let seed = null;
    let minDeg = Infinity;
    for (const id of ids) {
      if (placed.has(id)) continue;
      const d = adj.get(id).size;
      if (d < minDeg || (d === minDeg && (seed === null || id < seed))) {
        minDeg = d;
        seed = id;
      }
    }
    if (seed === null) break;
    stack.push(seed);

    while (stack.length > 0) {
      const v = stack.pop();
      if (placed.has(v)) continue;
      placed.add(v);
      order.push(v);
      // Push unplaced neighbours sorted by descending degree so the
      // smallest degree ends up on top of the stack (highest priority).
      const nb = [];
      for (const u of adj.get(v)) if (!placed.has(u)) nb.push(u);
      nb.sort((a, b) => adj.get(b).size - adj.get(a).size);
      for (const u of nb) stack.push(u);
    }
  }
  return order;
}

/**
 * Local adjusting (Algorithm 2). Process vertices in descending order
 * of incident crossings; for each, try swapping it with every
 * neighbour and keep the swap that yields the fewest crossings of
 * edges incident to either endpoint. The paper's Fig. 6 shows the
 * candidate positions as the slots occupied by v's neighbours, which
 * corresponds to a swap. Only edges incident to the swapped pair
 * change, so the cost delta is computed from just those edges.
 *
 * Uses numeric indices and typed arrays throughout for speed.
 *
 * @param {string[]} order
 * @param {Map<string, Set<string>>} adj
 * @returns {string[]}
 */
function avsdfAdjust(order, adj) {
  const n = order.length;
  if (n <= 2) return order;

  // Map string IDs to numeric indices.
  const idToIdx = new Map(order.map((id, i) => [id, i]));

  // Build numeric edge list (each undirected edge stored once, lo < hi).
  const numEdges = [];
  // For each vertex, list of edge indices incident to it.
  const vertexEdges = Array.from({ length: n }, () => []);
  for (const [v, neighbors] of adj) {
    const vi = idToIdx.get(v);
    for (const u of neighbors) {
      const ui = idToIdx.get(u);
      if (vi < ui) {
        const ei = numEdges.length;
        numEdges.push(vi < ui ? [vi, ui] : [ui, vi]);
        vertexEdges[vi].push(ei);
        vertexEdges[ui].push(ei);
      }
    }
  }
  const m = numEdges.length;

  // Position: pos[i] = circular slot of vertex i. orderArr[slot] = vertex id string.
  const pos = new Int32Array(n);
  const orderArr = order.slice();
  for (let i = 0; i < n; i++) pos[i] = i;

  // Count crossings of edge ei against all other edges.
  function edgeCrossings(ei, p) {
    const [a, b] = numEdges[ei];
    const lo = p[a] < p[b] ? p[a] : p[b];
    const hi = p[a] < p[b] ? p[b] : p[a];
    let c = 0;
    for (let j = 0; j < m; j++) {
      if (j === ei) continue;
      const [c2, d] = numEdges[j];
      if (c2 === a || c2 === b || d === a || d === b) continue;
      const pc = p[c2], pd = p[d];
      const lo2 = pc < pd ? pc : pd;
      const hi2 = pc < pd ? pd : pc;
      if ((lo < lo2 && lo2 < hi && hi < hi2) || (lo2 < lo && lo < hi2 && hi2 < hi)) c++;
    }
    return c;
  }

  // Total crossings of all edges incident to vertex vi.
  function vertexIncidentCrossings(vi, p) {
    let total = 0;
    for (const ei of vertexEdges[vi]) total += edgeCrossings(ei, p);
    return total;
  }

  // Collect edge indices incident to va or vb (deduped via a boolean stamp array).
  const edgeStamp = new Uint8Array(m);
  let stampVal = 1;
  function affectedEdgeIndices(va, vb) {
    stampVal++;
    const result = [];
    for (const ei of vertexEdges[va]) {
      if (edgeStamp[ei] !== stampVal) { edgeStamp[ei] = stampVal; result.push(ei); }
    }
    for (const ei of vertexEdges[vb]) {
      if (edgeStamp[ei] !== stampVal) { edgeStamp[ei] = stampVal; result.push(ei); }
    }
    return result;
  }

  // Count crossings where at least one edge is in affectedEdges. Each
  // crossing pair counted once via a pair-stamp array.
  const pairStamp = new Uint8Array(m * m);
  let pairStampVal = 1;
  function affectedCrossings(va, vb, p) {
    const affected = affectedEdgeIndices(va, vb);
    let count = 0;
    pairStampVal++;
    for (const ei of affected) {
      const [a, b] = numEdges[ei];
      const lo = p[a] < p[b] ? p[a] : p[b];
      const hi = p[a] < p[b] ? p[b] : p[a];
      for (let j = 0; j < m; j++) {
        if (j === ei) continue;
        const [c2, d] = numEdges[j];
        if (c2 === a || c2 === b || d === a || d === b) continue;
        const lo2 = p[c2] < p[d] ? p[c2] : p[d];
        const hi2 = p[c2] < p[d] ? p[d] : p[c2];
        if (!((lo < lo2 && lo2 < hi && hi < hi2) || (lo2 < lo && lo < hi2 && hi2 < hi))) continue;
        const key = ei < j ? ei * m + j : j * m + ei;
        if (pairStamp[key] === pairStampVal) continue;
        pairStamp[key] = pairStampVal;
        count++;
      }
    }
    return count;
  }

  // Compute initial incident crossings per vertex.
  const cross = new Array(n);
  for (let i = 0; i < n; i++) cross[i] = vertexIncidentCrossings(i, pos);

  // Process vertices by descending incident crossings (paper §3.3).
  const sorted = Array.from({ length: n }, (_, i) => i).sort((a, b) => cross[b] - cross[a]);

  for (const vi of sorted) {
    if (vertexEdges[vi].length === 0) continue;
    let bestDelta = 0;
    let bestU = -1;

    for (const ui of vertexEdges2Neighbors(vi)) {
      const before = affectedCrossings(vi, ui, pos);
      // Swap positions
      const tmp = pos[vi]; pos[vi] = pos[ui]; pos[ui] = tmp;
      const after = affectedCrossings(vi, ui, pos);
      // Revert
      pos[ui] = pos[vi]; pos[vi] = tmp;

      const delta = after - before;
      if (delta < bestDelta) {
        bestDelta = delta;
        bestU = ui;
      }
    }

    if (bestU !== -1) {
      const tmp = pos[vi]; pos[vi] = pos[bestU]; pos[bestU] = tmp;
      orderArr[pos[vi]] = order[vi];
      orderArr[pos[bestU]] = order[bestU];
      cross[vi] = vertexIncidentCrossings(vi, pos);
      cross[bestU] = vertexIncidentCrossings(bestU, pos);
    }
  }
  return orderArr;

  // Helper: neighbors of vi derived from its incident edges.
  function vertexEdges2Neighbors(vi) {
    const result = [];
    for (const ei of vertexEdges[vi]) {
      const [a, b] = numEdges[ei];
      result.push(a === vi ? b : a);
    }
    return result;
  }
}

/* ------------------------------------------------------------------ */
/*  Layout registry                                                    */
/* ------------------------------------------------------------------ */

export const DISCRETE_LAYOUTS = ['circle', 'grid', 'concentric', 'radial', 'avsdf'];

export const LAYOUT_LABELS = {
  force: 'Force-directed',
  circle: 'Circle',
  grid: 'Grid',
  concentric: 'Concentric',
  radial: 'Radial tree',
  avsdf: 'AVSDF circular',
};

export const ALL_LAYOUTS = ['force', ...DISCRETE_LAYOUTS];
