# AGENTS.md

> **Keep in sync**: any changes to this file should also be reflected in `README.md`.

Guidelines for AI agents working on this project.

## Project Overview

Interactive D3.js force-directed graph visualization for directed graphs. Originally built for Trailmark output but fully generic — works with any JSON matching the `{nodes, edges}` schema. No build step — vanilla ES modules served as static files.

## Architecture

| File | Responsibility |
|---|---|
| `js/data.js` | `GraphStore` class — parses JSON, validates schema, builds adjacency index, auto-detects node types / root types / edge rels, infers depth for reversed-edge types, assigns colours, manages expand/collapse state, computes visible subset, search, `countForType()` / `countForRel()`, discovers numeric/categorical attrs, provides attr-driven colour/size/opacity mapping with selectable scale (linear/log/percentile), attribute rollups (sum/max aggregation of descendant numeric values onto ancestors, DAG-diamond-safe and cycle-safe), multi-parent type detection |
| `js/layouts.js` | Pure discrete layout functions (circle, grid, concentric, radial tree, AVSDF circular) and the layout registry (`ALL_LAYOUTS`, `LAYOUT_LABELS`). No D3 dependency — unit-testable in Node |
| `js/graph.js` | `GraphRenderer` class — D3 force simulation, SVG rendering, zoom/pan, drag, zoom-dependent label visibility, adaptive edge rendering (including attr-weighted edges), multi-parent visual marker (yellow dashed stroke), pulls all visual config from `GraphStore`, switches between force-directed and discrete layouts via `setLayout()` |
| `js/ui.js` | Pure functions for UI components — stats bar, type filters (with counts and editable colour pickers), edge legend (per-rel colour/dash swatches with counts and editable colour pickers), attr selectors (colour-by / size-by dropdowns), rollup controls (enable checkbox + sum/max aggregator selector), colour scale selector (linear/log/percentile), layout selector dropdown, colour legend (gradient bar or categorical swatches, all editable), search wiring (combobox pattern with keyboard navigation), tooltip (with multi-parent indicator and rollup value), detail modal content (with rollup value), collapsible sidebar sections with ARIA |
| `js/main.js` | Entry point — file loading (drag-and-drop + picker), wires store → renderer → UI, owns selection state and highlight logic, shows/hides the detail modal over the graph on node selection, hides force controls when a discrete layout is active, help modal (open via button or `?` shortcut, focus trapping, close on Escape/backdrop) |
| `css/style.css` | Dark theme, layout, all component styles |
| `index.html` | App shell with semantic landmarks (`<main>`, `<aside>`, `<header>`), ARIA attributes, screen reader live region, loads D3 v7 from CDN, imports `main.js` as ES module |

## Data Flow

```
File drop/pick → main.js parses JSON
  → GraphStore.load() indexes nodes, edges, adjacency, discovers attrs
  → GraphStore.getVisible() computes visible subset
  → GraphRenderer.update() renders graph (force-directed or discrete layout)
  → UI callbacks wire click/hover/search/attr-selectors/layout-selector → store mutations → re-render
```

## Key Patterns

- **Fully data-driven**: all type colours, edge colours/dashes, node sizes, root types, and filter lists are derived from the loaded JSON at runtime. Nothing is hardcoded to a specific graph schema.
- **Progressive disclosure**: only root nodes (auto-detected as any type with at least one parentless node) visible initially; click expands children, click again collapses recursively. All disconnected hierarchies are shown as entry points.
- **Topology-driven layout**: D3's default link strength (inverse of node degree) keeps children clustered around high-degree parent nodes. New nodes are placed near their parent's position. A weak cluster force acts as a tiebreaker only for large graphs.
- **Zoom-dependent labels**: labels are created for the top 500 nodes by radius, then shown/hidden based on zoom level. Only nodes whose radius exceeds a threshold at the current zoom scale display labels. Labels are truncated at 24 characters.
- **Adaptive edge rendering**: edge opacity, stroke width, and arrow markers scale with the number of visible nodes to reduce visual noise in large graphs. When an attr mapping is active, edge weight derives from the target node's attr value.
- **Selection takes precedence over hover**: clicking a node or selecting via search sets a persistent selection. While a node is selected, hovering other nodes shows the tooltip but does not change the highlight. The selection highlight is also re-applied after any graph refresh (expand/collapse, filter toggle, attr change) so it is never silently lost. Clicking the background clears the selection.
- **Pre-tick layout**: when more than 100 new nodes appear, the simulation is pre-ticked off-screen in chunked `requestAnimationFrame` batches (up to 1000 ticks or 10 seconds) with collision disabled. A loading overlay ("Computing layout...") is shown during this phase. After pre-tick, `fitToView()` animates a zoom-to-fit transition. Pre-tick only runs for the force-directed layout.
- **Discrete layouts**: switching to a non-force layout (circle, grid, concentric, radial tree, AVSDF circular) computes positions synchronously via pure functions in `layouts.js`, stops the simulation, renders once, and calls `fitToView()`. The force controls section is hidden while a discrete layout is active. Dragging still works — node positions update directly via `_tick()` without restarting the simulation. On window resize, discrete layouts are recomputed because their positions are viewport-relative.
- **Responsive resize**: a `ResizeObserver` on the graph container recalculates the viewBox, centering forces, and cluster centers when the window resizes. For discrete layouts, positions are recomputed and the view re-fitted.
- **D3 module as global**: D3 is loaded via `<script>` tag (not imported), so `d3` is a global. Don't add `import d3` statements.
- **No build step**: all JS uses native ES module `import`/`export`. No bundler, no transpiler.
- **State lives in `GraphStore`**: the renderer is stateless — call `update()` with new visible data after any store mutation. Colours and sizes are accessed via `store.nodeColor()`, `store.colorForType()`, `store.colorForRel()`, `store.nodeRadius()` etc. Selection state (`selectedNodeId`) lives in `main.js`, not in the store or renderer.
- **Attr-driven visual mapping**: `GraphStore` auto-discovers numeric and categorical attrs from node data. Users can select a "colour by" and "size by" attr via sidebar dropdowns. Numeric attrs map to a heat ramp (cyan→green→yellow→red) with a selectable scale mode (linear, log, or percentile) for handling skewed distributions; categorical attrs map to a distinct colour palette. Nodes missing the active attr fade to low opacity. All mapping is generic — no field names are hardcoded.
- **Attribute rollups**: when a numeric colour-by or size-by attr is active, users can enable "Roll up descendant values" to aggregate the attr across each node's sub-tree (self + all descendants) so the mapping works above the leaf layer. The aggregation function is Sum (default) or Max. Rollup values are computed in `_rebuildRollup()` as the aggregate over each node's unique descendant set — shared descendants in DAG diamonds are counted once, and cycles are handled by BFS reachability (each node visits its descendants at most once per traversal). Each node's descendant set is cached; for DAG regions a fast union of already-cached child sets avoids a full BFS, keeping the total work O(V × (V + E)) and fast enough for 10k-node graphs. When rollup is active, `getColorLegend()` reports the rolled-up range, `edgeWeight()` uses the target node's rolled-up value, and `nodeOpacity()`/`nodeColor()`/`nodeRadius()` reflect rolled-up values so ancestors without the raw attr still get a real colour/size. `rollupValue(node)` returns the aggregate (or undefined when rollup is off / the sub-tree has no value).
- **AVSDF circular layout**: `avsdfLayout()` in `layouts.js` implements He & Sykora's Adjacent Vertex with Smallest Degree First algorithm. A DFS-style traversal seeds each component from its smallest-degree vertex and always visits smallest-degree unplaced neighbours next, yielding zero crossings for any tree. A local "adjusting" post-pass (Algorithm 2) swaps each vertex with every neighbour and keeps the swap that reduces incident-edge crossings; it is gated by `adjustThreshold` (default 100 nodes) so large graphs skip it for performance. The graph is treated as undirected, since the circular (one-page) crossing number is defined on undirected graphs.

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
Run unit tests with Node's built-in test runner:

```bash
npm test
# or: node --test test/data.test.mjs test/layouts.test.mjs
```

184 tests total — 144 covering the data layer (validation, loading, type/rel detection, expand/collapse, getVisible, search, reveal, nodeRadius, clusterCenters, edgesForNode, childrenIds, attribute discovery, colour-by-attr, size-by-attr, node opacity, edge weight, colour overrides, legend data, multi-root support, colour scale modes, multi-parent type detection, edge count per rel, attribute rollups: defaults/state, sum aggregation, max aggregation, DAG-diamond dedup, cycles, colour/size/edge-weight integration, load-reset, large-graph performance) and 40 covering the five discrete layout algorithms (circle, grid, concentric, radial tree, AVSDF circular: placement correctness, velocity reset, metric ordering, multi-root and DAG handling, zero-crossing tree layouts, local-adjusting crossing reduction). Four graph sizes (10/100/1k/10k nodes+edges each) verify correctness and performance.

A 9.6K-node test fixture is available at `test/fixtures/sample-large-graph.json` for visual testing.

### Visual (browser required)
Playwright browser tests cover layout switching, rendering, and persistence across UI actions. The `playwright.config.mjs` scopes Playwright to browser-only test files (visual, edge-cases, large-fixture) so the Node unit tests are not picked up.

```bash
python3 -m http.server 8765
npx playwright test
```

24 tests across three files:
- `layouts.visual.test.mjs` — selector switching, all options present, discrete layouts render nodes & edges
- `layouts.edge-cases.test.mjs` — layout persists across expand/collapse, type filter toggle, search & select, colour-by attr change; pause/resume with discrete layout; force sim restores after switching back; drag works in discrete layouts; rollup controls appear when numeric colour-by attr selected; rollup changes node colours when enabled
- `layouts.large-fixture.test.mjs` — all layouts render 9,609 nodes / 13,417 edges with no browser errors

17 accessibility tests in `layouts.a11y.test.mjs`:
- Label association (`for`/`id`) and `aria-label` on the layout select
- Keyboard operability (focus, type-to-select)
- Heading hierarchy (h2, collapsible with `role="button"`, `aria-expanded`, `aria-controls`, `tabindex="0"`)
- SVG `aria-label` updates to name the active layout
- Screen reader live region announces layout changes
- Hidden force section is not focusable; reappears and is focusable when force layout reselected
- Sidebar toggle collapses/expands the sidebar with correct ARIA state and icon swap
- Sidebar toggle is keyboard operable (Enter and Space)
- Sidebar toggle is hidden until a graph is loaded
- Collapsed sidebar content is not focusable; becomes focusable again when expanded
- Loading a new graph resets the sidebar to expanded
- Help button is visible and labelled before a graph is loaded
- Help modal opens and closes with focus management (focus to close button, restore on close, SR announcements)
- Help modal is keyboard operable (`?` shortcut opens, Escape closes, `?` ignored in inputs)
- Help modal traps focus within the dialog (Tab/Shift+Tab wrap between focusable elements)
- Help modal closes on backdrop click and restores focus
- Help modal content has accessible headings (h2 title, 6 h3 sub-sections) and table structure (header cells, 5 shortcut rows)

## UI Controls

- **Expand All / Collapse All**: expand or collapse all nodes. Collapse All also clears the current selection and closes the detail modal.
- **Sidebar toggle (hamburger)**: a low-opacity icon overlay in the top-right corner of the graph area. Click (or Enter/Space when focused) to collapse or expand the sidebar. The icon shows an X while the sidebar is open (click to hide) and a hamburger while collapsed (click to show); `aria-expanded`, `aria-controls`, and `aria-label` update accordingly. Hidden until a graph is loaded.
- **Pause / Resume**: a low-opacity ⏸/▶ icon overlay in the top-left corner of the graph area. Freezes or restarts the force simulation. Nodes can still be dragged while paused — position updates directly via `_tick()` without restarting the simulation. The icon toggles between pause bars and a play arrow; `aria-label` updates accordingly.
- **Help dialog**: a low-opacity question-mark icon overlay in the bottom-left corner of the graph area. Click (or press `?` anywhere not in an input) to open a modal dialog (`role="dialog"`, `aria-modal="true"`) with usage instructions, sidebar control guide, keyboard shortcut table, and visual cue legend. The dialog traps Tab focus within itself, restores focus to the help button on close, and closes via the ✕ button, Escape, or a backdrop click. Visible before a graph is loaded so first-time users can discover functionality immediately.
- **Labels toggle**: checkbox that shows/hides node labels. Labels are capped to the top 500 nodes by radius; zoom-dependent visibility hides labels whose node radius falls below a threshold at the current zoom scale.
- **Layout selector**: dropdown to switch between force-directed (default) and discrete layouts (circle, grid, concentric, radial tree, AVSDF circular). Discrete layouts compute positions synchronously, stop the force simulation, and fit to view. The Forces sidebar section is hidden when a discrete layout is active.
- **Search**: implements the ARIA combobox/listbox pattern. 200ms debounce, minimum 2 characters, results capped to 20. Arrow Up/Down navigates results, Enter selects, Escape clears. Selecting a result calls `store.reveal()` to expand ancestors, auto-enables the node's type if filtered out, then selects and highlights the node.
- **Force controls**: five sliders (Repulsion, Link distance, Gravity, Collision pad, Clustering) with a "Reset forces" button. Forces are auto-tuned based on node count; user overrides are stored separately and merged at runtime. Sliders only auto-refresh when no user overrides exist.
- **Rollup controls**: shown in the "Visual Mapping" sidebar section only when a numeric colour-by or size-by attr is active. A "Roll up descendant values" checkbox toggles `store.setRollupEnabled()`; when enabled, an "Aggregate" dropdown selects Sum or Max via `store.setRollupFn()`. Enabling rollup aggregates the active numeric attr across each node's sub-tree (self + all descendants, DAG-diamond-safe and cycle-safe) so ancestor nodes without the raw attr get a real colour/size, the legend range reflects rolled-up values, edge weights use rolled-up target values, and tooltips / detail modal show the aggregate.
- **Edge legend**: lists every discovered relationship type with an SVG swatch showing the rel's colour and dash pattern, an editable colour picker, the rel name, and the edge count. Editing a colour calls `store.setRelColor()` and re-renders, updating edges and arrow markers. Rendered by `renderEdgeLegend()` into `#edge-legend` in a "Edge Types" sidebar section.
- **Collapsible sidebar sections**: every `<h2 class="sidebar-heading">` inside a `.sidebar-section` acts as a toggle button (`role="button"`, `tabindex="0"`) with `aria-expanded` and `aria-controls`. Supports click, Enter, and Space.

## Conventions

- Dark theme with slate/indigo palette (see CSS custom properties)
- Node colors auto-assigned from a 16-colour palette in `data.js` (ordered for maximum perceptual contrast between adjacent types) — accessed via `store.colorForType()`. Users can override any type or rel colour via inline colour pickers; overrides are stored in the same Maps and take effect immediately. When an attr mapping is active, `store.nodeColor()` returns the attr-driven colour instead; `store.nodeOpacity()` fades nodes missing the active attr.
- Node sizes computed by `store.nodeRadius()` using exponential decay across the type hierarchy (roots largest, leaves smallest) plus a child-count area bonus. When a size attr is active, radius derives from the attr value with sqrt scaling.
- Edge colors/dashes auto-assigned from palettes in `data.js` — accessed via `store.colorForRel()` / `store.dashForRel()`. Edge stroke width and opacity also scale via `store.edgeWeight()` when an attr mapping is active.
- Expanded nodes have a light stroke to distinguish them from collapsed nodes
- Multi-parent nodes (parents of 2+ different types, i.e. DAG diamonds) have a yellow dashed stroke to make the diamond structure visible
- Tooltip shows up to 4 attrs with "… and more" overflow. Multi-parent nodes display "Multiple parent types" in the tooltip. When an attr mapping is active, the tooltip dot reflects the mapped colour and active attrs are shown first in bold. When rollup is active, the tooltip shows the rolled-up aggregate (e.g. "score (Sum of descendants): 78") in bold.
- **Detail modal**: pops out over the top-right of the graph when a node is selected (via click or search). Shows type, ID, multi-parent indicator (when applicable), rollup aggregate (when active), all attrs (URLs rendered as links), and up to 50 connections with direction arrows and rel names. Closes via the ✕ button, Escape, or a background click; closing clears the selection and highlight. Anchor-positioned inside `#graph-container` (top: 60px, right: 16px) so it clears the sidebar toggle button and stays out of the sidebar's control stack. The modal body scrolls internally; the connections list no longer has its own scroll container.
- Stats bar shows generated date, total node/edge counts, and per-type colored dot counts.
- All user-facing text is plain English, no abbreviations
- No comments unless explaining *why*, not *what*
- Use `removeAttribute('display')` rather than `setAttribute('display', null)` for cross-browser compatibility (Firefox treats null as the literal string "null")

## Accessibility

- Semantic HTML landmarks: `<header>` (stats bar), `<main>` (graph), `<aside>` (sidebar)
- Heading hierarchy: `<h2>` for sidebar section headings, `<h3>` for detail modal node title, `<h4>` for detail sub-sections (Attributes, Connections)
- All form controls have associated labels: `<label>` with `for`/`id` for selects (including layout selector, colour scale selector, and rollup aggregate selector) and sliders, `aria-label` for colour pickers and checkboxes (including the rollup enable checkbox)
- Drop zone is keyboard-accessible: `role="button"`, `tabindex="0"`, responds to Enter and Space
- Search implements the ARIA combobox pattern: `role="combobox"` with `aria-expanded`, `aria-autocomplete`, `aria-activedescendant`; results use `role="listbox"` / `role="option"` with `aria-selected`
- Collapsible sections use `aria-expanded`, `aria-controls`, `role="button"`, and respond to keyboard
- Sidebar toggle uses `aria-expanded`, `aria-controls` (pointing at `#sidebar`), and a dynamic `aria-label` ("Hide sidebar"/"Show sidebar"); responds to Enter and Space. The collapsed sidebar uses `visibility: hidden` (delayed to preserve the slide animation) so its contents are removed from the tab order and accessibility tree.
- SVG has `role="img"` and an `aria-label` that names the active layout (e.g. "Circle layout graph visualization"), updated when the layout changes
- Screen reader live region (`#sr-announcements`, `aria-live="polite"`) announces graph load, node selection, layout changes, and help dialog open/close
- Detail modal uses `role="dialog"` with `aria-label`; its content region uses `aria-live="polite"` for updates. Closable via ✕ button, Escape, and background click.
- Help modal uses `role="dialog"` with `aria-modal="true"` and `aria-label`; content region has `role="document"`. Focus moves to the close button on open, Tab/Shift+Tab is trapped within the dialog, and focus is restored to the previously focused element on close. Closable via ✕ button, Escape, and backdrop click. Openable via the `?` keyboard shortcut (ignored when typing in inputs). Visible before a graph is loaded so new users can discover functionality immediately.
- Loading overlay uses `role="status"` with `aria-live="assertive"`
- Tooltip has `role="tooltip"` and `aria-live="polite"`
- All buttons have explicit `type="button"`
- `:focus-visible` outlines for keyboard navigation
- Multi-parent visual marker (`#facc15` yellow dashed stroke) has a non-colour-redundant cue (dash pattern) and a text equivalent in tooltip and detail modal
- Accent colour (`#818cf8`) chosen to pass WCAG AA contrast on dark backgrounds
