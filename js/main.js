/**
 * main.js — Entry point.  Wires file loading, graph store, renderer, and UI.
 */

import { GraphStore } from './data.js';
import { GraphRenderer } from './graph.js';
import { LAYOUT_LABELS } from './layouts.js';
import {
  renderStats,
  renderTypeFilters,
  renderEdgeLegend,
  renderAttrSelectors,
  renderColorLegend,
  renderForceControls,
  renderLayoutSelector,
  renderGroupingControls,
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
const edgeLegend = $('#edge-legend');
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
const groupingEl = $('#grouping-controls');
const forceSection = $('#force-section');
const btnExpandAll   = $('#btn-expand-all');
const btnCollapseAll = $('#btn-collapse-all');
const btnPause       = $('#btn-pause');
const btnSidebarToggle = $('#btn-sidebar-toggle');
const sidebarEl     = $('#sidebar');
const toggleLabels   = $('#toggle-labels input');
const srAnnounce     = $('#sr-announcements');
const btnHelp        = $('#btn-help');
const helpModal      = $('#help-modal');
const helpBackdrop   = $('#help-backdrop');
const helpClose      = $('#help-close');
const helpBody       = helpModal.querySelector('.help-modal-body');

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

const store = new GraphStore();
let renderer = null;

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
  store.selectedNodeId = null;
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
/*  Static button bindings (bound once; renderer guard added)          */
/* ------------------------------------------------------------------ */

btnExpandAll.onclick = () => {
  store.expandAll();
  refreshGraph();
};
btnCollapseAll.onclick = () => {
  store.collapseAll();
  refreshGraph();
  store.selectedNodeId = null;
  renderer?.highlight(null);
  renderDetail(detail, null, [], store);
  hideDetailModal();
};
btnPause.onclick = () => {
  if (!renderer) return;
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
  if (!renderer) return;
  renderer.showLabels = toggleLabels.checked;
  refreshGraph();
};

/* ------------------------------------------------------------------ */
/*  Help modal                                                         */
/* ------------------------------------------------------------------ */

let helpPreviouslyFocused = null;

function openHelp() {
  helpPreviouslyFocused = document.activeElement;
  helpModal.classList.remove('hidden');
  helpBody.scrollTop = 0;
  announce('Help dialog opened');
  requestAnimationFrame(() => helpClose.focus());
}

function closeHelp() {
  helpModal.classList.add('hidden');
  announce('Help dialog closed');
  if (helpPreviouslyFocused) {
    helpPreviouslyFocused.focus();
    helpPreviouslyFocused = null;
  } else {
    btnHelp.focus();
  }
}

btnHelp.addEventListener('click', openHelp);
helpClose.addEventListener('click', closeHelp);
helpBackdrop.addEventListener('click', closeHelp);

document.addEventListener('keydown', (e) => {
  if (helpModal.classList.contains('hidden')) {
    if (e.key === '?' && !(e.target instanceof Element && e.target.matches('input, textarea, [contenteditable]'))) {
      e.preventDefault();
      openHelp();
    }
  } else {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeHelp();
    } else {
      const focusable = helpModal.querySelectorAll('button, [tabindex="0"]');
      const focusableArr = Array.from(focusable);
      if (focusableArr.length === 0) return;
      const first = focusableArr[0];
      const last = focusableArr[focusableArr.length - 1];
      if (e.key === 'Tab' && e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (e.key === 'Tab' && !e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
});

/* ------------------------------------------------------------------ */
/*  File loading                                                       */
/* ------------------------------------------------------------------ */

const dropZoneError = $('#drop-zone-error');
const dropZoneErrorText = $('#drop-zone-error-text');
const dropZoneErrorDismiss = $('#drop-zone-error-dismiss');

function showError(message) {
  dropZoneErrorText.textContent = message;
  dropZoneError.classList.remove('hidden');
  // Ensure the drop zone is visible so the banner can be seen.
  dropZone.classList.remove('hidden');
  announce(message);
}

function clearError() {
  dropZoneErrorText.textContent = '';
  dropZoneError.classList.add('hidden');
}

dropZoneErrorDismiss.addEventListener('click', (e) => {
  e.stopPropagation();
  clearError();
  // If a graph is already loaded, hide the drop zone to reveal it.
  if (store.nodeMap.size > 0) {
    dropZone.classList.add('hidden');
  }
});

function handleFile(file) {
  clearError();
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const json = JSON.parse(String(e.target.result));
      loadGraph(json);
    } catch (err) {
      showError(`Failed to parse JSON: ${err.message}`);
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
  try {
    store.load(json);
  } catch (err) {
    showError(err.message);
    return;
  }

  if (store.nodeMap.size === 0) {
    showError('The loaded file contains no nodes.');
    return;
  }

  clearError();

  // Reset selection state — the previous selection refers to the old graph
  store.selectedNodeId = null;
  hideTooltip(tooltip);

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
  renderEdgeLegend(edgeLegend, store, refreshGraph);

  function onAttrChange() {
    renderAttrSelectors(attrSel, store, onAttrChange);
    renderColorLegend(legend, store, refreshGraph);
    refreshGraph();
  }
  renderAttrSelectors(attrSel, store, onAttrChange);
  renderColorLegend(legend, store, refreshGraph);

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

  // Create renderer once; reuse across subsequent file loads
  if (!renderer) {
    renderer = new GraphRenderer(graphEl, store, {
      onNodeClick: (node) => {
        store.toggleExpand(node.id);
        refreshGraph();
        selectNode(node.id);
      },
      onNodeHover: (node, event) => {
        showTooltip(tooltip, node, event, store);
        if (!store.selectedNodeId) highlightNode(node.id);
      },
      onNodeHoverOut: () => {
        hideTooltip(tooltip);
        if (store.selectedNodeId) highlightNode(store.selectedNodeId);
        else renderer.highlight(null);
      },
      onBackgroundClick: () => {
        store.selectedNodeId = null;
        renderer.highlight(null);
        renderDetail(detail, null, [], store);
        hideDetailModal();
      },
    });
  } else {
    renderer.reset();
  }

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
    const label = LAYOUT_LABELS[renderer.getLayout()] || renderer.getLayout();
    announce(`Layout changed to ${label}`);
    refreshGraph();
  });
  // Reset force section visibility — renderer.reset() restored force layout
  if (forceSection && renderer.isForceLayout()) {
    forceSection.classList.remove('hidden');
  }
  function onGroupingChange() {
    const state = store.groupingEnabled ? 'enabled' : 'disabled';
    const by = store.groupBy === 'component' ? 'connected component' : 'node type';
    announce(`Grouping ${state}${store.groupingEnabled ? `, grouped by ${by}` : ''}`);
    renderGroupingControls(groupingEl, store, onGroupingChange);
    refreshGraph();
  }
  renderGroupingControls(groupingEl, store, onGroupingChange);
  renderDetail(detail, null, [], store);
  hideDetailModal();
}

function refreshGraph() {
  if (!renderer) return;
  const visible = store.getVisible();
  renderer.update(visible);
  if (store.selectedNodeId) highlightNode(store.selectedNodeId);
  if (forceCtrl && renderer.isForceLayout() && !renderer.hasForceOverrides()) {
    renderForceControls(forceCtrl, renderer);
  }
}

/* ------------------------------------------------------------------ */
/*  Selection & highlight                                              */
/* ------------------------------------------------------------------ */

function selectNode(nodeId) {
  store.selectedNodeId = nodeId;
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
