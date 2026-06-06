import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:4321';
const PACK = `${BASE}/plugins/tw-ecommerce-majordomo/`;

test.describe('Pack detail — majordomo', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('hero shows PACK + Core + Sandbox-ready badges', async ({ page }) => {
    await page.goto(PACK);
    await expect(page.getByText('PACK', { exact: true }).first()).toBeVisible();
    await expect(page.locator('[data-publisher="core"]').first()).toBeVisible();
    await expect(page.locator('[data-setup="sandbox-ready"]').first()).toBeVisible();
  });

  test('install panel: Claude Code tab active first, command visible', async ({ page }) => {
    await page.goto(PACK);
    const panel = page.locator('.pack-install');
    await expect(panel).toBeVisible();
    const firstTab = panel.locator('.install-tab').first();
    await expect(firstTab).toHaveClass(/active/);
    await expect(panel.locator('.install-panel:not(.hidden) code')).toContainText('/plugin install');
  });

  test('install tabs switch on click', async ({ page }) => {
    await page.goto(PACK);
    const panel = page.locator('.pack-install');
    await panel.locator('.install-tab[data-harness="cursor"]').click();
    await expect(panel.locator('.install-panel[data-harness="cursor"]')).not.toHaveClass(/hidden/);
    await expect(panel.locator('.install-panel[data-harness="claude-code"]')).toHaveClass(/hidden/);
  });

  test('copy buttons exist in the install panel', async ({ page }) => {
    await page.goto(PACK);
    expect(await page.locator('.pack-install .copy-btn').count()).toBeGreaterThan(0);
  });

  test('use cases appear before "What\'s inside" in the DOM', async ({ page }) => {
    await page.goto(PACK);
    const order = await page.evaluate(() => {
      const uc = document.evaluate("//h2[contains(., 'What you can ask it') or contains(., '你可以請它做什麼')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      const inside = document.evaluate("//summary[contains(., \"What's inside\") or contains(., '內容物')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      if (!uc || !inside) return 0;
      return uc.compareDocumentPosition(inside) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1;
    });
    expect(order).toBe(1);
  });

  test('setup section lists provider groups (ECPay)', async ({ page }) => {
    await page.goto(PACK);
    await expect(page.getByText('ECPay 綠界').first()).toBeVisible();
  });

  test('dependency graph is omitted for the 41-node pack', async ({ page }) => {
    await page.goto(PACK);
    await expect(page.getByRole('heading', { name: /Dependency Graph|依賴關係圖/ })).toHaveCount(0);
  });

  test('source section links to GitHub + manifests', async ({ page }) => {
    await page.goto(PACK);
    await expect(page.getByRole('link', { name: 'GitHub' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'plugin.json' })).toBeVisible();
  });
});

test.describe('Pack card enrichment — /plugins list', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('majordomo card shows setup state + Install CTA', async ({ page }) => {
    await page.goto(`${BASE}/plugins/`);
    const card = page.locator('a[href="/plugins/tw-ecommerce-majordomo/"]');
    await expect(card.locator('[data-setup="sandbox-ready"]')).toBeVisible();
    await expect(card.getByText('Install', { exact: false }).first()).toBeVisible();
  });
});
