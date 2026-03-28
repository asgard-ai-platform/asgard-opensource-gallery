import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:4321';

test.describe('FilterBar & Search - Desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('MCP page: sidebar is visible on desktop', async ({ page }) => {
    await page.goto(`${BASE}/mcp/`);
    const sidebar = page.locator('#filter-bar');
    await expect(sidebar).toBeVisible();
  });

  test('MCP page: search input works', async ({ page }) => {
    await page.goto(`${BASE}/mcp/`);
    const input = page.locator('#search-input');
    await expect(input).toBeVisible();
    await input.fill('shopline');
    await page.waitForTimeout(300);
    // Should filter cards — at least one visible
    const visibleCards = page.locator('[data-category]:visible');
    const count = await visibleCards.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(63); // filtered, not all
  });

  test('MCP page: status filter works', async ({ page }) => {
    await page.goto(`${BASE}/mcp/`);
    // Uncheck "coming-soon" and "planned"
    await page.uncheck('.filter-status[value="coming-soon"]');
    await page.uncheck('.filter-status[value="planned"]');
    await page.waitForTimeout(200);
    // Only released cards should be visible
    const visibleCards = page.locator('[data-category][data-status="released"]:visible');
    const count = await visibleCards.count();
    expect(count).toBeGreaterThan(0);
    // Non-released should be hidden
    const hiddenComingSoon = page.locator('[data-status="coming-soon"]');
    for (let i = 0; i < Math.min(await hiddenComingSoon.count(), 3); i++) {
      await expect(hiddenComingSoon.nth(i)).toBeHidden();
    }
  });

  test('MCP page: region filter works', async ({ page }) => {
    await page.goto(`${BASE}/mcp/`);
    await page.check('.filter-region[value="taiwan"]');
    await page.waitForTimeout(200);
    const visibleCards = page.locator('[data-category]:visible');
    const count = await visibleCards.count();
    expect(count).toBeGreaterThan(0);
    // All visible cards should have data-region="taiwan"
    for (let i = 0; i < Math.min(count, 5); i++) {
      const region = await visibleCards.nth(i).getAttribute('data-region');
      expect(region).toBe('taiwan');
    }
  });

  test('MCP page: result count updates', async ({ page }) => {
    await page.goto(`${BASE}/mcp/`);
    const resultCount = page.locator('#result-count');
    await expect(resultCount).toBeVisible();
    const text = await resultCount.textContent();
    expect(text).toMatch(/Showing \d+ of \d+/);
  });

  test('Skills page: skill type filter exists', async ({ page }) => {
    await page.goto(`${BASE}/skills/`);
    const skillTypeFilter = page.locator('.filter-skilltype');
    const count = await skillTypeFilter.count();
    expect(count).toBe(4); // industry, methodology, theory, algorithm
  });

  test('Skills page: filtering by skill type works', async ({ page }) => {
    await page.goto(`${BASE}/skills/`);
    // Click labels to toggle skill type checkboxes (inputs are sr-only, click the parent label's span)
    await page.locator('.filter-skilltype[value="industry"]').evaluate((el) => { (el as HTMLInputElement).checked = false; el.dispatchEvent(new Event('change')); });
    await page.locator('.filter-skilltype[value="methodology"]').evaluate((el) => { (el as HTMLInputElement).checked = false; el.dispatchEvent(new Event('change')); });
    await page.locator('.filter-skilltype[value="theory"]').evaluate((el) => { (el as HTMLInputElement).checked = false; el.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(200);
    const visibleCards = page.locator('[data-skilltype]:visible');
    const count = await visibleCards.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(count, 5); i++) {
      const type = await visibleCards.nth(i).getAttribute('data-skilltype');
      expect(type).toBe('algorithm');
    }
  });
});

test.describe('FilterBar - Sticky Behavior on Scroll', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('MCP page: sidebar stays visible after scrolling', async ({ page }) => {
    await page.goto(`${BASE}/mcp/`);
    // Scroll down significantly
    await page.evaluate(() => window.scrollTo(0, 1500));
    await page.waitForTimeout(500);
    // The sidebar search input should remain in viewport (sticky)
    const searchInput = page.locator('#search-input');
    const box = await searchInput.boundingBox();
    expect(box).not.toBeNull();
    // Sidebar should be sticky near top of viewport (around top-24 = 96px)
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeLessThan(200); // should be near top, not scrolled away
  });

  test('MCP page: search input is usable after scroll', async ({ page }) => {
    await page.goto(`${BASE}/mcp/`);
    await page.evaluate(() => window.scrollTo(0, 2000));
    await page.waitForTimeout(300);
    const input = page.locator('#search-input');
    // Should be visible and clickable
    await expect(input).toBeVisible();
    await input.click();
    await input.fill('shopee');
    const value = await input.inputValue();
    expect(value).toBe('shopee');
  });

  test('MCP page: filter checkboxes work after scroll', async ({ page }) => {
    await page.goto(`${BASE}/mcp/`);
    await page.evaluate(() => window.scrollTo(0, 1500));
    await page.waitForTimeout(300);
    // Try unchecking a status filter
    const checkbox = page.locator('.filter-status[value="coming-soon"]');
    await expect(checkbox).toBeVisible();
    await checkbox.uncheck();
    const checked = await checkbox.isChecked();
    expect(checked).toBe(false);
  });

  test('Skills page: sidebar stays visible after scrolling', async ({ page }) => {
    await page.goto(`${BASE}/skills/`);
    await page.evaluate(() => window.scrollTo(0, 3000));
    await page.waitForTimeout(300);
    const sidebar = page.locator('#filter-bar');
    await expect(sidebar).toBeVisible();
    const box = await sidebar.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
  });

  test('MCP page: sidebar does not overlap header after scroll', async ({ page }) => {
    await page.goto(`${BASE}/mcp/`);
    await page.evaluate(() => window.scrollTo(0, 1000));
    await page.waitForTimeout(500);
    const header = page.locator('header');
    const searchInput = page.locator('#search-input');
    const headerBox = await header.boundingBox();
    const inputBox = await searchInput.boundingBox();
    expect(headerBox).not.toBeNull();
    expect(inputBox).not.toBeNull();
    // Search input top should be at or below header bottom
    expect(inputBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 2);
  });

  test('MCP page: sidebar does not overflow viewport vertically', async ({ page }) => {
    await page.goto(`${BASE}/mcp/`);
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(300);
    const sidebar = page.locator('#filter-bar .glass-card');
    const box = await sidebar.boundingBox();
    expect(box).not.toBeNull();
    // Bottom of sidebar should be within or near viewport
    const viewportHeight = 800;
    const sidebarBottom = box!.y + box!.height;
    // If sidebar extends below viewport, it's a problem
    if (sidebarBottom > viewportHeight + 50) {
      // Check if it has scrolling capability
      const hasScroll = await sidebar.evaluate((el) => {
        return el.scrollHeight > el.clientHeight ||
               window.getComputedStyle(el).overflowY === 'auto' ||
               window.getComputedStyle(el).overflowY === 'scroll';
      });
      expect(hasScroll).toBe(true);
    }
  });
});

test.describe('FilterBar - Mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('MCP page: sidebar collapses to full-width on mobile', async ({ page }) => {
    await page.goto(`${BASE}/mcp/`);
    const sidebar = page.locator('#filter-bar');
    await expect(sidebar).toBeVisible();
    const box = await sidebar.boundingBox();
    expect(box).not.toBeNull();
    // On mobile, sidebar should be full-width (not 72 fixed)
    expect(box!.width).toBeGreaterThan(300); // roughly full-width
  });

  test('MCP page: search works on mobile', async ({ page }) => {
    await page.goto(`${BASE}/mcp/`);
    const input = page.locator('#search-input');
    await expect(input).toBeVisible();
    await input.fill('ga4');
    await page.waitForTimeout(300);
    const visibleCards = page.locator('[data-category]:visible');
    const count = await visibleCards.count();
    expect(count).toBeGreaterThanOrEqual(1); // should find mcp-ga4 via slug match
  });

  test('MCP page: filter still works after scrolling on mobile', async ({ page }) => {
    await page.goto(`${BASE}/mcp/`);
    // On mobile, sidebar is above the grid (not sticky), so scroll to cards area
    await page.evaluate(() => window.scrollTo(0, 800));
    await page.waitForTimeout(300);
    // Scroll back up to filter
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const input = page.locator('#search-input');
    await expect(input).toBeVisible();
    await input.fill('line');
    await page.waitForTimeout(300);
    const visibleCards = page.locator('[data-category]:visible');
    const count = await visibleCards.count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('FilterBar - Interaction Edge Cases', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('MCP page: clearing search shows all cards', async ({ page }) => {
    await page.goto(`${BASE}/mcp/`);
    const input = page.locator('#search-input');
    await input.fill('shopline');
    await page.waitForTimeout(200);
    const filteredCount = await page.locator('[data-category]:visible').count();
    await input.fill('');
    await page.waitForTimeout(200);
    const allCount = await page.locator('[data-category]:visible').count();
    expect(allCount).toBeGreaterThan(filteredCount);
  });

  test('MCP page: no results shows zero count', async ({ page }) => {
    await page.goto(`${BASE}/mcp/`);
    const input = page.locator('#search-input');
    await input.fill('zzzznonexistent');
    await page.waitForTimeout(200);
    const resultCount = page.locator('#result-count');
    const text = await resultCount.textContent();
    expect(text).toMatch(/0/);
  });

  test('MCP page: combining search + filter works', async ({ page }) => {
    await page.goto(`${BASE}/mcp/`);
    // Filter to Taiwan region
    await page.check('.filter-region[value="taiwan"]');
    // Then search
    const input = page.locator('#search-input');
    await input.fill('shop');
    await page.waitForTimeout(200);
    const visibleCards = page.locator('[data-category]:visible');
    const count = await visibleCards.count();
    expect(count).toBeGreaterThan(0);
    // All visible should be taiwan
    for (let i = 0; i < count; i++) {
      const region = await visibleCards.nth(i).getAttribute('data-region');
      expect(region).toBe('taiwan');
    }
  });
});
