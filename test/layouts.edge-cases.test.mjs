import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GRAPH_FILE = path.join(__dirname, '..', 'large_graph.json');
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
