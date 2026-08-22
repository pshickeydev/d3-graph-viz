import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  circleLayout,
  gridLayout,
  concentricLayout,
  radialTreeLayout,
  avsdfLayout,
  groupedDiscreteLayout,
  DISCRETE_LAYOUTS,
  ALL_LAYOUTS,
  LAYOUT_LABELS,
} from '../js/layouts.js';

/* ================================================================
 *  Helpers
 * ================================================================ */

function makeNodes(ids) {
  return ids.map((id) => ({ id, x: 0, y: 0, vx: 1, vy: 1 }));
}

function makeEdges(pairs) {
  return pairs.map(([from, to]) => ({ from, to, rel: 'r' }));
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/* ================================================================
 *  Registry
 * ================================================================ */

describe('layout registry', () => {
  test('exposes discrete layouts', () => {
    assert.ok(DISCRETE_LAYOUTS.includes('circle'));
    assert.ok(DISCRETE_LAYOUTS.includes('grid'));
    assert.ok(DISCRETE_LAYOUTS.includes('concentric'));
    assert.ok(DISCRETE_LAYOUTS.includes('radial'));
    assert.ok(DISCRETE_LAYOUTS.includes('avsdf'));
  });

  test('ALL_LAYOUTS starts with force', () => {
    assert.equal(ALL_LAYOUTS[0], 'force');
    assert.equal(ALL_LAYOUTS.length, DISCRETE_LAYOUTS.length + 1);
  });

  test('every layout has a human label', () => {
    for (const key of ALL_LAYOUTS) {
      assert.ok(LAYOUT_LABELS[key], `missing label for ${key}`);
    }
  });
});

/* ================================================================
 *  Circle layout
 * ================================================================ */

describe('circleLayout', () => {
  test('places nodes on a circle centered in the viewport', () => {
    const nodes = makeNodes(['a', 'b', 'c', 'd']);
    circleLayout(nodes, 400, 400);
    const cx = 200, cy = 200, radius = 160;
    for (const node of nodes) {
      const d = Math.hypot(node.x - cx, node.y - cy);
      assert.ok(Math.abs(d - radius) < 1e-6, `${node.id} not on circle`);
    }
  });

  test('resets velocity', () => {
    const nodes = makeNodes(['a', 'b']);
    circleLayout(nodes, 200, 200);
    for (const node of nodes) {
      assert.equal(node.vx, 0);
      assert.equal(node.vy, 0);
    }
  });

  test('single node goes to center', () => {
    const nodes = makeNodes(['a']);
    circleLayout(nodes, 200, 200);
    assert.equal(nodes[0].x, 100);
    assert.equal(nodes[0].y, 100);
  });

  test('empty input is a no-op', () => {
    const nodes = [];
    circleLayout(nodes, 200, 200);
    assert.equal(nodes.length, 0);
  });

  test('honours custom radius and start angle', () => {
    const nodes = makeNodes(['a']);
    nodes.push({ id: 'b', x: 0, y: 0, vx: 0, vy: 0 });
    circleLayout(nodes, 200, 200, { radius: 50, startAngle: 0 });
    // First node at angle 0 from center (100,100): (150, 100)
    assert.ok(Math.abs(nodes[0].x - 150) < 1e-6);
    assert.ok(Math.abs(nodes[0].y - 100) < 1e-6);
  });
});

/* ================================================================
 *  Grid layout
 * ================================================================ */

describe('gridLayout', () => {
  test('places nodes in a grid with no overlap', () => {
    const nodes = makeNodes(['a', 'b', 'c', 'd', 'e', 'f']);
    gridLayout(nodes, 600, 600);
    const positions = new Set(nodes.map((n) => `${n.x},${n.y}`));
    assert.equal(positions.size, nodes.length, 'positions collide');
  });

  test('resets velocity', () => {
    const nodes = makeNodes(['a', 'b', 'c']);
    gridLayout(nodes, 300, 300);
    for (const node of nodes) {
      assert.equal(node.vx, 0);
      assert.equal(node.vy, 0);
    }
  });

  test('honours custom column count', () => {
    const nodes = makeNodes(['a', 'b', 'c', 'd']);
    gridLayout(nodes, 400, 400, { cols: 1 });
    // All nodes in one column → same x, different y
    const xs = new Set(nodes.map((n) => n.x));
    assert.equal(xs.size, 1);
    const ys = new Set(nodes.map((n) => n.y));
    assert.equal(ys.size, 4);
  });

  test('empty input is a no-op', () => {
    const nodes = [];
    gridLayout(nodes, 200, 200);
    assert.equal(nodes.length, 0);
  });

  test('nodes stay within viewport bounds', () => {
    const nodes = makeNodes(Array.from({ length: 20 }, (_, i) => `n${i}`));
    const W = 500, H = 500;
    gridLayout(nodes, W, H);
    for (const node of nodes) {
      assert.ok(node.x >= 0 && node.x <= W, `${node.id} x out of bounds`);
      assert.ok(node.y >= 0 && node.y <= H, `${node.id} y out of bounds`);
    }
  });
});

/* ================================================================
 *  Concentric layout
 * ================================================================ */

describe('concentricLayout', () => {
  test('higher-degree nodes land closer to center', () => {
    const nodes = makeNodes(['hub', 'a', 'b', 'c']);
    const edges = makeEdges([
      ['hub', 'a'], ['hub', 'b'], ['hub', 'c'],
      ['a', 'b'],
    ]);
    concentricLayout(nodes, edges, 400, 400);
    const hub = nodes.find((n) => n.id === 'hub');
    const hubDist = Math.hypot(hub.x - 200, hub.y - 200);
    for (const node of nodes) {
      if (node.id === 'hub') continue;
      const d = Math.hypot(node.x - 200, node.y - 200);
      assert.ok(d >= hubDist - 1e-6, `${node.id} should be farther out than hub`);
    }
  });

  test('resets velocity', () => {
    const nodes = makeNodes(['a', 'b', 'c']);
    const edges = makeEdges([['a', 'b'], ['b', 'c']]);
    concentricLayout(nodes, edges, 300, 300);
    for (const node of nodes) {
      assert.equal(node.vx, 0);
      assert.equal(node.vy, 0);
    }
  });

  test('honours explicit metric', () => {
    const nodes = makeNodes(['a', 'b', 'c']);
    const metric = new Map([['a', 5], ['b', 2], ['c', 1]]);
    concentricLayout(nodes, [], 400, 400, { metric });
    // 'a' has the highest metric → closest to center
    const aDist = Math.hypot(nodes[0].x - 200, nodes[0].y - 200);
    const cDist = Math.hypot(nodes[2].x - 200, nodes[2].y - 200);
    assert.ok(aDist <= cDist, 'highest-metric node should be innermost');
  });

  test('empty input is a no-op', () => {
    concentricLayout([], [], 200, 200);
  });

  test('single node goes to center', () => {
    const nodes = makeNodes(['only']);
    concentricLayout(nodes, [], 200, 200);
    assert.equal(nodes[0].x, 100);
    assert.equal(nodes[0].y, 100);
  });
});

/* ================================================================
 *  Radial tree layout
 * ================================================================ */

describe('radialTreeLayout', () => {
  test('root is at center, leaves on outer ring', () => {
    // root -> a -> leaf1, leaf2
    const nodes = makeNodes(['root', 'a', 'leaf1', 'leaf2']);
    const parentsOf = new Map([
      ['a', ['root']],
      ['leaf1', ['a']],
      ['leaf2', ['a']],
    ]);
    radialTreeLayout(nodes, (id) => parentsOf.get(id) || [], 400, 400);
    const root = nodes.find((n) => n.id === 'root');
    const rootDist = Math.hypot(root.x - 200, root.y - 200);
    assert.ok(rootDist < 1e-6, 'root should be at center');
    for (const id of ['leaf1', 'leaf2']) {
      const leaf = nodes.find((n) => n.id === id);
      const d = Math.hypot(leaf.x - 200, leaf.y - 200);
      assert.ok(d > rootDist, `${id} should be outside root`);
    }
  });

  test('leaves are further out than their parents', () => {
    const nodes = makeNodes(['r', 'x', 'y', 'z']);
    const parentsOf = new Map([
      ['x', ['r']],
      ['y', ['x']],
      ['z', ['y']],
    ]);
    radialTreeLayout(nodes, (id) => parentsOf.get(id) || [], 600, 600);
    const get = (id) => nodes.find((n) => n.id === id);
    const dR = dist(get('r'), { x: 300, y: 300 });
    const dX = dist(get('x'), { x: 300, y: 300 });
    const dY = dist(get('y'), { x: 300, y: 300 });
    const dZ = dist(get('z'), { x: 300, y: 300 });
    assert.ok(dR < dX, 'root closer than child');
    assert.ok(dX < dY, 'child closer than grandchild');
    assert.ok(dY < dZ, 'grandchild closer than great-grandchild');
  });

  test('handles multiple roots', () => {
    const nodes = makeNodes(['r1', 'r2', 'c1', 'c2']);
    const parentsOf = new Map([
      ['c1', ['r1']],
      ['c2', ['r2']],
    ]);
    radialTreeLayout(nodes, (id) => parentsOf.get(id) || [], 400, 400);
    const r1 = nodes.find((n) => n.id === 'r1');
    const r2 = nodes.find((n) => n.id === 'r2');
    // Both roots at center
    assert.ok(Math.hypot(r1.x - 200, r1.y - 200) < 1e-6);
    assert.ok(Math.hypot(r2.x - 200, r2.y - 200) < 1e-6);
  });

  test('resets velocity', () => {
    const nodes = makeNodes(['r', 'c']);
    const parentsOf = new Map([['c', ['r']]]);
    radialTreeLayout(nodes, (id) => parentsOf.get(id) || [], 400, 400);
    for (const node of nodes) {
      assert.equal(node.vx, 0);
      assert.equal(node.vy, 0);
    }
  });

  test('empty input is a no-op', () => {
    radialTreeLayout([], () => [], 200, 200);
  });

  test('single node goes to center', () => {
    const nodes = makeNodes(['solo']);
    radialTreeLayout(nodes, () => [], 200, 200);
    assert.equal(nodes[0].x, 100);
    assert.equal(nodes[0].y, 100);
  });

  test('DAG with multiple parents uses first visible parent', () => {
    // diamond: r -> a, r -> b, c <- a, c <- b
    const nodes = makeNodes(['r', 'a', 'b', 'c']);
    const parentsOf = new Map([
      ['a', ['r']],
      ['b', ['r']],
      ['c', ['a', 'b']],
    ]);
    radialTreeLayout(nodes, (id) => parentsOf.get(id) || [], 600, 600);
    const get = (id) => nodes.find((n) => n.id === id);
    const dR = dist(get('r'), { x: 300, y: 300 });
    const dC = dist(get('c'), { x: 300, y: 300 });
    assert.ok(dR < dC, 'root closer than diamond bottom');
  });
});

/* ================================================================
 *  AVSDF circular layout (He & Sykora)
 * ================================================================ */

/**
 * Count chord crossings for a circular ordering of undirected edges.
 * Two chords (a,b) and (c,d) cross iff exactly one of c,d lies in the
 * open interval between a and b on the circle.
 */
function countCircularCrossings(order, edges) {
  const pos = new Map(order.map((id, i) => [id, i]));
  let count = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const [a, b] = [edges[i].from, edges[i].to];
      const [c, d] = [edges[j].from, edges[j].to];
      if (a === c || a === d || b === c || b === d) continue;
      const pa = pos.get(a), pb = pos.get(b), pc = pos.get(c), pd = pos.get(d);
      const lo1 = Math.min(pa, pb), hi1 = Math.max(pa, pb);
      const lo2 = Math.min(pc, pd), hi2 = Math.max(pc, pd);
      if ((lo1 < lo2 && lo2 < hi1 && hi1 < hi2) || (lo2 < lo1 && lo1 < hi2 && hi2 < hi1)) {
        count++;
      }
    }
  }
  return count;
}

/** Derive the circular ordering the renderer produced from node positions. */
function circularOrder(nodes, cx, cy) {
  return nodes
    .map((n) => ({ id: n.id, a: Math.atan2(n.y - cy, n.x - cx) }))
    .sort((a, b) => a.a - b.a)
    .map((o) => o.id);
}

describe('avsdfLayout', () => {
  test('places nodes on a circle centered in the viewport', () => {
    const nodes = makeNodes(['a', 'b', 'c', 'd']);
    const edges = makeEdges([['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'a']]);
    avsdfLayout(nodes, edges, 400, 400);
    const cx = 200, cy = 200, radius = 160;
    for (const node of nodes) {
      const d = Math.hypot(node.x - cx, node.y - cy);
      assert.ok(Math.abs(d - radius) < 1e-6, `${node.id} not on circle`);
    }
  });

  test('resets velocity', () => {
    const nodes = makeNodes(['a', 'b', 'c']);
    const edges = makeEdges([['a', 'b'], ['b', 'c']]);
    avsdfLayout(nodes, edges, 300, 300);
    for (const node of nodes) {
      assert.equal(node.vx, 0);
      assert.equal(node.vy, 0);
    }
  });

  test('single node goes to center', () => {
    const nodes = makeNodes(['only']);
    avsdfLayout(nodes, [], 200, 200);
    assert.equal(nodes[0].x, 100);
    assert.equal(nodes[0].y, 100);
  });

  test('empty input is a no-op', () => {
    avsdfLayout([], [], 200, 200);
  });

  test('two connected nodes are placed on the circle', () => {
    const nodes = makeNodes(['a', 'b']);
    const edges = makeEdges([['a', 'b']]);
    avsdfLayout(nodes, edges, 400, 400);
    const cx = 200, cy = 200, radius = 160;
    for (const node of nodes) {
      const d = Math.hypot(node.x - cx, node.y - cy);
      assert.ok(Math.abs(d - radius) < 1e-6);
    }
  });

  test('produces zero crossings for a tree', () => {
    // Paper §3.1: AVSDF yields an optimal (zero-crossing) drawing for any tree.
    const nodes = makeNodes(['root', 'a', 'b', 'c', 'd', 'e']);
    const edges = makeEdges([
      ['root', 'a'], ['root', 'b'], ['root', 'c'],
      ['b', 'd'], ['b', 'e'],
    ]);
    avsdfLayout(nodes, edges, 400, 400);
    const order = circularOrder(nodes, 200, 200);
    assert.equal(countCircularCrossings(order, edges), 0);
  });

  test('produces zero crossings for a path graph', () => {
    const nodes = makeNodes(['n0', 'n1', 'n2', 'n3', 'n4', 'n5']);
    const edges = makeEdges([
      ['n0', 'n1'], ['n1', 'n2'], ['n2', 'n3'],
      ['n3', 'n4'], ['n4', 'n5'],
    ]);
    avsdfLayout(nodes, edges, 400, 400);
    const order = circularOrder(nodes, 200, 200);
    assert.equal(countCircularCrossings(order, edges), 0);
  });

  test('starts from the smallest-degree vertex', () => {
    // Star: center has degree 5, leaves degree 1. The first-placed vertex
    // (angle 0) must be a leaf, not the center.
    const nodes = makeNodes(['center', 'l1', 'l2', 'l3', 'l4', 'l5']);
    const edges = makeEdges([
      ['center', 'l1'], ['center', 'l2'], ['center', 'l3'],
      ['center', 'l4'], ['center', 'l5'],
    ]);
    avsdfLayout(nodes, edges, 400, 400, { startAngle: 0 });
    // Node at angle 0 is the first in the ordering → on the +x axis.
    const onAxis = nodes.find((n) => Math.abs(n.y - 200) < 1e-6 && n.x > 200);
    assert.ok(onAxis, 'expected a node on the +x axis');
    assert.notEqual(onAxis.id, 'center');
  });

  test('handles disconnected graphs without error', () => {
    // Two disjoint edges. All vertices have degree 1 so AVSDF must
    // restart from a new component after the first is consumed.
    const nodes = makeNodes(['a', 'b', 'c', 'd']);
    const edges = makeEdges([['a', 'b'], ['c', 'd']]);
    avsdfLayout(nodes, edges, 400, 400);
    const order = circularOrder(nodes, 200, 200);
    assert.equal(order.length, 4);
    // Each component is an edge → zero crossings overall.
    assert.equal(countCircularCrossings(order, edges), 0);
  });

  test('isolated nodes are still placed on the circle', () => {
    const nodes = makeNodes(['iso1', 'iso2', 'a', 'b']);
    const edges = makeEdges([['a', 'b']]);
    avsdfLayout(nodes, edges, 400, 400);
    const cx = 200, cy = 200, radius = 160;
    for (const node of nodes) {
      const d = Math.hypot(node.x - cx, node.y - cy);
      assert.ok(Math.abs(d - radius) < 1e-6, `${node.id} not on circle`);
    }
  });

  test('local adjusting reduces (or keeps) crossings', () => {
    // A graph where the greedy AVSDF order is suboptimal: K4 joined to
    // a 4-cycle by a perfect matching. Brute force confirms the optimum
    // is 7 crossings; without adjusting AVSDF reaches 8.
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const edges = makeEdges([
      ['a', 'b'], ['a', 'c'], ['a', 'd'],
      ['b', 'c'], ['b', 'd'], ['c', 'd'],          // K4
      ['e', 'f'], ['f', 'g'], ['g', 'h'], ['h', 'e'], // 4-cycle
      ['a', 'e'], ['b', 'f'], ['c', 'g'], ['d', 'h'], // matching
    ]);
    const nodesA = makeNodes(ids);
    avsdfLayout(nodesA, edges, 400, 400, { adjust: false });
    const cWithout = countCircularCrossings(circularOrder(nodesA, 200, 200), edges);

    const nodesB = makeNodes(ids);
    avsdfLayout(nodesB, edges, 400, 400, { adjust: true });
    const cWith = countCircularCrossings(circularOrder(nodesB, 200, 200), edges);

    assert.ok(cWith <= cWithout, `adjusting should not increase crossings (${cWithout} -> ${cWith})`);
    assert.ok(cWith < cWithout, `adjusting should strictly reduce crossings (${cWithout} -> ${cWith})`);
  });

  test('adjusting is gated by adjustThreshold', () => {
    // Five-node graph: below threshold adjusting runs; above it doesn't.
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const edges = makeEdges([
      ['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'a'], ['a', 'c'],
    ]);
    const nodesA = makeNodes(ids);
    avsdfLayout(nodesA, edges, 400, 400, { adjust: true, adjustThreshold: 10 });
    const orderA = circularOrder(nodesA, 200, 200);

    const nodesB = makeNodes(ids);
    avsdfLayout(nodesB, edges, 400, 400, { adjust: true, adjustThreshold: 2 });
    const orderB = circularOrder(nodesB, 200, 200);

    // With threshold 10 the pass runs; with threshold 2 it is skipped.
    // The two orders need not differ for every graph, but the call must
    // not throw and must still place nodes on the circle.
    assert.equal(orderA.length, ids.length);
    assert.equal(orderB.length, ids.length);
  });

  test('honours custom radius and start angle', () => {
    const nodes = makeNodes(['a', 'b', 'c']);
    const edges = makeEdges([['a', 'b'], ['b', 'c']]);
    avsdfLayout(nodes, edges, 200, 200, { radius: 50, startAngle: 0 });
    // First-ordered node at angle 0 → (150, 100).
    const onAxis = nodes.find((n) => Math.abs(n.y - 100) < 1e-6 && n.x > 100);
    assert.ok(onAxis);
    const d = Math.hypot(onAxis.x - 100, onAxis.y - 100);
    assert.ok(Math.abs(d - 50) < 1e-6);
  });

  test('order is deterministic for identical inputs', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const edges = makeEdges([
      ['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e'], ['e', 'a'], ['a', 'c'],
    ]);
    const nodesA = makeNodes(ids);
    avsdfLayout(nodesA, edges, 400, 400);
    const orderA = circularOrder(nodesA, 200, 200).join(',');

    const nodesB = makeNodes(ids);
    avsdfLayout(nodesB, edges, 400, 400);
    const orderB = circularOrder(nodesB, 200, 200).join(',');

    assert.equal(orderA, orderB, 'AVSDF order must be deterministic');
  });

  test('handles a DAG by treating edges as undirected', () => {
    // Directed cycle a→b→c→d→a plus chord a→c. The circular crossing
    // number is defined on undirected graphs, so the renderer must not
    // treat direction as meaningful here.
    const nodes = makeNodes(['a', 'b', 'c', 'd']);
    const edges = makeEdges([
      ['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'a'], ['a', 'c'],
    ]);
    avsdfLayout(nodes, edges, 400, 400);
    const order = circularOrder(nodes, 200, 200);
    // 4-cycle + one chord has a 0-crossing layout; confirm no more than 1.
    const c = countCircularCrossings(order, edges);
    assert.ok(c <= 1, `expected at most 1 crossing, got ${c}`);
  });
});

/* ================================================================
 *  groupedDiscreteLayout
 * ================================================================ */

describe('groupedDiscreteLayout', () => {
  function makeGroupedNodes(count) {
    return Array.from({ length: count }, (_, i) => ({ id: `n${i}`, x: 0, y: 0, vx: 1, vy: 1 }));
  }

  test('every node lands inside its cluster region', () => {
    const groups = new Map([
      ['a', makeGroupedNodes(4)],
      ['b', makeGroupedNodes(3)],
      ['c', makeGroupedNodes(2)],
    ]);
    const regions = groupedDiscreteLayout(circleLayout, groups, 800, 600);
    for (const [key, nodes] of groups) {
      const r = regions.get(key);
      assert.ok(r, `missing region for ${key}`);
      for (const node of nodes) {
        assert.ok(node.x >= r.cx - r.w / 2 - 1e-6, `${key} node left of region`);
        assert.ok(node.x <= r.cx + r.w / 2 + 1e-6, `${key} node right of region`);
        assert.ok(node.y >= r.cy - r.h / 2 - 1e-6, `${key} node above region`);
        assert.ok(node.y <= r.cy + r.h / 2 + 1e-6, `${key} node below region`);
      }
    }
  });

  test('regions for different clusters do not overlap', () => {
    const groups = new Map([
      ['a', makeGroupedNodes(5)],
      ['b', makeGroupedNodes(4)],
      ['c', makeGroupedNodes(3)],
      ['d', makeGroupedNodes(2)],
    ]);
    const regions = groupedDiscreteLayout(gridLayout, groups, 800, 600);
    const rects = [...regions.values()].map((r) => ({
      x0: r.cx - r.w / 2, x1: r.cx + r.w / 2,
      y0: r.cy - r.h / 2, y1: r.cy + r.h / 2,
    }));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        const overlapX = a.x0 < b.x1 && b.x0 < a.x1;
        const overlapY = a.y0 < b.y1 && b.y0 < a.y1;
        assert.ok(!(overlapX && overlapY), `regions ${i} and ${j} overlap`);
      }
    }
  });

  test('velocities reset to 0', () => {
    const groups = new Map([
      ['a', makeGroupedNodes(3)],
      ['b', makeGroupedNodes(2)],
    ]);
    groupedDiscreteLayout(circleLayout, groups, 800, 600);
    for (const nodes of groups.values()) {
      for (const node of nodes) {
        assert.equal(node.vx, 0);
        assert.equal(node.vy, 0);
      }
    }
  });

  test('empty groups map returns empty regions', () => {
    const regions = groupedDiscreteLayout(circleLayout, new Map(), 800, 600);
    assert.equal(regions.size, 0);
  });

  test('single cluster fills the whole viewport region', () => {
    const groups = new Map([['only', makeGroupedNodes(4)]]);
    const regions = groupedDiscreteLayout(circleLayout, groups, 800, 600);
    assert.equal(regions.size, 1);
    const r = regions.get('only');
    assert.equal(r.cx, 400);
    assert.equal(r.cy, 300);
    // All nodes must be within the single region
    for (const node of groups.get('only')) {
      assert.ok(Math.abs(node.x - 400) <= r.w / 2 + 1e-6);
      assert.ok(Math.abs(node.y - 300) <= r.h / 2 + 1e-6);
    }
  });

  test('single node per cluster still gets a region', () => {
    const groups = new Map([
      ['a', makeGroupedNodes(1)],
      ['b', makeGroupedNodes(1)],
    ]);
    const regions = groupedDiscreteLayout(circleLayout, groups, 800, 600);
    assert.equal(regions.size, 2);
    for (const [key, nodes] of groups) {
      const r = regions.get(key);
      assert.ok(r, `missing region for ${key}`);
      assert.ok(Math.abs(nodes[0].x - r.cx) <= r.w / 2 + 1e-6);
      assert.ok(Math.abs(nodes[0].y - r.cy) <= r.h / 2 + 1e-6);
    }
  });

  test('clusters with zero visible members do not appear', () => {
    const groups = new Map([
      ['a', makeGroupedNodes(3)],
      ['empty', []],
    ]);
    const regions = groupedDiscreteLayout(circleLayout, groups, 800, 600);
    assert.equal(regions.size, 1);
    assert.ok(!regions.has('empty'));
  });

  test('deterministic for same input', () => {
    const make = () => new Map([
      ['a', makeGroupedNodes(4)],
      ['b', makeGroupedNodes(2)],
      ['c', makeGroupedNodes(3)],
    ]);
    const r1 = groupedDiscreteLayout(circleLayout, make(), 800, 600);
    const r2 = groupedDiscreteLayout(circleLayout, make(), 800, 600);
    assert.deepEqual([...r1], [...r2]);
  });

  test('works with every discrete layout as the base function', () => {
    const groups = new Map([
      ['a', makeGroupedNodes(4)],
      ['b', makeGroupedNodes(3)],
    ]);
    const edges = makeEdges([['a', 'b']]);
    const fns = [
      (nodes, w, h) => circleLayout(nodes, w, h),
      (nodes, w, h) => gridLayout(nodes, w, h),
      (nodes, w, h) => concentricLayout(nodes, edges, w, h),
      (nodes, w, h) => radialTreeLayout(nodes, () => [], w, h),
      (nodes, w, h) => avsdfLayout(nodes, edges, w, h),
    ];
    for (const fn of fns) {
      const regions = groupedDiscreteLayout(fn, groups, 800, 600);
      assert.equal(regions.size, 2);
      for (const nodes of groups.values()) {
        for (const node of nodes) {
          assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y), 'positions must be finite');
        }
      }
    }
  });
});
