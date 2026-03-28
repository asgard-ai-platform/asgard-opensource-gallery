import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:4321';

test.describe('Ecosystem Page', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('page loads successfully', async ({ page }) => {
    const response = await page.goto(`${BASE}/ecosystem/`);
    expect(response?.status()).toBe(200);
  });

  // --- Image Gallery Tests ---
  test('Mimir screenshots exist in public dir and are served', async ({ page }) => {
    const r1 = await page.goto(`${BASE}/screenshots/mimir-dashboard.png`);
    expect(r1?.status()).toBe(200);
    const r2 = await page.goto(`${BASE}/screenshots/mimir-sql.png`);
    expect(r2?.status()).toBe(200);
  });

  test('Sindri screenshots are served', async ({ page }) => {
    const r1 = await page.goto(`${BASE}/screenshots/sindri-hub.png`);
    expect(r1?.status()).toBe(200);
    const r2 = await page.goto(`${BASE}/screenshots/sindri-chat.png`);
    expect(r2?.status()).toBe(200);
  });

  test('Odin screenshots are served', async ({ page }) => {
    const r1 = await page.goto(`${BASE}/screenshots/odin-workflow.png`);
    expect(r1?.status()).toBe(200);
    const r2 = await page.goto(`${BASE}/screenshots/odin-erd.png`);
    expect(r2?.status()).toBe(200);
  });

  test('Mimir gallery: images are present in DOM', async ({ page }) => {
    await page.goto(`${BASE}/ecosystem/`);
    const mimirGallery = page.locator('.eco-gallery[data-color="red"]');
    await expect(mimirGallery).toBeVisible();
    const images = mimirGallery.locator('.eco-gallery-img');
    const count = await images.count();
    expect(count).toBe(2);

    // Check src attributes
    const src0 = await images.nth(0).getAttribute('src');
    const src1 = await images.nth(1).getAttribute('src');
    console.log('Mimir image srcs:', src0, src1);
    expect(src0).toContain('mimir');
    expect(src1).toContain('mimir');
  });

  test('Mimir gallery: first image is visible (has active class)', async ({ page }) => {
    await page.goto(`${BASE}/ecosystem/`);
    const mimirGallery = page.locator('.eco-gallery[data-color="red"]');
    const activeImg = mimirGallery.locator('.eco-gallery-img.active');
    const count = await activeImg.count();
    expect(count).toBe(1);

    // Check that active image is actually visible (opacity > 0)
    const opacity = await activeImg.evaluate((el) => {
      return window.getComputedStyle(el).opacity;
    });
    console.log('Active image opacity:', opacity);
    expect(parseFloat(opacity)).toBe(1);
  });

  test('Mimir gallery: inactive image is hidden (opacity 0)', async ({ page }) => {
    await page.goto(`${BASE}/ecosystem/`);
    const mimirGallery = page.locator('.eco-gallery[data-color="red"]');
    const images = mimirGallery.locator('.eco-gallery-img');
    // Second image should NOT have active class
    const secondImg = images.nth(1);
    const hasActive = await secondImg.evaluate((el) => el.classList.contains('active'));
    expect(hasActive).toBe(false);
    const opacity = await secondImg.evaluate((el) => {
      return window.getComputedStyle(el).opacity;
    });
    console.log('Inactive image opacity:', opacity);
    expect(parseFloat(opacity)).toBe(0);
  });

  test('Mimir gallery: active image has non-zero dimensions', async ({ page }) => {
    await page.goto(`${BASE}/ecosystem/`);
    const mimirGallery = page.locator('.eco-gallery[data-color="red"]');
    const activeImg = mimirGallery.locator('.eco-gallery-img.active');

    // Wait for image to potentially load
    await page.waitForTimeout(1000);

    const box = await activeImg.boundingBox();
    console.log('Active image bounding box:', box);
    if (box) {
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
    }

    // Check naturalWidth to see if image actually loaded
    const naturalWidth = await activeImg.evaluate((el: HTMLImageElement) => el.naturalWidth);
    console.log('Active image naturalWidth:', naturalWidth);
    expect(naturalWidth).toBeGreaterThan(0);
  });

  test('Mimir gallery: image actually renders pixels (not blank)', async ({ page }) => {
    await page.goto(`${BASE}/ecosystem/`);

    // Wait for images to load
    await page.waitForTimeout(2000);

    const mimirGallery = page.locator('.eco-gallery[data-color="red"]');
    const activeImg = mimirGallery.locator('.eco-gallery-img.active');

    // Check the computed dimensions
    const dims = await activeImg.evaluate((el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        position: style.position,
        src: (el as HTMLImageElement).src,
        complete: (el as HTMLImageElement).complete,
        naturalWidth: (el as HTMLImageElement).naturalWidth,
        naturalHeight: (el as HTMLImageElement).naturalHeight,
      };
    });
    console.log('Active image full details:', JSON.stringify(dims, null, 2));
    expect(dims.complete).toBe(true);
    expect(dims.naturalWidth).toBeGreaterThan(0);
    expect(dims.width).toBeGreaterThan(0);
    expect(dims.height).toBeGreaterThan(0);
  });

  test('Gallery container has correct height', async ({ page }) => {
    await page.goto(`${BASE}/ecosystem/`);
    // Check the gallery container (parent of eco-gallery) has h-[500px]
    const containers = page.locator('.eco-gallery').locator('..');
    const firstContainer = containers.first();
    const box = await firstContainer.boundingBox();
    console.log('Gallery container box:', box);
    expect(box).not.toBeNull();
    // Should be approximately 500px tall (h-[500px])
    if (box) {
      expect(box.height).toBeGreaterThan(100);
    }
  });

  test('Sindri gallery has images', async ({ page }) => {
    await page.goto(`${BASE}/ecosystem/`);
    const gallery = page.locator('.eco-gallery[data-color="indigo"]');
    const images = gallery.locator('.eco-gallery-img');
    const count = await images.count();
    expect(count).toBe(2);
    const src0 = await images.nth(0).getAttribute('src');
    expect(src0).toContain('sindri');
  });

  test('Odin gallery has images', async ({ page }) => {
    await page.goto(`${BASE}/ecosystem/`);
    const gallery = page.locator('.eco-gallery[data-color="emerald"]');
    const images = gallery.locator('.eco-gallery-img');
    const count = await images.count();
    expect(count).toBe(2);
    const src0 = await images.nth(0).getAttribute('src');
    expect(src0).toContain('odin');
  });

  test('Gallery dot navigation works', async ({ page }) => {
    await page.goto(`${BASE}/ecosystem/`);
    const mimirGallery = page.locator('.eco-gallery[data-color="red"]');
    const images = mimirGallery.locator('.eco-gallery-img');
    const dots = mimirGallery.locator('.eco-dot');

    // Initially first image active
    await expect(images.nth(0)).toHaveClass(/active/);
    await expect(images.nth(1)).not.toHaveClass(/active/);

    // Click second dot
    await dots.nth(1).click();
    await page.waitForTimeout(600); // wait for CSS transition

    await expect(images.nth(1)).toHaveClass(/active/);
    await expect(images.nth(0)).not.toHaveClass(/active/);
  });

  // --- Scroll and Section Tests ---
  test('all major sections are present', async ({ page }) => {
    await page.goto(`${BASE}/ecosystem/`);
    // Hero
    const hero = page.locator('text=Asgard');
    await expect(hero.first()).toBeVisible();
    // AI Paradox
    await expect(page.locator('text=AI Paradox')).toBeVisible();
    // Mimir
    await expect(page.locator('h2:has-text("Mimir")')).toBeVisible();
    // Sindri
    await expect(page.locator('h2:has-text("Sindri")')).toBeVisible();
    // Odin
    await expect(page.locator('h2:has-text("Odin")')).toBeVisible();
    // Heimdall
    await expect(page.locator('h3:has-text("Heimdall")')).toBeVisible();
  });

  test('industry application cards are scrollable', async ({ page }) => {
    await page.goto(`${BASE}/ecosystem/`);
    const scrollContainer = page.locator('.overflow-x-auto').last();
    await expect(scrollContainer).toBeVisible();
    const scrollWidth = await scrollContainer.evaluate((el) => el.scrollWidth);
    const clientWidth = await scrollContainer.evaluate((el) => el.clientWidth);
    console.log('Scroll container: scrollWidth=', scrollWidth, 'clientWidth=', clientWidth);
    // Should be scrollable (content wider than container)
    expect(scrollWidth).toBeGreaterThan(clientWidth);
  });
});
