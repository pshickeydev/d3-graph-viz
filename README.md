# D3 Graph Viewer

Interactive force-directed graph visualization for directed graphs, built with [D3.js](https://d3js.org/) v7. Originally developed for [Trailmark](https://github.com/trailofbits/trailmark) output but works with any JSON graph matching the `{nodes, edges}` schema below.

## Quick Start

1. Serve the directory with any static file server:

   ```bash
   # Python
   python3 -m http.server 8000

   # Node
   npx serve .
   ```

2. Open `http://localhost:8000` in a browser.

3. Drop a graph JSON file onto the page (or click to browse).

## Features

- **Force-directed layout** — topology-driven clustering where children naturally group around parent nodes, with zoom/pan
- **Progressive disclosure** — starts with auto-detected root nodes (all types with parentless nodes, supporting multiple disconnected hierarchies); click to expand children, click again to collapse
- **Color-coded node types** — colours auto-assigned from a 16-colour palette (ordered for perceptual contrast); click the colour swatch next to any type to customise
- **Attribute-driven visual mapping** — colour and size nodes by any discovered attribute via sidebar dropdowns. Numeric attrs show a gradient legend with editable ramp stops and a selectable scale mode (Linear, Log, or Percentile) for handling skewed distributions; categorical attrs show labelled swatches. All colours are editable via inline colour pickers. Nodes missing the active attr fade out, and edges scale width/opacity by the target node's value.
- **Scaled node sizes** — exponential radius decay across the type hierarchy makes roots visibly larger than leaves, or size by any numeric attribute
- **Edge styling** — colours and dash patterns auto-assigned per relationship type, with directional arrows (arrows hidden for large graphs to reduce clutter)
- **Adaptive rendering** — edge opacity, stroke width, and label density scale with the number of visible nodes
- **Zoom-dependent labels** — labels appear progressively as you zoom in; only the most prominent nodes are labelled at overview zoom
- **Search** — find nodes by label or ID with instant results; full keyboard navigation (Arrow keys, Enter, Escape)
- **Type filters** — toggle node types on/off, with node counts per type
- **Detail sidebar** — click any node to see full attributes, connections, and links
- **Tooltip** — hover for quick node summary; active mapping attributes shown first in bold; multi-parent nodes flagged
- **Multi-parent visual marker** — nodes with parents of 2+ different types (DAG diamonds) get a yellow dashed stroke, making the diamond structure visible at a glance
- **Highlight** — hover or select a node to dim unrelated nodes and edges; selection takes precedence over hover
- **Force simulation controls** — tune Repulsion, Link distance, Gravity, Collision pad, and Clustering via sidebar sliders; reset to auto-tuned defaults
- **Pause / Resume** — low-opacity ⏸/▶ icon overlay in the top-right corner of the graph; freeze the force simulation while still allowing node dragging
- **Keyboard accessible** — all controls reachable via keyboard with visible focus indicators; ARIA landmarks, roles, and live regions for screen reader support

## Expected Input Format

The viewer accepts any JSON file with a `nodes` array and an `edges` array. All node types, edge relationship types, colours, sizes, and root detection are derived automatically from the data — nothing is hardcoded to a specific schema.

```json
{
  "generated": "2025-01-15",
  "stats": { "nodes": 500, "edges": 1200, "by_type": { ... } },
  "nodes": [
    { "id": "root:main", "type": "root", "label": "Main", "attrs": {} }
  ],
  "edges": [
    { "from": "root:main", "to": "group:backend", "rel": "contains" }
  ]
}
```

### Required fields

- **nodes[]**: `id` (string), `type` (string). `label` and `attrs` are optional but recommended.
- **edges[]**: `from` (string), `to` (string), `rel` (string)

### Optional fields

- **stats**: displayed in the top summary bar (supports `nodes`, `edges`, `by_type`, `by_rel`)
- **generated**: shown in stats bar
- Any additional edge or node attrs are displayed in tooltips and the detail panel

## Project Structure

```
d3-graph-viz/
├── index.html          # App shell with semantic landmarks and ARIA
├── css/
│   └── style.css       # Dark theme, layout, focus styles, sr-only utility
├── js/
│   ├── main.js         # Entry: file load, wiring, selection state, screen reader announcements
│   ├── graph.js        # D3 force simulation, render, zoom/pan
│   ├── data.js         # Parse/validate JSON, adjacency, expand/collapse, attr discovery & mapping, colour scales, multi-parent detection
│   └── ui.js           # Sidebar, search (combobox pattern), filters, attr selectors, scale selector, tooltips, collapsible sections
├── test/
│   ├── data.test.mjs   # GraphStore unit tests
│   ├── expand_all.test.mjs
│   ├── expand_all_xl.test.mjs
│   ├── graph-gen.mjs   # Synthetic graph generator for tests
│   └── fixtures/
│       └── sample-large-graph.json  # 9.6K-node test fixture
├── README.md
└── AGENTS.md
```

## Tech Stack

- **D3.js v7** loaded from CDN — no build step required
- Vanilla ES modules — no framework, no bundler
- Single `index.html` entry point
- Unit tests: Node.js built-in test runner

## Running Tests

```bash
node --test test/data.test.mjs
```

116 tests covering validation, indexing, type/rel detection, expand/collapse, visible subset computation, search, reveal, nodeRadius, clusterCenters, edgesForNode, childrenIds, attribute discovery, colour-by-attr, size-by-attr, node opacity, edge weight, colour overrides, legend data, multi-root support, colour scale modes (linear/log/percentile), and multi-parent type detection — run against small (10), medium (100), large (1000), and extra-large (10000) synthetic graphs. No browser required.

## License

Apache License 2.0 — see [LICENSE](LICENSE).

## Future Improvements

- Attribute rollups — aggregate descendant numeric attrs (sum/max) onto ancestor types so colour-by-attr works above the leaf layer
- Attribute-based node filtering (e.g. show only nodes where a numeric attr exceeds a threshold)
- Path highlighting between two selected nodes
- Filter by edge attributes
- Export visible subgraph as PNG/SVG
- Hierarchical layout options (tree, radial, zoomable treemap)
