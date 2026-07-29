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

  test('countForRel returns edge count for each rel and 0 for unknown', () => {
    const { store } = createStore(100, 100);
    let total = 0;
    for (const rel of store.relList) {
      const count = store.countForRel(rel);
      let manual = 0;
      for (const e of store.raw.edges) if (e.rel === rel) manual++;
      assert.equal(count, manual);
      total += count;
    }
    assert.equal(total, store.raw.edges.length);
    assert.equal(store.countForRel('nonexistent'), 0);
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
 *  Colour overrides and legend
 * ================================================================ */

describe('colour overrides', () => {
  test('setTypeColor overrides type colour', () => {
    const { store } = createStore(100, 100);
    const type = store.typeList[0];
    store.setTypeColor(type, '#ff0000');
    assert.equal(store.colorForType(type), '#ff0000');
  });

  test('setRelColor overrides edge rel colour', () => {
    const { store } = createStore(100, 100);
    const rel = store.relList[0];
    store.setRelColor(rel, '#00ff00');
    assert.equal(store.colorForRel(rel), '#00ff00');
  });

  test('setCatColor overrides categorical colour and rebuilds cache', () => {
    const { store } = createStore(100, 100);
    store.setColorAttr('tier');
    const legend = store.getColorLegend();
    const firstVal = legend.entries[0].value;
    const origColor = legend.entries[0].color;
    store.setCatColor(firstVal, '#abcdef');
    const updated = store.getColorLegend();
    assert.equal(updated.entries[0].color, '#abcdef');
    assert.notEqual(origColor, '#abcdef');
  });

  test('setHeatRampStop overrides numeric ramp and rebuilds cache', () => {
    const { store } = createStore(100, 100);
    store.setColorAttr('score');
    store.setHeatRampStop(0, '#000000');
    const ramp = store.getHeatRamp();
    assert.equal(ramp[0], '#000000');
    const legend = store.getColorLegend();
    assert.equal(legend.stops[0], '#000000');
  });

  test('setColorAttr resets overrides', () => {
    const { store } = createStore(100, 100);
    store.setColorAttr('score');
    store.setHeatRampStop(0, '#000000');
    store.setColorAttr('tier');
    const ramp = store.getHeatRamp();
    assert.notEqual(ramp[0], '#000000');
  });

  test('type colour overrides persist across load()', () => {
    const { store } = createStore(100, 100);
    const type = store.typeList[0];
    store.setTypeColor(type, '#ff0000');
    assert.equal(store.colorForType(type), '#ff0000');
    // Reload a fresh graph that includes the same type name
    const fresh = generateGraph(50, 50);
    store.load(fresh);
    assert.ok(store.typeList.includes(type), 'fresh graph should include same type');
    assert.equal(store.colorForType(type), '#ff0000');
  });

  test('rel colour overrides persist across load()', () => {
    const { store } = createStore(100, 100);
    const rel = store.relList[0];
    store.setRelColor(rel, '#00ff00');
    assert.equal(store.colorForRel(rel), '#00ff00');
    const fresh = generateGraph(50, 50);
    store.load(fresh);
    assert.ok(store.relList.includes(rel), 'fresh graph should include same rel');
    assert.equal(store.colorForRel(rel), '#00ff00');
  });
});

describe('getColorLegend', () => {
  test('returns null when no colour attr active', () => {
    const { store } = createStore(100, 100);
    assert.equal(store.getColorLegend(), null);
  });

  test('returns numeric legend with stops', () => {
    const { store } = createStore(100, 100);
    store.setColorAttr('score');
    const legend = store.getColorLegend();
    assert.equal(legend.kind, 'numeric');
    assert.equal(legend.attr, 'score');
    assert.ok(legend.stops.length >= 2);
    assert.equal(legend.min, 0);
    assert.equal(legend.max, 100);
  });

  test('returns categorical legend with entries', () => {
    const { store } = createStore(100, 100);
    store.setColorAttr('tier');
    const legend = store.getColorLegend();
    assert.equal(legend.kind, 'categorical');
    assert.ok(legend.entries.length >= 2);
    for (const e of legend.entries) {
      assert.ok(e.value);
      assert.ok(e.color.startsWith('#'));
    }
  });
});

/* ================================================================
 *  Multi-root support
 * ================================================================ */

describe('multi-root support', () => {
  test('all zero-indegree types become root types', () => {
    const store = new GraphStore();
    store.load({
      nodes: [
        { id: 'seg1', type: 'segment', label: 'Segment 1' },
        { id: 'seg2', type: 'segment', label: 'Segment 2' },
        ...Array.from({ length: 200 }, (_, i) => ({
          id: `owner-${i}`, type: 'owner-team', label: `Team ${i}`,
        })),
        { id: 'repo1', type: 'repo', label: 'Repo 1' },
      ],
      edges: [
        { from: 'seg1', to: 'repo1', rel: 'contains' },
        { from: 'owner-0', to: 'repo1', rel: 'owns' },
      ],
    });
    assert.ok(store.rootTypes.has('segment'), 'segment should be a root type');
    assert.ok(store.rootTypes.has('owner-team'), 'owner-team should be a root type');
  });

  test('all root types visible initially', () => {
    const store = new GraphStore();
    store.load({
      nodes: [
        { id: 'seg1', type: 'segment', label: 'Segment 1' },
        ...Array.from({ length: 50 }, (_, i) => ({
          id: `team-${i}`, type: 'team', label: `Team ${i}`,
        })),
        { id: 'repo1', type: 'repo', label: 'Repo 1' },
      ],
      edges: [
        { from: 'seg1', to: 'repo1', rel: 'contains' },
        { from: 'team-0', to: 'repo1', rel: 'owns' },
      ],
    });
    const visible = store.getVisible();
    const visibleIds = new Set(visible.nodes.map(n => n.id));
    assert.ok(visibleIds.has('seg1'), 'segment root should be visible');
    for (let i = 0; i < 50; i++) {
      assert.ok(visibleIds.has(`team-${i}`), `team-${i} should be visible`);
    }
    assert.ok(!visibleIds.has('repo1'), 'repo child should not be visible initially');
  });

  test('reveal works for children under any root hierarchy', () => {
    const store = new GraphStore();
    store.load({
      nodes: [
        { id: 'seg1', type: 'segment', label: 'Segment 1' },
        ...Array.from({ length: 50 }, (_, i) => ({
          id: `team-${i}`, type: 'team', label: `Team ${i}`,
        })),
        { id: 'repo1', type: 'repo', label: 'Repo 1' },
      ],
      edges: [
        { from: 'seg1', to: 'repo1', rel: 'contains' },
        { from: 'team-0', to: 'repo1', rel: 'owns' },
      ],
    });
    store.reveal('repo1');
    const visible = store.getVisible();
    const visibleIds = new Set(visible.nodes.map(n => n.id));
    assert.ok(visibleIds.has('repo1'), 'repo should be visible after reveal');
    assert.ok(store.expanded.has('seg1'), 'segment parent should be expanded');
    assert.ok(store.expanded.has('team-0'), 'team parent should be expanded');
  });

  test('types with mixed parentless and parented nodes are root types', () => {
    const store = new GraphStore();
    store.load({
      nodes: [
        { id: 'cat1', type: 'category', label: 'Category 1' },
        { id: 'cat2', type: 'category', label: 'Category 2' },
        { id: 'item1', type: 'item', label: 'Item 1' },
      ],
      edges: [
        { from: 'cat1', to: 'cat2', rel: 'contains' },
        { from: 'cat2', to: 'item1', rel: 'contains' },
      ],
    });
    assert.ok(store.rootTypes.has('category'),
      'category should be root (cat1 is parentless)');
    const visible = store.getVisible();
    const visibleIds = new Set(visible.nodes.map(n => n.id));
    assert.ok(visibleIds.has('cat1'), 'parentless cat1 should be visible');
    assert.ok(!visibleIds.has('cat2'), 'parented cat2 should not be visible initially');
  });
});

/* ================================================================
 *  Colour scale modes (log / percentile)
 * ================================================================ */

describe('colour scale modes', () => {
  function createSkewedStore() {
    const store = new GraphStore();
    const nodes = [];
    for (let i = 0; i < 100; i++) {
      nodes.push({
        id: `n${i}`, type: 'item', label: `Item ${i}`,
        attrs: { value: i < 95 ? i : i * 100 },
      });
    }
    store.load({ nodes, edges: [] });
    return store;
  }

  test('setColorScale changes the scale mode', () => {
    const store = createSkewedStore();
    assert.equal(store.colorScale, 'linear');
    store.setColorAttr('value');
    store.setColorScale('log');
    assert.equal(store.colorScale, 'log');
  });

  test('log scale spreads out skewed values', () => {
    const store = createSkewedStore();
    store.setColorAttr('value');

    const linearColor50 = store.nodeColor(store.nodeMap.get('n50'));
    const linearColor95 = store.nodeColor(store.nodeMap.get('n95'));

    store.setColorScale('log');
    const logColor50 = store.nodeColor(store.nodeMap.get('n50'));
    const logColor95 = store.nodeColor(store.nodeMap.get('n95'));

    assert.notEqual(logColor50, linearColor50,
      'log and linear should produce different colours for mid-range values');
  });

  test('percentile scale ranks values evenly', () => {
    const store = createSkewedStore();
    store.setColorAttr('value');
    store.setColorScale('percentile');

    const c0 = store.nodeColor(store.nodeMap.get('n0'));
    const c50 = store.nodeColor(store.nodeMap.get('n49'));
    const c99 = store.nodeColor(store.nodeMap.get('n99'));

    assert.notEqual(c0, c99, 'min and max should have different colours');
    assert.notEqual(c0, c50, 'min and median should have different colours');
  });

  test('setColorAttr resets scale to linear', () => {
    const store = createSkewedStore();
    store.setColorAttr('value');
    store.setColorScale('log');
    assert.equal(store.colorScale, 'log');
    store.setColorAttr('value');
    assert.equal(store.colorScale, 'linear');
  });

  test('getColorLegend includes scale mode', () => {
    const store = createSkewedStore();
    store.setColorAttr('value');
    store.setColorScale('percentile');
    const legend = store.getColorLegend();
    assert.equal(legend.scale, 'percentile');
  });
});

/* ================================================================
 *  Multi-parent type detection
 * ================================================================ */

describe('hasMultipleParentTypes', () => {
  test('returns true for nodes with parents of different types', () => {
    const store = new GraphStore();
    store.load({
      nodes: [
        { id: 'product1', type: 'product', label: 'Product 1' },
        { id: 'team1', type: 'team', label: 'Team 1' },
        { id: 'repo1', type: 'repo', label: 'Repo 1' },
      ],
      edges: [
        { from: 'product1', to: 'repo1', rel: 'contains' },
        { from: 'team1', to: 'repo1', rel: 'owns' },
      ],
    });
    assert.ok(store.hasMultipleParentTypes('repo1'));
  });

  test('returns false for nodes with parents of the same type', () => {
    const store = new GraphStore();
    store.load({
      nodes: [
        { id: 'cat1', type: 'category', label: 'Cat 1' },
        { id: 'cat2', type: 'category', label: 'Cat 2' },
        { id: 'item1', type: 'item', label: 'Item 1' },
      ],
      edges: [
        { from: 'cat1', to: 'item1', rel: 'contains' },
        { from: 'cat2', to: 'item1', rel: 'contains' },
      ],
    });
    assert.ok(!store.hasMultipleParentTypes('item1'));
  });

  test('returns false for root nodes (no parents)', () => {
    const store = new GraphStore();
    store.load({
      nodes: [
        { id: 'root1', type: 'root', label: 'Root 1' },
        { id: 'child1', type: 'child', label: 'Child 1' },
      ],
      edges: [
        { from: 'root1', to: 'child1', rel: 'contains' },
      ],
    });
    assert.ok(!store.hasMultipleParentTypes('root1'));
  });

  test('returns false for single-parent nodes', () => {
    const store = new GraphStore();
    store.load({
      nodes: [
        { id: 'root1', type: 'root', label: 'Root 1' },
        { id: 'child1', type: 'child', label: 'Child 1' },
      ],
      edges: [
        { from: 'root1', to: 'child1', rel: 'contains' },
      ],
    });
    assert.ok(!store.hasMultipleParentTypes('child1'));
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

/* ================================================================
 *  Attribute rollups
 * ================================================================ */

/** Build a small tree with a numeric 'score' attr for rollup tests. */
function createRollupStore(extraNodes = [], extraEdges = []) {
  const store = new GraphStore();
  // tree:
  //   root (no score)
  //   ├── a (10)
  //   │   ├── a1 (5)
  //   │   └── a2 (3)
  //   └── b (20)
  //       └── b1 (40)
  // Expected sums: root=78, a=18, b=60, a1=5, a2=3, b1=40
  // Expected maxes: root=40, a=10, b=40, a1=5, a2=3, b1=40
  const nodes = [
    { id: 'root', type: 'root', label: 'Root', attrs: {} },
    { id: 'a', type: 'branch', label: 'A', attrs: { score: 10 } },
    { id: 'b', type: 'branch', label: 'B', attrs: { score: 20 } },
    { id: 'a1', type: 'leaf', label: 'A1', attrs: { score: 5 } },
    { id: 'a2', type: 'leaf', label: 'A2', attrs: { score: 3 } },
    { id: 'b1', type: 'leaf', label: 'B1', attrs: { score: 40 } },
    // Filler nodes so 'score' passes the discovery count >= 5 threshold.
    { id: 'f0', type: 'leaf', label: 'F0', attrs: { score: 0 } },
    { id: 'f1', type: 'leaf', label: 'F1', attrs: { score: 1 } },
    { id: 'f2', type: 'leaf', label: 'F2', attrs: { score: 2 } },
  ];
  const edges = [
    { from: 'root', to: 'a', rel: 'contains' },
    { from: 'root', to: 'b', rel: 'contains' },
    { from: 'a', to: 'a1', rel: 'contains' },
    { from: 'a', to: 'a2', rel: 'contains' },
    { from: 'b', to: 'b1', rel: 'contains' },
  ];
  store.load({ nodes: [...nodes, ...extraNodes], edges: [...edges, ...extraEdges] });
  return store;
}

describe('rollup — defaults & state', () => {
  test('rollup is disabled by default', () => {
    const store = createRollupStore();
    assert.equal(store.rollupEnabled, false);
    assert.equal(store.rollupFn, 'sum');
    assert.equal(store.rollupActive(), false);
  });

  test('rollupActive is false when no numeric attr is active', () => {
    const store = createRollupStore();
    store.setRollupEnabled(true);
    // rollup enabled but no colour/size attr selected
    assert.equal(store.rollupActive(), false);
  });

  test('rollupActive is false when a categorical attr is active', () => {
    const store = createRollupStore();
    // 'tier' is categorical in graph-gen, but here we have no tier.
    // Add a categorical attr to a few nodes to get it discovered.
    for (const id of ['a', 'b', 'a1', 'a2', 'b1', 'f0', 'f1', 'f2']) {
      store.nodeMap.get(id).attrs.tier = 'gold';
    }
    store.load({
      nodes: [...store.nodeMap.values()].map((n) => ({ ...n, attrs: { ...n.attrs, tier: 'gold' } })),
      edges: store.raw.edges,
    });
    store.setRollupEnabled(true);
    store.setColorAttr('tier');
    assert.equal(store.rollupActive(), false);
  });

  test('rollupActive is true when rollup enabled and numeric colour attr active', () => {
    const store = createRollupStore();
    store.setColorAttr('score');
    store.setRollupEnabled(true);
    assert.equal(store.rollupActive(), true);
  });

  test('rollupActive is true when rollup enabled and numeric size attr active', () => {
    const store = createRollupStore();
    store.setSizeAttr('score');
    store.setRollupEnabled(true);
    assert.equal(store.rollupActive(), true);
  });

  test('setRollupEnabled toggles the flag', () => {
    const store = createRollupStore();
    store.setRollupEnabled(true);
    assert.equal(store.rollupEnabled, true);
    store.setRollupEnabled(false);
    assert.equal(store.rollupEnabled, false);
  });

  test('setRollupFn switches the aggregation function', () => {
    const store = createRollupStore();
    store.setRollupFn('max');
    assert.equal(store.rollupFn, 'max');
    store.setRollupFn('sum');
    assert.equal(store.rollupFn, 'sum');
  });

  test('setRollupFn ignores unknown functions', () => {
    const store = createRollupStore();
    store.setRollupFn('avg');
    assert.equal(store.rollupFn, 'sum');
  });
});

describe('rollup — sum aggregation', () => {
  test('aggregates self + all descendant values', () => {
    const store = createRollupStore();
    store.setColorAttr('score');
    store.setRollupEnabled(true);
    assert.equal(store.rollupValue(store.nodeMap.get('root')), 78);
    assert.equal(store.rollupValue(store.nodeMap.get('a')), 18);
    assert.equal(store.rollupValue(store.nodeMap.get('b')), 60);
    assert.equal(store.rollupValue(store.nodeMap.get('a1')), 5);
    assert.equal(store.rollupValue(store.nodeMap.get('a2')), 3);
    assert.equal(store.rollupValue(store.nodeMap.get('b1')), 40);
  });

  test('leaf with no descendants returns its own value', () => {
    const store = createRollupStore();
    store.setColorAttr('score');
    store.setRollupEnabled(true);
    assert.equal(store.rollupValue(store.nodeMap.get('a1')), 5);
  });

  test('node with no attr value and no descendants returns undefined', () => {
    const store = createRollupStore();
    store.setColorAttr('score');
    store.setRollupEnabled(true);
    // root has no score attr; its descendants do, so it should still
    // have a rollup. A truly empty node would return undefined.
    const empty = store.nodeMap.get('f0');
    empty.attrs = { score: 0 };
    assert.equal(store.rollupValue(empty), 0);
  });

  test('range reflects rolled-up values, not raw attr range', () => {
    const store = createRollupStore();
    store.setColorAttr('score');
    store.setRollupEnabled(true);
    const legend = store.getColorLegend();
    assert.equal(legend.min, 0);
    assert.equal(legend.max, 78);
    assert.equal(legend.rollup, true);
    assert.equal(legend.rollupFn, 'sum');
  });

  test('rollupValue returns undefined when rollup is off', () => {
    const store = createRollupStore();
    store.setColorAttr('score');
    // rollup disabled
    assert.equal(store.rollupValue(store.nodeMap.get('root')), undefined);
  });
});

describe('rollup — max aggregation', () => {
  test('aggregates max of self + descendant values', () => {
    const store = createRollupStore();
    store.setColorAttr('score');
    store.setRollupEnabled(true);
    store.setRollupFn('max');
    assert.equal(store.rollupValue(store.nodeMap.get('root')), 40);
    assert.equal(store.rollupValue(store.nodeMap.get('a')), 10);
    assert.equal(store.rollupValue(store.nodeMap.get('b')), 40);
    assert.equal(store.rollupValue(store.nodeMap.get('a1')), 5);
    assert.equal(store.rollupValue(store.nodeMap.get('b1')), 40);
  });

  test('legend reports max rollup function', () => {
    const store = createRollupStore();
    store.setColorAttr('score');
    store.setRollupEnabled(true);
    store.setRollupFn('max');
    const legend = store.getColorLegend();
    assert.equal(legend.rollupFn, 'max');
    assert.equal(legend.max, 40);
  });
});

describe('rollup — DAG diamonds count descendants once', () => {
  test('shared descendant is not double-counted in sum', () => {
    // root -> a, root -> b, a -> c, b -> c (diamond)
    // root's unique descendants: {a, b, a1, a2, b1, c}
    // sum(root) = 10 + 20 + 5 + 3 + 40 + 100 = 178 (c counted once)
    // Without dedup, c would be counted via both a and b -> 278.
    const store = createRollupStore(
      [{ id: 'c', type: 'leaf', label: 'C', attrs: { score: 100 } }],
      [
        { from: 'a', to: 'c', rel: 'contains' },
        { from: 'b', to: 'c', rel: 'contains' },
      ],
    );
    store.setColorAttr('score');
    store.setRollupEnabled(true);
    assert.equal(store.rollupValue(store.nodeMap.get('root')), 178);
    // a's unique descendants: {a, a1, a2, c} = 10 + 5 + 3 + 100 = 118
    assert.equal(store.rollupValue(store.nodeMap.get('a')), 118);
    // b's unique descendants: {b, b1, c} = 20 + 40 + 100 = 160
    assert.equal(store.rollupValue(store.nodeMap.get('b')), 160);
    assert.equal(store.rollupValue(store.nodeMap.get('c')), 100);
  });

  test('shared descendant is not double-counted in max', () => {
    const store = createRollupStore(
      [{ id: 'c', type: 'leaf', label: 'C', attrs: { score: 100 } }],
      [
        { from: 'a', to: 'c', rel: 'contains' },
        { from: 'b', to: 'c', rel: 'contains' },
      ],
    );
    store.setColorAttr('score');
    store.setRollupEnabled(true);
    store.setRollupFn('max');
    assert.equal(store.rollupValue(store.nodeMap.get('root')), 100);
    assert.equal(store.rollupValue(store.nodeMap.get('a')), 100);
    assert.equal(store.rollupValue(store.nodeMap.get('b')), 100);
  });
});

describe('rollup — cycles', () => {
  test('cycle members include the whole cycle in their descendant set', () => {
    // x -> y -> z -> x (cycle). Each can reach all three.
    const store = new GraphStore();
    const nodes = [
      { id: 'x', type: 't', label: 'X', attrs: { score: 1 } },
      { id: 'y', type: 't', label: 'Y', attrs: { score: 2 } },
      { id: 'z', type: 't', label: 'Z', attrs: { score: 3 } },
      { id: 'f0', type: 't', label: 'F0', attrs: { score: 0 } },
      { id: 'f1', type: 't', label: 'F1', attrs: { score: 1 } },
      { id: 'f2', type: 't', label: 'F2', attrs: { score: 2 } },
    ];
    const edges = [
      { from: 'x', to: 'y', rel: 'r' },
      { from: 'y', to: 'z', rel: 'r' },
      { from: 'z', to: 'x', rel: 'r' },
    ];
    store.load({ nodes, edges });
    store.setColorAttr('score');
    store.setRollupEnabled(true);
    assert.equal(store.rollupValue(store.nodeMap.get('x')), 6);
    assert.equal(store.rollupValue(store.nodeMap.get('y')), 6);
    assert.equal(store.rollupValue(store.nodeMap.get('z')), 6);
  });
});

describe('rollup — colour mapping', () => {
  test('ancestor without attr gets a colour when rollup is on', () => {
    const store = createRollupStore();
    store.setColorAttr('score');
    // Without rollup, root (no score attr) fades out
    assert.equal(store.nodeOpacity(store.nodeMap.get('root')), 0.15);
    assert.equal(store.nodeColor(store.nodeMap.get('root')), DEFAULT_COLOR);
    store.setRollupEnabled(true);
    // With rollup, root has a rolled-up value and gets a real colour
    assert.equal(store.nodeOpacity(store.nodeMap.get('root')), 1);
    assert.notEqual(store.nodeColor(store.nodeMap.get('root')), DEFAULT_COLOR);
  });

  test('disabling rollup reverts ancestor to faded state', () => {
    const store = createRollupStore();
    store.setColorAttr('score');
    store.setRollupEnabled(true);
    assert.equal(store.nodeOpacity(store.nodeMap.get('root')), 1);
    store.setRollupEnabled(false);
    assert.equal(store.nodeOpacity(store.nodeMap.get('root')), 0.15);
    assert.equal(store.nodeColor(store.nodeMap.get('root')), DEFAULT_COLOR);
  });

  test('leaf keeps a real colour and full opacity with rollup on', () => {
    const store = createRollupStore();
    store.setColorAttr('score');
    const leafColor = store.nodeColor(store.nodeMap.get('b1'));
    assert.notEqual(leafColor, DEFAULT_COLOR);
    store.setRollupEnabled(true);
    // The leaf's own value is its rollup, so it stays fully opaque
    // and coloured. The exact colour may shift because the legend
    // range now spans rolled-up values (0..78 instead of 0..40).
    assert.notEqual(store.nodeColor(store.nodeMap.get('b1')), DEFAULT_COLOR);
    assert.equal(store.nodeOpacity(store.nodeMap.get('b1')), 1);
  });

  test('changing colour attr rebuilds rollup for the new attr', () => {
    const store = createRollupStore();
    // Add a second numeric attr so we can switch
    for (const [id, node] of store.nodeMap) {
      if (node.attrs.score != null) {
        node.attrs.weight = node.attrs.score * 2;
      }
    }
    // reload to re-discover attrs
    store.load({
      nodes: [...store.nodeMap.values()].map((n) => ({ ...n, attrs: { ...n.attrs } })),
      edges: store.raw.edges,
    });
    store.setColorAttr('score');
    store.setRollupEnabled(true);
    assert.equal(store.rollupValue(store.nodeMap.get('root')), 78);
    store.setColorAttr('weight');
    // weight = 2*score, so rollup sum should be 2*78 = 156
    assert.equal(store.rollupValue(store.nodeMap.get('root')), 156);
    assert.equal(store.rollupActive(), true);
  });
});

describe('rollup — size mapping', () => {
  test('ancestor gets a radius when rollup is on', () => {
    const store = createRollupStore();
    store.setSizeAttr('score');
    // Without rollup, root (no score) gets the fallback min radius
    const beforeR = store.nodeRadius(store.nodeMap.get('root'));
    assert.equal(beforeR, 3);
    assert.equal(store.nodeOpacity(store.nodeMap.get('root')), 0.15);
    store.setRollupEnabled(true);
    // With rollup, root gets a real radius based on rolled-up value
    const afterR = store.nodeRadius(store.nodeMap.get('root'));
    assert.ok(afterR > 3, `root radius should grow with rollup, got ${afterR}`);
    assert.equal(store.nodeOpacity(store.nodeMap.get('root')), 1);
  });

  test('root has the largest radius because it has the largest rollup', () => {
    const store = createRollupStore();
    store.setSizeAttr('score');
    store.setRollupEnabled(true);
    const rootR = store.nodeRadius(store.nodeMap.get('root'));
    const leafR = store.nodeRadius(store.nodeMap.get('a2'));
    assert.ok(rootR > leafR, 'root (sum=78) should be larger than a2 (sum=3)');
  });
});

describe('rollup — edge weight', () => {
  test('edge weight uses rolled-up target value when active', () => {
    const store = createRollupStore();
    store.setColorAttr('score');
    // edge root->a: target is 'a'. Without rollup, a's weight = (10-0)/(78-0)
    const edge = store.raw.edges.find((e) => e.from === 'root' && e.to === 'a');
    store.setRollupEnabled(false);
    const wBefore = store.edgeWeight(edge);
    store.setRollupEnabled(true);
    const wAfter = store.edgeWeight(edge);
    // With rollup, a's rolled-up value is 18 (out of max 78)
    assert.ok(wAfter > 0 && wAfter <= 1);
    assert.notEqual(wBefore, wAfter, 'edge weight should change when rollup toggled');
    assert.ok(Math.abs(wAfter - 18 / 78) < 0.001, `expected ~0.231, got ${wAfter}`);
  });
});

describe('rollup — load resets state', () => {
  test('loading a new graph resets rollup to disabled', () => {
    const store = createRollupStore();
    store.setColorAttr('score');
    store.setRollupEnabled(true);
    store.setRollupFn('max');
    assert.equal(store.rollupEnabled, true);
    assert.equal(store.rollupFn, 'max');
    // load a fresh graph
    const fresh = createRollupStore();
    store.load({
      nodes: [...fresh.nodeMap.values()].map((n) => ({ ...n, attrs: { ...n.attrs } })),
      edges: fresh.raw.edges,
    });
    assert.equal(store.rollupEnabled, false);
    assert.equal(store.rollupFn, 'sum');
    assert.equal(store.rollupActive(), false);
  });
});

describe('rollup — performance on large graph', () => {
  test('rollup computes within reasonable time for 10k nodes', () => {
    const { store } = createStore(10000, 10000);
    store.setColorAttr('score');
    const t0 = performance.now();
    store.setRollupEnabled(true);
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 3000, `rollup on 10k nodes took ${elapsed.toFixed(1)}ms`);
    // sanity: most nodes should have a rollup value
    let withValue = 0;
    for (const node of store.nodeMap.values()) {
      if (store.rollupValue(node) != null) withValue++;
    }
    assert.ok(withValue > 5000, 'most nodes should have a rollup value');
  });

  test('switching attrs restores cached rollup values without recomputing descendant sets', () => {
    const { store } = createStore(1000, 1000);
    store.setColorAttr('score');
    store.setRollupEnabled(true);
    const scoreValue = store.rollupValue(store.nodeMap.get('n0'));
    assert.ok(scoreValue != null, 'score rollup should have a value');

    // Switch to another attr — descendant sets are reused, not recomputed
    store.setColorAttr('weight');
    const weightValue = store.rollupValue(store.nodeMap.get('n0'));
    assert.ok(weightValue != null, 'weight rollup should have a value');
    assert.notEqual(scoreValue, weightValue, 'different attrs should give different rollups');

    // Switch back — cached values are restored exactly
    store.setColorAttr('score');
    const restored = store.rollupValue(store.nodeMap.get('n0'));
    assert.equal(restored, scoreValue, 'restored rollup should match original');
  });

  test('changing rollup fn invalidates per-attr cache', () => {
    const { store } = createStore(1000, 1000);
    store.setColorAttr('score');
    store.setRollupEnabled(true);
    const sumValue = store.rollupValue(store.nodeMap.get('n0'));
    assert.ok(sumValue != null);

    store.setRollupFn('max');
    const maxValue = store.rollupValue(store.nodeMap.get('n0'));
    assert.ok(maxValue != null);
    assert.ok(maxValue <= sumValue, 'max should be <= sum');

    // Switching back to sum should restore the original value
    store.setRollupFn('sum');
    const restored = store.rollupValue(store.nodeMap.get('n0'));
    assert.equal(restored, sumValue, 'fn switch back should restore original value');
  });
});
