import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GRAPH_FILE = path.join(__dirname, 'fixtures', 'sample-large-graph.json');
const BASE_URL = 'http://localhost:8765';

async function sampleScreenPositions(page, count = 5) {
  return page.evaluate((n) => {
    const circles = document.querySelectorAll('#graph-container > svg circle');
    return Array.from(circles).slice(0, n).map((c) => {
      const r = c.getBoundingClientRect();
      return { x: r.left, y: r.top };
    });
  }, count);
}

test('layouts work on 9.6k-node fixture', async ({ page }) => {
  // Capture browser-side errors so a layout bug at scale surfaces clearly.
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);

  // The large fixture triggers pre-tick (1000+ new nodes) which shows
  // the loading overlay and can take several seconds.
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 15000 });

  // Wait for the loading overlay to clear (pre-tick complete) and nodes
  // to be rendered. Give it up to 30s for the 9.6k-node layout.
  await expect(page.locator('#loading-overlay')).toBeHidden({ timeout: 30000 });
  await page.waitForTimeout(1000);

  const nodeCount = await page.evaluate(
    () => document.querySelectorAll('#graph-container > svg circle').length,
  );
  expect(nodeCount, 'force layout should render nodes').toBeGreaterThan(0);
  console.log(`Force layout rendered ${nodeCount} nodes`);

  // Expand all so edges are visible at scale.
  await page.locator('#btn-expand-all').click();
  await expect(page.locator('#loading-overlay')).toBeHidden({ timeout: 30000 });
  await page.waitForTimeout(1500);

  const expandedCounts = await page.evaluate(() => ({
    nodes: document.querySelectorAll('#graph-container > svg circle').length,
    edges: document.querySelectorAll('#graph-container > svg line').length,
  }));
  console.log(`After expand-all: ${expandedCounts.nodes} nodes, ${expandedCounts.edges} edges`);
  expect(expandedCounts.nodes).toBeGreaterThan(0);
  expect(expandedCounts.edges).toBeGreaterThan(0);

  const forcePositions = await sampleScreenPositions(page);

  // Switch through every discrete layout and verify it renders without
  // errors and actually moves nodes.
  for (const layout of ['circle', 'grid', 'concentric', 'radial', 'avsdf']) {
    await page.locator('#select-layout').selectOption(layout);
    // Discrete layouts are synchronous but fitToView animates (~400ms).
    await page.waitForTimeout(800);

    const counts = await page.evaluate(() => ({
      nodes: document.querySelectorAll('#graph-container > svg circle').length,
      edges: document.querySelectorAll('#graph-container > svg line').length,
    }));
    expect(counts.nodes, `${layout} should render nodes`).toBeGreaterThan(0);
    expect(counts.edges, `${layout} should render edges`).toBeGreaterThan(0);
    console.log(`${layout}: ${counts.nodes} nodes, ${counts.edges} edges`);

    const positions = await sampleScreenPositions(page);
    let moved = 0;
    for (let i = 0; i < Math.min(5, positions.length); i++) {
      const dx = Math.abs(forcePositions[i].x - positions[i].x);
      const dy = Math.abs(forcePositions[i].y - positions[i].y);
      if (dx > 1 || dy > 1) moved++;
    }
    expect(moved, `${layout} should move nodes`).toBeGreaterThan(0);

    // Force section stays hidden for discrete layouts.
    await expect(page.locator('#force-section')).toBeHidden();
  }

  // Switch back to force — force section reappears.
  await page.locator('#select-layout').selectOption('force');
  await expect(page.locator('#force-section')).toBeVisible();

  // No page errors should have accumulated.
  expect(errors, `browser errors: ${errors.join('; ')}`).toEqual([]);
});
