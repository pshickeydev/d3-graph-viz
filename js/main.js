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
  renderLayoutSelector,
  wireSearch,
  wireSidebarCollapse,
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
const detailModal = $('#detail-modal');
const detailClose = $('#detail-close');
const tooltip   = $('#tooltip');
const attrSel   = $('#attr-selectors');
const legend    = $('#color-legend');
const forceCtrl = $('#force-controls');
const layoutSel = $('#layout-selector');
const forceSection = $('#force-section');
const btnExpandAll   = $('#btn-expand-all');
const btnCollapseAll = $('#btn-collapse-all');
const btnPause       = $('#btn-pause');
const btnSidebarToggle = $('#btn-sidebar-toggle');
const sidebarEl     = $('#sidebar');
const toggleLabels   = $('#toggle-labels input');
const srAnnounce     = $('#sr-announcements');

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

const store = new GraphStore();
let renderer = null;
let selectedNodeId = null;

function announce(message) {
  if (srAnnounce) {
    srAnnounce.textContent = '';
    requestAnimationFrame(() => { srAnnounce.textContent = message; });
  }
}

function showDetailModal() {
  detailModal.classList.remove('hidden');
}
function hideDetailModal() {
  detailModal.classList.add('hidden');
}

// Close detail modal: clears selection + highlight, mirroring background click
function closeDetail() {
  selectedNodeId = null;
  renderer?.highlight(null);
  renderDetail(detail, null, [], store);
  hideDetailModal();
}
detailClose.addEventListener('click', closeDetail);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !detailModal.classList.contains('hidden') && e.target !== searchIn) {
    closeDetail();
  }
});

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

// Click or keyboard activate drop zone to open picker
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

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
  wireSidebarCollapse($('#sidebar'));
  announce(`Graph loaded: ${store.nodeMap.size} nodes, ${store.raw.edges.length} edges`);

  btnPause.classList.remove('hidden');
  btnPause.classList.remove('paused');
  btnPause.setAttribute('aria-label', 'Pause simulation');

  btnSidebarToggle.classList.remove('hidden');
  btnSidebarToggle.classList.remove('collapsed');
  btnSidebarToggle.setAttribute('aria-label', 'Hide sidebar');
  btnSidebarToggle.setAttribute('aria-expanded', 'true');
  sidebarEl.classList.remove('collapsed');

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
    hideDetailModal();
  };
  btnPause.onclick = () => {
    if (renderer.isPaused) {
      renderer.resume();
      btnPause.classList.remove('paused');
      btnPause.setAttribute('aria-label', 'Pause simulation');
    } else {
      renderer.pause();
      btnPause.classList.add('paused');
      btnPause.setAttribute('aria-label', 'Resume simulation');
    }
  };
  btnSidebarToggle.onclick = () => {
    const collapsed = sidebarEl.classList.toggle('collapsed');
    btnSidebarToggle.classList.toggle('collapsed', collapsed);
    btnSidebarToggle.setAttribute('aria-expanded', String(!collapsed));
    btnSidebarToggle.setAttribute('aria-label', collapsed ? 'Show sidebar' : 'Hide sidebar');
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
      if (!selectedNodeId) highlightNode(node.id);
    },
    onNodeHoverOut: () => {
      hideTooltip(tooltip);
      if (selectedNodeId) highlightNode(selectedNodeId);
      else renderer.highlight(null);
    },
    onBackgroundClick: () => {
      selectedNodeId = null;
      renderer.highlight(null);
      renderDetail(detail, null, [], store);
      hideDetailModal();
    },
  });

  refreshGraph();
  renderForceControls(forceCtrl, renderer);
  renderLayoutSelector(layoutSel, renderer, () => {
    // Hide force controls when a discrete layout is active.
    if (forceSection) {
      if (renderer.isForceLayout()) {
        forceSection.classList.remove('hidden');
      } else {
        forceSection.classList.add('hidden');
      }
    }
    const label = {
      force: 'Force-directed',
      circle: 'Circle',
      grid: 'Grid',
      concentric: 'Concentric',
      radial: 'Radial tree',
    }[renderer.getLayout()] || renderer.getLayout();
    announce(`Layout changed to ${label}`);
    refreshGraph();
  });
  renderDetail(detail, null, [], store);
  hideDetailModal();
}

function refreshGraph() {
  if (!renderer) return;
  const visible = store.getVisible();
  renderer.update(visible);
  if (selectedNodeId) highlightNode(selectedNodeId);
  if (forceCtrl && renderer.isForceLayout() && !renderer.hasForceOverrides()) {
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
  showDetailModal();
  highlightNode(nodeId);
  announce(`Selected ${node?.label || node?.id || nodeId}, ${edges.length} connections`);
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
