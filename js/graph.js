/**
 * graph.js — D3 graph renderer.
 *
 * Supports a force-directed layout (default) and several discrete
 * static layouts (circle, grid, concentric, radial tree) via the
 * pure functions in layouts.js.
 *
 * Pulls all visual configuration (colours, sizes, dash patterns)
 * from the GraphStore instance — nothing is hardcoded to a
 * specific graph schema.
 */

/** @type {any} */
const d3 = typeof window !== 'undefined' ? /** @type {any} */ (window).d3 : undefined;

import {
  circleLayout,
  gridLayout,
  concentricLayout,
  radialTreeLayout,
  avsdfLayout,
  groupedDiscreteLayout,
  LAYOUT_LABELS,
} from './layouts.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function _truncateLabel(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

/* ------------------------------------------------------------------ */
/*  Cluster force — pulls each node toward its type's cluster center    */
/* ------------------------------------------------------------------ */

function forceCluster(clusterCenters, strength, keyFn) {
  let nodes;
  const keyOf = keyFn || ((node) => node.type);
  function force(alpha) {
    for (const node of nodes) {
      const center = clusterCenters.get(keyOf(node));
      if (!center) continue;
      node.vx += (center.x - node.x) * strength * alpha;
      node.vy += (center.y - node.y) * strength * alpha;
    }
  }
  force.initialize = (n) => { nodes = n; };
  return force;
}

/* ------------------------------------------------------------------ */
/*  GraphRenderer                                                      */
/* ------------------------------------------------------------------ */

export class GraphRenderer {
  /**
   * @param {HTMLElement}          container
   * @param {import('./data.js').GraphStore} store
   * @param {Object}               [opts]
   * @param {function}             [opts.onNodeClick]
   * @param {function}             [opts.onNodeHover]
   * @param {function}             [opts.onNodeHoverOut]
   * @param {function}             [opts.onBackgroundClick]
   */
  constructor(container, store, opts = {}) {
    this.container = container;
    this.store = store;
    this.onNodeClick = opts.onNodeClick || (() => { });
    this.onNodeHover = opts.onNodeHover || (() => { });
    this.onNodeHoverOut = opts.onNodeHoverOut || (() => { });
    this.onBackgroundClick = opts.onBackgroundClick || (() => { });

    this.width = container.clientWidth;
    this.height = container.clientHeight;

    /** @type {any} */
    this.svg = null;
    /** @type {any} */
    this.g = null;
    /** @type {any} */
    this.simulation = null;

    this._linkSel = null;
    this._nodeSel = null;
    this._labelSel = null;
    this._highlightedId = null;
    this.showLabels = true;
    this._preTickId = 0;
    this._clusterStrength = 0;
    this._zoomScale = 1;
    this._visibleNodeCount = 0;
    /** @type {{chargeStrength?: number, linkDistance?: number, gravity?: number, collisionPad?: number, clusterStrength?: number}} */
    this._forceOverrides = {};
    /** @type {{chargeStrength: number, linkDistance: number, gravity: number, collisionPad: number, clusterStrength: number}} */
    this._autoForceParams = { chargeStrength: 0, linkDistance: 0, gravity: 0, collisionPad: 0, clusterStrength: 0 };
    this._paused = false;
    /** @type {Object[]} last visible edges, used for discrete-layout resize */
    this._lastEdges = [];
    /** @type {Map<string, number>} precomputed edge weights, rebuilt each update */
    this._edgeWeights = new Map();
    /** Active layout key: 'force' | 'circle' | 'grid' | 'concentric' | 'radial' */
    this._layout = 'force';
    /**
     * Cluster regions from the grouped discrete layout, keyed by group.
     * Only set when grouping is enabled and a discrete layout is active.
     * @type {Map<string, {cx: number, cy: number, w: number, h: number}>|null}
     */
    this._groupRegions = null;

    this._init();
  }

  /* ---------------------------------------------------------------- */
  /*  Initialisation                                                   */
  /* ---------------------------------------------------------------- */

  _init() {
    const { width, height } = this;

    this.svg = d3.select(this.container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('role', 'img')
      .attr('aria-label', this._ariaLabel());

    this.svg.append('defs');

    // Zoom container
    this.g = this.svg.append('g');

    this._zoom = d3.zoom()
      .scaleExtent([0.01, 8])
      .on('zoom', (event) => {
        this.g.attr('transform', event.transform);
        const prevScale = this._zoomScale;
        this._zoomScale = event.transform.k;
        if (Math.abs(event.transform.k - prevScale) / (prevScale || 1) > 0.05) {
          this._updateLabelVisibility();
          this._updateHullLabelVisibility();
        }
      })
      .on('end', () => {
        this._updateLabelVisibility();
        this._updateHullLabelVisibility();
      });

    this.svg.call(this._zoom);

    this.svg.on('click', (event) => {
      if (event.target.tagName === 'svg' || event.target.tagName === 'rect') {
        this.onBackgroundClick();
      }
    });

    // Invisible rect to catch clicks on empty canvas
    this.svg.insert('rect', ':first-child')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('fill', 'transparent');

    // Sub-groups for draw ordering
    this.g.append('g').attr('class', 'hulls');
    this.g.append('g').attr('class', 'links');
    this.g.append('g').attr('class', 'nodes');
    this.g.append('g').attr('class', 'labels');

    // Simulation (starts paused — forces are tuned per-update in _tuneForces)
    this.simulation = d3.forceSimulation()
      .force('link', d3.forceLink().id((d) => d.id))
      .force('charge', d3.forceManyBody())
      .force('collision', d3.forceCollide())
      .force('x', d3.forceX(width / 2))
      .force('y', d3.forceY(height / 2))
      .force('cluster', forceCluster(new Map(), 0))
      .on('tick', () => this._tick());

    this.simulation.stop();

    // Resize observer
    const ro = new ResizeObserver(() => {
      this.width = this.container.clientWidth;
      this.height = this.container.clientHeight;
      this.svg.attr('viewBox', `0 0 ${this.width} ${this.height}`);
      this.simulation.force('x').x(this.width / 2);
      this.simulation.force('y').y(this.height / 2);
      const clusterCenters = this._clusterCentersForForce();
      this.simulation.force('cluster', forceCluster(clusterCenters, this._clusterStrength, this._clusterKeyFn()));
      // Discrete layouts are viewport-relative — recompute positions on resize.
      if (!this.isForceLayout()) {
        this._applyDiscreteLayout(this.simulation.nodes(), this._lastEdges);
        this._tick();
        this.fitToView();
      }
    });
    ro.observe(this.container);
  }

  /* ---------------------------------------------------------------- */
  /*  Reset (called when a new graph is loaded into the same renderer) */
  /* ---------------------------------------------------------------- */

  /**
   * Clear all rendered state so the renderer can be reused for a new
   * graph. Keeps the SVG element, zoom behaviour, drag handler, and
   * ResizeObserver alive — only the per-graph artefacts (selections,
   * markers, simulation nodes, layout state) are discarded.
   */
  reset() {
    // Cancel any in-flight pre-tick work
    this._preTickId++;

    // Restore collision force in case reset() happened mid-pre-tick
    if (!this.simulation.force('collision')) {
      this.simulation.force('collision', d3.forceCollide());
    }
    const overlay = this.container.querySelector('#loading-overlay');
    if (overlay) overlay.classList.add('hidden');

    this.simulation.stop();
    this.simulation.nodes([]);
    this.simulation.force('link').links([]);

    // Clear rendered DOM
    this.g.select('.hulls').selectAll('*').remove();
    this.g.select('.links').selectAll('*').remove();
    this.g.select('.nodes').selectAll('*').remove();
    this.g.select('.labels').selectAll('*').remove();
    this.svg.select('defs').selectAll('*').remove();

    // Drop selection handles so highlight/tick become no-ops until next update()
    this._linkSel = null;
    this._nodeSel = null;
    this._labelSel = null;

    // Reset per-graph state
    this._highlightedId = null;
    this._zoomScale = 1;
    this._visibleNodeCount = 0;
    this._forceOverrides = {};
    this._autoForceParams = { chargeStrength: 0, linkDistance: 0, gravity: 0, collisionPad: 0, clusterStrength: 0 };
    this._paused = false;
    this._lastEdges = [];
    this._edgeWeights = new Map();
    this._layout = 'force';
    this._groupRegions = null;
    this.svg.attr('aria-label', this._ariaLabel());

    // Reset zoom so the new graph starts un-transformed
    this.svg.call(this._zoom.transform, d3.zoomIdentity);
  }

  /* ---------------------------------------------------------------- */
  /*  Arrow markers (rebuilt when edge rels change)                     */
  /* ---------------------------------------------------------------- */

  _ensureArrowMarkers() {
    const defs = this.svg.select('defs');
    for (const rel of this.store.relList) {
      const id = `arrow-${CSS.escape(rel)}`;
      const existing = defs.select(`#${CSS.escape(id)}`);
      if (existing.empty()) {
        defs.append('marker')
          .attr('id', id)
          .attr('viewBox', '0 -5 10 10')
          .attr('refX', 20)
          .attr('refY', 0)
          .attr('markerWidth', 6)
          .attr('markerHeight', 6)
          .attr('orient', 'auto')
          .append('path')
          .attr('d', 'M0,-5L10,0L0,5')
          .attr('fill', this.store.colorForRel(rel))
          .attr('opacity', 0.6);
      } else {
        existing.select('path').attr('fill', this.store.colorForRel(rel));
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Update (called when visible data changes)                        */
  /* ---------------------------------------------------------------- */

  /**
   * Re-render with a new set of visible nodes and edges.
   * @param {{ nodes: Object[], edges: Object[] }} visible
   */
  update(visible) {
    const { nodes, edges } = visible;
    const store = this.store;
    this._lastEdges = edges;

    this._ensureArrowMarkers();

    const linkData = edges.map((e) => ({
      source: e.from,
      target: e.to,
      rel: e.rel,
      _raw: e,
    }));

    // Preserve existing positions from the simulation's internal node array
    const simOld = this.simulation.nodes();
    const oldPositions = new Map();
    for (let i = 0; i < simOld.length; i++) {
      const n = simOld[i];
      oldPositions.set(n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy });
    }

    // Compute cluster centers for initial placement and cluster force
    const clusterCenters = this._clusterCentersForForce(nodes);

    const spread = Math.min(50 + nodes.length * 0.15, 400);
    const simNodes = nodes.map((n) => {
      const old = oldPositions.get(n.id);
      if (old) {
        n.x = old.x;
        n.y = old.y;
        n.vx = old.vx;
        n.vy = old.vy;
      } else {
        const parents = store.parentIds(n.id);
        const parentPos = parents.length > 0 ? oldPositions.get(parents[0]) : null;
        if (parentPos) {
          const jitter = Math.min(40 + nodes.length * 0.05, 120);
          n.x = parentPos.x + (Math.random() - 0.5) * jitter;
          n.y = parentPos.y + (Math.random() - 0.5) * jitter;
        } else {
          const center = clusterCenters.get(n.type);
          if (center) {
            n.x = center.x + (Math.random() - 0.5) * spread;
            n.y = center.y + (Math.random() - 0.5) * spread;
          } else {
            n.x = this.width / 2 + (Math.random() - 0.5) * spread;
            n.y = this.height / 2 + (Math.random() - 0.5) * spread;
          }
        }
        n.vx = 0;
        n.vy = 0;
      }
      return n;
    });

    // Discrete layouts compute positions synchronously and skip the
    // force simulation entirely.
    if (this._layout !== 'force') {
      this._applyDiscreteLayout(simNodes, edges);
    }

    // --- Links ---
    this._visibleNodeCount = simNodes.length;
    const hasAttrMapping = store.colorAttr || store.sizeAttr;

    // Precompute edge weights so each edge hits the store once, not
    // four times (width + opacity in both enter and update accessors).
    const edgeWeights = new Map();
    if (hasAttrMapping) {
      for (const d of linkData) {
        const key = `${d.source?.id || d.source}-${d.target?.id || d.target}`;
        edgeWeights.set(key, store.edgeWeight(d._raw));
      }
    }
    this._edgeWeights = edgeWeights;

    const baseEdgeOpacity = simNodes.length > 500 ? 0.12
      : simNodes.length > 200 ? 0.2
        : simNodes.length > 50 ? 0.35
          : 0.5;
    const baseEdgeWidth = simNodes.length > 500 ? 0.6
      : simNodes.length > 100 ? 0.8
        : 1.2;
    const showArrows = simNodes.length <= 300;
    const edgeKey = (d) => `${d.source?.id || d.source}-${d.target?.id || d.target}`;
    this._linkSel = this.g.select('.links')
      .selectAll('line')
      .data(linkData, edgeKey)
      .join(
        (enter) => enter.append('line')
          .attr('stroke', (d) => store.colorForRel(d.rel))
          .attr('stroke-width', (d) => hasAttrMapping
            ? baseEdgeWidth + edgeWeights.get(edgeKey(d)) * 2
            : baseEdgeWidth)
          .attr('stroke-dasharray', (d) => store.dashForRel(d.rel))
          .attr('stroke-opacity', (d) => hasAttrMapping
            ? 0.08 + edgeWeights.get(edgeKey(d)) * 0.5
            : baseEdgeOpacity)
          .attr('marker-end', (d) => showArrows ? `url(#arrow-${CSS.escape(d.rel)})` : null),
        (update) => update
          .attr('stroke', (d) => store.colorForRel(d.rel))
          .attr('stroke-dasharray', (d) => store.dashForRel(d.rel))
          .attr('stroke-opacity', (d) => hasAttrMapping
            ? 0.08 + edgeWeights.get(edgeKey(d)) * 0.5
            : baseEdgeOpacity)
          .attr('stroke-width', (d) => hasAttrMapping
            ? baseEdgeWidth + edgeWeights.get(edgeKey(d)) * 2
            : baseEdgeWidth)
          .attr('marker-end', (d) => showArrows ? `url(#arrow-${CSS.escape(d.rel)})` : null),
        (exit) => exit.remove(),
      );

    // --- Nodes ---
    this._nodeSel = this.g.select('.nodes')
      .selectAll('circle')
      .data(simNodes, (d) => d.id)
      .join(
        (enter) => enter.append('circle')
          .attr('r', (d) => store.nodeRadius(d))
          .attr('fill', (d) => store.nodeColor(d))
          .attr('opacity', (d) => store.nodeOpacity(d))
          .attr('stroke', (d) => d.expanded ? '#e2e8f0' : store.hasMultipleParentTypes(d.id) ? '#facc15' : '#1e293b')
          .attr('stroke-width', (d) => d.expanded ? 2 : store.hasMultipleParentTypes(d.id) ? 2 : 1.5)
          .attr('stroke-dasharray', (d) => !d.expanded && store.hasMultipleParentTypes(d.id) ? '3,2' : null)
          .attr('cursor', 'pointer')
          .call(this._drag())
          .on('click', (_event, d) => this.onNodeClick(d))
          .on('mouseenter', (_event, d) => this.onNodeHover(d, _event))
          .on('mouseleave', (_event, d) => this.onNodeHoverOut(d)),
        (update) => update
          .attr('r', (d) => store.nodeRadius(d))
          .attr('fill', (d) => store.nodeColor(d))
          .attr('opacity', (d) => store.nodeOpacity(d))
          .attr('stroke', (d) => d.expanded ? '#e2e8f0' : store.hasMultipleParentTypes(d.id) ? '#facc15' : '#1e293b')
          .attr('stroke-width', (d) => d.expanded ? 2 : store.hasMultipleParentTypes(d.id) ? 2 : 1.5)
          .attr('stroke-dasharray', (d) => !d.expanded && store.hasMultipleParentTypes(d.id) ? '3,2' : null),
        (exit) => exit.remove(),
      );

    // --- Labels ---
    // Create labels for the most prominent nodes, capped to avoid
    // DOM bloat on very large graphs.  Zoom-dependent display toggling
    // hides labels at low zoom levels to reduce visual clutter.
    const MAX_LABELS = 500;
    let labelData = [];
    if (this.showLabels) {
      labelData = simNodes.slice().sort(
        (a, b) => store.nodeRadius(b) - store.nodeRadius(a),
      ).slice(0, MAX_LABELS);
      // Cache radius on each label datum so _updateLabelVisibility()
      // doesn't recompute it (Map.get + sqrt) on every zoom event.
      for (const d of labelData) {
        d._labelRadius = store.nodeRadius(d);
      }
    }
    this._labelSel = this.g.select('.labels')
      .selectAll('text')
      .data(labelData, (d) => d.id)
      .join(
        (enter) => enter.append('text')
          .text((d) => _truncateLabel(d.label || d.id, 24))
          .attr('font-size', (d) => Math.max(9, d._labelRadius * 0.7))
          .attr('text-anchor', 'middle')
          .attr('dy', (d) => d._labelRadius + 14)
          .attr('fill', '#e2e8f0')
          .attr('pointer-events', 'none'),
        (update) => update
          .text((d) => _truncateLabel(d.label || d.id, 24))
          .attr('font-size', (d) => Math.max(9, d._labelRadius * 0.7))
          .attr('dy', (d) => d._labelRadius + 14),
        (exit) => exit.remove(),
      );
    this._updateLabelVisibility();

    // Discrete layouts are static — render once and fit to view.
    if (this._layout !== 'force') {
      this.simulation.stop();
      this.simulation.nodes(simNodes);
      this.simulation.force('link').links(linkData);
      this._tick();
      this._drawGroupRegions();
      this.fitToView();
      return;
    }

    // Tune forces for current node count and restart
    this._tuneForces(simNodes.length, clusterCenters);
    this.simulation.nodes(simNodes);
    this.simulation.force('link').links(linkData);

    // Pre-tick off-screen when many new nodes appear so the layout
    // arrives close to settled before the first visible frame.
    const newCount = simNodes.length - oldPositions.size;
    if (newCount > 100) {
      const overlay = this.container.querySelector('#loading-overlay');
      if (overlay) overlay.classList.remove('hidden');

      const TARGET_MS = 10000;
      const MAX_TICKS = 1000;
      const CHUNK = 20;
      let done = 0;
      const gen = ++this._preTickId;
      const t0 = performance.now();
      this.simulation.alpha(1).stop();
      const collisionForce = this.simulation.force('collision');
      this.simulation.force('collision', null);
      const runChunk = () => {
        if (gen !== this._preTickId) return;
        const chunkStart = performance.now();
        let i = done;
        const end = Math.min(done + CHUNK, MAX_TICKS);
        while (i < end && (performance.now() - t0) < TARGET_MS) {
          this.simulation.tick();
          i++;
        }
        done = i;
        if (done < MAX_TICKS && (performance.now() - t0) < TARGET_MS) {
          requestAnimationFrame(runChunk);
        } else {
          this.simulation.force('collision', collisionForce);
          this._tick();
          if (overlay) overlay.classList.add('hidden');
          if (typeof window !== 'undefined') {
            /** @type {any} */ (window).__preTickMs = performance.now() - t0;
            /** @type {any} */ (window).__preTickTicks = done;
          }
          this.fitToView();
          if (!this._paused) {
            this.simulation.alpha(0.1).restart();
          }
        }
      };
      requestAnimationFrame(runChunk);
    } else {
      if (!this._paused) {
        this.simulation.alpha(0.6).restart();
      } else {
        this.simulation.stop();
        this._tick();
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Layout selection                                                 */
  /* ---------------------------------------------------------------- */

  /**
   * Switch the active layout. Pass 'force' for the default force-directed
   * simulation, or one of the discrete layout keys from layouts.js.
   * @param {string} key
   */
  setLayout(key) {
    this._layout = key;
    this.simulation.stop();
    this.svg.attr('aria-label', this._ariaLabel());
    if (key === 'force') {
      if (!this._paused) this.simulation.alpha(0.6).restart();
    }
  }

  /** @returns {string} */
  getLayout() {
    return this._layout;
  }

  /** @returns {boolean} */
  isForceLayout() {
    return this._layout === 'force';
  }

  /**
   * Build an aria-label for the SVG that names the active layout.
   * @returns {string}
   */
  _ariaLabel() {
    const label = LAYOUT_LABELS[this._layout] || LAYOUT_LABELS.force;
    return `${label} layout graph visualization`;
  }

  /**
   * Apply the active discrete layout to the visible nodes.
   * When grouping is enabled, the chosen layout runs per-cluster via
   * groupedDiscreteLayout() and the resulting regions are stored on
   * `this._groupRegions` so the renderer can draw labelled regions
   * without recomputing hulls.
   * @param {Object[]} simNodes
   * @param {Object[]} edges
   */
  _applyDiscreteLayout(simNodes, edges) {
    const store = this.store;
    const grouped = store.groupingEnabled;
    /** @type {any} */
    const fn = (() => {
      switch (this._layout) {
        case 'circle': return circleLayout;
        case 'grid': return gridLayout;
        case 'concentric': return concentricLayout;
        case 'radial': return radialTreeLayout;
        case 'avsdf': return avsdfLayout;
        default: return null;
      }
    })();
    if (!fn) return;
    if (grouped) {
      this._groupRegions = groupedDiscreteLayout(
        (nodes, w, h, opts) => {
          if (this._layout === 'concentric' || this._layout === 'avsdf') {
            fn(nodes, edges, w, h, opts);
          } else if (this._layout === 'radial') {
            fn(nodes, (id) => store.parentIds(id), w, h);
          } else {
            fn(nodes, w, h, opts);
          }
        },
        store.visibleGroups(simNodes),
        this.width,
        this.height,
      );
    } else {
      this._groupRegions = null;
      switch (this._layout) {
        case 'circle':
          circleLayout(simNodes, this.width, this.height);
          break;
        case 'grid':
          gridLayout(simNodes, this.width, this.height);
          break;
        case 'concentric':
          concentricLayout(simNodes, edges, this.width, this.height);
          break;
        case 'radial':
          radialTreeLayout(simNodes, (id) => store.parentIds(id), this.width, this.height);
          break;
        case 'avsdf':
          avsdfLayout(simNodes, edges, this.width, this.height);
          break;
        default:
          break;
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Force tuning                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * Cluster centers for the force simulation. When grouping is
   * enabled and grouping by component, key centers by the active
   * group over the visible nodes; otherwise fall back to the
   * per-type clusterCenters().
   * @param {Object[]} [nodes] - visible nodes; falls back to the
   *   current simulation nodes when omitted
   * @returns {Map<string, {x: number, y: number}>}
   */
  _clusterCentersForForce(nodes) {
    const store = this.store;
    if (store.groupingEnabled && store.groupBy === 'component') {
      return store.groupCenters(this.width, this.height, nodes || this.simulation.nodes());
    }
    return store.clusterCenters(this.width, this.height);
  }

  /**
   * Key function for the cluster force. Grouping by component needs
   * the group key; otherwise the default per-type key applies.
   * @returns {function}
   */
  _clusterKeyFn() {
    const store = this.store;
    if (store.groupingEnabled && store.groupBy === 'component') {
      return (node) => store.groupKeyFor(node);
    }
    return null;
  }

  _tuneForces(nodeCount, clusterCenters) {
    const n = Math.max(nodeCount, 1);
    const t = Math.min(n / 500, 1);

    // The collision force is temporarily removed during pre-tick; a
    // re-render that lands mid-pre-tick must restore it before tuning.
    if (!this.simulation.force('collision')) {
      this.simulation.force('collision', d3.forceCollide());
    }

    const labelPad = this.showLabels ? 12 : 4;

    this._autoForceParams = {
      chargeStrength: -60 - t * 60,
      linkDistance: 30 + (1 - t) * 30,
      gravity: 0.03 * (1 - t * 0.6),
      // When grouping is enabled the cluster force needs a higher
      // floor so hulls are actually compact, not just loosely grouped.
      clusterStrength: this.store.groupingEnabled
        ? Math.max(t * 0.06, 0.12)
        : t * 0.06,
      collisionPad: labelPad,
    };

    const p = this._effectiveForceParams();

    const chargeMax = 300 + t * 200;
    const alphaDecay = 0.02 + t * 0.04;
    const velocityDecay = 0.35 + t * 0.3;
    const theta = n > 2000 ? 2.5 : 0.9;

    this._clusterStrength = p.clusterStrength;

    this.simulation
      .force('link')
      .distance(p.linkDistance)
      .strength(null);
    this.simulation
      .force('charge')
      .strength(p.chargeStrength)
      .distanceMax(chargeMax)
      .theta(theta);
    this.simulation
      .force('collision')
      .radius((d) => this.store.nodeRadius(d) + p.collisionPad);
    this.simulation
      .force('x')
      .strength(p.gravity);
    this.simulation
      .force('y')
      .strength(p.gravity);
    this.simulation
      .force('cluster', forceCluster(clusterCenters, p.clusterStrength, this._clusterKeyFn()));
    this.simulation
      .alphaDecay(alphaDecay)
      .velocityDecay(velocityDecay);
  }

  _effectiveForceParams() {
    return { ...this._autoForceParams, ...this._forceOverrides };
  }

  getForceParams() {
    return this._effectiveForceParams();
  }

  setForceParam(key, value) {
    this._forceOverrides[key] = value;
    this._applyForceOverrides();
  }

  clearForceOverrides() {
    this._forceOverrides = {};
    this._applyForceOverrides();
  }

  hasForceOverrides() {
    return Object.keys(this._forceOverrides).length > 0;
  }

  _applyForceOverrides() {
    const p = this._effectiveForceParams();
    this._clusterStrength = p.clusterStrength;
    if (!this.simulation.force('collision')) {
      this.simulation.force('collision', d3.forceCollide());
    }
    this.simulation.force('link').distance(p.linkDistance).strength(null);
    this.simulation.force('charge').strength(p.chargeStrength);
    this.simulation.force('collision')
      .radius((d) => this.store.nodeRadius(d) + p.collisionPad);
    this.simulation.force('x').strength(p.gravity);
    this.simulation.force('y').strength(p.gravity);
    const clusterCenters = this._clusterCentersForForce();
    this.simulation.force('cluster', forceCluster(clusterCenters, p.clusterStrength, this._clusterKeyFn()));
    if (!this._paused) {
      this.simulation.alpha(0.3).restart();
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Highlight                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Highlight a node and dim everything else.
   * Pass null to clear.
   * @param {string|null} nodeId
   * @param {Set<string>} [connectedIds]
   */
  highlight(nodeId, connectedIds) {
    this._highlightedId = nodeId;
    const store = this.store;
    if (!nodeId) {
      this._nodeSel && this._nodeSel
        .attr('opacity', (d) => store.nodeOpacity(d));
      const hasAttrMapping = store.colorAttr || store.sizeAttr;
      const baseOpacity = this._visibleNodeCount > 500 ? 0.12
        : this._visibleNodeCount > 200 ? 0.2
          : this._visibleNodeCount > 50 ? 0.35 : 0.5;
      this._linkSel && this._linkSel
        .attr('stroke-opacity', (d) => hasAttrMapping
          ? 0.08 + (this._edgeWeights.get(`${d.source?.id || d.source}-${d.target?.id || d.target}`) ?? 0) * 0.5
          : baseOpacity);
      this._labelSel && this._labelSel.attr('opacity', 1);
      this._updateLabelVisibility();
      return;
    }
    const connected = connectedIds || new Set();
    connected.add(nodeId);

    this._nodeSel && this._nodeSel
      .attr('opacity', (d) => connected.has(d.id) ? 1 : 0.15);
    this._linkSel && this._linkSel
      .attr('stroke-opacity', (d) => {
        const src = d.source?.id || d.source;
        const tgt = d.target?.id || d.target;
        return (src === nodeId || tgt === nodeId) ? 0.8 : 0.05;
      });
    this._labelSel && this._labelSel
      .each(function () { this.removeAttribute('display'); })
      .attr('opacity', (d) => connected.has(d.id) ? 1 : 0.1);
  }

  /* ---------------------------------------------------------------- */
  /*  Label visibility (zoom-dependent)                                */
  /* ---------------------------------------------------------------- */

  _updateLabelVisibility() {
    if (!this._labelSel || !this.showLabels) return;
    const scale = this._zoomScale;
    const n = this._visibleNodeCount;

    if (this._highlightedId) return;

    const minScreenR = n > 15 ? 20 / scale : 6 / scale;

    this._labelSel.each(function (d) {
      const r = d._labelRadius;
      if (r >= minScreenR) {
        this.removeAttribute('display');
      } else {
        this.setAttribute('display', 'none');
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Simulation tick                                                  */
  /* ---------------------------------------------------------------- */

  _tick() {
    if (this._linkSel) {
      this._linkSel
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y);
    }
    if (this._nodeSel) {
      this._nodeSel
        .attr('cx', (d) => d.x)
        .attr('cy', (d) => d.y);
    }
    if (this._labelSel) {
      this._labelSel
        .attr('x', (d) => d.x)
        .attr('y', (d) => d.y);
    }
    this._drawHulls();
  }

  /* ---------------------------------------------------------------- */
  /*  Grouping (hulls + discrete regions)                             */
  /* ---------------------------------------------------------------- */

  /**
   * Draw convex-hull hulls around visible groups (force layout).
   * Called on every tick so hulls track node motion. Above 1k visible
   * nodes the per-tick hull recompute is too costly, so hulls are only
   * drawn when the simulation has settled (alpha < 0.05) and on discrete
   * renders. Hulls are data-joined per group key so toggling grouping or
   * changing the group-by key re-joins cheaply.
   */
  _drawHulls() {
    const store = this.store;
    const hulls = this.g.select('.hulls');
    if (!store.groupingEnabled || this._visibleNodeCount < 2) {
      hulls.selectAll('*').remove();
      return;
    }
    if (this._visibleNodeCount > 1000 && this.simulation.alpha() >= 0.05) {
      // Deferred: wait for the simulation to settle before drawing hulls
      // so the per-tick O(k n log n) hull cost is not paid every frame.
      return;
    }
    const simNodes = this.simulation.nodes();
    const groups = store.visibleGroups(simNodes);
    const entries = [...groups.entries()].filter(([, nodes]) => nodes.length >= 2);
    const pad = this._maxNodeRadius() + 12;

    const hullData = entries.map(([key, nodes]) => {
      const pts = nodes.map((/** @type {any} */ n) => [n.x, n.y]);
      const hull = d3.polygonHull(pts);
      if (!hull || hull.length < 3) return null;
      const centroid = d3.polygonCentroid(hull);
      // Push each hull vertex outward from the centroid so nodes sit
      // comfortably inside the band rather than on its edge.
      const padded = hull.map(([px, py]) => {
        const dx = px - centroid[0];
        const dy = py - centroid[1];
        const len = Math.hypot(dx, dy) || 1;
        return [px + (dx / len) * pad, py + (dy / len) * pad];
      });
      return { key, hull: padded, centroid, count: nodes.length, color: store.groupColor(key) };
    }).filter(Boolean);

    const hullSel = hulls.selectAll('path.hull')
      .data(hullData, (d) => d.key)
      .join(
        (enter) => enter.append('path')
          .attr('class', 'hull')
          .attr('fill', (d) => d.color)
          .attr('fill-opacity', 0.08)
          .attr('stroke', (d) => d.color)
          .attr('stroke-opacity', 0.35)
          .attr('stroke-width', 1)
          .attr('pointer-events', 'none'),
        (update) => update,
        (exit) => exit.remove(),
      );
    hullSel.attr('d', (d) => `M${d.hull.map((p) => `${p[0]},${p[1]}`).join('L')}Z`);

    // Labels at hull centroids, hidden when zoomed out. Visibility is
    // toggled via the display attribute so zooming back in can reveal
    // them again without a full hull recompute.
    const labelSel = hulls.selectAll('text.hull-label')
      .data(hullData, (d) => d.key)
      .join(
        (enter) => enter.append('text')
          .attr('class', 'hull-label')
          .attr('fill', '#94a3b8')
          .attr('font-size', 11)
          .attr('text-anchor', 'middle')
          .attr('pointer-events', 'none'),
        (update) => update,
        (exit) => exit.remove(),
      );
    labelSel
      .attr('x', (d) => d.centroid[0])
      .attr('y', (d) => d.centroid[1])
      .text((d) => `${store.groupLabel(d.key)} (${d.count})`);
    this._updateHullLabelVisibility();
  }

  /** Show/hide hull labels for the current zoom scale. */
  _updateHullLabelVisibility() {
    const hulls = this.g && this.g.select('.hulls');
    if (!hulls) return;
    const show = this._zoomScale >= 0.4;
    hulls.selectAll('text.hull-label').each(function () {
      if (show) {
        this.removeAttribute('display');
      } else {
        this.setAttribute('display', 'none');
      }
    });
  }

  /**
   * Draw labelled rounded-rect regions for grouped discrete layouts.
   * Regions come from groupedDiscreteLayout() and never move, so this
   * runs once per render rather than per tick. Single-member groups get
   * no region or label — same rule as force-mode hulls — so root-heavy
   * initial views stay uncluttered.
   */
  _drawGroupRegions() {
    const store = this.store;
    const hulls = this.g.select('.hulls');
    if (!store.groupingEnabled || !this._groupRegions) {
      hulls.selectAll('*').remove();
      return;
    }
    // Member counts for labels, from the visible nodes partitioned by group.
    const counts = new Map();
    for (const n of this.simulation.nodes()) {
      const key = store.groupKeyFor(n);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const regions = [...this._groupRegions.entries()]
      .filter(([key]) => (counts.get(key) || 0) >= 2)
      .map(([key, r]) => ({
        key, ...r, color: store.groupColor(key), count: counts.get(key) || 0,
      }));
    const rectSel = hulls.selectAll('rect.group-region')
      .data(regions, (d) => d.key)
      .join(
        (enter) => enter.append('rect')
          .attr('class', 'group-region')
          .attr('fill', (d) => d.color)
          .attr('fill-opacity', 0.08)
          .attr('stroke', (d) => d.color)
          .attr('stroke-opacity', 0.35)
          .attr('stroke-width', 1)
          .attr('rx', 8)
          .attr('pointer-events', 'none'),
        (update) => update,
        (exit) => exit.remove(),
      );
    rectSel
      .attr('x', (d) => d.cx - d.w / 2)
      .attr('y', (d) => d.cy - d.h / 2)
      .attr('width', (d) => d.w)
      .attr('height', (d) => d.h);

    const labelSel = hulls.selectAll('text.group-region-label')
      .data(regions, (d) => d.key)
      .join(
        (enter) => enter.append('text')
          .attr('class', 'group-region-label')
          .attr('fill', '#94a3b8')
          .attr('font-size', 11)
          .attr('text-anchor', 'middle')
          .attr('pointer-events', 'none'),
        (update) => update,
        (exit) => exit.remove(),
      );
    labelSel
      .attr('x', (d) => d.cx)
      .attr('y', (d) => d.cy - d.h / 2 + 14)
      .text((d) => `${store.groupLabel(d.key)} (${d.count})`);
  }

  /** Largest visible node radius, used to pad hulls. @returns {number} */
  _maxNodeRadius() {
    let max = 0;
    for (const n of this.simulation.nodes()) {
      const r = this.store.nodeRadius(n);
      if (r > max) max = r;
    }
    return max;
  }

  /* ---------------------------------------------------------------- */
  /*  Fit to view                                                      */
  /* ---------------------------------------------------------------- */

  fitToView(padding = 60) {
    const nodes = this.simulation.nodes();
    if (!nodes.length) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }

    const bw = maxX - minX;
    const bh = maxY - minY;
    const scale = Math.min(
      (this.width - padding * 2) / bw,
      (this.height - padding * 2) / bh,
      8,
    );
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const tx = this.width / 2 - cx * scale;
    const ty = this.height / 2 - cy * scale;

    const t = d3.zoomIdentity.translate(tx, ty).scale(scale);
    this.svg.transition().duration(400)
      .call(this._zoom.transform, t)
      .on('end', () => this._updateLabelVisibility());
  }

  /* ---------------------------------------------------------------- */
  /*  Drag behaviour                                                   */
  /* ---------------------------------------------------------------- */

  _drag() {
    const sim = this.simulation;
    return d3.drag()
      .on('start', (event, d) => {
        if (this._paused || !this.isForceLayout()) {
          d.fx = d.x;
          d.fy = d.y;
        } else {
          if (!event.active) sim.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        }
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
        if (this._paused || !this.isForceLayout()) {
          d.x = event.x;
          d.y = event.y;
          this._tick();
        }
      })
      .on('end', (event, d) => {
        if (this._paused || !this.isForceLayout()) {
          d.x = d.fx;
          d.y = d.fy;
          d.fx = null;
          d.fy = null;
        } else {
          if (!event.active) sim.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }
      });
  }

  pause() {
    this._paused = true;
    this.simulation.stop();
  }

  resume() {
    this._paused = false;
    if (this.isForceLayout()) {
      this.simulation.alpha(0.3).restart();
    } else {
      // Discrete layouts are static — just re-render at current positions.
      this._tick();
    }
  }

  get isPaused() {
    return this._paused;
  }
}
