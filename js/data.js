/**
 * data.js — Parse, validate, and manage graph data.
 *
 * All type/color/hierarchy information is derived from the loaded data
 * at runtime — nothing is hardcoded to a specific graph schema.
 */

/* ------------------------------------------------------------------ */
/*  Colour palette (auto-assigned to discovered types)                 */
/* ------------------------------------------------------------------ */

const PALETTE = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#3b82f6', // blue
  '#06b6d4', // cyan
  '#14b8a6', // teal
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ef4444', // red
  '#ec4899', // pink
  '#f97316', // orange
  '#84cc16', // lime
  '#a855f7', // purple
  '#22d3ee', // sky
  '#facc15', // yellow
  '#fb923c', // light-orange
  '#4ade80', // light-green
];

const REL_PALETTE = [
  '#64748b', // slate
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#10b981', // emerald
  '#ec4899', // pink
  '#06b6d4', // cyan
];

const REL_DASHES = [
  null,      // solid
  '6,3',
  '4,4',
  '2,2',
  '8,4',
  '3,6',
  '10,2',
  '5,5',
];

/** Fallback colour for overflow types. */
export const DEFAULT_COLOR = '#94a3b8';

/* ------------------------------------------------------------------ */
/*  Graph store                                                        */
/* ------------------------------------------------------------------ */

/**
 * @typedef {Object} GraphNode
 * @property {string}  id
 * @property {string}  type
 * @property {string}  label
 * @property {Object}  attrs
 * @property {number}  [childCount]  — total direct children
 * @property {boolean} [expanded]
 */

/**
 * @typedef {Object} GraphEdge
 * @property {string} from
 * @property {string} to
 * @property {string} rel
 */

/**
 * @typedef {Object} GraphData
 * @property {string}            [generated]
 * @property {Object}            [sources]
 * @property {Object}            [stats]
 * @property {GraphNode[]}       nodes
 * @property {GraphEdge[]}       edges
 */

export class GraphStore {
  constructor() {
    /** @type {GraphData|null} */
    this.raw = null;

    /** All nodes keyed by id. @type {Map<string, GraphNode>} */
    this.nodeMap = new Map();

    /** parent-id → [child-ids] */
    this.childrenOf = new Map();

    /** child-id → [parent-ids] */
    this.parentsOf = new Map();

    /** source-id → [edges] */
    this.edgesFrom = new Map();

    /** target-id → [edges] */
    this.edgesTo = new Map();

    /** Set of currently expanded node ids. */
    this.expanded = new Set();

    /** Set of node type strings currently enabled for display. */
    this.enabledTypes = new Set();

    /** Ordered list of discovered node types (roots first, leaves last). */
    this.typeList = [];

    /** Auto-assigned colour per node type. @type {Map<string, string>} */
    this.typeColors = new Map();

    /** Set of node types that appear as roots (no incoming edges). */
    this.rootTypes = new Set();

    /** Ordered list of discovered edge rel types. */
    this.relList = [];

    /** Auto-assigned colour per edge rel. @type {Map<string, string>} */
    this.relColors = new Map();

    /** Auto-assigned dash pattern per edge rel. @type {Map<string, string|null>} */
    this.relDashes = new Map();
    /** @type {Map<string, number>} cached base radius per type */
    this._typeBaseRadius = new Map();
  }

  /* ---------------------------------------------------------------- */
  /*  Loading                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Load and index a graph JSON object.
   * @param {GraphData} json
   */
  load(json) {
    this._validate(json);
    this.raw = json;

    this.nodeMap.clear();
    this.childrenOf.clear();
    this.parentsOf.clear();
    this.edgesFrom.clear();
    this.edgesTo.clear();
    this.expanded.clear();
    this._typeBaseRadius.clear();

    // Index nodes
    for (const n of json.nodes) {
      this.nodeMap.set(n.id, { ...n, expanded: false, childCount: 0 });
    }

    // Index edges and build parent/child adjacency
    for (const e of json.edges) {
      if (!this.edgesFrom.has(e.from)) this.edgesFrom.set(e.from, []);
      this.edgesFrom.get(e.from).push(e);
      if (!this.edgesTo.has(e.to)) this.edgesTo.set(e.to, []);
      this.edgesTo.get(e.to).push(e);

      if (!this.childrenOf.has(e.from)) this.childrenOf.set(e.from, []);
      this.childrenOf.get(e.from).push(e.to);
      if (!this.parentsOf.has(e.to)) this.parentsOf.set(e.to, []);
      this.parentsOf.get(e.to).push(e.from);
    }

    // Compute child counts
    for (const [id, children] of this.childrenOf) {
      const node = this.nodeMap.get(id);
      if (node) node.childCount = children.length;
    }

    this._deriveTypeInfo();
    this._deriveRelInfo();

    this.enabledTypes = new Set(this.typeList);

    const levels = Math.max(this.typeList.length - 1, 1);
    const maxR = 24, minR = 4;
    const maxA = maxR * maxR, minA = minR * minR;
    this._typeBaseRadius.clear();
    for (let i = 0; i < this.typeList.length; i++) {
      this._typeBaseRadius.set(this.typeList[i], Math.sqrt(maxA - ((maxA - minA) * i) / levels));
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Auto-detection                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Derive the type list ordered by graph depth (roots first),
   * identify root types, and assign colours.
   */
  _deriveTypeInfo() {
    // Find all types and which have no parents (true roots)
    const typeCounts = new Map();
    const hasParent = new Set();

    for (const [id, node] of this.nodeMap) {
      typeCounts.set(node.type, (typeCounts.get(node.type) || 0) + 1);
      if (this.parentsOf.has(id) && this.parentsOf.get(id).length > 0) {
        hasParent.add(id);
      }
    }

    // Root types: among types with parentless nodes, pick only the
    // type(s) with the fewest such nodes.  This avoids treating large
    // parallel hierarchies (e.g. 288 owner-teams) as roots when a
    // small true-root type (e.g. 3 segments) exists.
    const parentlessByType = new Map();
    for (const [id, node] of this.nodeMap) {
      if (!hasParent.has(id)) {
        parentlessByType.set(node.type, (parentlessByType.get(node.type) || 0) + 1);
      }
    }

    this.rootTypes = new Set();
    if (parentlessByType.size > 0) {
      const minCount = Math.min(...parentlessByType.values());
      const threshold = Math.max(minCount * 3, 10);
      for (const [type, count] of parentlessByType) {
        if (count <= threshold) {
          this.rootTypes.add(type);
        }
      }
    }

    // Order types by average graph depth (BFS from roots)
    const typeDepthSum = new Map();
    const typeDepthCount = new Map();
    const visited = new Set();
    const queue = [];

    for (const [id] of this.nodeMap) {
      if (!hasParent.has(id)) {
        queue.push({ id, depth: 0 });
      }
    }

    let queuePtr = 0;
    while (queuePtr < queue.length) {
      const { id, depth } = queue[queuePtr++];
      if (visited.has(id)) continue;
      visited.add(id);

      const node = this.nodeMap.get(id);
      if (node) {
        const t = node.type;
        typeDepthSum.set(t, (typeDepthSum.get(t) || 0) + depth);
        typeDepthCount.set(t, (typeDepthCount.get(t) || 0) + 1);
      }

      const children = this.childrenOf.get(id) || [];
      for (const cid of children) {
        if (!visited.has(cid)) {
          queue.push({ id: cid, depth: depth + 1 });
        }
      }
    }

    // Sort types: lowest average depth first (roots), then by count descending
    const allTypes = [...typeCounts.keys()];
    allTypes.sort((a, b) => {
      const avgA = (typeDepthSum.get(a) || 0) / (typeDepthCount.get(a) || 1);
      const avgB = (typeDepthSum.get(b) || 0) / (typeDepthCount.get(b) || 1);
      if (avgA !== avgB) return avgA - avgB;
      return (typeCounts.get(b) || 0) - (typeCounts.get(a) || 0);
    });

    this.typeList = allTypes;

    // Assign colours round-robin from palette
    this.typeColors = new Map();
    for (let i = 0; i < allTypes.length; i++) {
      this.typeColors.set(allTypes[i], PALETTE[i % PALETTE.length]);
    }
  }

  /** Discover edge rel types, assign colours and dash patterns. */
  _deriveRelInfo() {
    const relCounts = new Map();
    for (const e of this.raw.edges) {
      relCounts.set(e.rel, (relCounts.get(e.rel) || 0) + 1);
    }

    this.relList = [...relCounts.keys()].sort(
      (a, b) => (relCounts.get(b) || 0) - (relCounts.get(a) || 0),
    );

    this.relColors = new Map();
    this.relDashes = new Map();
    for (let i = 0; i < this.relList.length; i++) {
      this.relColors.set(this.relList[i], REL_PALETTE[i % REL_PALETTE.length]);
      this.relDashes.set(this.relList[i], REL_DASHES[i % REL_DASHES.length]);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Validation                                                       */
  /* ---------------------------------------------------------------- */

  /** @param {any} json */
  _validate(json) {
    if (!json || typeof json !== 'object') {
      throw new Error('Invalid graph JSON: expected an object');
    }
    if (!Array.isArray(json.nodes)) {
      throw new Error('Invalid graph JSON: missing "nodes" array');
    }
    if (!Array.isArray(json.edges)) {
      throw new Error('Invalid graph JSON: missing "edges" array');
    }
    for (const n of json.nodes) {
      if (!n.id || !n.type) {
        throw new Error(`Invalid node: missing id or type — ${JSON.stringify(n).slice(0, 120)}`);
      }
    }
    for (const e of json.edges) {
      if (!e.from || !e.to || !e.rel) {
        throw new Error(`Invalid edge: missing from/to/rel — ${JSON.stringify(e).slice(0, 120)}`);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Expand / Collapse                                                */
  /* ---------------------------------------------------------------- */

  /**
   * Toggle expansion of a node.  Returns true if now expanded.
   * @param {string} nodeId
   * @returns {boolean}
   */
  toggleExpand(nodeId) {
    const node = this.nodeMap.get(nodeId);
    if (!node) return false;
    if (this.expanded.has(nodeId)) {
      this._collapseRecursive(nodeId);
      return false;
    }
    this.expanded.add(nodeId);
    node.expanded = true;
    return true;
  }

  expandAll() {
    for (const [id, node] of this.nodeMap) {
      if (this.childrenOf.has(id) && this.childrenOf.get(id).length > 0) {
        this.expanded.add(id);
        node.expanded = true;
      }
    }
  }

  collapseAll() {
    for (const id of this.expanded) {
      const node = this.nodeMap.get(id);
      if (node) node.expanded = false;
    }
    this.expanded.clear();
  }

  /** Recursively collapse a node and all its descendants. */
  _collapseRecursive(nodeId) {
    const stack = [nodeId];
    while (stack.length > 0) {
      const id = stack.pop();
      this.expanded.delete(id);
      const node = this.nodeMap.get(id);
      if (node) node.expanded = false;
      const children = this.childrenOf.get(id) || [];
      for (const cid of children) {
        if (this.expanded.has(cid)) {
          stack.push(cid);
        }
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Visible subset                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Compute the set of nodes and edges currently visible.
   *
   * A node is visible if:
   *   1. It has no parents AND its type is a root type, OR
   *   2. At least one of its parents is expanded.
   *   AND its type is in enabledTypes.
   *
   * @returns {{ nodes: GraphNode[], edges: GraphEdge[] }}
   */
  getVisible() {
    const visibleIds = new Set();
    const expanded = this.expanded;
    const enabled = this.enabledTypes;

    for (const [id, node] of this.nodeMap) {
      if (!enabled.has(node.type)) continue;

      const parents = this.parentsOf.get(id);
      if (!parents || parents.length === 0) {
        if (this.rootTypes.has(node.type)) {
          visibleIds.add(id);
        }
      } else if (parents.some((pid) => expanded.has(pid))) {
        visibleIds.add(id);
      }
    }

    const nodes = [];
    for (const id of visibleIds) {
      nodes.push(this.nodeMap.get(id));
    }

    const edges = [];
    for (const e of this.raw.edges) {
      if (visibleIds.has(e.from) && visibleIds.has(e.to)) {
        edges.push(e);
      }
    }

    return { nodes, edges };
  }

  /* ---------------------------------------------------------------- */
  /*  Search                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Search nodes by label substring (case-insensitive).
   * @param {string} query
   * @param {number} [limit=50]
   * @returns {GraphNode[]}
   */
  search(query, limit = 50) {
    if (!query) return [];
    const q = query.toLowerCase();
    const results = [];
    for (const node of this.nodeMap.values()) {
      const label = node.label || '';
      if (label.toLowerCase().includes(q) || node.id.toLowerCase().includes(q)) {
        results.push(node);
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  /**
   * Ensure a node is visible by expanding all its ancestor chain.
   * @param {string} nodeId
   */
  reveal(nodeId) {
    const ancestors = [];
    const visited = new Set();
    const queue = [nodeId];
    let ptr = 0;
    while (ptr < queue.length) {
      const current = queue[ptr++];
      if (visited.has(current)) continue;
      visited.add(current);
      const parents = this.parentsOf.get(current) || [];
      for (const pid of parents) {
        ancestors.push(pid);
        queue.push(pid);
      }
    }
    ancestors.reverse();
    for (const aid of ancestors) {
      const node = this.nodeMap.get(aid);
      if (node && !this.expanded.has(aid)) {
        this.expanded.add(aid);
        node.expanded = true;
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Queries                                                          */
  /* ---------------------------------------------------------------- */

  /** Get colour for a node type. */
  colorForType(type) {
    return this.typeColors.get(type) || DEFAULT_COLOR;
  }

  /** Get colour for an edge rel. */
  colorForRel(rel) {
    return this.relColors.get(rel) || DEFAULT_COLOR;
  }

  /** Get dash pattern for an edge rel. */
  dashForRel(rel) {
    return this.relDashes.get(rel) || null;
  }

  /**
   * Compute node radius based on its position in the type hierarchy
   * and its child count. Uses pre-computed base radius per type.
   * @param {GraphNode} node
   * @returns {number}
   */
  nodeRadius(node) {
    const base = this._typeBaseRadius.get(node.type);
    if (base === undefined) return 4;
    const extraA = Math.min(node.childCount || 0, 64);
    return Math.sqrt(base * base + extraA);
  }

  /**
   * Compute spatial cluster centers for each node type, arranged
   * in a circle around the canvas center. Used by the renderer's
   * cluster force so same-type nodes group together visually.
   * @param {number} width
   * @param {number} height
   * @returns {Map<string, {x: number, y: number}>}
   */
  clusterCenters(width, height) {
    const centers = new Map();
    const n = this.typeList.length;
    if (n === 0) return centers;
    const cx = width / 2;
    const cy = height / 2;
    if (n === 1) {
      centers.set(this.typeList[0], { x: cx, y: cy });
      return centers;
    }
    const radius = Math.min(width, height) * 0.35;
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
      centers.set(this.typeList[i], {
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      });
    }
    return centers;
  }

  /**
   * Get all edges connected to a node (in or out).
   * @param {string} nodeId
   * @returns {GraphEdge[]}
   */
  edgesForNode(nodeId) {
    const from = this.edgesFrom.get(nodeId) || [];
    const to = this.edgesTo.get(nodeId) || [];
    return [...from, ...to];
  }

  /**
   * Get direct children ids of a node.
   * @param {string} nodeId
   * @returns {string[]}
   */
  childrenIds(nodeId) {
    return this.childrenOf.get(nodeId) || [];
  }
}
