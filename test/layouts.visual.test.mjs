import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GRAPH_FILE = path.join(__dirname, '..', 'large_graph.json');
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

test('layout selector switches between layouts', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(2000);

  await expect(page.locator('#layout-selector')).toBeVisible();
  await expect(page.locator('#select-layout')).toBeVisible();
  await expect(page.locator('#force-section')).toBeVisible();

  const initialPositions = await sampleScreenPositions(page);
  expect(initialPositions.length).toBe(5);

  // Switch to circle layout
  await page.locator('#select-layout').selectOption('circle');
  await expect(page.locator('#force-section')).toBeHidden();
  await page.waitForTimeout(800);

  const circlePositions = await sampleScreenPositions(page);
  let moved = 0;
  for (let i = 0; i < 5; i++) {
    const dx = Math.abs(initialPositions[i].x - circlePositions[i].x);
    const dy = Math.abs(initialPositions[i].y - circlePositions[i].y);
    if (dx > 1 || dy > 1) moved++;
  }
  expect(moved).toBeGreaterThan(0);

  // Switch to grid layout
  await page.locator('#select-layout').selectOption('grid');
  await page.waitForTimeout(800);
  const gridPositions = await sampleScreenPositions(page);
  let gridMoved = 0;
  for (let i = 0; i < 5; i++) {
    const dx = Math.abs(circlePositions[i].x - gridPositions[i].x);
    const dy = Math.abs(circlePositions[i].y - gridPositions[i].y);
    if (dx > 1 || dy > 1) gridMoved++;
  }
  expect(gridMoved).toBeGreaterThan(0);

  // Switch back to force layout — force section should reappear
  await page.locator('#select-layout').selectOption('force');
  await expect(page.locator('#force-section')).toBeVisible();
});

test('layout selector has all layout options', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });

  const options = await page.locator('#select-layout option').allTextContents();
  expect(options).toContain('Force-directed');
  expect(options).toContain('Circle');
  expect(options).toContain('Grid');
  expect(options).toContain('Concentric');
  expect(options).toContain('Radial tree');
});

test('discrete layouts render edges and nodes', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1500);

  // Expand all so edges are visible
  await page.locator('#btn-expand-all').click();
  await page.waitForTimeout(1500);

  for (const layout of ['circle', 'grid', 'concentric', 'radial']) {
    await page.locator('#select-layout').selectOption(layout);
    await page.waitForTimeout(800);
    const counts = await page.evaluate(() => ({
      nodes: document.querySelectorAll('#graph-container > svg circle').length,
      edges: document.querySelectorAll('#graph-container > svg line').length,
    }));
    expect(counts.nodes, `${layout} should render nodes`).toBeGreaterThan(0);
    expect(counts.edges, `${layout} should render edges`).toBeGreaterThan(0);
  }
});
