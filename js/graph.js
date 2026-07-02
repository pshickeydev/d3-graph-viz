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

    const zoom = d3.zoom()
      .scaleExtent([0.05, 8])
      .on('zoom', (event) => {
        this.g.attr('transform', event.transform);
      });

    this.svg.call(zoom);

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
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide())
      .force('x', d3.forceX(width / 2))
      .force('y', d3.forceY(height / 2))
      .on('tick', () => this._tick());

    this.simulation.stop();

    // Resize observer
    const ro = new ResizeObserver(() => {
      this.width = this.container.clientWidth;
      this.height = this.container.clientHeight;
      this.svg.attr('viewBox', `0 0 ${this.width} ${this.height}`);
      this.simulation.force('center', d3.forceCenter(this.width / 2, this.height / 2));
      this.simulation.force('x').x(this.width / 2);
      this.simulation.force('y').y(this.height / 2);
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

    // Preserve existing positions
    const oldPositions = new Map();
    if (this._nodeSel) {
      this._nodeSel.each(function (d) {
        oldPositions.set(d.id, { x: d.x, y: d.y, vx: d.vx, vy: d.vy });
      });
    }

    const spread = Math.min(200 + nodes.length * 0.5, 2000);
    const simNodes = nodes.map((n) => {
      const old = oldPositions.get(n.id);
      return {
        ...n,
        x: old ? old.x : this.width / 2 + (Math.random() - 0.5) * spread,
        y: old ? old.y : this.height / 2 + (Math.random() - 0.5) * spread,
        vx: old ? old.vx : 0,
        vy: old ? old.vy : 0,
      };
    });

    // --- Links ---
    this._linkSel = this.g.select('.links')
      .selectAll('line')
      .data(linkData, (d) => `${d.source?.id || d.source}-${d.target?.id || d.target}`)
      .join(
        (enter) => enter.append('line')
          .attr('stroke', (d) => store.colorForRel(d.rel))
          .attr('stroke-width', 1.2)
          .attr('stroke-dasharray', (d) => store.dashForRel(d.rel))
          .attr('stroke-opacity', 0.5)
          .attr('marker-end', (d) => `url(#arrow-${CSS.escape(d.rel)})`),
        (update) => update
          .attr('stroke', (d) => store.colorForRel(d.rel))
          .attr('stroke-dasharray', (d) => store.dashForRel(d.rel)),
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
          .attr('stroke', '#1e293b')
          .attr('stroke-width', 1.5)
          .attr('cursor', 'pointer')
          .call(this._drag())
          .on('click', (_event, d) => this.onNodeClick(d))
          .on('mouseenter', (_event, d) => this.onNodeHover(d, _event))
          .on('mouseleave', (_event, d) => this.onNodeHoverOut(d)),
        (update) => update
          .attr('r', (d) => store.nodeRadius(d))
          .attr('fill', (d) => store.colorForType(d.type)),
        (exit) => exit.remove(),
      );

    // --- Labels (only for larger nodes) ---
    const labelData = this.showLabels
      ? simNodes.filter((n) => store.nodeRadius(n) >= 10)
      : [];
    this._labelSel = this.g.select('.labels')
      .selectAll('text')
      .data(labelData, (d) => d.id)
      .join(
        (enter) => enter.append('text')
          .text((d) => d.label || d.id)
          .attr('font-size', (d) => Math.max(9, store.nodeRadius(d) * 0.7))
          .attr('text-anchor', 'middle')
          .attr('dy', (d) => store.nodeRadius(d) + 14)
          .attr('fill', '#e2e8f0')
          .attr('pointer-events', 'none'),
        (update) => update.text((d) => d.label || d.id),
        (exit) => exit.remove(),
      );

    // Tune forces for current node count and restart
    this._tuneForces(simNodes.length);
    this.simulation.nodes(simNodes);
    this.simulation.force('link').links(linkData);
    this.simulation.alpha(0.6).restart();
  }

  /* ---------------------------------------------------------------- */
  /*  Force tuning                                                     */
  /* ---------------------------------------------------------------- */

  _tuneForces(nodeCount) {
    const n = Math.max(nodeCount, 1);
    const t = Math.min(n / 500, 1);

    const chargeStrength = -150 + t * 90;
    const chargeMax = 500 + t * Math.sqrt(n) * 10;
    const linkDist = 80 - t * 40;
    const linkStr = 0.3 - t * 0.15;
    const gravity = 0.03 - t * 0.02;
    const alphaDecay = 0.02 + t * 0.02;

    const labelPad = this.showLabels ? 12 : 4;

    this.simulation
      .force('link')
        .distance(linkDist)
        .strength(linkStr);
    this.simulation
      .force('charge')
        .strength(chargeStrength)
        .distanceMax(chargeMax);
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
      .alphaDecay(alphaDecay);
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
      this._linkSel && this._linkSel.attr('stroke-opacity', 0.5);
      this._labelSel && this._labelSel.attr('opacity', 1);
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
      .attr('opacity', (d) => connected.has(d.id) ? 1 : 0.1);
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
