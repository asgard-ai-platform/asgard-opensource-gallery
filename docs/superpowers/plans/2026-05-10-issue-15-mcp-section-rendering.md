# Issue #15 — MCP Detail Page Section Rendering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop silently dropping H2 sections on MCP detail pages. Make `## Tools (N)` and Chinese H2s produce stable, paired keys, and let the renderer walk every key with curated icons for canonicals plus humanised fallback for the long tail.

**Architecture:** Two-layer fix.
- **Layer 1** (`scripts/sync-gallery/sync-mcp-content.mjs`): rewrite `sectionKey()` to canonicalise H2 titles. Regex match for `Tools (N)` / `工具 (N)`, expanded zh→en alias table, Unicode-safe slugify fallback. Extract function for unit testing.
- **Layer 2** (`src/pages/mcp/[slug].astro`): renderer walks all keys present in JSON. Curated `sectionConfig` entries render in `preferredOrder`; long-tail keys render after with generic icon + humanised key. Symmetric en/zh fallback fixes existing asymmetry.

**Tech Stack:** Astro 5, TypeScript, JS-YAML, Node `node:test` for sync-gallery scripts, Playwright for e2e. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-10-issue-15-mcp-section-rendering-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `scripts/sync-gallery/sync-mcp-content.mjs` | Modify | Wrap main block in entry-point guard; export `sectionKey` and `extractSections`; rewrite `sectionKey` per spec Layer 1. |
| `scripts/sync-gallery/sync-mcp-content.test.mjs` | Create | `node:test` unit tests for `sectionKey` covering Tools(N) regex, CJK alias, Unicode-safe slugify, en/zh pairing. |
| `data/mcp-content.json` | Regenerate | Re-run sync script after `sectionKey` changes; commit the new JSON. |
| `src/pages/mcp/[slug].astro` | Modify | Extend `sectionConfig`; introduce `preferredOrder` + walk-all `renderKeys`; add `humanise` + `FALLBACK_ICON`; symmetric fallback in render block. |
| `e2e/mcp-detail.spec.ts` | Create | Playwright tests asserting `mcp-shopline` renders Available Tools + a tool name from the 143-tool table; `mcp-591` renders all 5 of its sections. |

---

## Task 1: Refactor `sync-mcp-content.mjs` for testability

Wrap the script's main block in an entry-point guard and export the pure helpers. This is a pure refactor — no behavior change. Required because the test file in Task 2 needs to `import` `sectionKey` without triggering the sync.

**Files:**
- Modify: `scripts/sync-gallery/sync-mcp-content.mjs:35-93,95-170`

- [ ] **Step 1: Add `export` to `extractSections`, `extractIntro`, `sectionKey`**

In `scripts/sync-gallery/sync-mcp-content.mjs`, change:

```js
function extractSections(readme) {
function extractIntro(readme) {
function sectionKey(title) {
```

to:

```js
export function extractSections(readme) {
export function extractIntro(readme) {
export function sectionKey(title) {
```

- [ ] **Step 2: Wrap main block in entry-point guard**

Wrap lines from `console.log('═══════════════════════════════════════════════════');` (currently line 97) through end-of-file (currently line 170) in:

```js
if (import.meta.url === `file://${process.argv[1]}`) {
  // ... existing main block ...
}
```

This matches the pattern in `audit-pypi.mjs:125`, `audit-orphans.mjs:102`, `audit-readme-format.mjs:104`, `check-sync-thresholds.mjs:45`.

- [ ] **Step 3: Verify the script still runs as a CLI**

Run: `node scripts/sync-gallery/sync-mcp-content.mjs --help 2>&1 | head -5` (the script ignores `--help`, but it should print the banner and start fetching; Ctrl-C after the banner is fine).

Expected: prints `═══════════════════════════════════════════════════` and `Sync MCP Content → data/mcp-content.json`.

Alternative quick verification (no network):

```bash
node -e "import('./scripts/sync-gallery/sync-mcp-content.mjs').then(m => console.log(Object.keys(m)))"
```

Expected: `[ 'extractSections', 'extractIntro', 'sectionKey' ]` (no banner — guard works).

- [ ] **Step 4: Verify `npm run test:scripts` still passes**

Run: `npm run test:scripts`

Expected: all existing sync-gallery tests pass; no regression.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-gallery/sync-mcp-content.mjs
git commit -m "refactor(sync-mcp-content): export helpers and add entry-point guard"
```

---

## Task 2: Write failing tests for new `sectionKey` behavior

Write the full test suite for the new `sectionKey` per spec Layer 1. Tests will fail against current implementation — that's the RED phase.

**Files:**
- Create: `scripts/sync-gallery/sync-mcp-content.test.mjs`

- [ ] **Step 1: Create the test file**

Create `scripts/sync-gallery/sync-mcp-content.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionKey } from './sync-mcp-content.mjs';

// ── Tools (N) regex (en) ──
test('sectionKey: "Tools" → available_tools', () => {
  assert.equal(sectionKey('Tools'), 'available_tools');
});
test('sectionKey: "Tools (4)" → available_tools', () => {
  assert.equal(sectionKey('Tools (4)'), 'available_tools');
});
test('sectionKey: "Tools (143)" → available_tools', () => {
  assert.equal(sectionKey('Tools (143)'), 'available_tools');
});
test('sectionKey: "Tools(4)" (no space) → available_tools', () => {
  assert.equal(sectionKey('Tools(4)'), 'available_tools');
});
test('sectionKey: "Available Tools" → available_tools', () => {
  assert.equal(sectionKey('Available Tools'), 'available_tools');
});

// ── Tools (N) regex (zh) ──
test('sectionKey: "工具" → available_tools', () => {
  assert.equal(sectionKey('工具'), 'available_tools');
});
test('sectionKey: "工具 (4)" → available_tools', () => {
  assert.equal(sectionKey('工具 (4)'), 'available_tools');
});
test('sectionKey: "工具 (143)" → available_tools', () => {
  assert.equal(sectionKey('工具 (143)'), 'available_tools');
});
test('sectionKey: "可用工具" → available_tools', () => {
  assert.equal(sectionKey('可用工具'), 'available_tools');
});

// ── en/zh canonical pairing ──
test('sectionKey: "Features" / "功能特色" both → features', () => {
  assert.equal(sectionKey('Features'), 'features');
  assert.equal(sectionKey('功能特色'), 'features');
});
test('sectionKey: "Quick Start" / "快速開始" both → quick_start', () => {
  assert.equal(sectionKey('Quick Start'), 'quick_start');
  assert.equal(sectionKey('快速開始'), 'quick_start');
});
test('sectionKey: "API Reference" / "API 參考" both → api_reference', () => {
  assert.equal(sectionKey('API Reference'), 'api_reference');
  assert.equal(sectionKey('API 參考'), 'api_reference');
});
test('sectionKey: "Development" / "開發" both → development', () => {
  assert.equal(sectionKey('Development'), 'development');
  assert.equal(sectionKey('開發'), 'development');
});
test('sectionKey: "License" / "授權" both → license', () => {
  assert.equal(sectionKey('License'), 'license');
  assert.equal(sectionKey('授權'), 'license');
});
test('sectionKey: "Contributing" / "貢獻" both → contributing', () => {
  assert.equal(sectionKey('Contributing'), 'contributing');
  assert.equal(sectionKey('貢獻'), 'contributing');
});

// ── Long-tail aliases ──
test('sectionKey: "Important Write Tools" / "重要寫入工具" → important_write_tools', () => {
  assert.equal(sectionKey('Important Write Tools'), 'important_write_tools');
  assert.equal(sectionKey('重要寫入工具'), 'important_write_tools');
});
test('sectionKey: "Project Structure" / "專案結構" → project_structure', () => {
  assert.equal(sectionKey('Project Structure'), 'project_structure');
  assert.equal(sectionKey('專案結構'), 'project_structure');
});
test('sectionKey: "API Constraints" / "API 限制" → api_constraints', () => {
  assert.equal(sectionKey('API Constraints'), 'api_constraints');
  assert.equal(sectionKey('API 限制'), 'api_constraints');
});

// ── Unicode-safe slugify fallback ──
test('sectionKey: unknown CJK heading falls back to CJK slug, not empty', () => {
  // "自訂段落" = "Custom Section" — not in alias table
  assert.equal(sectionKey('自訂段落'), '自訂段落');
});
test('sectionKey: unknown ASCII heading slugifies to lowercase_underscore', () => {
  assert.equal(sectionKey('Some New Heading'), 'some_new_heading');
});
test('sectionKey: punctuation in unknown heading is stripped', () => {
  assert.equal(sectionKey('Foo & Bar!'), 'foo_bar');
});
test('sectionKey: empty / whitespace-only heading returns empty string', () => {
  assert.equal(sectionKey(''), '');
  assert.equal(sectionKey('   '), '');
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npm run test:scripts`

Expected: many failures in `sync-mcp-content.test.mjs` (e.g. `sectionKey('Tools (4)')` returns `tools_4` not `available_tools`; `sectionKey('專案結構')` returns `''` not `專案結構`). Existing tests in `_lib.test.mjs`, `audit-pypi.test.mjs` etc. continue to pass.

- [ ] **Step 3: Commit (RED)**

```bash
git add scripts/sync-gallery/sync-mcp-content.test.mjs
git commit -m "test(sync-mcp-content): failing tests for new sectionKey behavior"
```

---

## Task 3: Implement new `sectionKey`

Replace `sectionKey()` with the new structure. Tests from Task 2 should now pass.

**Files:**
- Modify: `scripts/sync-gallery/sync-mcp-content.mjs:81-93` (the `sectionKey` function)

- [ ] **Step 1: Replace the `sectionKey` function**

In `scripts/sync-gallery/sync-mcp-content.mjs`, replace the existing `sectionKey` function (currently lines 81-93) with:

```js
export function sectionKey(title) {
  const raw = title.trim().toLowerCase();
  if (!raw) return '';

  // Pre-strip regex matches (preserve parens for "Tools (N)" / "工具 (N)")
  if (/^tools\s*(\(\s*\d+\s*\))?$/.test(raw)) return 'available_tools';
  if (/^工具\s*(\(\s*\d+\s*\))?$/.test(raw)) return 'available_tools';

  // Normalised form: keep Unicode letters/numbers + whitespace, strip the rest.
  // \p{L} keeps CJK; \p{N} keeps digits.
  const t = raw.replace(/[^\p{L}\p{N}\s]/gu, '').trim();

  // ── en whitelist + zh aliases (both canonicalise to the same en key) ──
  if (t.includes('what this does') || t === 'features' || t.includes('功能特色') || t === '功能') return 'features';
  if (t.includes('quick start') || t.includes('getting started') || t.includes('快速開始') || t === '入門') return 'quick_start';
  if (t.includes('api reference') || t.includes('api 參考')) return 'api_reference';
  if (t === 'available tools' || t === '可用工具') return 'available_tools';
  if (t.includes('important write tools') || t.includes('重要寫入工具')) return 'important_write_tools';
  if (t.includes('install') || t.includes('安裝')) return 'install';
  if (t.includes('configuration') || t.includes('config') || t.includes('設定') || t.includes('配置')) return 'configuration';
  if (t === 'development' || t === '開發') return 'development';
  if (t.includes('contributing') || t.includes('貢獻')) return 'contributing';
  if (t.includes('license') || t.includes('授權')) return 'license';
  if (t.includes('usage examples') || t.includes('使用範例') || t === '範例' || t === 'example') return 'usage_examples';
  if (t.includes('project structure') || t.includes('專案結構')) return 'project_structure';
  if (t.includes('api constraints') || t.includes('api 限制')) return 'api_constraints';
  if (t.includes('api endpoint coverage') || t.includes('api 端點覆蓋')) return 'api_endpoint_coverage';
  if (t.includes('known test gaps') || t.includes('已知測試缺口')) return 'known_test_gaps';
  if (t.includes('roadmap') || t.includes('路線圖')) return 'roadmap';
  if (t.includes('use with')) return 'usage';

  // Slugify fallback (preserves CJK as legal key)
  return t.replace(/\s+/g, '_').replace(/^_|_$/g, '');
}
```

- [ ] **Step 2: Run tests — verify they pass**

Run: `npm run test:scripts`

Expected: all `sync-mcp-content.test.mjs` tests pass. All existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add scripts/sync-gallery/sync-mcp-content.mjs
git commit -m "fix(sync-mcp-content): canonicalise H2 keys (Tools(N), CJK alias, Unicode-safe fallback)

Closes part of #15 — Layer 1 of the section-rendering fix."
```

---

## Task 4: Re-sync `data/mcp-content.json`

Old JSON contains broken keys (`""`, `"143"`, `"api"`, `tools_4`, `tools_143`). Re-running the sync against live READMEs rewrites them with the new canonical keys. This is a data-only commit.

**Files:**
- Regenerate: `data/mcp-content.json`

- [ ] **Step 1: Run the sync script**

Run:

```bash
node scripts/sync-gallery/sync-mcp-content.mjs
```

Expected: prints `✅` for each released MCP, finishes with `Done`. Takes ~30-60s (one `gh api` call per repo × 2 languages).

- [ ] **Step 2: Verify shopline keys are now canonical**

Run:

```bash
jq '."mcp-shopline".sections.zh | keys' data/mcp-content.json
jq '."mcp-shopline".sections.en | keys' data/mcp-content.json
```

Expected zh keys: include `available_tools`, `license`, `api_constraints` (no more `""`, `"143"`, `"api"`).
Expected en keys: include `available_tools` (no more `tools_143`).

- [ ] **Step 3: Verify mcp-591 keys**

Run:

```bash
jq '."mcp-591".sections.en | keys' data/mcp-content.json
```

Expected: includes `usage_examples` or other canonicalised forms; no orphaned `tools_4` if upstream README has `## Tools (4)`.

- [ ] **Step 4: Validate**

Run: `npm run validate`

Expected: passes (validates YAML, not JSON, but confirms no schema-level breakage).

- [ ] **Step 5: Commit**

```bash
git add data/mcp-content.json
git commit -m "data(mcp-content): re-sync with new canonical section keys"
```

---

## Task 5: Extend `sectionConfig` in `[slug].astro`

Add 3 new curated entries (`development`, `contributing`, `license`) so they render with proper icon + zh label. This is a backward-compatible change — `sectionOrder` (still hard-coded to 4 entries) won't render the new ones yet, but the config is in place for Task 6.

**Files:**
- Modify: `src/pages/mcp/[slug].astro:48-54`

- [ ] **Step 1: Add 3 entries to `sectionConfig`**

In `src/pages/mcp/[slug].astro`, replace the existing `sectionConfig` and `sectionOrder` declarations (lines 48-54) with:

```ts
// Section display config: key → { icon, labelEn, labelZh }
const sectionConfig: Record<string, { icon: string; labelEn: string; labelZh: string }> = {
  features: { icon: 'M13 10V3L4 14h7v7l9-11h-7z', labelEn: 'Features', labelZh: '功能特色' },
  api_reference: { icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', labelEn: 'API Reference', labelZh: 'API 參考文件' },
  quick_start: { icon: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z', labelEn: 'Quick Start', labelZh: '快速開始' },
  available_tools: { icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z', labelEn: 'Available Tools', labelZh: '可用工具' },
  development: { icon: 'M14.25 9.75 16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0 0 20.25 18V6A2.25 2.25 0 0 0 18 3.75H6A2.25 2.25 0 0 0 3.75 6v12A2.25 2.25 0 0 0 6 20.25Z', labelEn: 'Development', labelZh: '開發' },
  contributing: { icon: 'M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z', labelEn: 'Contributing', labelZh: '貢獻' },
  license: { icon: 'M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z', labelEn: 'License', labelZh: '授權' },
};
const sectionOrder = ['features', 'api_reference', 'quick_start', 'available_tools'];
```

(`sectionOrder` line is unchanged for now — Task 6 replaces it.)

- [ ] **Step 2: Verify build still works**

Run: `npm run build`

Expected: builds successfully, ~349 pages. No new sections render yet (because `sectionOrder` still only references the original 4), but the config is in place.

- [ ] **Step 3: Commit**

```bash
git add src/pages/mcp/[slug].astro
git commit -m "feat(mcp-detail): add curated icon/label config for development/contributing/license"
```

---

## Task 6: Walk-all renderer + symmetric en/zh fallback

Atomic rewrite of the section render block: introduce `preferredOrder` + `humanise` + `FALLBACK_ICON` + walk-all key list, and switch render block to use them with symmetric fallback.

**Files:**
- Modify: `src/pages/mcp/[slug].astro:54` and `src/pages/mcp/[slug].astro:159-178`

- [ ] **Step 1: Replace `sectionOrder` with `preferredOrder` + helpers**

In `src/pages/mcp/[slug].astro`, replace this single line:

```ts
const sectionOrder = ['features', 'api_reference', 'quick_start', 'available_tools'];
```

with:

```ts
const preferredOrder = [
  'features', 'quick_start', 'api_reference', 'available_tools',
  'development', 'contributing', 'license',
];

const FALLBACK_ICON = 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h10a2 2 0 012 2v14a2 2 0 01-2 2z';

const humanise = (k: string): string =>
  k.split('_').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');

const enKeys = detail ? Object.keys(detail.en) : [];
const zhKeys = detail ? Object.keys(detail.zh) : [];

const canonical = detail
  ? preferredOrder.filter((k) => detail.en[k] || detail.zh[k])
  : [];

const longTail = [
  ...enKeys.filter((k) => !preferredOrder.includes(k)),
  ...zhKeys.filter((k) => !preferredOrder.includes(k) && !enKeys.includes(k)),
];

const renderKeys = [...canonical, ...longTail];
```

- [ ] **Step 2: Replace the render block**

Find the existing block (currently lines 159-178):

```jsx
{sectionOrder.map((key) => {
  const enHtml = detail.en[key];
  const zhHtml = detail.zh[key];
  const cfg = sectionConfig[key];
  if (!enHtml && !zhHtml) return null;
  return (
    <section class="skill-section">
      <h2 class="skill-section-title">
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={cfg.icon} /></svg>
        <span class="lang-en">{cfg.labelEn}</span><span class="lang-zh">{cfg.labelZh}</span>
      </h2>
      {enHtml && <div class="skill-content lang-en" set:html={enHtml} />}
      {zhHtml ? (
        <div class="skill-content lang-zh" set:html={zhHtml} />
      ) : enHtml ? (
        <div class="skill-content lang-zh" set:html={enHtml} />
      ) : null}
    </section>
  );
})}
```

Replace with:

```jsx
{renderKeys.map((key) => {
  const enHtml = detail.en[key];
  const zhHtml = detail.zh[key];
  const cfg = sectionConfig[key] ?? {
    icon: FALLBACK_ICON,
    labelEn: humanise(key),
    labelZh: humanise(key),
  };
  if (!enHtml && !zhHtml) return null;
  return (
    <section class="skill-section">
      <h2 class="skill-section-title">
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={cfg.icon} /></svg>
        <span class="lang-en">{cfg.labelEn}</span><span class="lang-zh">{cfg.labelZh}</span>
      </h2>
      {enHtml || zhHtml ? <div class="skill-content lang-en" set:html={enHtml || zhHtml} /> : null}
      {zhHtml || enHtml ? <div class="skill-content lang-zh" set:html={zhHtml || enHtml} /> : null}
    </section>
  );
})}
```

- [ ] **Step 3: Build the site**

Run: `npm run build`

Expected: ~349 pages, no errors.

- [ ] **Step 4: Spot-check the built pages**

Run:

```bash
grep -c 'Available Tools\|可用工具' dist/mcp/mcp-shopline/index.html
grep -c 'Project Structure\|專案結構' dist/mcp/mcp-shopline/index.html
grep -c 'Usage Examples\|使用範例' dist/mcp/mcp-591/index.html
```

Expected: each `grep -c` returns ≥ 1 (heading present in the built HTML).

- [ ] **Step 5: Commit**

```bash
git add src/pages/mcp/[slug].astro
git commit -m "feat(mcp-detail): walk all section keys with humanised fallback + symmetric en/zh

Closes #15 — Layer 2 of the section-rendering fix."
```

---

## Task 7: Add Playwright e2e test

Lock in the behavior with browser-level assertions. Two MCPs cover the cases: shopline (canonical Available Tools + Chinese pairing), 591 (long-tail sections via humanised fallback).

**Files:**
- Create: `e2e/mcp-detail.spec.ts`

- [ ] **Step 1: Create the test file**

Create `e2e/mcp-detail.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:4321';

test.describe('MCP detail page — section rendering (issue #15)', () => {
  test('mcp-shopline renders Available Tools heading + a tool name from the table', async ({ page }) => {
    await page.goto(`${BASE}/mcp/mcp-shopline/`);
    await expect(page.getByRole('heading', { level: 2, name: /Available Tools/ })).toBeVisible();
    // A tool name that lives in the 143-tool table
    await expect(page.getByText('query_orders').first()).toBeVisible();
  });

  test('mcp-shopline ZH toggle renders 可用工具 heading, no empty headings', async ({ page }) => {
    await page.goto(`${BASE}/mcp/mcp-shopline/`);
    await page.evaluate(() => {
      localStorage.setItem('ygg-lang', 'zh');
      document.documentElement.setAttribute('data-lang', 'zh');
    });
    await page.reload();
    await expect(page.getByRole('heading', { level: 2, name: /可用工具/ })).toBeVisible();
    // No empty <h2> in the lang-zh slot
    const emptyHeadings = await page.locator('h2.skill-section-title:has(span.lang-zh:empty)').count();
    expect(emptyHeadings).toBe(0);
  });

  test('mcp-591 renders long-tail sections via humanised fallback', async ({ page }) => {
    await page.goto(`${BASE}/mcp/mcp-591/`);
    // mcp-591 README has H2s like "Example", "Install", "Usage", "Development & Testing".
    // After canonicalisation they become usage_examples, install, usage, development_testing
    // (or development if alias hits "Development" prefix; either way, all should render).
    const headingTexts = await page.locator('h2.skill-section-title').allTextContents();
    // Expect at least 4 distinct skill-section-title headings (was 0 before the fix).
    expect(headingTexts.length).toBeGreaterThanOrEqual(4);
    // Spot-check one humanised fallback key — "Install" should appear as either
    // a curated section (if added) or humanised "Install" from key `install`.
    expect(headingTexts.some((t) => /Install/i.test(t))).toBe(true);
  });

  test('no section is rendered with empty heading text', async ({ page }) => {
    await page.goto(`${BASE}/mcp/mcp-shopline/`);
    const headings = page.locator('h2.skill-section-title');
    const count = await headings.count();
    for (let i = 0; i < count; i++) {
      const text = (await headings.nth(i).textContent())?.trim();
      expect(text, `heading #${i} should not be empty`).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Start the preview server**

In one terminal:

```bash
npm run preview
```

Expected: serves `dist/` on `http://localhost:4321`. Leave running.

- [ ] **Step 3: Run the new e2e tests**

In a second terminal:

```bash
npx playwright test e2e/mcp-detail.spec.ts
```

Expected: 4 passed.

- [ ] **Step 4: Run the full e2e suite (no regressions in existing 45 tests)**

```bash
npx playwright test
```

Expected: all tests pass.

- [ ] **Step 5: Stop the preview server (Ctrl-C in terminal 1)**

- [ ] **Step 6: Commit**

```bash
git add e2e/mcp-detail.spec.ts
git commit -m "test(e2e): assert MCP detail sections render per issue #15"
```

---

## Task 8: Final verification

End-to-end check: full build, full test suite, manual visual check, no leftover broken keys.

- [ ] **Step 1: Clean build**

```bash
rm -rf dist && npm run build
```

Expected: ~349 pages, no errors.

- [ ] **Step 2: Full validation + test suite**

```bash
npm run validate && npm run test:scripts && npx playwright test
```

(Playwright needs the preview server up — run `npm run preview &` first if it isn't.)

Expected: all green.

- [ ] **Step 3: Manual visual check**

Open `http://localhost:4321/mcp/mcp-shopline/` and confirm:
- "Available Tools" heading renders with the green icon (curated)
- The 143-tool table is visible
- Toggling language to Chinese shows `可用工具` and the same table content (zh content if zh README has it; otherwise en content as fallback)
- Sections like "Project Structure", "Roadmap", "Contributing", "License" all appear (curated where defined, humanised otherwise)

Open `http://localhost:4321/mcp/mcp-591/` and confirm:
- All H2s from the upstream README appear as sections
- No empty headings, no garbled keys

- [ ] **Step 4: Confirm `mcp-content.json` has no broken keys**

```bash
jq '[.. | objects | keys[]?] | map(select(. == "" or test("^[0-9]+$"))) | length' data/mcp-content.json
```

Expected: `0` (no empty keys, no pure-digit keys).

- [ ] **Step 5: Open PR** (if working in a worktree/branch)

```bash
gh pr create --title "fix(#15): MCP detail page renders all README H2 sections" --body "$(cat <<'EOF'
## Summary
- Layer 1: rewrote sectionKey() in scripts/sync-gallery/sync-mcp-content.mjs — Tools(N) regex, expanded zh→en alias table, Unicode-safe slugify
- Layer 2: walk-all renderer in src/pages/mcp/[slug].astro — preferredOrder for canonical sections, humanised fallback for long tail, symmetric en/zh fallback
- Re-synced data/mcp-content.json with the new canonical keys

Closes #15.

## Test plan
- [x] npm run test:scripts — sectionKey unit tests
- [x] npm run build — full site builds
- [x] npx playwright test — new e2e tests pass + no regression in existing 45
- [x] Manual: /mcp/mcp-shopline/ shows Available Tools + 143-tool table; ZH toggle works; long-tail sections render
- [x] Manual: /mcp/mcp-591/ shows all upstream H2s

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(Skip if user wants to PR manually.)

---

## Self-Review Notes

**Spec coverage check:**
- Layer 1.A (Tools(N) regex) → Task 3, tested in Task 2.
- Layer 1.B (CJK alias table) → Task 3, tested in Task 2.
- Layer 1.C (Unicode-safe slugify) → Task 3, tested in Task 2.
- Layer 2.A (extend sectionConfig) → Task 5.
- Layer 2.B (preferredOrder) → Task 6.
- Layer 2.C (walk-all key list) → Task 6.
- Layer 2.D (per-section render with fallback config) → Task 6.
- Layer 2.E (symmetric en/zh fallback) → Task 6.
- Re-sync mcp-content.json → Task 4.
- Acceptance criteria → Tasks 7 + 8.

**Key consistency:** `preferredOrder`, `sectionConfig`, `humanise`, `FALLBACK_ICON`, `renderKeys`, `enKeys`, `zhKeys`, `canonical`, `longTail` are all named consistently across tasks 5-7. `sectionKey` exported from `sync-mcp-content.mjs` is consumed by `sync-mcp-content.test.mjs` in Task 2.

**No placeholders:** every step that changes code shows the code; every step that runs a command shows the expected output.
