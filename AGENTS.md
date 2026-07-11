# AGENTS.md

Guidelines for AI agents working on this project.

## Project Overview

Interactive D3.js force-directed graph visualization for directed graphs. Originally built for Trailmark output but fully generic — works with any JSON matching the `{nodes, edges}` schema. No build step — vanilla ES modules served as static files.

## Architecture

| File | Responsibility |
|---|---|
| `js/data.js` | `GraphStore` class — parses JSON, validates schema, builds adjacency index, auto-detects node types / root types / edge rels, assigns colours, manages expand/collapse state, computes visible subset, search |
| `js/graph.js` | `GraphRenderer` class — D3 force simulation, SVG rendering, zoom/pan, drag, pulls all visual config from `GraphStore` |
| `js/ui.js` | Pure functions for UI components — stats bar, type filters, search wiring, tooltip, detail sidebar |
| `js/main.js` | Entry point — file loading (drag-and-drop + picker), wires store → renderer → UI |
| `css/style.css` | Dark theme, layout, all component styles |
| `index.html` | App shell, loads D3 v7 from CDN, imports `main.js` as ES module |

## Data Flow

```
File drop/pick → main.js parses JSON
  → GraphStore.load() indexes nodes, edges, adjacency
  → GraphStore.getVisible() computes visible subset
  → GraphRenderer.update() renders force-directed graph
  → UI callbacks wire click/hover/search → store mutations → re-render
```

## Key Patterns

- **Fully data-driven**: all type colours, edge colours/dashes, node sizes, root types, and filter lists are derived from the loaded JSON at runtime. Nothing is hardcoded to a specific graph schema.
- **Progressive disclosure**: only root nodes (auto-detected as the type with fewest parentless nodes) visible initially; click expands children, click again collapses recursively
- **D3 module as global**: D3 is loaded via `<script>` tag (not imported), so `d3` is a global. Don't add `import d3` statements.
- **No build step**: all JS uses native ES module `import`/`export`. No bundler, no transpiler.
- **State lives in `GraphStore`**: the renderer is stateless — call `update()` with new visible data after any store mutation. Colours and sizes are accessed via `store.colorForType()`, `store.colorForRel()`, `store.nodeRadius()` etc.

## Input Data Schema

The tool accepts any JSON file with `nodes[]` and `edges[]` arrays:

- `nodes[]` — each has `id` (string), `type` (string). `label` (string) and `attrs` (object) are optional.
- `edges[]` — each has `from` (string), `to` (string), `rel` (string). Any additional properties are preserved.
- `stats` — optional summary object with `nodes`, `edges`, `by_type`, `by_rel` counts
- `generated` — optional date string

Node types: auto-detected from data (ordered by graph depth, roots first)
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

Tests exercise validation, loading, type/rel detection, expand/collapse, getVisible, search, reveal, and nodeRadius. Four graph sizes (10/100/1k/10k nodes+edges each) verify correctness and performance.

### Visual (browser required)
Use Playwright MCP to load the page, drop a JSON file, and verify the graph renders.

## Conventions

- Dark theme with slate/indigo palette (see CSS custom properties)
- Node colors auto-assigned from a 16-colour palette in `data.js` — accessed via `store.colorForType()`
- Node sizes computed by `store.nodeRadius()` based on type hierarchy depth + child count
- Edge colors/dashes auto-assigned from palettes in `data.js` — accessed via `store.colorForRel()` / `store.dashForRel()`
- Tooltip and detail panel show all node attrs generically (no hardcoded field names)
- All user-facing text is plain English, no abbreviations
- No comments unless explaining *why*, not *what*
