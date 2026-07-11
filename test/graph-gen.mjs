/**
 * test/graph-gen.mjs — Synthetic graph generator for tests.
 *
 * Produces a directed acyclic graph with a configurable number of nodes
 * and edges, spread across several node types and edge rels so that
 * every GraphStore code path (type detection, root detection, BFS
 * depth ordering, expand/collapse, getVisible, search, reveal) gets
 * exercised.
 */

/**
 * @param {number} nodeCount
 * @param {number} edgeCount  approximate — deduped, so may be slightly fewer
 * @returns {{ nodes: object[], edges: object[] }}
 */
export function generateGraph(nodeCount, edgeCount) {
  const TYPES = ['root', 'branch', 'leaf', 'stem', 'cluster'];
  const RELS  = ['contains', 'references', 'depends', 'links'];

  const nodes = [];
  for (let i = 0; i < nodeCount; i++) {
    const type = i === 0
      ? 'root'
      : TYPES[1 + (i % (TYPES.length - 1))];
    nodes.push({
      id: `n${i}`,
      type,
      label: `Node ${i}`,
      attrs: { index: i, tier: type },
    });
  }

  const edgeSet = new Set();
  const edges = [];
  let attempts = 0;
  const maxAttempts = edgeCount * 3;

  while (edges.length < edgeCount && attempts < maxAttempts) {
    attempts++;
    const from = Math.floor(Math.random() * (nodeCount - 1));
    const to = 1 + Math.floor(Math.random() * (nodeCount - 1));
    if (from === to) continue;
    const key = `${from}-${to}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);
    edges.push({
      from: `n${from}`,
      to: `n${to}`,
      rel: RELS[Math.floor(Math.random() * RELS.length)],
    });
  }

  return { nodes, edges };
}
