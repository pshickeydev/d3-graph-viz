import { test, expect } from '@playwright/test';

test('expand all loads extra-large graph without nodes stuck in top-left', async ({ page }) => {
  await page.goto('http://localhost:8000');
  await page.setInputFiles('#file-input', 'xl_graph.json');
  await page.waitForSelector('#graph-container svg circle', { timeout: 5000 });
  await page.click('#btn-expand-all');
  await page.waitForSelector('#loading-overlay:not(.hidden)', { timeout: 3000 });
  await page.waitForSelector('#loading-overlay.hidden', { state: 'attached', timeout: 60000 });
  const circles = page.locator('#graph-container svg circle');
  const count = await circles.count();
  console.log('circle count xl:', count);
  const firstCx = await circles.first().getAttribute('cx');
  console.log('first cx xl:', firstCx);
  const cx = Number(firstCx);
  expect(cx).toBeGreaterThan(10);
});
