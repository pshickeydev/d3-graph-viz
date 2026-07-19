import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GRAPH_FILE = path.join(__dirname, 'fixtures', 'large_graph.json');
const BASE_URL = 'http://localhost:8765';

test('layout selector has associated label and aria-label', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  // Label is associated via for/id
  const labelFor = await page.locator('label[for="select-layout"]').getAttribute('for');
  expect(labelFor).toBe('select-layout');

  // aria-label is present (redundant with the visible label, but the
  // project convention adds aria-label to all selects)
  const ariaLabel = await page.locator('#select-layout').getAttribute('aria-label');
  expect(ariaLabel).toBe('Graph layout');

  // Select is focusable (no tabindex=-1)
  const tabindex = await page.locator('#select-layout').getAttribute('tabindex');
  expect(tabindex === null || tabindex === '0').toBe(true);
});

test('layout selector is keyboard operable', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  // Focus the select directly and verify it accepts keyboard interaction
  await page.locator('#select-layout').focus();
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('select-layout');

  // Verify focus-visible outline is applied (project convention)
  const hasFocusVisible = await page.locator('#select-layout').evaluate((el) => {
    const outline = window.getComputedStyle(el).outlineStyle;
    return outline !== 'none';
  });
  // outlineStyle may be 'auto' or a specific style when focused
  expect(hasFocusVisible).toBe(true);

  // Operate via keyboard: ArrowDown opens, type 'g' to jump to Grid
  await page.keyboard.press('g');
  await page.waitForTimeout(200);
  const value = await page.locator('#select-layout').inputValue();
  // 'g' should jump to "Grid" in most browsers
  expect(['grid']).toContain(value);
});

test('layout section heading hierarchy is correct', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });

  // Layout section has an h2 heading like all sidebar sections
  const heading = page.locator('#layout-selector').locator('xpath=ancestor::div[contains(@class,"sidebar-section")]/h2');
  await expect(heading).toBeVisible();
  await expect(heading).toHaveText('Layout');

  // Heading is collapsible with ARIA (wired by wireSidebarCollapse)
  const role = await heading.getAttribute('role');
  const ariaExpanded = await heading.getAttribute('aria-expanded');
  expect(role).toBe('button');
  expect(ariaExpanded).toBe('true'); // section starts expanded

  // Heading is keyboard-accessible
  const tabindex = await heading.getAttribute('tabindex');
  expect(tabindex).toBe('0');

  // Heading controls its body via aria-controls
  const ariaControls = await heading.getAttribute('aria-controls');
  expect(ariaControls).toBeTruthy();
  const section = page.locator('div.sidebar-section', { has: page.locator('#layout-selector') });
  const bodyId = await section.locator('.sidebar-section-body').getAttribute('id');
  expect(ariaControls).toBe(bodyId);
});

test('SVG aria-label updates with active layout', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  const svg = page.locator('#graph-container > svg[role="img"]');

  // Initial: force-directed
  expect(await svg.getAttribute('aria-label')).toBe('Interactive force-directed graph visualization');

  // Circle
  await page.locator('#select-layout').selectOption('circle');
  await page.waitForTimeout(300);
  expect(await svg.getAttribute('aria-label')).toBe('Circle layout graph visualization');

  // Grid
  await page.locator('#select-layout').selectOption('grid');
  await page.waitForTimeout(300);
  expect(await svg.getAttribute('aria-label')).toBe('Grid layout graph visualization');

  // Concentric
  await page.locator('#select-layout').selectOption('concentric');
  await page.waitForTimeout(300);
  expect(await svg.getAttribute('aria-label')).toBe('Concentric layout graph visualization');

  // Radial
  await page.locator('#select-layout').selectOption('radial');
  await page.waitForTimeout(300);
  expect(await svg.getAttribute('aria-label')).toBe('Radial tree layout graph visualization');

  // Back to force
  await page.locator('#select-layout').selectOption('force');
  await page.waitForTimeout(300);
  expect(await svg.getAttribute('aria-label')).toBe('Interactive force-directed graph visualization');
});

test('layout change is announced to screen readers', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  const sr = page.locator('#sr-announcements');

  // Switch to circle
  await page.locator('#select-layout').selectOption('circle');
  await page.waitForTimeout(200);
  let announcement = await sr.textContent();
  expect(announcement).toContain('Circle');

  // Switch to grid
  await page.locator('#select-layout').selectOption('grid');
  await page.waitForTimeout(200);
  announcement = await sr.textContent();
  expect(announcement).toContain('Grid');

  // Switch to radial tree
  await page.locator('#select-layout').selectOption('radial');
  await page.waitForTimeout(200);
  announcement = await sr.textContent();
  expect(announcement).toContain('Radial tree');
});

test('hidden force section is not focusable', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  // Force section visible initially
  await expect(page.locator('#force-section')).toBeVisible();

  // Switch to circle — force section hidden via .hidden (display:none)
  await page.locator('#select-layout').selectOption('circle');
  await expect(page.locator('#force-section')).toBeHidden();

  // The force section heading should not be focusable or in the a11y tree
  const headingVisible = await page.locator('#force-section h2').isVisible();
  expect(headingVisible).toBe(false);

  // Try to focus the first slider inside the hidden section — should fail
  await page.locator('#force-section input').first().focus();
  const focusedInForceSection = await page.evaluate(() => {
    const el = document.activeElement;
    return el ? el.closest('#force-section') !== null : false;
  });
  expect(focusedInForceSection).toBe(false);

  // Switch back to force — section reappears and is focusable
  await page.locator('#select-layout').selectOption('force');
  await expect(page.locator('#force-section')).toBeVisible();
  await page.locator('#force-section input').first().focus();
  const refocusedInForceSection = await page.evaluate(() => {
    const el = document.activeElement;
    return el ? el.closest('#force-section') !== null : false;
  });
  expect(refocusedInForceSection).toBe(true);
});
