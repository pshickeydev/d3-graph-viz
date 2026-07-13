/**
 * ui.js — Sidebar, search, filters, tooltip, and stats bar.
 *
 * All visual configuration is pulled from the GraphStore instance.
 */

/* ------------------------------------------------------------------ */
/*  Stats bar                                                          */
/* ------------------------------------------------------------------ */

/**
 * Render the stats summary bar.
 * @param {HTMLElement} el
 * @param {Object}      stats
 * @param {string}      generated
 * @param {import('./data.js').GraphStore} store
 */
export function renderStats(el, stats, generated, store) {
  if (!stats) {
    el.innerHTML = '<span class="stat-item">No stats available</span>';
    return;
  }

  const items = [];

  if (generated) {
    items.push(`<span class="stat-item"><strong>Generated:</strong> ${generated}</span>`);
  }
  if (stats.nodes != null) {
    items.push(`<span class="stat-item"><strong>Nodes:</strong> ${Number(stats.nodes).toLocaleString()}</span>`);
  }
  if (stats.edges != null) {
    items.push(`<span class="stat-item"><strong>Edges:</strong> ${Number(stats.edges).toLocaleString()}</span>`);
  }

  if (stats.by_type) {
    for (const [type, count] of Object.entries(stats.by_type)) {
      const color = store.colorForType(type);
      items.push(
        `<span class="stat-item"><span class="stat-dot" style="background:${color}"></span>${type}: ${Number(count).toLocaleString()}</span>`
      );
    }
  }

  el.innerHTML = items.join('');
}

/* ------------------------------------------------------------------ */
/*  Type filters                                                       */
/* ------------------------------------------------------------------ */

/**
 * Render type filter checkboxes from the store's discovered types.
 * @param {HTMLElement} el
 * @param {import('./data.js').GraphStore} store
 * @param {function}    onChange — called with (type, enabled)
 */
export function renderTypeFilters(el, store, onChange, onColorChange) {
  el.innerHTML = '';
  for (const type of store.typeList) {
    const color = store.colorForType(type);
    const count = store.countForType(type);
    const checked = store.enabledTypes.has(type) ? 'checked' : '';

    const label = document.createElement('label');
    label.className = 'filter-item';
    label.innerHTML = `
      <input type="checkbox" data-type="${escapeHtml(type)}" ${checked} aria-label="Show ${escapeHtml(type)} nodes">
      <input type="color" class="filter-color" value="${color}" aria-label="Change colour for ${escapeHtml(type)}">
      ${escapeHtml(type)}
      <span class="filter-count">${count.toLocaleString()}</span>
    `;
    label.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
      onChange(type, e.target.checked);
    });
    const colorInput = label.querySelector('input[type="color"]');
    colorInput.addEventListener('input', (e) => {
      e.stopPropagation();
      store.setTypeColor(type, e.target.value);
      if (onColorChange) onColorChange();
    });
    colorInput.addEventListener('click', (e) => e.stopPropagation());
    el.appendChild(label);
  }
}

/* ------------------------------------------------------------------ */
/*  Search                                                             */
/* ------------------------------------------------------------------ */

/**
 * Wire up the search input.
 * @param {HTMLInputElement} input
 * @param {HTMLElement}      resultsList
 * @param {import('./data.js').GraphStore} store
 * @param {function}         onSelect — (nodeId) => void
 */
export function wireSearch(input, resultsList, store, onSelect) {
  let debounceTimer = null;
  let activeIndex = -1;

  function updateAriaExpanded() {
    const open = !resultsList.classList.contains('hidden') && resultsList.children.length > 0;
    input.setAttribute('aria-expanded', String(open));
  }

  function setActiveDescendant(index) {
    const items = resultsList.querySelectorAll('[role="option"]');
    items.forEach((item, i) => {
      item.classList.toggle('active', i === index);
      item.setAttribute('aria-selected', String(i === index));
    });
    activeIndex = index;
    if (index >= 0 && items[index]) {
      input.setAttribute('aria-activedescendant', items[index].id);
      items[index].scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function selectItem(nodeId) {
    onSelect(nodeId);
    resultsList.innerHTML = '';
    resultsList.classList.add('hidden');
    activeIndex = -1;
    updateAriaExpanded();
  }

  const onInput = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const query = input.value.trim();
      if (query.length < 2) {
        resultsList.innerHTML = '';
        resultsList.classList.add('hidden');
        activeIndex = -1;
        updateAriaExpanded();
        return;
      }
      const results = store.search(query);
      activeIndex = -1;
      renderSearchResults(resultsList, results, store, selectItem);
      updateAriaExpanded();
    }, 200);
  };

  const onKeydown = (e) => {
    const items = resultsList.querySelectorAll('[role="option"]');
    if (e.key === 'Escape') {
      input.value = '';
      resultsList.innerHTML = '';
      resultsList.classList.add('hidden');
      activeIndex = -1;
      updateAriaExpanded();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length > 0) {
        setActiveDescendant(activeIndex < items.length - 1 ? activeIndex + 1 : 0);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length > 0) {
        setActiveDescendant(activeIndex > 0 ? activeIndex - 1 : items.length - 1);
      }
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && items[activeIndex]) {
        e.preventDefault();
        items[activeIndex].click();
      }
    }
  };

  input.removeEventListener('input', input._searchInput);
  input.removeEventListener('keydown', input._searchKeydown);
  input._searchInput = onInput;
  input._searchKeydown = onKeydown;
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKeydown);
  input.value = '';
  resultsList.innerHTML = '';
  resultsList.classList.add('hidden');
  updateAriaExpanded();
}

function renderSearchResults(el, results, store, onSelect) {
  el.innerHTML = '';
  if (results.length === 0) {
    el.innerHTML = '<div class="search-result-item" role="option" aria-disabled="true">No results</div>';
    el.classList.remove('hidden');
    return;
  }

  const items = results.slice(0, 20);
  for (let i = 0; i < items.length; i++) {
    const node = items[i];
    const color = store.colorForType(node.type);
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');
    item.id = `search-option-${i}`;
    item.innerHTML = `
      <span class="filter-dot" style="background:${color}" aria-hidden="true"></span>
      <span class="search-label">${escapeHtml(node.label || node.id)}</span>
      <span class="search-type">${escapeHtml(node.type)}</span>
    `;
    item.addEventListener('click', () => {
      onSelect(node.id);
    });
    el.appendChild(item);
  }
  el.classList.remove('hidden');
}

/* ------------------------------------------------------------------ */
/*  Attribute selectors (colour-by / size-by)                          */
/* ------------------------------------------------------------------ */

/**
 * Render dropdowns for choosing colour-by and size-by attributes.
 * @param {HTMLElement} el
 * @param {import('./data.js').GraphStore} store
 * @param {function}    onChange — called after either selector changes
 */
export function renderAttrSelectors(el, store, onChange) {
  el.innerHTML = '';

  const colorAttrs = store.colorableAttrs();
  const sizeAttrs = store.sizableAttrs();

  const section = el.closest('.sidebar-section');
  if (colorAttrs.length === 0 && sizeAttrs.length === 0) {
    if (section) section.classList.add('hidden');
    return;
  }
  if (section) section.classList.remove('hidden');

  if (colorAttrs.length > 0) {
    const row = document.createElement('div');
    row.className = 'attr-selector-row';
    const label = document.createElement('label');
    label.className = 'attr-selector-label';
    label.textContent = 'Colour by';
    label.htmlFor = 'select-colour-by';
    const select = document.createElement('select');
    select.className = 'attr-selector';
    select.id = 'select-colour-by';

    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'Node type';
    select.appendChild(none);

    for (const p of colorAttrs) {
      const opt = document.createElement('option');
      opt.value = p.key;
      opt.textContent = `${p.key} (${p.kind})`;
      select.appendChild(opt);
    }

    select.value = store.colorAttr || '';
    select.addEventListener('change', () => {
      store.setColorAttr(select.value || null);
      onChange();
    });
    row.appendChild(label);
    row.appendChild(select);
    el.appendChild(row);
  }

  if (sizeAttrs.length > 0) {
    const row = document.createElement('div');
    row.className = 'attr-selector-row';
    const label = document.createElement('label');
    label.className = 'attr-selector-label';
    label.textContent = 'Size by';
    label.htmlFor = 'select-size-by';
    const select = document.createElement('select');
    select.className = 'attr-selector';
    select.id = 'select-size-by';

    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'Type hierarchy';
    select.appendChild(none);

    for (const p of sizeAttrs) {
      const opt = document.createElement('option');
      opt.value = p.key;
      opt.textContent = `${p.key}`;
      select.appendChild(opt);
    }

    select.value = store.sizeAttr || '';
    select.addEventListener('change', () => {
      store.setSizeAttr(select.value || null);
      onChange();
    });
    row.appendChild(label);
    row.appendChild(select);
    el.appendChild(row);
  }
}

/* ------------------------------------------------------------------ */
/*  Colour legend                                                      */
/* ------------------------------------------------------------------ */

/**
 * Render a colour legend for the active colour mapping.
 * Shows a gradient bar for numeric attrs, or labelled swatches for
 * categorical attrs. All colours are editable via colour picker inputs.
 * @param {HTMLElement} el
 * @param {import('./data.js').GraphStore} store
 * @param {function}    onChange — called after any colour change
 */
export function renderColorLegend(el, store, onChange) {
  el.innerHTML = '';

  const legend = store.getColorLegend();
  if (!legend) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');

  if (legend.kind === 'numeric') {
    _renderNumericLegend(el, legend, store, onChange);
  } else {
    _renderCategoricalLegend(el, legend, store, onChange);
  }
}

function _renderNumericLegend(el, legend, store, onChange) {
  const wrapper = document.createElement('div');
  wrapper.className = 'legend-numeric';

  const gradStr = legend.stops.join(', ');
  const bar = document.createElement('div');
  bar.className = 'legend-gradient-bar';
  bar.style.background = `linear-gradient(to right, ${gradStr})`;
  wrapper.appendChild(bar);

  const stops = document.createElement('div');
  stops.className = 'legend-stops';
  for (let i = 0; i < legend.stops.length; i++) {
    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'legend-stop-picker';
    input.value = legend.stops[i];
    input.setAttribute('aria-label', `Heat ramp stop ${i + 1}`);
    input.addEventListener('input', () => {
      store.setHeatRampStop(i, input.value);
      const newStops = store.getHeatRamp();
      bar.style.background = `linear-gradient(to right, ${newStops.join(', ')})`;
      onChange();
    });
    stops.appendChild(input);
  }
  wrapper.appendChild(stops);

  const labels = document.createElement('div');
  labels.className = 'legend-range-labels';
  labels.innerHTML = `<span>${_fmtNum(legend.min)}</span><span>${_fmtNum(legend.max)}</span>`;
  wrapper.appendChild(labels);

  el.appendChild(wrapper);
}

function _renderCategoricalLegend(el, legend, store, onChange) {
  const list = document.createElement('div');
  list.className = 'legend-categorical';
  for (const entry of legend.entries) {
    const row = document.createElement('div');
    row.className = 'legend-cat-item';

    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'legend-cat-picker';
    input.value = entry.color;
    input.setAttribute('aria-label', `Change colour for ${entry.value}`);
    input.addEventListener('input', () => {
      store.setCatColor(entry.value, input.value);
      onChange();
    });

    const label = document.createElement('span');
    label.className = 'legend-cat-label';
    label.textContent = entry.value;

    row.appendChild(input);
    row.appendChild(label);
    list.appendChild(row);
  }
  el.appendChild(list);
}

function _fmtNum(n) {
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toFixed(1);
}

/* ------------------------------------------------------------------ */
/*  Tooltip                                                            */
/* ------------------------------------------------------------------ */

/**
 * Show a tooltip near the cursor for a hovered node.
 * Displays all attrs generically — no hardcoded field names.
 * @param {HTMLElement} tooltipEl
 * @param {Object}      node
 * @param {MouseEvent}  event
 * @param {import('./data.js').GraphStore} store
 */
export function showTooltip(tooltipEl, node, event, store) {
  const color = store.nodeColor(node);
  let html = `
    <div class="tooltip-header">
      <span class="filter-dot" style="background:${color}"></span>
      <strong>${escapeHtml(node.label || node.id)}</strong>
    </div>
    <div class="tooltip-type">${escapeHtml(node.type)}</div>
  `;

  if (node.childCount) {
    html += `<div class="tooltip-detail">Children: ${node.childCount}</div>`;
  }

  if (node.attrs && typeof node.attrs === 'object') {
    const activeKeys = new Set();
    if (store.colorAttr) activeKeys.add(store.colorAttr);
    if (store.sizeAttr) activeKeys.add(store.sizeAttr);

    let shown = 0;
    const entries = Object.entries(node.attrs);
    const sorted = activeKeys.size > 0
      ? entries.sort(([a], [b]) => (activeKeys.has(b) ? 1 : 0) - (activeKeys.has(a) ? 1 : 0))
      : entries;

    for (const [key, val] of sorted) {
      if (val == null || val === '') continue;
      if (shown >= 4) {
        html += `<div class="tooltip-detail">… and more</div>`;
        break;
      }
      const display = typeof val === 'object' ? JSON.stringify(val) : String(val);
      const bold = activeKeys.has(key);
      html += bold
        ? `<div class="tooltip-detail"><strong>${escapeHtml(key)}: ${escapeHtml(display)}</strong></div>`
        : `<div class="tooltip-detail">${escapeHtml(key)}: ${escapeHtml(display)}</div>`;
      shown++;
    }
  }

  if (node.expanded) {
    html += '<div class="tooltip-hint">Click to collapse</div>';
  } else if (node.childCount) {
    html += '<div class="tooltip-hint">Click to expand</div>';
  }

  tooltipEl.innerHTML = html;
  tooltipEl.classList.remove('hidden');

  // Position near cursor, clamped to viewport
  const pad = 12;
  const rect = tooltipEl.getBoundingClientRect();
  let x = event.clientX + pad;
  let y = event.clientY + pad;
  if (x + rect.width > window.innerWidth) {
    x = event.clientX - rect.width - pad;
  }
  if (y + rect.height > window.innerHeight) {
    y = event.clientY - rect.height - pad;
  }
  tooltipEl.style.left = `${Math.max(0, x)}px`;
  tooltipEl.style.top = `${Math.max(0, y)}px`;
}

export function hideTooltip(tooltipEl) {
  tooltipEl.classList.add('hidden');
}

/* ------------------------------------------------------------------ */
/*  Sidebar detail panel                                               */
/* ------------------------------------------------------------------ */

/**
 * Render the detail panel for a selected node.
 * All attrs are shown generically.
 * @param {HTMLElement} el
 * @param {Object}      node
 * @param {Object[]}    edges
 * @param {import('./data.js').GraphStore} store
 */
export function renderDetail(el, node, edges, store) {
  if (!node) {
    el.innerHTML = '<div class="detail-empty">Click a node to see details</div>';
    return;
  }

  const color = store.colorForType(node.type);
  let html = `
    <div class="detail-header">
      <span class="detail-dot" style="background:${color}"></span>
      <h3 class="detail-title">${escapeHtml(node.label || node.id)}</h3>
    </div>
    <div class="detail-meta">
      <div><strong>Type:</strong> ${escapeHtml(node.type)}</div>
      <div><strong>ID:</strong> <code>${escapeHtml(node.id)}</code></div>
    </div>
  `;

  // Attrs table — render all attrs generically
  if (node.attrs && typeof node.attrs === 'object' && Object.keys(node.attrs).length > 0) {
    html += '<div class="detail-section"><h4 class="detail-section-heading">Attributes</h4><table class="detail-table">';
    for (const [key, val] of Object.entries(node.attrs)) {
      let display;
      if (typeof val === 'string' && isUrl(val)) {
        display = `<a href="${escapeHtml(val)}" target="_blank" rel="noopener">${escapeHtml(val)}</a>`;
      } else if (typeof val === 'object' && val !== null) {
        display = `<code>${escapeHtml(JSON.stringify(val))}</code>`;
      } else {
        display = escapeHtml(String(val));
      }
      html += `<tr><td>${escapeHtml(key)}</td><td>${display}</td></tr>`;
    }
    html += '</table></div>';
  }

  // Connected edges
  if (edges.length > 0) {
    html += `<div class="detail-section"><h4 class="detail-section-heading">Connections (${edges.length})</h4><ul class="detail-edges">`;
    const shown = edges.slice(0, 50);
    for (const e of shown) {
      const otherId = e.from === node.id ? e.to : e.from;
      const other = store.nodeMap.get(otherId);
      const otherLabel = other ? (other.label || other.id) : otherId;
      const dir = e.from === node.id ? '→' : '←';
      html += `<li>${dir} <span class="edge-rel">${escapeHtml(e.rel)}</span> ${escapeHtml(otherLabel)}</li>`;
    }
    if (edges.length > 50) {
      html += `<li class="detail-more">… and ${edges.length - 50} more</li>`;
    }
    html += '</ul></div>';
  }

  el.innerHTML = html;
}

/* ------------------------------------------------------------------ */
/*  Force controls                                                     */
/* ------------------------------------------------------------------ */

const FORCE_PARAMS = [
  { key: 'chargeStrength', label: 'Repulsion', min: -200, max: 0, step: 1 },
  { key: 'linkDistance',   label: 'Link distance', min: 5, max: 200, step: 1 },
  { key: 'gravity',       label: 'Gravity', min: 0, max: 0.15, step: 0.002 },
  { key: 'collisionPad',  label: 'Collision pad', min: 0, max: 40, step: 1 },
  { key: 'clusterStrength', label: 'Clustering', min: 0, max: 0.3, step: 0.005 },
];

export function renderForceControls(el, renderer, onChange) {
  el.innerHTML = '';

  const current = renderer.getForceParams();

  for (const p of FORCE_PARAMS) {
    const row = document.createElement('div');
    row.className = 'force-control-row';

    const header = document.createElement('div');
    header.className = 'force-control-header';

    const lbl = document.createElement('label');
    lbl.className = 'force-control-label';
    lbl.textContent = p.label;
    lbl.htmlFor = `force-${p.key}`;

    const val = document.createElement('span');
    val.className = 'force-control-value';

    header.appendChild(lbl);
    header.appendChild(val);

    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'force-slider';
    input.id = `force-${p.key}`;
    input.min = p.min;
    input.max = p.max;
    input.step = p.step;
    const snapped = Math.round(current[p.key] / p.step) * p.step;
    input.value = snapped;
    val.textContent = formatForceValue(snapped, p);

    input.addEventListener('input', () => {
      const v = Number(input.value);
      val.textContent = formatForceValue(v, p);
      renderer.setForceParam(p.key, v);
      if (onChange) onChange();
    });

    row.appendChild(header);
    row.appendChild(input);
    el.appendChild(row);
  }

  const resetBtn = document.createElement('button');
  resetBtn.className = 'action-btn reset-forces-btn';
  resetBtn.type = 'button';
  resetBtn.textContent = 'Reset forces';
  resetBtn.addEventListener('click', () => {
    renderer.clearForceOverrides();
    renderForceControls(el, renderer, onChange);
    if (onChange) onChange();
  });
  el.appendChild(resetBtn);
}

function formatForceValue(v, param) {
  if (param.step < 0.01) return v.toFixed(3);
  if (param.step < 1) return v.toFixed(2);
  return String(Math.round(v));
}

/* ------------------------------------------------------------------ */
/*  Collapsible sidebar sections                                       */
/* ------------------------------------------------------------------ */

export function wireSidebarCollapse(sidebar) {
  for (const heading of sidebar.querySelectorAll('.sidebar-section > .sidebar-heading')) {
    if (heading._collapseWired) continue;
    heading._collapseWired = true;

    heading.setAttribute('role', 'button');
    heading.setAttribute('tabindex', '0');
    const section = heading.closest('.sidebar-section');
    const isCollapsed = section.classList.contains('collapsed');
    heading.setAttribute('aria-expanded', String(!isCollapsed));

    const body = section.querySelector('.sidebar-section-body');
    if (body) {
      if (!body.id) body.id = `section-body-${Math.random().toString(36).slice(2, 8)}`;
      heading.setAttribute('aria-controls', body.id);
    }

    const toggle = () => {
      section.classList.toggle('collapsed');
      heading.setAttribute('aria-expanded', String(!section.classList.contains('collapsed')));
    };
    heading.addEventListener('click', toggle);
    heading.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function isUrl(str) {
  return /^https?:\/\//i.test(str);
}
