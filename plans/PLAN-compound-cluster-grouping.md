# Plan: Compound / Cluster Grouping

Implements the "compound/cluster grouping" item from README.md → Future Improvements
("Additional layouts (DAG layered / dagre-style, compound/cluster grouping)").

## 1. Goal & interpretation

Add a **grouped (compound) visualisation mode**: visible nodes are partitioned into
clusters, each cluster is drawn inside a labelled convex-hull (or rounded-rect) band,
and clusters are spatially separated so the grouping is readable at a glance.

This is **not** a new discrete layout and **not** a new layout-registry entry. It is a
rendering + force overlay that composes with the existing layouts:

- With the **force-directed layout** (default): the existing per-type `cluster` force
  already groups same-type nodes. The new feature makes that grouping *visible* by
  drawing hulls and upgrades the force so it is optional and stronger when enabled.
- With **discrete layouts** (circle, grid, concentric, radial, avsdf): positions are
  computed per-cluster (clusters are laid out first, then nodes within each cluster),
  so the grouping survives in discrete mode too.

Default grouping key is **node `type`** (consistent with the existing
`clusterCenters()` in `js/data.js:1275` and the existing `forceCluster` in
`js/graph.js:38`). A secondary grouping by **connected component** is included because
it is schema-independent and useful for the multi-hierarchy graphs this tool targets.

Out of scope (do not implement): nested/hierarchical compound nodes (cytoscape-style
`parent` fields), collapse-to-supernode semantics, dagre layered layout (a separate
Future Improvements bullet).

## 2. User-facing behaviour

- New sidebar section **"Grouping"** (collapsible, same pattern as other sections)
  placed directly below the Layout selector section in `index.html`.
  - Checkbox **"Group nodes into clusters"** (`#grouping-enabled`, default off).
  - Dropdown **"Group by"** (`#group-by`) with options: `Node type` (default),
    `Connected component`. Disabled while the checkbox is unchecked.
- When enabled:
  - Every visible cluster is enclosed by a translucent filled hull/region with a
    1px border in the cluster's colour (`store.colorForType()` for type grouping,
    a grey ramp for component grouping), rendered **behind** edges.
  - A cluster label (group key + member count, e.g. `vessel (42)`) is drawn at the
    hull centroid in a muted colour, hidden when the cluster has fewer than 2
    visible members or when zoomed out past the existing label threshold logic.
  - Force layout: the `cluster` force targets the active grouping instead of
    hardcoded `node.type`, and its strength floor is raised (see §5) so hulls are
    actually compact. The existing "Clustering" force slider continues to work.
  - Discrete layouts: a cluster-aware variant packs clusters into the viewport and
    runs the selected discrete layout inside each cluster's region (see §6).
- Toggling grouping, changing the group-by key, expanding/collapsing, filtering
  types, or changing attr mappings all re-render hulls without losing the current
  selection (selection re-apply is already handled by `refreshGraph()` in
  `js/main.js:390`).
- Layout changes keep the grouping setting; loading a new file resets grouping to
  off (consistent with attr-state reset in `GraphStore._resetAttrState()`).
- Screen-reader live region announces: `Grouping enabled, grouped by node type` /
  `Grouping disabled`. SVG `aria-label` is unchanged (it names the layout).

## 3. Data layer (`js/data.js`)

Add to `GraphStore`:

- State:
  - `_groupingEnabled = false` (boolean)
  - `_groupBy = 'type'` (`'type' | 'component'`)
  - `_componentId = Map<string, number>` — node id → connected-component index,
    computed once in `load()` via union-find over `edges` (treat edges as
    undirected). Deterministic: components numbered in order of first encounter
    iterating `this.nodes` in input order.
- Accessors (all with JSDoc, per project typecheck rules):
  - `get groupingEnabled()` / `setGroupingEnabled(bool)`
  - `get groupBy()` / `setGroupBy(key)` — validates against `['type', 'component']`,
    throws `Error` on unknown key (same style as existing validation errors).
  - `groupKeyFor(node)` → `string` — returns `node.type` or `String(componentId)`.
  - `groupLabel(key)` → `string` — for `type` returns the type name; for
    `component` returns `Component N` (1-based, ordered by component size
    descending, recomputed per call site from `_componentId` sizes cached at load).
  - `groupColor(key)` → hex string — for `type` delegates to `colorForType()`;
    for `component` returns one of a fixed 8-colour grey/slate ramp by
    `componentIndex % 8`.
  - `visibleGroups(visibleNodes)` → `Map<string, Object[]>` — partitions the given
    node array by `groupKeyFor`. Used by renderer; pure function of input.
- Reset: add the three new fields to `_resetAttrState()`-adjacent reset logic in
  `load()` (grouping off, groupBy `'type'`). Follow the existing pattern — do not
  clear fields individually outside the centralised reset.

Component ids are stable across expand/collapse because they are computed from the
full edge list, not the visible subset.

## 4. Layout layer (`js/layouts.js`)

No new entry in `DISCRETE_LAYOUTS` / `LAYOUT_LABELS`. Add one pure helper:

```js
export function groupedDiscreteLayout(baseLayoutFn, groups, width, height, opts = {})
```

- `groups`: `Map<groupKey, node[]>` (from `store.visibleGroups`).
- Compute each cluster's bounding requirement (`sqrt(count)`-proportional area),
  then pack cluster regions in a deterministic grid over the viewport (clusters
  sorted by size descending; grid cell size proportional to cluster area).
- Run `baseLayoutFn(nodes, cellW, cellH, opts)` per cluster with `x/y` offset by
  the cell origin. Because all existing discrete layouts are pure functions of
  `(nodes, w, h, opts)`, they can be reused per-cluster without modification.
- Return a `Map<groupKey, {cx, cy, w, h}>` of cluster regions so the renderer can
  draw labelled regions without a separate hull computation in discrete mode.
- Mutates `x/y/vx/vy` like the other layouts. Zero-velocity on every node.

Edge cases to handle (with unit tests): empty node list, single cluster, single
node per cluster, clusters with 0 visible members must not appear.

## 5. Renderer (`js/graph.js`)

### 5.1 Hull layer

- In `_init()` add a fourth sub-group **before** `.links` so hulls render behind
  edges: `this.g.append('g').attr('class', 'hulls')`.
- In `update()`, after node positions are known for discrete layouts and on every
  `_tick()` for force layout:
  - If `store.groupingEnabled` and `simNodes.length >= 2`:
    - Partition via `store.visibleGroups(simNodes)`.
    - Per group with ≥ 2 members compute a convex hull with `d3.polygonHull()`
      (already available — `d3` global from CDN; do **not** add an import).
      Pad the hull by `maxNodeRadius + 12` px.
    - Data-join `<path>` per group (key = group key) with `fill: groupColor(key)`
      at opacity 0.08, `stroke: groupColor(key)` at opacity 0.35, stroke-width 1,
      `pointer-events: none`.
    - Data-join `<text>` per group at hull centroid (`d3.polygonCentroid`) with
      `groupLabel(key) + ' (' + members.length + ')'`, fill `#94a3b8`,
      `pointer-events: none`, hidden when `this._zoomScale < 0.4` (reuse the
      label-visibility threshold style from `_updateLabelVisibility`).
  - Else: clear the hull layer (`selectAll('*').remove()` once when transitioning
    from enabled → disabled; cheap because the join is keyed).
- Hull recompute cost is O(k · n log n) per tick; gate full recompute to every tick
  is acceptable for ≤ 1k visible nodes. For > 1k visible nodes, draw hulls only when
  the simulation settles (`alpha < 0.05`) and on discrete-layout render — document
  this in the code (why, not what).

### 5.2 Force integration

- `forceCluster(clusterCenters, strength)` currently keys on `node.type`
  (`graph.js:42`). Generalise: pass a `keyFn` — `forceCluster(centers, strength,
  keyFn)`. When grouping is enabled and `groupBy === 'component'`, the caller
  supplies `keyFn = (node) => store.groupKeyFor(node)` and a centres map keyed by
  group (add `store.groupCenters(width, height)` mirroring `clusterCenters()` but
  keyed by `groupKeyFor` over **visible** nodes; falls back to `clusterCenters()`
  semantics for `'type'`).
- When grouping is enabled, set the auto-tuned `clusterStrength` floor in
  `_tuneForces` to `Math.max(t * 0.06, 0.12)` so hulls are visually compact by
  default. User overrides still win via `_effectiveForceParams()`.
- The "Clustering" slider keeps controlling the same force; no UI change needed.

### 5.3 Discrete layouts

- In `_applyDiscreteLayout()`: when `store.groupingEnabled`, wrap the chosen
  discrete layout with `groupedDiscreteLayout()` from `layouts.js`, passing
  `store.visibleGroups(simNodes)`; store the returned regions map on
  `this._groupRegions` so `_tick()`/hull rendering can draw labelled regions
  (simple rounded `<rect>` per region in discrete mode — no hull needed since
  regions don't move).
- When grouping is disabled, call the discrete layouts exactly as today.
- The ResizeObserver path (`graph.js:183-187`) re-runs `_applyDiscreteLayout`, so
  regions recompute automatically. No extra wiring.

### 5.4 Reset

- In `reset()`: clear the hull layer, `_groupRegions = null`. Grouping state lives
  on the store and is reset by `GraphStore.load()`, so the renderer just reads
  `store.groupingEnabled` on next `update()`.

## 6. UI (`js/ui.js`, `js/main.js`, `index.html`, `css/style.css`)

- `index.html`: add a `<section class="sidebar-section">` with
  `<h2 class="sidebar-heading">Grouping</h2>` and a container `<div
  id="grouping-controls">`, placed immediately after the layout section. Follow the
  existing collapsible-section markup exactly (ARIA attributes come for free from
  the existing section-toggle wiring, which selects by `.sidebar-heading`).
- `js/ui.js`: new exported pure function
  `renderGroupingControls(el, store, onChange)`:
  - Builds the checkbox + labelled select per the accessibility conventions already
    used (`<label for>`, `aria-label` on checkbox, plain-English labels).
  - `change` handlers call `store.setGroupingEnabled()` / `store.setGroupBy()` then
    `onChange()`.
- `js/main.js`: in `loadGraph()`, call `renderGroupingControls(groupingEl, store,
  () => { announce(...); refreshGraph(); })` next to the existing
  `renderLayoutSelector(...)` call. Announcer messages per §2.
- `css/style.css`: styles for `.grouping-row` (reuse `.attr-selector-row` /
  `.attr-selector` classes where possible — prefer reuse over new CSS), plus
  `.hulls path` / `.hulls text` default styles if not set inline.

## 7. Tests

### 7.1 Node unit tests (`node --test`)

`test/data.test.mjs` — new `describe('grouping', ...)` block:
- `groupKeyFor` returns type / component id correctly.
- Components: two disconnected hierarchies → two distinct component ids; ids are
  deterministic across reload.
- `visibleGroups` partitions a node array and skips nothing.
- `setGroupBy` rejects unknown keys (throws).
- Grouping state resets on `load()`.
- `groupCenters` returns one center per visible group, deterministic for same
  dimensions (mirror the existing `clusterCenters` tests at
  `test/data.test.mjs:421`).

`test/layouts.test.mjs` — new `describe('groupedDiscreteLayout', ...)`:
- Every node lands inside its cluster's returned region rect.
- Regions for different clusters do not overlap (assert pairwise rect separation).
- Velocities reset to 0 (mirrors existing per-layout tests).
- Empty input, single cluster, single node per cluster.
- Deterministic for same input.

Update the test-count paragraph in README.md §Testing and AGENTS.md §Testing
(new totals = existing + new).

### 7.2 Playwright tests

`test/layouts.edge-cases.test.mjs` (append):
- Grouping toggle renders one `.hulls path` per visible type on the small fixture.
- Hull count updates after type-filter toggle and after expand-all.
- Selection survives enabling/disabling grouping.
- Works with a discrete layout active (regions render, no console errors).
- Group-by switch to "Connected component" changes hull count appropriately.

`test/layouts.a11y.test.mjs` (append):
- Grouping checkbox and select have associated labels / `aria-label`.
- Live region announces grouping enable/disable.
- Grouping section heading participates in collapsible-section keyboard behaviour.

`test/layouts.large-fixture.test.mjs` (append):
- Enable grouping with the 9.6k-node fixture: no browser errors, hull count > 0
  after expand-all (or document the >1k-node deferred-hull behaviour and assert it).

## 8. Docs & housekeeping

- `README.md`: remove "compound/cluster grouping" from Future Improvements; add a
  bullet under the features section describing grouping (checkbox, group-by,
  hulls, works with force + discrete layouts). Update test counts.
- `AGENTS.md`: mirror README changes (the file header demands sync); add a Key
  Patterns bullet: "Grouping is a store-owned overlay (`store.groupingEnabled` /
  `store.visibleGroups()`); the renderer draws hulls behind edges in a `.hulls`
  group and reuses `groupedDiscreteLayout()` for discrete modes. Hull recompute is
  deferred to simulation settle above 1k visible nodes."
- `npm run typecheck` must pass with zero errors; add JSDoc to all new public APIs.

## 9. Implementation order (agent checklist)

1. `js/data.js`: component ids at load + grouping state + accessors + reset.
2. Unit tests for data layer; run `npm test`.
3. `js/layouts.js`: `groupedDiscreteLayout()` + unit tests; run `npm test`.
4. `js/graph.js`: hull layer, generalised `forceCluster(keyFn)`, discrete-layout
   integration, reset; run `npm run typecheck`.
5. `index.html` section + `js/ui.js` `renderGroupingControls` + `js/main.js`
   wiring + CSS.
6. Playwright tests (edge-cases, a11y, large-fixture); serve on :8765 and run
   `npx playwright test`.
7. README/AGENTS updates; final `npm test && npm run typecheck && npx playwright
   test` green.

## 10. Risks / decisions taken

- **Per-tick hull cost on large graphs**: mitigated by the >1k deferred-hull rule
  (§5.1). Alternative considered: drawing hulls only on `zoom end` — rejected,
  hulls must track node motion in force mode.
- **Group-by extensibility**: the `groupKeyFor`/`groupLabel`/`groupColor` triplet
  keeps grouping keys open-ended (a future "group by categorical attr" only adds a
  store branch, no renderer change). Only `type` and `component` ship in this
  iteration.
- **Discrete layouts** reuse existing pure functions per cluster instead of new
  algorithms — keeps `layouts.js` testable in Node and avoids duplicating five
  layout implementations.
- **No hulls for singletons**: single-member groups render no hull/label to avoid
  visual noise on root-heavy initial views.
