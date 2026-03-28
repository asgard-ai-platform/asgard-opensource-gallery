import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:4321';

test.use({
  viewport: { width: 375, height: 812 }, // iPhone-like mobile viewport
});

test.describe('Mobile Menu', () => {
  test('hamburger button is visible on mobile', async ({ page }) => {
    await page.goto(BASE);
    const btn = page.locator('#mobile-menu-btn');
    await expect(btn).toBeVisible();
  });

  test('desktop nav is hidden on mobile', async ({ page }) => {
    await page.goto(BASE);
    // Desktop nav should be hidden (md:flex but we're at 375px)
    const desktopNav = page.locator('header .hidden.md\\:flex');
    await expect(desktopNav).toBeHidden();
  });

  test('clicking hamburger opens sidebar and overlay', async ({ page }) => {
    await page.goto(BASE);

    const overlay = page.locator('#mobile-overlay');
    const sidebar = page.locator('#mobile-sidebar');

    // Initially hidden/off-screen
    await expect(overlay).toBeHidden();
    await expect(sidebar).toHaveClass(/translate-x-full/);

    // Click hamburger
    await page.click('#mobile-menu-btn');

    // Overlay should be visible
    await expect(overlay).toBeVisible();

    // Sidebar should slide in (translate-x-full removed)
    await expect(sidebar).not.toHaveClass(/translate-x-full/);
  });

  test('sidebar has opaque background (not transparent)', async ({ page }) => {
    await page.goto(BASE);
    await page.click('#mobile-menu-btn');

    const sidebar = page.locator('#mobile-sidebar');
    const bgColor = await sidebar.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });

    // Should be a solid dark color, not transparent
    console.log('Sidebar background-color:', bgColor);
    expect(bgColor).not.toBe('transparent');
    expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('sidebar contains all nav links', async ({ page }) => {
    await page.goto(BASE);
    await page.click('#mobile-menu-btn');

    const sidebar = page.locator('#mobile-sidebar');
    // Check for key nav links
    await expect(sidebar.locator('a[href="/mcp/"]')).toBeVisible();
    await expect(sidebar.locator('a[href="/skills/"]')).toBeVisible();
    await expect(sidebar.locator('a[href="/bundles/"]')).toBeVisible();
    await expect(sidebar.locator('a[href="/ecosystem/"]')).toBeVisible();
    await expect(sidebar.locator('a[href="/contribute/"]')).toBeVisible();
  });

  test('clicking close button closes sidebar', async ({ page }) => {
    await page.goto(BASE);

    // Open
    await page.click('#mobile-menu-btn');
    const overlay = page.locator('#mobile-overlay');
    await expect(overlay).toBeVisible();

    // Close
    await page.click('#mobile-close-btn');
    await expect(overlay).toBeHidden();

    const sidebar = page.locator('#mobile-sidebar');
    await expect(sidebar).toHaveClass(/translate-x-full/);
  });

  test('clicking overlay closes sidebar', async ({ page }) => {
    await page.goto(BASE);

    // Open
    await page.click('#mobile-menu-btn');
    const overlay = page.locator('#mobile-overlay');
    await expect(overlay).toBeVisible();

    // Click overlay (not sidebar)
    await overlay.click({ position: { x: 10, y: 400 } });
    await expect(overlay).toBeHidden();
  });

  test('nav links navigate correctly', async ({ page }) => {
    await page.goto(BASE);
    await page.click('#mobile-menu-btn');

    // Click MCP Servers link
    await page.click('#mobile-sidebar a[href="/mcp/"]');
    await page.waitForURL('**/mcp/');
    expect(page.url()).toContain('/mcp/');
  });

  test('language toggle works in mobile menu', async ({ page }) => {
    await page.goto(BASE);
    await page.click('#mobile-menu-btn');

    // Get initial lang
    const initialLang = await page.locator('html').getAttribute('data-lang');
    expect(initialLang).toBe('en');

    // Click mobile lang toggle
    await page.click('#mobile-lang-toggle');

    const newLang = await page.locator('html').getAttribute('data-lang');
    expect(newLang).toBe('zh');
  });

  test('sidebar z-index is above page content', async ({ page }) => {
    await page.goto(BASE);
    await page.click('#mobile-menu-btn');

    const sidebarZ = await page.locator('#mobile-sidebar').evaluate((el) => {
      return parseInt(window.getComputedStyle(el).zIndex);
    });
    const overlayZ = await page.locator('#mobile-overlay').evaluate((el) => {
      return parseInt(window.getComputedStyle(el).zIndex);
    });

    console.log('Sidebar z-index:', sidebarZ, 'Overlay z-index:', overlayZ);
    expect(sidebarZ).toBeGreaterThanOrEqual(50);
    expect(overlayZ).toBeGreaterThanOrEqual(40);
    expect(sidebarZ).toBeGreaterThan(overlayZ);
  });

  test('menu works on multiple pages', async ({ page }) => {
    // Test on MCP page
    await page.goto(`${BASE}/mcp/`);
    await page.click('#mobile-menu-btn');
    await expect(page.locator('#mobile-overlay')).toBeVisible();
    await page.click('#mobile-close-btn');
    await expect(page.locator('#mobile-overlay')).toBeHidden();

    // Test on ecosystem page
    await page.goto(`${BASE}/ecosystem/`);
    await page.click('#mobile-menu-btn');
    await expect(page.locator('#mobile-overlay')).toBeVisible();
    await page.click('#mobile-close-btn');
    await expect(page.locator('#mobile-overlay')).toBeHidden();
  });
});
