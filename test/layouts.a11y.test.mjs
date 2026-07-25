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

  // AVSDF
  await page.locator('#select-layout').selectOption('avsdf');
  await page.waitForTimeout(300);
  expect(await svg.getAttribute('aria-label')).toBe('AVSDF circular layout graph visualization');

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

  // Switch to AVSDF circular — must announce the friendly label, not the
  // raw key 'avsdf' (regression guard for the LAYOUT_LABELS lookup).
  await page.locator('#select-layout').selectOption('avsdf');
  await page.waitForTimeout(200);
  announcement = await sr.textContent();
  expect(announcement).toContain('AVSDF circular');
  expect(announcement).not.toContain('avsdf');
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

test('sidebar toggle button collapses and expands the sidebar', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  const toggle = page.locator('#btn-sidebar-toggle');
  const sidebar = page.locator('#sidebar');

  // Toggle is visible and wired after graph load
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveAttribute('aria-controls', 'sidebar');
  await expect(toggle).toHaveAttribute('aria-label', 'Hide sidebar');
  await expect(sidebar).not.toHaveClass(/collapsed/);

  // Initial icon (sidebar expanded): X shown, hamburger hidden (click to close)
  // SVG <line> has a zero-area geometry, so check computed display instead of visibility.
  const xDisplayOpen = await toggle.locator('.x-line').first().evaluate((el) => getComputedStyle(el).display);
  const hamDisplayOpen = await toggle.locator('.hamburger-line').first().evaluate((el) => getComputedStyle(el).display);
  expect(xDisplayOpen).not.toBe('none');
  expect(hamDisplayOpen).toBe('none');

  // Click to collapse
  await toggle.click();
  await expect(sidebar).toHaveClass(/collapsed/);
  await expect(toggle).toHaveClass(/collapsed/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveAttribute('aria-label', 'Show sidebar');

  // Collapsed icon: hamburger shown, X hidden (click to open)
  const xDisplayClosed = await toggle.locator('.x-line').first().evaluate((el) => getComputedStyle(el).display);
  const hamDisplayClosed = await toggle.locator('.hamburger-line').first().evaluate((el) => getComputedStyle(el).display);
  expect(xDisplayClosed).toBe('none');
  expect(hamDisplayClosed).not.toBe('none');

  // The sidebar content should no longer take up layout width.
  // Wait for the 0.2s width transition to finish, then verify the box has collapsed.
  await page.waitForTimeout(400);
  const sidebarBox = await sidebar.boundingBox();
  expect(sidebarBox.width).toBe(0);

  // Click again to expand
  await toggle.click();
  await page.waitForTimeout(400);
  await expect(sidebar).not.toHaveClass(/collapsed/);
  await expect(toggle).not.toHaveClass(/collapsed/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveAttribute('aria-label', 'Hide sidebar');
  const expandedBox = await sidebar.boundingBox();
  expect(expandedBox.width).toBeGreaterThan(0);
});

test('sidebar toggle is keyboard operable', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  const toggle = page.locator('#btn-sidebar-toggle');
  const sidebar = page.locator('#sidebar');

  // Focus and activate via keyboard (Enter)
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(sidebar).toHaveClass(/collapsed/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  // Space toggles back
  await page.keyboard.press('Space');
  await expect(sidebar).not.toHaveClass(/collapsed/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
});

test('sidebar toggle is hidden before a graph is loaded', async ({ page }) => {
  await page.goto(BASE_URL);
  // Drop zone visible, graph not yet loaded
  await expect(page.locator('#drop-zone')).toBeVisible();
  await expect(page.locator('#btn-sidebar-toggle')).toHaveClass(/hidden/);
});

test('collapsed sidebar content is not focusable', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  const toggle = page.locator('#btn-sidebar-toggle');
  const sidebar = page.locator('#sidebar');

  // Collapse the sidebar
  await toggle.click();
  await page.waitForTimeout(400);

  // Try to focus the search input inside the collapsed sidebar — should not land there
  await page.locator('#search-input').focus();
  const focusedInSidebar = await page.evaluate(() => {
    const el = document.activeElement;
    return el ? el.closest('#sidebar') !== null : false;
  });
  expect(focusedInSidebar).toBe(false);

  // Expand again — search input is focusable once more
  await toggle.click();
  await page.waitForTimeout(400);
  await page.locator('#search-input').focus();
  const refocusedInSidebar = await page.evaluate(() => {
    const el = document.activeElement;
    return el ? el.closest('#sidebar') !== null : false;
  });
  expect(refocusedInSidebar).toBe(true);
});

test('loading a new graph resets the sidebar to expanded', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  const toggle = page.locator('#btn-sidebar-toggle');
  const sidebar = page.locator('#sidebar');

  // Collapse the sidebar
  await toggle.click();
  await expect(sidebar).toHaveClass(/collapsed/);
  await expect(toggle).toHaveClass(/collapsed/);

  // Load a different graph — the change event fires because the file differs
  const otherGraph = path.join(__dirname, 'fixtures', 'sample-large-graph.json');
  await page.locator('#file-input').setInputFiles(otherGraph);
  await page.waitForTimeout(1500);

  // Sidebar should be expanded again, toggle in the default state
  await expect(sidebar).not.toHaveClass(/collapsed/);
  await expect(toggle).not.toHaveClass(/collapsed/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveAttribute('aria-label', 'Hide sidebar');
});

test('help button is visible and labelled before a graph is loaded', async ({ page }) => {
  await page.goto(BASE_URL);
  const help = page.locator('#btn-help');
  await expect(help).toBeVisible();
  await expect(help).toHaveAttribute('aria-label', 'Open help and keyboard shortcuts');
});

test('help modal opens and closes with focus management', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  const helpBtn = page.locator('#btn-help');
  const modal = page.locator('#help-modal');

  // Modal is hidden initially
  await expect(modal).toHaveClass(/hidden/);

  // Click the help button to open
  await helpBtn.click();
  await expect(modal).not.toHaveClass(/hidden/);

  // Dialog has correct ARIA
  await expect(modal).toHaveAttribute('role', 'dialog');
  await expect(modal).toHaveAttribute('aria-modal', 'true');
  await expect(modal).toHaveAttribute('aria-label', 'Help and keyboard shortcuts');

  // Focus moved to the close button
  await expect(page.locator('#help-close')).toBeFocused();

  // Screen reader announced the opening
  const sr = page.locator('#sr-announcements');
  await page.waitForTimeout(200);
  expect(await sr.textContent()).toContain('Help dialog opened');

  // Heading hierarchy: h2 title inside the dialog
  await expect(page.locator('.help-modal-title')).toHaveText('How to use this graph viewer');

  // Escape closes the modal
  await page.keyboard.press('Escape');
  await expect(modal).toHaveClass(/hidden/);

  // Focus restored to the help button
  await expect(helpBtn).toBeFocused();

  // Screen reader announced the closing
  await page.waitForTimeout(200);
  expect(await sr.textContent()).toContain('Help dialog closed');
});

test('help modal is keyboard operable (? shortcut, Enter on button, Escape)', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  const modal = page.locator('#help-modal');

  // ? opens the modal
  await page.keyboard.press('?');
  await expect(modal).not.toHaveClass(/hidden/);

  // Escape closes
  await page.keyboard.press('Escape');
  await expect(modal).toHaveClass(/hidden/);

  // ? does not open the modal when typing in an input
  await page.locator('#search-input').focus();
  await page.keyboard.press('?');
  await expect(modal).toHaveClass(/hidden/);
});

test('help modal traps focus within the dialog', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  const modal = page.locator('#help-modal');
  const closeBtn = page.locator('#help-close');
  const body = page.locator('.help-modal-body');

  // Open via button click
  await page.locator('#btn-help').click();
  await expect(modal).not.toHaveClass(/hidden/);
  await expect(closeBtn).toBeFocused();

  // Tab forward from the close button — focus moves to the body (tabindex=0)
  await page.keyboard.press('Tab');
  await expect(body).toBeFocused();

  // Tab forward from the body — wrap back to close button
  await page.keyboard.press('Tab');
  await expect(closeBtn).toBeFocused();

  // Shift+Tab from close button — wrap to body
  await page.keyboard.press('Shift+Tab');
  await expect(body).toBeFocused();

  // Close via Escape
  await page.keyboard.press('Escape');
  await expect(modal).toHaveClass(/hidden/);
});

test('help modal closes on backdrop click', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  const modal = page.locator('#help-modal');

  // Open via the help button
  await page.locator('#btn-help').click();
  await expect(modal).not.toHaveClass(/hidden/);

  // Click the backdrop (not the content) to close
  await page.locator('#help-backdrop').evaluate((el) => el.click());
  await expect(modal).toHaveClass(/hidden/);

  // Focus restored to the help button
  await expect(page.locator('#btn-help')).toBeFocused();
});

test('help modal content has accessible headings and table structure', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.locator('#file-input').setInputFiles(GRAPH_FILE);
  await expect(page.locator('#graph-container > svg[role="img"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  await page.locator('#btn-help').click();

  // h2 title
  await expect(page.locator('#help-modal h2')).toHaveCount(1);

  // h3 sub-sections
  await expect(page.locator('#help-modal h3')).toHaveCount(6);

  // Keyboard shortcuts table has header cells
  await expect(page.locator('.help-shortcut-table th')).toHaveCount(2);
  const rows = page.locator('.help-shortcut-table tbody tr');
  await expect(rows).toHaveCount(5);

  // The ? shortcut row exists
  await expect(page.locator('.help-shortcut-table')).toContainText('Open this help dialog');

  // Close to clean up
  await page.keyboard.press('Escape');
});
