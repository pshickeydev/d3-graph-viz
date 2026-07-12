import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GraphStore, DEFAULT_COLOR } from '../js/data.js';
import { generateGraph } from './graph-gen.mjs';

/* ================================================================
 *  Helpers
 * ================================================================ */

function createStore(nodeCount, edgeCount) {
  const json = generateGraph(nodeCount, edgeCount);
  const store = new GraphStore();
  store.load(json);
  return { store, json };
}

/** Count how many nodes have at least one expanded parent (or are roots). */
function countVisibleNodes(store) {
  let count = 0;
  for (const [id, node] of store.nodeMap) {
    if (!store.enabledTypes.has(node.type)) continue;
    const parents = store.parentsOf.get(id);
    if (!parents || parents.length === 0) {
      if (store.rootTypes.has(node.type)) count++;
    } else if (parents.some((pid) => store.expanded.has(pid))) {
      count++;
    }
  }
  return count;
}

/* ================================================================
 *  Validation
 * ================================================================ */

describe('validation', () => {
  test('rejects non-object input', () => {
    const store = new GraphStore();
    assert.throws(() => store.load(null), /expected an object/);
    assert.throws(() => store.load('string'), /expected an object/);
  });

  test('rejects missing nodes array', () => {
    const store = new GraphStore();
    assert.throws(() => store.load({ edges: [] }), /missing "nodes" array/);
  });

  test('rejects missing edges array', () => {
    const store = new GraphStore();
    assert.throws(() => store.load({ nodes: [] }), /missing "edges" array/);
  });

  test('rejects node missing id', () => {
    const store = new GraphStore();
    assert.throws(
      () => store.load({ nodes: [{ type: 'x' }], edges: [] }),
      /missing id or type/,
    );
  });

  test('rejects edge missing rel', () => {
    const store = new GraphStore();
    assert.throws(
      () => store.load({ nodes: [{ id: 'a', type: 'x' }], edges: [{ from: 'a', to: 'b' }] }),
      /missing from\/to\/rel/,
    );
  });
});

/* ================================================================
 *  Load & Index
 * ================================================================ */

describe('load', () => {
  test('indexes all nodes into nodeMap', () => {
    const { store, json } = createStore(100, 100);
    assert.equal(store.nodeMap.size, json.nodes.length);
  });

  test('indexes all edges into edgesFrom / edgesTo', () => {
    const { store, json } = createStore(100, 100);
    let totalFrom = 0;
    let totalTo = 0;
    for (const arr of store.edgesFrom.values()) totalFrom += arr.length;
    for (const arr of store.edgesTo.values()) totalTo += arr.length;
    assert.equal(totalFrom, json.edges.length);
    assert.equal(totalTo, json.edges.length);
  });

  test('builds childrenOf / parentsOf adjacency', () => {
    const { store, json } = createStore(100, 100);
    let totalChildren = 0;
    let totalParents = 0;
    for (const arr of store.childrenOf.values()) totalChildren += arr.length;
    for (const arr of store.parentsOf.values()) totalParents += arr.length;
    assert.equal(totalChildren, json.edges.length);
    assert.equal(totalParents, json.edges.length);
  });

  test('computes childCount for every parent node', () => {
    const { store } = createStore(100, 100);
    for (const [id, children] of store.childrenOf) {
      const node = store.nodeMap.get(id);
      assert.equal(node.childCount, children.length);
    }
  });

  test('enabledTypes includes all discovered types', () => {
    const { store } = createStore(100, 100);
    for (const type of store.typeList) {
      assert.ok(store.enabledTypes.has(type));
    }
  });
});

/* ================================================================
 *  Type & Rel Detection
 * ================================================================ */

describe('type detection', () => {
  test('typeList is non-empty and contains "root" first', () => {
    const { store } = createStore(100, 100);
    assert.ok(store.typeList.length > 0);
    assert.equal(store.typeList[0], 'root');
  });

  test('rootTypes contains "root"', () => {
    const { store } = createStore(100, 100);
    assert.ok(store.rootTypes.has('root'));
  });

  test('typeColors assigned for every type', () => {
    const { store } = createStore(100, 100);
    for (const type of store.typeList) {
      const color = store.colorForType(type);
      assert.ok(color && color.startsWith('#'));
    }
  });

  test('colorForType returns DEFAULT_COLOR for unknown type', () => {
    const { store } = createStore(10, 10);
    assert.equal(store.colorForType('nonexistent'), DEFAULT_COLOR);
  });
});

describe('rel detection', () => {
  test('relList is sorted by frequency descending', () => {
    const { store } = createStore(100, 100);
    const counts = [];
    for (const rel of store.relList) {
      let c = 0;
      for (const e of store.raw.edges) if (e.rel === rel) c++;
      counts.push(c);
    }
    for (let i = 1; i < counts.length; i++) {
      assert.ok(counts[i - 1] >= counts[i], 'relList not sorted by count');
    }
  });

  test('relColors and relDashes assigned for every rel', () => {
    const { store } = createStore(100, 100);
    for (const rel of store.relList) {
      assert.ok(store.colorForRel(rel).startsWith('#'));
      const dash = store.dashForRel(rel);
      assert.ok(dash === null || typeof dash === 'string');
    }
  });

  test('colorForRel returns DEFAULT_COLOR for unknown rel', () => {
    const { store } = createStore(10, 10);
    assert.equal(store.colorForRel('nonexistent'), DEFAULT_COLOR);
  });
});

/* ================================================================
 *  Expand / Collapse
 * ================================================================ */

describe('expandAll', () => {
  test('marks every node with children as expanded', () => {
    const { store } = createStore(100, 100);
    store.expandAll();
    for (const [id, children] of store.childrenOf) {
      if (children.length > 0) {
        assert.ok(store.expanded.has(id), `node ${id} should be expanded`);
        assert.equal(store.nodeMap.get(id).expanded, true);
      }
    }
  });

  test('expandAll is idempotent', () => {
    const { store } = createStore(100, 100);
    store.expandAll();
    const sizeA = store.expanded.size;
    store.expandAll();
    assert.equal(store.expanded.size, sizeA);
  });
});

describe('collapseAll', () => {
  test('clears all expanded nodes', () => {
    const { store } = createStore(100, 100);
    store.expandAll();
    assert.ok(store.expanded.size > 0);
    store.collapseAll();
    assert.equal(store.expanded.size, 0);
    for (const [id] of store.nodeMap) {
      assert.equal(store.nodeMap.get(id).expanded, false);
    }
  });
});

describe('toggleExpand', () => {
  test('expands a node and returns true', () => {
    const { store } = createStore(100, 100);
    const firstParent = [...store.childrenOf.keys()][0];
    assert.ok(store.toggleExpand(firstParent));
    assert.ok(store.expanded.has(firstParent));
  });

  test('collapses a node and its descendants recursively', () => {
    const { store } = createStore(100, 100);
    store.expandAll();
    const parents = [...store.childrenOf.keys()];
    const rootId = parents[0];
    store.toggleExpand(rootId);
    assert.ok(!store.expanded.has(rootId));
    const children = store.childrenOf.get(rootId) || [];
    for (const cid of children) {
      if (store.childrenOf.has(cid)) {
        assert.ok(!store.expanded.has(cid), `child ${cid} should be collapsed`);
      }
    }
  });

  test('returns false for unknown node', () => {
    const { store } = createStore(10, 10);
    assert.equal(store.toggleExpand('nonexistent'), false);
  });
});

/* ================================================================
 *  getVisible
 * ================================================================ */

describe('getVisible — initial (only roots)', () => {
  test('visible node count equals count of root-type parentless nodes', () => {
    const { store } = createStore(100, 100);
    const visible = store.getVisible();
    const expected = countVisibleNodes(store);
    assert.equal(visible.nodes.length, expected);
  });

  test('visible edges is empty initially (no children visible)', () => {
    const { store } = createStore(100, 100);
    const visible = store.getVisible();
    // Only root nodes visible, their children are not yet expanded
    // so edges between roots and children are not both-visible
    assert.equal(visible.edges.length, 0);
  });
});

describe('getVisible — after expandAll', () => {
  test('all nodes with enabled types are visible', () => {
    const { store } = createStore(100, 100);
    store.expandAll();
    const visible = store.getVisible();
    const expected = countVisibleNodes(store);
    assert.equal(visible.nodes.length, expected);
  });

  test('all edges between visible nodes are returned', () => {
    const { store } = createStore(100, 100);
    store.expandAll();
    const visible = store.getVisible();
    const visibleIds = new Set(visible.nodes.map((n) => n.id));
    let expected = 0;
    for (const e of store.raw.edges) {
      if (visibleIds.has(e.from) && visibleIds.has(e.to)) expected++;
    }
    assert.equal(visible.edges.length, expected);
  });
});

describe('getVisible — after collapseAll', () => {
  test('only root-type nodes remain visible', () => {
    const { store } = createStore(100, 100);
    store.expandAll();
    store.collapseAll();
    const visible = store.getVisible();
    const expected = countVisibleNodes(store);
    assert.equal(visible.nodes.length, expected);
    assert.equal(expected, visible.nodes.length);
  });
});

describe('getVisible — type filtering', () => {
  test('disabling a type removes its nodes from visible set', () => {
    const { store } = createStore(100, 100);
    store.expandAll();
    const typeToRemove = store.typeList[store.typeList.length - 1];
    store.enabledTypes.delete(typeToRemove);
    const visible = store.getVisible();
    for (const node of visible.nodes) {
      assert.notEqual(node.type, typeToRemove);
    }
  });
});

/* ================================================================
 *  Search
 * ================================================================ */

describe('search', () => {
  test('finds nodes by label substring', () => {
    const { store } = createStore(100, 100);
    const results = store.search('Node 1');
    assert.ok(results.length > 0);
    for (const r of results) {
      assert.ok((r.label || '').toLowerCase().includes('node 1') ||
                r.id.toLowerCase().includes('node 1'));
    }
  });

  test('is case-insensitive', () => {
    const { store } = createStore(100, 100);
    const lower = store.search('node 5');
    const upper = store.search('NODE 5');
    assert.equal(lower.length, upper.length);
  });

  test('respects limit parameter', () => {
    const { store } = createStore(1000, 1000);
    const results = store.search('node', 10);
    assert.ok(results.length <= 10);
  });

  test('returns empty for empty query', () => {
    const { store } = createStore(100, 100);
    assert.equal(store.search('').length, 0);
  });
});

/* ================================================================
 *  Reveal
 * ================================================================ */

describe('reveal', () => {
  test('expands all ancestors of a deeply nested node', () => {
    const { store } = createStore(100, 100);
    // Find a leaf node that has parents
    let leafId = null;
    for (const [id] of store.nodeMap) {
      if (!store.childrenOf.has(id) && store.parentsOf.has(id)) {
        leafId = id;
        break;
      }
    }
    if (leafId) {
      store.reveal(leafId);
      const visible = store.getVisible();
      const visibleIds = new Set(visible.nodes.map((n) => n.id));
      assert.ok(visibleIds.has(leafId), 'revealed leaf should be visible');
    }
  });
});

/* ================================================================
 *  nodeRadius
 * ================================================================ */

describe('nodeRadius', () => {
  test('returns a positive number for known types', () => {
    const { store } = createStore(100, 100);
    for (const type of store.typeList) {
      const r = store.nodeRadius({ type, childCount: 0 });
      assert.ok(r > 0, `radius for ${type} should be positive`);
    }
  });

  test('returns 4 for unknown type', () => {
    const { store } = createStore(10, 10);
    assert.equal(store.nodeRadius({ type: 'unknown', childCount: 0 }), 4);
  });

  test('larger childCount produces larger radius', () => {
    const { store } = createStore(100, 100);
    const type = store.typeList[0];
    const small = store.nodeRadius({ type, childCount: 0 });
    const large = store.nodeRadius({ type, childCount: 50 });
    assert.ok(large > small, 'more children should mean larger radius');
  });

  test('radius caps at 64 extra area', () => {
    const { store } = createStore(100, 100);
    const type = store.typeList[0];
    const r64  = store.nodeRadius({ type, childCount: 64 });
    const r200 = store.nodeRadius({ type, childCount: 200 });
    assert.equal(r64, r200, 'extra area should cap at 64');
  });
});

/* ================================================================
 *  clusterCenters
 * ================================================================ */

describe('clusterCenters', () => {
  test('returns a center for every type', () => {
    const { store } = createStore(100, 100);
    const centers = store.clusterCenters(800, 600);
    for (const type of store.typeList) {
      assert.ok(centers.has(type), `missing center for type ${type}`);
    }
  });

  test('centers are arranged around canvas center', () => {
    const { store } = createStore(100, 100);
    const w = 800, h = 600;
    const centers = store.clusterCenters(w, h);
    const cx = w / 2, cy = h / 2;
    for (const [, c] of centers) {
      const dist = Math.hypot(c.x - cx, c.y - cy);
      assert.ok(dist > 0, 'center should not be at canvas center');
    }
  });

  test('single type center is at canvas center', () => {
    const store = new GraphStore();
    store.load({
      nodes: [{ id: 'a', type: 'only', label: 'A' }],
      edges: [],
    });
    const centers = store.clusterCenters(800, 600);
    const c = centers.get('only');
    assert.equal(c.x, 400);
    assert.equal(c.y, 300);
  });

  test('empty store returns empty map', () => {
    const store = new GraphStore();
    store.load({ nodes: [], edges: [] });
    const centers = store.clusterCenters(800, 600);
    assert.equal(centers.size, 0);
  });

  test('centers are deterministic for same dimensions', () => {
    const { store } = createStore(100, 100);
    const c1 = store.clusterCenters(800, 600);
    const c2 = store.clusterCenters(800, 600);
    for (const type of store.typeList) {
      assert.equal(c1.get(type).x, c2.get(type).x);
      assert.equal(c1.get(type).y, c2.get(type).y);
    }
  });
});

/* ================================================================
 *  edgesForNode & childrenIds
 * ================================================================ */

describe('edgesForNode', () => {
  test('returns combined in + out edges', () => {
    const { store } = createStore(100, 100);
    for (const [id] of store.nodeMap) {
      const edges = store.edgesForNode(id);
      const fromCount = (store.edgesFrom.get(id) || []).length;
      const toCount = (store.edgesTo.get(id) || []).length;
      assert.equal(edges.length, fromCount + toCount);
    }
  });
});

describe('childrenIds', () => {
  test('returns same array as childrenOf', () => {
    const { store } = createStore(100, 100);
    for (const [id] of store.nodeMap) {
      const children = store.childrenIds(id);
      const expected = store.childrenOf.get(id) || [];
      assert.deepEqual(children, expected);
    }
  });
});

/* ================================================================
 *  Attribute discovery
 * ================================================================ */

describe('attribute discovery', () => {
  test('discovers numeric attrs', () => {
    const { store } = createStore(100, 100);
    const profile = store.attrProfiles.get('score');
    assert.ok(profile, 'score attr should be discovered');
    assert.equal(profile.kind, 'numeric');
    assert.equal(profile.min, 0);
    assert.equal(profile.max, 100);
  });

  test('discovers categorical attrs', () => {
    const { store } = createStore(100, 100);
    const profile = store.attrProfiles.get('tier');
    assert.ok(profile, 'tier attr should be discovered');
    assert.equal(profile.kind, 'categorical');
    assert.ok(profile.values.length >= 2);
  });

  test('colorableAttrs includes both numeric and categorical', () => {
    const { store } = createStore(100, 100);
    const attrs = store.colorableAttrs();
    assert.ok(attrs.length >= 2);
    const kinds = new Set(attrs.map((a) => a.kind));
    assert.ok(kinds.has('numeric'));
    assert.ok(kinds.has('categorical'));
  });

  test('sizableAttrs includes only numeric', () => {
    const { store } = createStore(100, 100);
    const attrs = store.sizableAttrs();
    assert.ok(attrs.length >= 1);
    for (const a of attrs) {
      assert.equal(a.kind, 'numeric');
    }
  });
});

/* ================================================================
 *  Colour-by-attr
 * ================================================================ */

describe('setColorAttr', () => {
  test('numeric attr assigns hex colours to nodes', () => {
    const { store } = createStore(100, 100);
    store.setColorAttr('score');
    let colored = 0;
    for (const node of store.nodeMap.values()) {
      const c = store.nodeColor(node);
      if (c !== DEFAULT_COLOR) colored++;
      assert.ok(c.startsWith('#'), `colour should be hex, got ${c}`);
    }
    assert.ok(colored > 50, 'most nodes should get attr-based colour');
  });

  test('categorical attr assigns palette colours', () => {
    const { store } = createStore(100, 100);
    store.setColorAttr('tier');
    const colours = new Set();
    for (const node of store.nodeMap.values()) {
      colours.add(store.nodeColor(node));
    }
    assert.ok(colours.size >= 2, 'should have at least 2 distinct colours');
  });

  test('null reverts to type colour', () => {
    const { store } = createStore(100, 100);
    const node = store.nodeMap.values().next().value;
    const typeColor = store.colorForType(node.type);
    store.setColorAttr('score');
    assert.notEqual(store.nodeColor(node), typeColor);
    store.setColorAttr(null);
    assert.equal(store.nodeColor(node), typeColor);
  });
});

/* ================================================================
 *  Size-by-attr
 * ================================================================ */

describe('setSizeAttr', () => {
  test('numeric attr produces varying radii', () => {
    const { store } = createStore(100, 100);
    store.setSizeAttr('score');
    const radii = new Set();
    for (const node of store.nodeMap.values()) {
      radii.add(store.nodeRadius(node));
    }
    assert.ok(radii.size > 3, 'should have multiple distinct radii');
  });

  test('null reverts to default sizing', () => {
    const { store } = createStore(100, 100);
    const node = store.nodeMap.values().next().value;
    const defaultR = store.nodeRadius(node);
    store.setSizeAttr('score');
    store.setSizeAttr(null);
    assert.equal(store.nodeRadius(node), defaultR);
  });

  test('min-value node gets minimum radius', () => {
    const { store } = createStore(100, 100);
    store.setSizeAttr('score');
    const minNode = [...store.nodeMap.values()].find((n) => n.attrs?.score === 0);
    if (minNode) {
      assert.equal(store.nodeRadius(minNode), 3);
    }
  });
});

/* ================================================================
 *  Node opacity
 * ================================================================ */

describe('nodeOpacity', () => {
  test('returns 1 when no attr mapping active', () => {
    const { store } = createStore(100, 100);
    for (const node of store.nodeMap.values()) {
      assert.equal(store.nodeOpacity(node), 1);
    }
  });

  test('fades nodes missing the active colour attr', () => {
    const store = new GraphStore();
    store.load({
      nodes: [
        { id: 'a', type: 'x', label: 'A', attrs: { val: 10 } },
        { id: 'b', type: 'x', label: 'B', attrs: { val: 20 } },
        { id: 'c', type: 'x', label: 'C', attrs: {} },
        { id: 'd', type: 'x', label: 'D', attrs: { val: 30 } },
        { id: 'e', type: 'x', label: 'E', attrs: { val: 40 } },
        { id: 'f', type: 'x', label: 'F', attrs: { val: 50 } },
      ],
      edges: [],
    });
    store.setColorAttr('val');
    assert.equal(store.nodeOpacity(store.nodeMap.get('a')), 1);
    assert.equal(store.nodeOpacity(store.nodeMap.get('c')), 0.15);
  });
});

/* ================================================================
 *  Edge weight
 * ================================================================ */

describe('edgeWeight', () => {
  test('returns 0.5 when no attr active', () => {
    const { store } = createStore(100, 100);
    const edge = store.raw.edges[0];
    assert.equal(store.edgeWeight(edge), 0.5);
  });

  test('scales with target node attr value', () => {
    const { store } = createStore(100, 100);
    store.setSizeAttr('score');
    const weights = store.raw.edges.slice(0, 20).map((e) => store.edgeWeight(e));
    const unique = new Set(weights);
    assert.ok(unique.size > 1, 'edge weights should vary');
  });
});

/* ================================================================
 *  Size-specific performance & correctness
 * ================================================================ */

function runSizeTests(label, nodeCount, edgeCount) {
  describe(`size: ${label} (${nodeCount} nodes, ${edgeCount} edges)`, () => {
    let store;
    let json;

    beforeEach(() => {
      const result = createStore(nodeCount, edgeCount);
      store = result.store;
      json = result.json;
    });

    test('loads without error and indexes all data', () => {
      assert.equal(store.nodeMap.size, json.nodes.length);
    });

    test('typeList and relList are populated', () => {
      assert.ok(store.typeList.length > 0);
      assert.ok(store.relList.length > 0);
    });

    test('getVisible returns only roots initially', () => {
      const visible = store.getVisible();
      assert.ok(visible.nodes.length < nodeCount,
        `expected fewer than ${nodeCount} visible nodes, got ${visible.nodes.length}`);
    });

    test('expandAll then getVisible returns all nodes', () => {
      store.expandAll();
      const visible = store.getVisible();
      assert.equal(visible.nodes.length, countVisibleNodes(store));
    });

    test('collapseAll then getVisible returns only roots', () => {
      store.expandAll();
      store.collapseAll();
      const visible = store.getVisible();
      assert.equal(visible.nodes.length, countVisibleNodes(store));
    });

    test('expandAll + collapseAll is fast enough', () => {
      const t0 = performance.now();
      store.expandAll();
      store.getVisible();
      store.collapseAll();
      store.getVisible();
      const elapsed = performance.now() - t0;
      // Generous threshold — should be well under 1s even for 10k
      assert.ok(elapsed < 2000, `expand/collapse cycle took ${elapsed.toFixed(1)}ms`);
    });

    test('toggleExpand on a parent reveals its children', () => {
      const firstParent = [...store.childrenOf.keys()][0];
      if (!firstParent) return;
      store.toggleExpand(firstParent);
      const visible = store.getVisible();
      const visibleIds = new Set(visible.nodes.map((n) => n.id));
      const children = store.childrenOf.get(firstParent) || [];
      for (const cid of children) {
        if (store.enabledTypes.has(store.nodeMap.get(cid).type)) {
          assert.ok(visibleIds.has(cid), `child ${cid} should be visible after expand`);
        }
      }
    });

    test('search finds results and respects limit', () => {
      const results = store.search('Node', 20);
      assert.ok(results.length > 0);
      assert.ok(results.length <= 20);
    });

    test('nodeRadius is consistent for same type + childCount', () => {
      const type = store.typeList[0];
      const r1 = store.nodeRadius({ type, childCount: 10 });
      const r2 = store.nodeRadius({ type, childCount: 10 });
      assert.equal(r1, r2);
    });
  });
}

runSizeTests('small', 10, 10);
runSizeTests('medium', 100, 100);
runSizeTests('large', 1000, 1000);
runSizeTests('extra large', 10000, 10000);
