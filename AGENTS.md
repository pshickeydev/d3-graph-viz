# AGENTS.md

> **Keep in sync**: any changes to this file should also be reflected in `README.md`.

Guidelines for AI agents working on this project.

## Project Overview

Interactive D3.js force-directed graph visualization for directed graphs. Originally built for Trailmark output but fully generic — works with any JSON matching the `{nodes, edges}` schema. No build step — vanilla ES modules served as static files.

## Architecture

| File | Responsibility |
|---|---|
| `js/data.js` | `GraphStore` class — parses JSON, validates schema, builds adjacency index, auto-detects node types / root types / edge rels, infers depth for reversed-edge types, assigns colours, manages expand/collapse state, computes visible subset, search, `countForType()`, discovers numeric/categorical attrs, provides attr-driven colour/size/opacity mapping |
| `js/graph.js` | `GraphRenderer` class — D3 force simulation, SVG rendering, zoom/pan, drag, zoom-dependent label visibility, adaptive edge rendering (including attr-weighted edges), pulls all visual config from `GraphStore` |
| `js/ui.js` | Pure functions for UI components — stats bar, type filters (with counts and editable colour pickers), attr selectors (colour-by / size-by dropdowns), colour legend (gradient bar or categorical swatches, all editable), search wiring (combobox pattern with keyboard navigation), tooltip, detail sidebar, collapsible sidebar sections with ARIA |
| `js/main.js` | Entry point — file loading (drag-and-drop + picker), wires store → renderer → UI, owns selection state and highlight logic |
| `css/style.css` | Dark theme, layout, all component styles |
| `index.html` | App shell with semantic landmarks (`<main>`, `<aside>`, `<header>`), ARIA attributes, screen reader live region, loads D3 v7 from CDN, imports `main.js` as ES module |

## Data Flow

```
File drop/pick → main.js parses JSON
  → GraphStore.load() indexes nodes, edges, adjacency, discovers attrs
  → GraphStore.getVisible() computes visible subset
  → GraphRenderer.update() renders force-directed graph
  → UI callbacks wire click/hover/search/attr-selectors → store mutations → re-render
```

## Key Patterns

- **Fully data-driven**: all type colours, edge colours/dashes, node sizes, root types, and filter lists are derived from the loaded JSON at runtime. Nothing is hardcoded to a specific graph schema.
- **Progressive disclosure**: only root nodes (auto-detected as the type with fewest parentless nodes) visible initially; click expands children, click again collapses recursively.
- **Topology-driven layout**: D3's default link strength (inverse of node degree) keeps children clustered around high-degree parent nodes. New nodes are placed near their parent's position. A weak cluster force acts as a tiebreaker only for large graphs.
- **Zoom-dependent labels**: labels are created for the top 500 nodes by radius, then shown/hidden based on zoom level. Only nodes whose radius exceeds a threshold at the current zoom scale display labels. Labels are truncated at 24 characters.
- **Adaptive edge rendering**: edge opacity, stroke width, and arrow markers scale with the number of visible nodes to reduce visual noise in large graphs. When an attr mapping is active, edge weight derives from the target node's attr value.
- **Selection takes precedence over hover**: clicking a node or selecting via search sets a persistent selection. While a node is selected, hovering other nodes shows the tooltip but does not change the highlight. The selection highlight is also re-applied after any graph refresh (expand/collapse, filter toggle, attr change) so it is never silently lost. Clicking the background clears the selection.
- **Pre-tick layout**: when more than 100 new nodes appear, the simulation is pre-ticked off-screen in chunked `requestAnimationFrame` batches (up to 1000 ticks or 10 seconds) with collision disabled. A loading overlay ("Computing layout...") is shown during this phase. After pre-tick, `fitToView()` animates a zoom-to-fit transition.
- **Responsive resize**: a `ResizeObserver` on the graph container recalculates the viewBox, centering forces, and cluster centers when the window resizes.
- **D3 module as global**: D3 is loaded via `<script>` tag (not imported), so `d3` is a global. Don't add `import d3` statements.
- **No build step**: all JS uses native ES module `import`/`export`. No bundler, no transpiler.
- **State lives in `GraphStore`**: the renderer is stateless — call `update()` with new visible data after any store mutation. Colours and sizes are accessed via `store.nodeColor()`, `store.colorForType()`, `store.colorForRel()`, `store.nodeRadius()` etc. Selection state (`selectedNodeId`) lives in `main.js`, not in the store or renderer.
- **Attr-driven visual mapping**: `GraphStore` auto-discovers numeric and categorical attrs from node data. Users can select a "colour by" and "size by" attr via sidebar dropdowns. Numeric attrs map to a heat ramp (cyan→green→yellow→red); categorical attrs map to a distinct colour palette. Nodes missing the active attr fade to low opacity. All mapping is generic — no field names are hardcoded.

## Input Data Schema

The tool accepts any JSON file with `nodes[]` and `edges[]` arrays:

- `nodes[]` — each has `id` (string), `type` (string). `label` (string) and `attrs` (object) are optional.
- `edges[]` — each has `from` (string), `to` (string), `rel` (string). Any additional properties are preserved.
- `stats` — optional summary object with `nodes`, `edges`, `by_type`, `by_rel` counts
- `generated` — optional date string

Node types: auto-detected from data (ordered by graph depth, roots first). Types with reversed edge direction (e.g. crew→vessel where crew has no incoming edges but is semantically a leaf) have their depth inferred from neighbouring types.

Edge rels: auto-detected from data (ordered by frequency)

## Development

Serve with any static server:

```bash
python3 -m http.server 8000
```

No install step. No dependencies beyond a browser and D3 CDN.

## Testing

### Data layer (no browser)
Run GraphStore unit tests with Node's built-in test runner:

```bash
node --test test/data.test.mjs
```

103 tests total — 81 covering validation, loading, type/rel detection, expand/collapse, getVisible, search, reveal, nodeRadius, clusterCenters, edgesForNode, and childrenIds; 14 covering attribute discovery, colour-by-attr, size-by-attr, node opacity, and edge weight; 8 covering colour overrides (type, rel, categorical, heat ramp) and legend data. Four graph sizes (10/100/1k/10k nodes+edges each) verify correctness and performance.

A 9.6K-node test fixture is available at `test/fixtures/sample-large-graph.json` for visual testing.

### Visual (browser required)
Use Playwright MCP to load the page, drop a JSON file, and verify the graph renders.

## UI Controls

- **Expand All / Collapse All**: expand or collapse all nodes. Collapse All also clears the current selection and detail panel.
- **Pause / Resume**: a low-opacity ⏸/▶ icon overlay in the top-right corner of the graph area. Freezes or restarts the force simulation. Nodes can still be dragged while paused — position updates directly via `_tick()` without restarting the simulation. The icon toggles between pause bars and a play arrow; `aria-label` updates accordingly.
- **Labels toggle**: checkbox that shows/hides node labels. Labels are capped to the top 500 nodes by radius; zoom-dependent visibility hides labels whose node radius falls below a threshold at the current zoom scale.
- **Search**: implements the ARIA combobox/listbox pattern. 200ms debounce, minimum 2 characters, results capped to 20. Arrow Up/Down navigates results, Enter selects, Escape clears. Selecting a result calls `store.reveal()` to expand ancestors, auto-enables the node's type if filtered out, then selects and highlights the node.
- **Force controls**: five sliders (Repulsion, Link distance, Gravity, Collision pad, Clustering) with a "Reset forces" button. Forces are auto-tuned based on node count; user overrides are stored separately and merged at runtime. Sliders only auto-refresh when no user overrides exist.
- **Collapsible sidebar sections**: every `<h2 class="sidebar-heading">` inside a `.sidebar-section` acts as a toggle button (`role="button"`, `tabindex="0"`) with `aria-expanded` and `aria-controls`. Supports click, Enter, and Space.

## Conventions

- Dark theme with slate/indigo palette (see CSS custom properties)
- Node colors auto-assigned from a 16-colour palette in `data.js` (ordered for maximum perceptual contrast between adjacent types) — accessed via `store.colorForType()`. Users can override any type or rel colour via inline colour pickers; overrides are stored in the same Maps and take effect immediately. When an attr mapping is active, `store.nodeColor()` returns the attr-driven colour instead; `store.nodeOpacity()` fades nodes missing the active attr.
- Node sizes computed by `store.nodeRadius()` using exponential decay across the type hierarchy (roots largest, leaves smallest) plus a child-count area bonus. When a size attr is active, radius derives from the attr value with sqrt scaling.
- Edge colors/dashes auto-assigned from palettes in `data.js` — accessed via `store.colorForRel()` / `store.dashForRel()`. Edge stroke width and opacity also scale via `store.edgeWeight()` when an attr mapping is active.
- Expanded nodes have a light stroke to distinguish them from collapsed nodes
- Tooltip shows up to 4 attrs with "… and more" overflow. When an attr mapping is active, the tooltip dot reflects the mapped colour and active attrs are shown first in bold.
- Detail panel shows type, ID, all attrs (URLs rendered as links), and up to 50 connections with direction arrows and rel names.
- Stats bar shows generated date, total node/edge counts, and per-type colored dot counts.
- All user-facing text is plain English, no abbreviations
- No comments unless explaining *why*, not *what*
- Use `removeAttribute('display')` rather than `setAttribute('display', null)` for cross-browser compatibility (Firefox treats null as the literal string "null")

## Accessibility

- Semantic HTML landmarks: `<header>` (stats bar), `<main>` (graph), `<aside>` (sidebar)
- Heading hierarchy: `<h2>` for sidebar section headings, `<h3>` for detail panel node title, `<h4>` for detail sub-sections (Attributes, Connections)
- All form controls have associated labels: `<label>` with `for`/`id` for selects and sliders, `aria-label` for colour pickers and checkboxes
- Drop zone is keyboard-accessible: `role="button"`, `tabindex="0"`, responds to Enter and Space
- Search implements the ARIA combobox pattern: `role="combobox"` with `aria-expanded`, `aria-autocomplete`, `aria-activedescendant`; results use `role="listbox"` / `role="option"` with `aria-selected`
- Collapsible sections use `aria-expanded`, `aria-controls`, `role="button"`, and respond to keyboard
- SVG has `role="img"` and `aria-label`
- Screen reader live region (`#sr-announcements`, `aria-live="polite"`) announces graph load and node selection
- Detail panel uses `aria-live="polite"` for content updates
- Loading overlay uses `role="status"` with `aria-live="assertive"`
- Tooltip has `role="tooltip"` and `aria-live="polite"`
- All buttons have explicit `type="button"`
- `:focus-visible` outlines for keyboard navigation
- Accent colour (`#818cf8`) chosen to pass WCAG AA contrast on dark backgrounds
