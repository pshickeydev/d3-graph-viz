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
export function renderTypeFilters(el, store, onChange) {
  el.innerHTML = '';
  for (const type of store.typeList) {
    const color = store.colorForType(type);
    const count = store.countForType(type);
    const checked = store.enabledTypes.has(type) ? 'checked' : '';

    const label = document.createElement('label');
    label.className = 'filter-item';
    label.innerHTML = `
      <input type="checkbox" data-type="${escapeHtml(type)}" ${checked}>
      <span class="filter-dot" style="background:${color}"></span>
      ${escapeHtml(type)}
      <span class="filter-count">${count.toLocaleString()}</span>
    `;
    label.querySelector('input').addEventListener('change', (e) => {
      onChange(type, e.target.checked);
    });
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

  const onInput = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const query = input.value.trim();
      if (query.length < 2) {
        resultsList.innerHTML = '';
        resultsList.classList.add('hidden');
        return;
      }
      const results = store.search(query);
      renderSearchResults(resultsList, results, store, onSelect);
    }, 200);
  };

  const onKeydown = (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      resultsList.innerHTML = '';
      resultsList.classList.add('hidden');
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
}

function renderSearchResults(el, results, store, onSelect) {
  el.innerHTML = '';
  if (results.length === 0) {
    el.innerHTML = '<div class="search-result-item">No results</div>';
    el.classList.remove('hidden');
    return;
  }

  for (const node of results.slice(0, 20)) {
    const color = store.colorForType(node.type);
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.innerHTML = `
      <span class="filter-dot" style="background:${color}"></span>
      <span class="search-label">${escapeHtml(node.label || node.id)}</span>
      <span class="search-type">${escapeHtml(node.type)}</span>
    `;
    item.addEventListener('click', () => {
      onSelect(node.id);
      el.innerHTML = '';
      el.classList.add('hidden');
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
    const label = document.createElement('span');
    label.className = 'attr-selector-label';
    label.textContent = 'Colour by';
    const select = document.createElement('select');
    select.className = 'attr-selector';

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
    const label = document.createElement('span');
    label.className = 'attr-selector-label';
    label.textContent = 'Size by';
    const select = document.createElement('select');
    select.className = 'attr-selector';

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
      <h3>${escapeHtml(node.label || node.id)}</h3>
    </div>
    <div class="detail-meta">
      <div><strong>Type:</strong> ${escapeHtml(node.type)}</div>
      <div><strong>ID:</strong> <code>${escapeHtml(node.id)}</code></div>
    </div>
  `;

  // Attrs table — render all attrs generically
  if (node.attrs && typeof node.attrs === 'object' && Object.keys(node.attrs).length > 0) {
    html += '<div class="detail-section"><h4>Attributes</h4><table class="detail-table">';
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
    html += `<div class="detail-section"><h4>Connections (${edges.length})</h4><ul class="detail-edges">`;
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
