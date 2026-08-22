import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GRAPH_FILE = path.join(__dirname, 'fixtures', 'large_graph.json');
const BASE_URL = 'http://localhost:8765';

// Edge cases that the basic visual tests don't cover.

test('layout persists across expand/collapse', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  // Switch to circle layout
  await page.locator('#select-layout').selectOption('circle');
  await page.waitForTimeout(500);
  expect(await page.locator('#select-layout').inputValue()).toBe('circle');

  // Expand all — layout should remain circle
  await page.locator('#btn-expand-all').click();
  await page.waitForTimeout(1000);
  expect(await page.locator('#select-layout').inputValue()).toBe('circle');
  const expandedNodes = await page.evaluate(
    () => document.querySelectorAll('#graph-container > svg circle').length,
  );
  expect(expandedNodes).toBeGreaterThan(100);

  // Collapse all — layout should remain circle
  await page.locator('#btn-collapse-all').click();
  await page.waitForTimeout(800);
  expect(await page.locator('#select-layout').inputValue()).toBe('circle');

  expect(errors).toEqual([]);
});

test('layout persists across type filter toggle', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  // Switch to grid layout
  await page.locator('#select-layout').selectOption('grid');
  await page.waitForTimeout(500);
  expect(await page.locator('#select-layout').inputValue()).toBe('grid');

  // Expand all so type filters have effect
  await page.locator('#btn-expand-all').click();
  await page.waitForTimeout(1000);
  const beforeFilter = await page.evaluate(
    () => document.querySelectorAll('#graph-container > svg circle').length,
  );

  // Toggle off a type filter
  const firstCheckbox = page.locator('#type-filters input[type="checkbox"]').first();
  const wasChecked = await firstCheckbox.isChecked();
  if (wasChecked) {
    await firstCheckbox.uncheck();
    await page.waitForTimeout(500);
    const afterFilter = await page.evaluate(
      () => document.querySelectorAll('#graph-container > svg circle').length,
    );
    expect(afterFilter).toBeLessThan(beforeFilter);
  }

  // Layout should still be grid
  expect(await page.locator('#select-layout').inputValue()).toBe('grid');
  expect(errors).toEqual([]);
});

test('layout persists across search and select', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  // Switch to concentric layout
  await page.locator('#select-layout').selectOption('concentric');
  await page.waitForTimeout(500);
  expect(await page.locator('#select-layout').inputValue()).toBe('concentric');

  // Search for a node
  await page.locator('#search-input').fill('Node 1');
  await page.waitForTimeout(400); // 200ms debounce + buffer
  const results = await page.locator('#search-results [role="option"]').count();
  expect(results).toBeGreaterThan(0);

  // Click the first result
  await page.locator('#search-results [role="option"]').first().click();
  await page.waitForTimeout(500);

  // Layout should still be concentric
  expect(await page.locator('#select-layout').inputValue()).toBe('concentric');
  expect(errors).toEqual([]);
});

test('layout persists across colour-by attr change', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  // Switch to radial layout
  await page.locator('#select-layout').selectOption('radial');
  await page.waitForTimeout(500);
  expect(await page.locator('#select-layout').inputValue()).toBe('radial');

  // Expand all so attr mapping has an effect
  await page.locator('#btn-expand-all').click();
  await page.waitForTimeout(1000);

  // Change colour-by attr if available
  const colourBy = page.locator('#select-colour-by');
  if (await colourBy.count() > 0) {
    const opts = await colourBy.locator('option').allTextContents();
    if (opts.length > 1) {
      await colourBy.selectOption({ index: 1 });
      await page.waitForTimeout(500);
    }
  }

  // Layout should still be radial
  expect(await page.locator('#select-layout').inputValue()).toBe('radial');
  expect(errors).toEqual([]);
});

test('pause/resume works with discrete layout', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  // Switch to circle layout
  await page.locator('#select-layout').selectOption('circle');
  await page.waitForTimeout(500);

  // Pause
  await page.locator('#btn-pause').click();
  await expect(page.locator('#btn-pause')).toHaveClass(/paused/);

  // Resume — should not throw even though layout is discrete (no sim restart)
  await page.locator('#btn-pause').click();
  await expect(page.locator('#btn-pause')).not.toHaveClass(/paused/);

  expect(errors).toEqual([]);
});

test('force layout selection restores simulation', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  // Go force -> circle -> grid -> force and verify force section reappears
  // and simulation restarts (nodes move over time).
  for (const layout of ['circle', 'grid', 'force']) {
    await page.locator('#select-layout').selectOption(layout);
    await page.waitForTimeout(300);
  }

  await expect(page.locator('#force-section')).toBeVisible();

  // Force layout should be actively simulating — positions should drift.
  // Sample quickly (the small graph settles fast).
  const pos1 = await page.evaluate(() => {
    const c = document.querySelector('#graph-container > svg circle');
    return c ? { x: parseFloat(c.getAttribute('cx')), y: parseFloat(c.getAttribute('cy')) } : null;
  });
  await page.waitForTimeout(200);
  const pos2 = await page.evaluate(() => {
    const c = document.querySelector('#graph-container > svg circle');
    return c ? { x: parseFloat(c.getAttribute('cx')), y: parseFloat(c.getAttribute('cy')) } : null;
  });
  // At least one coordinate should have changed (simulation is running).
  // If the first node happened to be pinned, sample a few more.
  let moved = Math.abs(pos1.x - pos2.x) > 0.01 || Math.abs(pos1.y - pos2.y) > 0.01;
  if (!moved) {
    // Check a few more nodes — some may be fixed by drag.
    const samples = await page.evaluate(() => {
      const circles = document.querySelectorAll('#graph-container > svg circle');
      return Array.from(circles).slice(0, 10).map((c) => ({
        x: parseFloat(c.getAttribute('cx')), y: parseFloat(c.getAttribute('cy')),
      }));
    });
    await page.waitForTimeout(200);
    const samples2 = await page.evaluate(() => {
      const circles = document.querySelectorAll('#graph-container > svg circle');
      return Array.from(circles).slice(0, 10).map((c) => ({
        x: parseFloat(c.getAttribute('cx')), y: parseFloat(c.getAttribute('cy')),
      }));
    });
    for (let i = 0; i < samples.length; i++) {
      if (Math.abs(samples[i].x - samples2[i].x) > 0.01 || Math.abs(samples[i].y - samples2[i].y) > 0.01) {
        moved = true;
        break;
      }
    }
  }
  expect(moved, 'force simulation should be running after switching back').toBe(true);

  expect(errors).toEqual([]);
});

test('drag works in discrete layout', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  // Switch to grid layout (deterministic positions)
  await page.locator('#select-layout').selectOption('grid');
  await page.waitForTimeout(500);

  // Get the first node's screen position
  const firstCircle = page.locator('#graph-container > svg circle').first();
  const box = await firstCircle.boundingBox();
  expect(box).not.toBeNull();

  // Drag it by 50px to the right
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  // Node should have moved (no error thrown)
  const newBox = await firstCircle.boundingBox();
  expect(newBox).not.toBeNull();
  expect(Math.abs(newBox.x - box.x)).toBeGreaterThan(10);

  expect(errors).toEqual([]);
});

test('rollup controls appear when numeric colour-by attr is selected', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  // Switch to circle layout to stop the force simulation and avoid
  // render-during-tick races when changing attribute mappings.
  await page.locator('#select-layout').selectOption('circle');
  await page.waitForTimeout(500);

  // Initially, rollup controls should not be present (no attr selected)
  expect(await page.locator('#rollup-enabled').count()).toBe(0);

  const colourBy = page.locator('#select-colour-by');
  const opts = await colourBy.locator('option').allTextContents();
  expect(opts.length).toBeGreaterThan(1);

  // Select the first numeric attr (index 1 = "index (numeric)")
  await colourBy.selectOption({ index: 1 });
  await page.waitForTimeout(500);

  // Rollup checkbox should now be visible
  const rollupCheckbox = page.locator('#rollup-enabled');
  await expect(rollupCheckbox).toBeVisible();
  expect(await rollupCheckbox.isChecked()).toBe(false);

  // Aggregate dropdown should NOT be visible yet (rollup not enabled)
  expect(await page.locator('#select-rollup-fn').count()).toBe(0);

  // Enable rollup
  await rollupCheckbox.check();
  await page.waitForTimeout(500);
  expect(await rollupCheckbox.isChecked()).toBe(true);

  // Aggregate dropdown should now be visible
  const fnSelect = page.locator('#select-rollup-fn');
  await expect(fnSelect).toBeVisible();
  expect(await fnSelect.inputValue()).toBe('sum');

  // Switch to max
  await fnSelect.selectOption('max');
  await page.waitForTimeout(500);
  expect(await fnSelect.inputValue()).toBe('max');

  // Uncheck rollup — aggregate dropdown should disappear
  await rollupCheckbox.uncheck();
  await page.waitForTimeout(500);
  expect(await rollupCheckbox.isChecked()).toBe(false);
  expect(await page.locator('#select-rollup-fn').count()).toBe(0);

  expect(errors).toEqual([]);
});

test('rollup changes node colours when enabled', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  // Switch to radial layout to keep node positions stable while we change attrs
  await page.locator('#select-layout').selectOption('radial');
  await page.waitForTimeout(500);

  // Expand all so ancestor nodes are visible
  await page.locator('#btn-expand-all').click();
  await page.waitForTimeout(1000);

  // Select colour-by numeric attr
  await page.locator('#select-colour-by').selectOption({ index: 1 });
  await page.waitForTimeout(500);

  // Sample some node fill colours before rollup
  const fillsBefore = await page.evaluate(() => {
    const circles = document.querySelectorAll('#graph-container > svg circle');
    return Array.from(circles).slice(0, 20).map((c) => c.getAttribute('fill'));
  });

  // Enable rollup
  await page.locator('#rollup-enabled').check();
  await page.waitForTimeout(500);

  // Sample node fill colours after rollup — at least some should differ
  const fillsAfter = await page.evaluate(() => {
    const circles = document.querySelectorAll('#graph-container > svg circle');
    return Array.from(circles).slice(0, 20).map((c) => c.getAttribute('fill'));
  });

  let changed = 0;
  for (let i = 0; i < Math.min(fillsBefore.length, fillsAfter.length); i++) {
    if (fillsBefore[i] !== fillsAfter[i]) changed++;
  }
  expect(changed).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

/* ================================================================
 *  Grouping (compound / cluster)
 * ================================================================ */

test('grouping toggle renders one hull per visible type', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  // Enable grouping (default: by node type)
  await page.locator('#grouping-enabled').check();
  await page.waitForTimeout(800);

  const hulls = await page.evaluate(
    () => document.querySelectorAll('#graph-container .hulls path.hull').length,
  );
  expect(hulls).toBeGreaterThan(0);
  // At most one hull per visible type
  const types = await page.evaluate(() => {
    const checked = [...document.querySelectorAll('#type-filters input[type="checkbox"]')]
      .filter((c) => c.checked).length;
    return checked;
  });
  expect(hulls).toBeLessThanOrEqual(types);

  expect(errors).toEqual([]);
});

test('hull count updates after type-filter toggle and expand-all', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  await page.locator('#grouping-enabled').check();
  await page.waitForTimeout(800);
  const before = await page.evaluate(
    () => document.querySelectorAll('#graph-container .hulls path.hull').length,
  );

  // Expand all — more visible nodes means more (or same) hulls
  await page.locator('#btn-expand-all').click();
  await page.waitForTimeout(1500);
  const afterExpand = await page.evaluate(
    () => document.querySelectorAll('#graph-container .hulls path.hull').length,
  );
  expect(afterExpand).toBeGreaterThanOrEqual(before);

  // Toggle off a type filter — hull count should drop or stay consistent
  const firstCheckbox = page.locator('#type-filters input[type="checkbox"]').first();
  if (await firstCheckbox.isChecked()) {
    await firstCheckbox.uncheck();
    await page.waitForTimeout(800);
    const afterFilter = await page.evaluate(
      () => document.querySelectorAll('#graph-container .hulls path.hull').length,
    );
    expect(afterFilter).toBeLessThanOrEqual(afterExpand);
  }

  expect(errors).toEqual([]);
});

test('selection survives enabling and disabling grouping', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  // Select a node via search (reveals ancestors and selects)
  await page.locator('#search-input').fill('Node 1');
  await page.waitForTimeout(400);
  await page.locator('#search-results [role="option"]').first().click();
  await page.waitForTimeout(500);
  expect(await page.locator('#detail-modal').isVisible()).toBe(true);

  // Enable grouping — selection should persist (detail modal stays open)
  await page.locator('#grouping-enabled').check();
  await page.waitForTimeout(800);
  expect(await page.locator('#detail-modal').isVisible()).toBe(true);

  // Disable grouping — selection should still persist
  await page.locator('#grouping-enabled').uncheck();
  await page.waitForTimeout(800);
  expect(await page.locator('#detail-modal').isVisible()).toBe(true);

  expect(errors).toEqual([]);
});

test('grouping works with a discrete layout active', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  // Switch to circle layout first
  await page.locator('#select-layout').selectOption('circle');
  await page.waitForTimeout(500);

  // Enable grouping — regions should render instead of hulls
  await page.locator('#grouping-enabled').check();
  await page.waitForTimeout(800);

  const regions = await page.evaluate(
    () => document.querySelectorAll('#graph-container .hulls rect.group-region').length,
  );
  expect(regions).toBeGreaterThan(0);
  const regionLabels = await page.evaluate(
    () => document.querySelectorAll('#graph-container .hulls text.group-region-label').length,
  );
  expect(regionLabels).toBe(regions);

  // Switch to another discrete layout — still no errors, regions persist
  await page.locator('#select-layout').selectOption('grid');
  await page.waitForTimeout(800);
  const regionsGrid = await page.evaluate(
    () => document.querySelectorAll('#graph-container .hulls rect.group-region').length,
  );
  expect(regionsGrid).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

test('group-by switch to connected component changes hull count', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  await page.locator('#grouping-enabled').check();
  await page.waitForTimeout(800);
  const typeHulls = await page.evaluate(
    () => document.querySelectorAll('#graph-container .hulls path.hull').length,
  );

  await page.locator('#select-group-by').selectOption('component');
  await page.waitForTimeout(800);
  const componentHulls = await page.evaluate(
    () => document.querySelectorAll('#graph-container .hulls path.hull').length,
  );
  // A connected graph should have fewer (or equal) component hulls than type hulls
  expect(componentHulls).toBeLessThanOrEqual(typeHulls);

  expect(errors).toEqual([]);
});

test('hull labels appear when zoomed in and hide when zoomed out', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  await page.locator('#grouping-enabled').check();
  await page.waitForTimeout(800);

  const visibleHullLabels = () => page.evaluate(
    () => [...document.querySelectorAll('#graph-container .hulls text.hull-label')]
      .filter((t) => t.getAttribute('display') !== 'none').length,
  );

  // At fit-to-view zoom the labels are shown
  expect(await visibleHullLabels()).toBeGreaterThan(0);

  // Zoom out past the threshold — labels hidden via display attribute
  const svg = page.getByRole('img', { name: /layout graph visualization/ });
  await svg.hover();
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(120);
  }
  expect(await visibleHullLabels()).toBe(0);

  // Zoom back in — labels must reappear without losing the hulls
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(400);
  expect(await visibleHullLabels()).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

test('single-member groups render no region or label in discrete layouts', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  await page.locator('#select-layout').selectOption('circle');
  await page.waitForTimeout(500);
  await page.locator('#grouping-enabled').check();
  await page.waitForTimeout(800);

  // The fixture's initial view has exactly one singleton type ('root'):
  // it must not get a region or a label, matching force-mode hulls.
  const labelTexts = await page.evaluate(
    () => [...document.querySelectorAll('#graph-container .hulls text.group-region-label')]
      .map((t) => t.textContent),
  );
  expect(labelTexts.length).toBeGreaterThan(0);
  expect(labelTexts.some((t) => t.startsWith('root '))).toBe(false);
  for (const t of labelTexts) {
    const count = Number(t.match(/\((\d+)\)/)?.[1] || 0);
    expect(count).toBeGreaterThanOrEqual(2);
  }

  expect(errors).toEqual([]);
});
