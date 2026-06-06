import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:4321';

test.describe('PlugIns — packs vs collections', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('page loads', async ({ page }) => {
    const res = await page.goto(`${BASE}/plugins/`);
    expect(res?.status()).toBe(200);
  });

  test('both sections render, packs before collections', async ({ page }) => {
    await page.goto(`${BASE}/plugins/`);
    const packs = page.locator('[data-section="packs"]');
    const collections = page.locator('[data-section="collections"]');
    await expect(packs).toBeVisible();
    await expect(collections).toBeVisible();
    // packs section appears earlier in the DOM than collections
    const order = await page.evaluate(() => {
      const p = document.querySelector('[data-section="packs"]');
      const c = document.querySelector('[data-section="collections"]');
      if (!p || !c) return 0;
      return p.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1;
    });
    expect(order).toBe(1);
  });

  test('majordomo is a pack card with PACK + Core badge', async ({ page }) => {
    await page.goto(`${BASE}/plugins/`);
    const card = page.locator('[data-section="packs"] a[href="/plugins/tw-ecommerce-majordomo/"]');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-kind', 'pack');
    await expect(card.getByText('PACK', { exact: true })).toBeVisible();
    await expect(card.locator('[data-publisher="core"]')).toBeVisible();
  });

  test('collection cards have no PACK badge and are kind=collection', async ({ page }) => {
    await page.goto(`${BASE}/plugins/`);
    const collectionCards = page.locator('[data-section="collections"] a[data-kind="collection"]');
    expect(await collectionCards.count()).toBeGreaterThan(0);
    await expect(page.locator('[data-section="collections"]').getByText('PACK', { exact: true })).toHaveCount(0);
  });

  // emba-famulus is the live skills-only pack (slice 4). It is org-owned, so its
  // publisher tier is core; the community path stays unvalidated until a
  // genuinely community-owned pack lands.
  test('skills-only pack shows "Skills only" and no MCP count', async ({ page }) => {
    await page.goto(`${BASE}/plugins/`);
    const emba = page.locator('a[href="/plugins/emba-famulus/"]');
    await expect(emba.getByText('Skills only')).toBeVisible();
    await expect(emba.getByText('MCP')).toHaveCount(0);
    await expect(emba.locator('[data-publisher="core"]')).toBeVisible();
  });
});
