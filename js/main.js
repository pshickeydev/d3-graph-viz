/**
 * main.js — Entry point.  Wires file loading, graph store, renderer, and UI.
 */

import { GraphStore } from './data.js';
import { GraphRenderer } from './graph.js';
import {
  renderStats,
  renderTypeFilters,
  renderAttrSelectors,
  renderColorLegend,
  renderForceControls,
  wireSearch,
  showTooltip,
  hideTooltip,
  renderDetail,
} from './ui.js';

/* ------------------------------------------------------------------ */
/*  DOM references                                                     */
/* ------------------------------------------------------------------ */

const $         = (sel) => document.querySelector(sel);
const dropZone  = $('#drop-zone');
const fileInput = $('#file-input');
const graphEl   = $('#graph-container');
const statsBar  = $('#stats-bar');
const filters   = $('#type-filters');
const searchIn  = $('#search-input');
const searchRes = $('#search-results');
const detail    = $('#detail-panel');
const tooltip   = $('#tooltip');
const attrSel   = $('#attr-selectors');
const legend    = $('#color-legend');
const forceCtrl = $('#force-controls');
const btnExpandAll   = $('#btn-expand-all');
const btnCollapseAll = $('#btn-collapse-all');
const toggleLabels   = $('#toggle-labels input');

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

const store = new GraphStore();
let renderer = null;
let selectedNodeId = null;

/* ------------------------------------------------------------------ */
/*  File loading                                                       */
/* ------------------------------------------------------------------ */

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const json = JSON.parse(e.target.result);
      loadGraph(json);
    } catch (err) {
      alert(`Failed to parse JSON: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

// Drag-and-drop
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

// File picker
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
});

// Click drop zone to open picker
dropZone.addEventListener('click', () => fileInput.click());

/* ------------------------------------------------------------------ */
/*  Graph lifecycle                                                    */
/* ------------------------------------------------------------------ */

function loadGraph(json) {
  store.load(json);

  if (store.nodeMap.size === 0) {
    alert('The loaded file contains no nodes.');
    return;
  }

  // Hide drop zone, show graph
  dropZone.classList.add('hidden');
  graphEl.classList.remove('hidden');
  $('#sidebar').classList.remove('hidden');
  statsBar.classList.remove('hidden');

  // Stats
  renderStats(statsBar, json.stats, json.generated, store);

  // Type filters
  function onTypeFilterChange(type, enabled) {
    if (enabled) {
      store.enabledTypes.add(type);
    } else {
      store.enabledTypes.delete(type);
    }
    refreshGraph();
  }
  renderTypeFilters(filters, store, onTypeFilterChange, refreshGraph);

  function onAttrChange() {
    renderColorLegend(legend, store, refreshGraph);
    refreshGraph();
  }
  renderAttrSelectors(attrSel, store, onAttrChange);
  renderColorLegend(legend, store, refreshGraph);

  btnExpandAll.onclick = () => {
    store.expandAll();
    refreshGraph();
  };
  btnCollapseAll.onclick = () => {
    store.collapseAll();
    refreshGraph();
    selectedNodeId = null;
    renderer?.highlight(null);
    renderDetail(detail, null, [], store);
  };
  toggleLabels.onchange = () => {
    if (renderer) {
      renderer.showLabels = toggleLabels.checked;
      refreshGraph();
    }
  };

  // Search — reveal and enable the target node's type if filtered out
  wireSearch(searchIn, searchRes, store, (nodeId) => {
    const node = store.nodeMap.get(nodeId);
    if (node && !store.enabledTypes.has(node.type)) {
      store.enabledTypes.add(node.type);
      renderTypeFilters(filters, store, onTypeFilterChange, refreshGraph);
    }
    store.reveal(nodeId);
    refreshGraph();
    selectNode(nodeId);
  });

  // Create renderer
  if (renderer) {
    graphEl.querySelector('svg')?.remove();
  }
  renderer = new GraphRenderer(graphEl, store, {
    onNodeClick: (node) => {
      store.toggleExpand(node.id);
      refreshGraph();
      selectNode(node.id);
    },
    onNodeHover: (node, event) => {
      showTooltip(tooltip, node, event, store);
      highlightNode(node.id);
    },
    onNodeHoverOut: () => {
      hideTooltip(tooltip);
      if (!selectedNodeId) renderer.highlight(null);
    },
    onBackgroundClick: () => {
      selectedNodeId = null;
      renderer.highlight(null);
      renderDetail(detail, null, [], store);
    },
  });

  refreshGraph();
  renderForceControls(forceCtrl, renderer);
  renderDetail(detail, null, [], store);
}

function refreshGraph() {
  if (!renderer) return;
  const visible = store.getVisible();
  renderer.update(visible);
  if (forceCtrl && !renderer.hasForceOverrides()) {
    renderForceControls(forceCtrl, renderer);
  }
}

/* ------------------------------------------------------------------ */
/*  Selection & highlight                                              */
/* ------------------------------------------------------------------ */

function selectNode(nodeId) {
  selectedNodeId = nodeId;
  const node = store.nodeMap.get(nodeId);
  const edges = store.edgesForNode(nodeId);
  renderDetail(detail, node, edges, store);
  highlightNode(nodeId);
}

function highlightNode(nodeId) {
  const edges = store.edgesForNode(nodeId);
  const connected = new Set();
  for (const e of edges) {
    connected.add(e.from);
    connected.add(e.to);
  }
  renderer.highlight(nodeId, connected);
}
