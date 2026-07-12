/**
 * graph.js — D3 force-directed graph renderer.
 *
 * Pulls all visual configuration (colours, sizes, dash patterns)
 * from the GraphStore instance — nothing is hardcoded to a
 * specific graph schema.
 */

/* ------------------------------------------------------------------ */
/*  GraphRenderer                                                      */
/* ------------------------------------------------------------------ */

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

function forceCluster(clusterCenters, strength) {
  let nodes;
  function force(alpha) {
    for (const node of nodes) {
      const center = clusterCenters.get(node.type);
      if (!center) continue;
      node.vx += (center.x - node.x) * strength * alpha;
      node.vy += (center.y - node.y) * strength * alpha;
    }
  }
  force.initialize = (n) => { nodes = n; };
  return force;
}

export class GraphRenderer {
  /**
   * @param {HTMLElement}          container
   * @param {import('./data.js').GraphStore} store
   * @param {Object}               opts
   * @param {function}             opts.onNodeClick
   * @param {function}             opts.onNodeHover
   * @param {function}             opts.onNodeHoverOut
   */
  constructor(container, store, opts = {}) {
    this.container = container;
    this.store = store;
    this.onNodeClick = opts.onNodeClick || (() => {});
    this.onNodeHover = opts.onNodeHover || (() => {});
    this.onNodeHoverOut = opts.onNodeHoverOut || (() => {});
    this.onBackgroundClick = opts.onBackgroundClick || (() => {});

    this.width = container.clientWidth;
    this.height = container.clientHeight;

    /** @type {d3.Selection} */
    this.svg = null;
    /** @type {d3.Selection} */
    this.g = null;
    /** @type {d3.Simulation} */
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
      .attr('viewBox', `0 0 ${width} ${height}`);

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
        }
      })
      .on('end', () => {
        this._updateLabelVisibility();
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
      const clusterCenters = this.store.clusterCenters(this.width, this.height);
      this.simulation.force('cluster', forceCluster(clusterCenters, this._clusterStrength));
    });
    ro.observe(this.container);
  }

  /* ---------------------------------------------------------------- */
  /*  Arrow markers (rebuilt when edge rels change)                     */
  /* ---------------------------------------------------------------- */

  _ensureArrowMarkers() {
    const defs = this.svg.select('defs');
    for (const rel of this.store.relList) {
      const id = `arrow-${CSS.escape(rel)}`;
      if (defs.select(`#${CSS.escape(id)}`).empty()) {
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
    const clusterCenters = store.clusterCenters(this.width, this.height);

    const spread = Math.min(50 + nodes.length * 0.15, 400);
    const simNodes = nodes.map((n) => {
      const old = oldPositions.get(n.id);
      if (old) {
        n.x = old.x;
        n.y = old.y;
        n.vx = old.vx;
        n.vy = old.vy;
      } else {
        const parents = store.parentsOf.get(n.id) || [];
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

    // --- Links ---
    this._visibleNodeCount = simNodes.length;
    const edgeOpacity = simNodes.length > 500 ? 0.12
      : simNodes.length > 200 ? 0.2
      : simNodes.length > 50 ? 0.35
      : 0.5;
    const edgeWidth = simNodes.length > 500 ? 0.6
      : simNodes.length > 100 ? 0.8
      : 1.2;
    const showArrows = simNodes.length <= 300;
    this._linkSel = this.g.select('.links')
      .selectAll('line')
      .data(linkData, (d) => `${d.source?.id || d.source}-${d.target?.id || d.target}`)
      .join(
        (enter) => enter.append('line')
          .attr('stroke', (d) => store.colorForRel(d.rel))
          .attr('stroke-width', edgeWidth)
          .attr('stroke-dasharray', (d) => store.dashForRel(d.rel))
          .attr('stroke-opacity', edgeOpacity)
          .attr('marker-end', (d) => showArrows ? `url(#arrow-${CSS.escape(d.rel)})` : null),
        (update) => update
          .attr('stroke', (d) => store.colorForRel(d.rel))
          .attr('stroke-dasharray', (d) => store.dashForRel(d.rel))
          .attr('stroke-opacity', edgeOpacity)
          .attr('stroke-width', edgeWidth)
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
          .attr('fill', (d) => store.colorForType(d.type))
          .attr('stroke', (d) => d.expanded ? '#e2e8f0' : '#1e293b')
          .attr('stroke-width', (d) => d.expanded ? 2 : 1.5)
          .attr('cursor', 'pointer')
          .call(this._drag())
          .on('click', (_event, d) => this.onNodeClick(d))
          .on('mouseenter', (_event, d) => this.onNodeHover(d, _event))
          .on('mouseleave', (_event, d) => this.onNodeHoverOut(d)),
        (update) => update
          .attr('r', (d) => store.nodeRadius(d))
          .attr('fill', (d) => store.colorForType(d.type))
          .attr('stroke', (d) => d.expanded ? '#e2e8f0' : '#1e293b')
          .attr('stroke-width', (d) => d.expanded ? 2 : 1.5),
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
    }
    this._labelSel = this.g.select('.labels')
      .selectAll('text')
      .data(labelData, (d) => d.id)
      .join(
        (enter) => enter.append('text')
          .text((d) => _truncateLabel(d.label || d.id, 24))
          .attr('font-size', (d) => Math.max(9, store.nodeRadius(d) * 0.7))
          .attr('text-anchor', 'middle')
          .attr('dy', (d) => store.nodeRadius(d) + 14)
          .attr('fill', '#e2e8f0')
          .attr('pointer-events', 'none'),
        (update) => update
          .text((d) => _truncateLabel(d.label || d.id, 24)),
        (exit) => exit.remove(),
      );
    this._updateLabelVisibility();

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
            window.__preTickMs = performance.now() - t0;
            window.__preTickTicks = done;
          }
          this.fitToView();
          this.simulation.alpha(0.1).restart();
        }
      };
      requestAnimationFrame(runChunk);
    } else {
      this.simulation.alpha(0.6).restart();
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Force tuning                                                     */
  /* ---------------------------------------------------------------- */

  _tuneForces(nodeCount, clusterCenters) {
    const n = Math.max(nodeCount, 1);
    const t = Math.min(n / 500, 1);

    const chargeStrength = -60 - t * 60;
    const chargeMax = 300 + t * 200;
    const linkDist = 30 + (1 - t) * 30;
    const gravity = 0.03 * (1 - t * 0.6);
    const clusterStrength = t * 0.06;
    this._clusterStrength = clusterStrength;
    const alphaDecay = 0.02 + t * 0.04;
    const velocityDecay = 0.35 + t * 0.3;
    const theta = n > 2000 ? 2.5 : 0.9;

    const labelPad = this.showLabels ? 12 : 4;

    this.simulation
      .force('link')
        .distance(linkDist)
        .strength(null);
    this.simulation
      .force('charge')
        .strength(chargeStrength)
        .distanceMax(chargeMax)
        .theta(theta);
    this.simulation
      .force('collision')
        .radius((d) => this.store.nodeRadius(d) + labelPad);
    this.simulation
      .force('x')
        .strength(gravity);
    this.simulation
      .force('y')
        .strength(gravity);
    this.simulation
      .force('cluster', forceCluster(clusterCenters, clusterStrength));
    this.simulation
      .alphaDecay(alphaDecay)
      .velocityDecay(velocityDecay);
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
    if (!nodeId) {
      this._nodeSel && this._nodeSel.attr('opacity', 1);
      const baseOpacity = this._visibleNodeCount > 500 ? 0.12
        : this._visibleNodeCount > 200 ? 0.2
        : this._visibleNodeCount > 50 ? 0.35 : 0.5;
      this._linkSel && this._linkSel.attr('stroke-opacity', baseOpacity);
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
    const store = this.store;

    if (this._highlightedId) return;

    const minScreenR = n > 15 ? 20 / scale : 6 / scale;

    this._labelSel.each(function (d) {
      const r = store.nodeRadius(d);
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
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
  }
}
