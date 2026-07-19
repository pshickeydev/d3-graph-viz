import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  circleLayout,
  gridLayout,
  concentricLayout,
  radialTreeLayout,
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
    radialTreeLayout(nodes, parentsOf, 400, 400);
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
    radialTreeLayout(nodes, parentsOf, 600, 600);
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
    radialTreeLayout(nodes, parentsOf, 400, 400);
    const r1 = nodes.find((n) => n.id === 'r1');
    const r2 = nodes.find((n) => n.id === 'r2');
    // Both roots at center
    assert.ok(Math.hypot(r1.x - 200, r1.y - 200) < 1e-6);
    assert.ok(Math.hypot(r2.x - 200, r2.y - 200) < 1e-6);
  });

  test('resets velocity', () => {
    const nodes = makeNodes(['r', 'c']);
    const parentsOf = new Map([['c', ['r']]]);
    radialTreeLayout(nodes, parentsOf, 400, 400);
    for (const node of nodes) {
      assert.equal(node.vx, 0);
      assert.equal(node.vy, 0);
    }
  });

  test('empty input is a no-op', () => {
    radialTreeLayout([], new Map(), 200, 200);
  });

  test('single node goes to center', () => {
    const nodes = makeNodes(['solo']);
    radialTreeLayout(nodes, new Map(), 200, 200);
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
    radialTreeLayout(nodes, parentsOf, 600, 600);
    const get = (id) => nodes.find((n) => n.id === id);
    const dR = dist(get('r'), { x: 300, y: 300 });
    const dC = dist(get('c'), { x: 300, y: 300 });
    assert.ok(dR < dC, 'root closer than diamond bottom');
  });
});
