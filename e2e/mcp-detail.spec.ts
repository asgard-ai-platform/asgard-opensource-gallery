import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:4321';

test.describe('MCP detail page — section rendering (issue #15)', () => {
  test('mcp-shopline renders Available Tools heading + a tool name from the table', async ({ page }) => {
    await page.goto(`${BASE}/mcp/mcp-shopline/`);
    await expect(page.getByRole('heading', { level: 2, name: /Available Tools/ })).toBeVisible();
    await expect(page.getByText('query_orders').first()).toBeVisible();
  });

  test('mcp-shopline ZH toggle renders 可用工具 and pairs with the tool table', async ({ page }) => {
    await page.goto(`${BASE}/mcp/mcp-shopline/`);
    await page.evaluate(() => {
      localStorage.setItem('ygg-lang', 'zh');
      document.documentElement.setAttribute('data-lang', 'zh');
    });
    await page.reload();
    await expect(page.getByRole('heading', { level: 2, name: /可用工具/ })).toBeVisible();
    // Tool names appear in zh view (zh content block is visible, en block is hidden)
    await expect(page.locator('.skill-content.lang-zh code', { hasText: 'query_orders' }).first()).toBeVisible();
  });

  test('mcp-shopline renders long-tail sections via humanised fallback', async ({ page }) => {
    await page.goto(`${BASE}/mcp/mcp-shopline/`);
    // "Project Structure" is a humanised fallback heading (no curated icon/label)
    await expect(page.getByRole('heading', { level: 2, name: /Project Structure/ })).toBeVisible();
    // "Roadmap" is also long-tail
    await expect(page.getByRole('heading', { level: 2, name: /Roadmap/ })).toBeVisible();
  });

  test('mcp-591 renders all curated sections plus Usage Examples', async ({ page }) => {
    await page.goto(`${BASE}/mcp/mcp-591/`);
    const sectionHeadings = page.locator('h2.skill-section-title');
    await expect(sectionHeadings.first()).toBeVisible();
    const count = await sectionHeadings.count();
    expect(count).toBeGreaterThanOrEqual(5);  // at least 5 sections; was 0 before fix
    await expect(page.getByRole('heading', { level: 2, name: /Available Tools/ })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: /Usage Examples/ })).toBeVisible();
  });

  test('no skill-section heading is rendered with empty text', async ({ page }) => {
    await page.goto(`${BASE}/mcp/mcp-shopline/`);
    const headings = page.locator('h2.skill-section-title');
    const count = await headings.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const text = (await headings.nth(i).textContent())?.trim();
      expect(text, `heading #${i} should not be empty`).toBeTruthy();
    }
  });
});
