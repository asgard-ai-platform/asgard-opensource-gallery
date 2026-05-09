# Design — Issue #15: MCP Detail Page Section Rendering

**Date:** 2026-05-10
**Scope:** `asgard-opensource-gallery` (Yggdrasil) — `scripts/sync-gallery/sync-mcp-content.mjs`, `src/pages/mcp/[slug].astro`, `data/mcp-content.json`
**Status:** Designed, not yet implemented.
**Issue:** [#15](https://github.com/asgard-ai-platform/asgard-opensource-gallery/issues/15)

## Background

After PR #14 synced the golden-sample-style README for `mcp-591`, the new
content reached `data/mcp-content.json` correctly but the detail page
rendered almost none of it. The same gap silently affects every released MCP
that follows the `mcp-shopline` golden sample.

Two layers disagree on section keys:

- **Layer 1 — `sync-mcp-content.mjs::sectionKey()`** normalises an H2 heading
  into a key. ASCII titles get lowercase + slugified (`## Tools (4)` →
  `tools_4`, `## Tools (143)` → `tools_143`, `## Development` →
  `development`). Chinese titles collapse to an empty string after
  `replace(/[^\w\s]/g, '')` strips all CJK. The whitelist for tools uses
  `t === 'tools'` exactly, so `Tools (N)` never matches `available_tools`.
- **Layer 2 — `src/pages/mcp/[slug].astro:54`** only renders four hard-coded
  keys: `['features', 'api_reference', 'quick_start', 'available_tools']`.

Net effect: keys produced by Layer 1 do not match keys consumed by Layer 2,
so most sections are silently dropped on render.

### Concrete impact (verified 2026-05-10 against `data/mcp-content.json`)

`mcp-shopline` en has 14 keys but only 3 render
(`features`, `api_reference`, `quick_start`). The 143-tool table
(`tools_143`) is missing on the live site. zh has 3 keys: `""`, `"143"`,
`"api"` — every Chinese H2 was mangled by the CJK-stripping regex, so the
language toggle is essentially broken for this MCP.

`mcp-591` has 5 en keys (`example`, `requirements`, `install`, `usage`,
`development_testing`) and zero zh keys. None of the en keys are in
`sectionOrder`, so nothing past the YAML description renders.

## Goals

1. Stop silently dropping sections. Every H2 in the upstream README appears
   on the detail page without per-MCP code changes.
2. en/zh sections of the same canonical meaning render under one
   `<section>` block (paired by key).
3. Chinese H2 headings produce stable, non-empty keys.
4. New H2 sections in golden-sample MCPs do not require touching the
   renderer.

## Non-goals

- Editing upstream READMEs.
- Changing the sync workflow plumbing (it already delivers data correctly;
  PR #14 confirmed this).
- Changing `audit-readme-format.mjs` rules.
- Changing how `intro` is extracted or rendered.

## Design

Two layers, each with a single responsibility:

- **Layer 1 — `sectionKey()`** is the only place that maps H2 title → key.
  en and zh equivalents canonicalise to the same key. Long-tail unknown
  titles produce a legal slug (CJK characters survive intact).
- **Layer 2 — renderer** walks every key present in the JSON. Canonical keys
  with a curated icon/label render first in a preferred order; long-tail
  keys render after with a generic icon and a humanised heading.

Data flow stays one-directional: `README → sectionKey() →
mcp-content.json → renderer`. The renderer does no key transformation;
key alignment is entirely Layer 1's responsibility.

### Layer 1 — `sectionKey()` rewrite

Three changes:

**A. `Tools (N)` regex match → `available_tools`**

The function is restructured so regex matches run **before** punctuation
stripping, on a `raw` form that preserves `()`:

```js
function sectionKey(title) {
  const raw = title.trim().toLowerCase();

  // Pre-strip regex matches (preserve parens for "Tools (N)" form)
  if (/^tools(\s*\(\d+\))?$/.test(raw)) return 'available_tools';
  if (/^工具(\s*\(\d+\))?$/.test(raw)) return 'available_tools';

  // Normalised form for substring/equality checks
  const t = raw.replace(/[^\p{L}\p{N}\s]/gu, '').trim();

  // ...existing whitelist (extended with CJK aliases per Section B)...

  // Slugify fallback (per Section C)
  return t.replace(/\s+/g, '_').replace(/^_|_$/g, '');
}
```

**B. CJK alias table (zh → canonical en key)**

| zh H2 | canonical key |
|---|---|
| 功能特色 / 功能 | features |
| 快速開始 / 入門 | quick_start |
| API 參考 / API 參考文件 | api_reference |
| 可用工具 / 工具 / 工具 (N) | available_tools |
| 重要寫入工具 | important_write_tools |
| 安裝 | install |
| 設定 / 配置 | configuration |
| 開發 | development |
| 貢獻 | contributing |
| 授權 | license |
| 範例 / 使用範例 | usage_examples |
| 專案結構 | project_structure |
| API 限制 | api_constraints |
| API 端點覆蓋 | api_endpoint_coverage |
| 已知測試缺口 | known_test_gaps |
| 路線圖 | roadmap |

The existing en whitelist (`t.includes('what this does')`,
`t.includes('quick start')`, etc.) stays. The zh entries are added next to
their en counterparts so both produce the same key.

**C. Slugify fallback uses Unicode property escape**

Diff against the existing function (changes already shown in Section A's
restructure):

- normalise: `[^\w\s]` → `[^\p{L}\p{N}\s]/gu`  (keeps CJK letters/digits)
- slugify:   `[^a-z0-9]+` → `\s+`              (no longer rewrites CJK to `_`)

`\p{L}` keeps every Unicode letter (incl. CJK), `\p{N}` keeps every digit.
`## 專案結構` (not in alias table) → key `專案結構` — a legal,
non-empty key the renderer can humanise.

### Layer 2 — Renderer rewrite (`src/pages/mcp/[slug].astro`)

**A. Extend `sectionConfig`** (4 → 7 curated entries)

| key | labelEn | labelZh |
|---|---|---|
| features | Features | 功能特色 |
| quick_start | Quick Start | 快速開始 |
| api_reference | API Reference | API 參考文件 |
| available_tools | Available Tools | 可用工具 |
| development | Development | 開發 |
| contributing | Contributing | 貢獻 |
| license | License | 授權 |

The 4 existing entries keep their icons. The 3 new entries pick suitable
icons from heroicons (development → wrench-screwdriver, contributing →
users, license → document-text).

**B. Replace `sectionOrder` with `preferredOrder`**

```js
const preferredOrder = [
  'features', 'quick_start', 'api_reference', 'available_tools',
  'development', 'contributing', 'license',
];
```

**C. Walk-all key list**

```js
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

Canonical sections render in the preferred order regardless of upstream
README order (so "Features" always comes before "License"). Long-tail
sections render in the order they appear in the en README, then any
zh-only sections at the end.

**D. Per-section render with fallback config**

```jsx
const FALLBACK_ICON = 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h10a2 2 0 012 2v14a2 2 0 01-2 2z';

const humanise = (k) => k.split('_')
  .map(w => w[0].toUpperCase() + w.slice(1))
  .join(' ');

{renderKeys.map((key) => {
  const enHtml = detail.en[key];
  const zhHtml = detail.zh[key];
  const cfg = sectionConfig[key] ?? {
    icon: FALLBACK_ICON,
    labelEn: humanise(key),
    labelZh: humanise(key),  // CJK keys (e.g. "專案結構") pass through unchanged
  };
  // existing <section class="skill-section"> markup
})}
```

**E. Symmetric en/zh fallback** (fixes existing asymmetry)

```jsx
{enHtml || zhHtml ? <div class="skill-content lang-en" set:html={enHtml || zhHtml} /> : null}
{zhHtml || enHtml ? <div class="skill-content lang-zh" set:html={zhHtml || enHtml} /> : null}
```

Currently zh-missing falls back to en; en-missing leaves the lang-en slot
empty. The symmetric form means the language toggle never shows an empty
section.

### Re-sync after the change

`mcp-content.json` was generated by the old `sectionKey()` and contains
broken keys (`""`, `"143"`, `"api"`, `tools_4`, `tools_143`, ...).
After Layer 1 changes land, run:

```bash
node scripts/sync-gallery/sync-mcp-content.mjs
```

This re-fetches all 14 released MCP READMEs and rewrites `mcp-content.json`
with canonicalised keys. Without this step, Layer 2's improvements still
help, but the existing broken keys remain.

## Edge cases

1. **Astro `set:html` with falsy value**: `enHtml || zhHtml` short-circuits
   to `undefined` when both are falsy; the outer `?` filters those out, no
   empty `<div>` is emitted.
2. **Same key, en/zh content not aligned**: e.g. zh README has
   `## 安裝` (alias → `install`) but en README has no Install section.
   The renderer fills both lang slots with zh content. Acceptable —
   reflects upstream README reality.
3. **mcp-shopline broken zh keys (`""`, `"143"`, `"api"`)**: after re-sync,
   alias/regex collects them into canonical keys (`""` ← `## 授權` →
   `license`; `"143"` ← `## 工具 (143)` → `available_tools`; `"api"` ←
   `## API 限制` → `api_constraints`).
4. **Long-tail Chinese keys**: `## 專案結構` (no alias) → key `專案結構`.
   Renders as a Chinese-only section with `專案結構` as both labels.
   The en speaker sees Chinese in the lang-en slot; this is the honest
   representation of "this section only exists in Chinese upstream".

## Acceptance

- [ ] `mcp-shopline` detail page renders the 143-tool table under the
      "Available Tools" section.
- [ ] `mcp-shopline` zh toggle shows Chinese sections with no empty
      headings, no `""` / `"143"` keys.
- [ ] `mcp-591` detail page renders all five existing en sections
      (`example`, `requirements`, `install`, `usage`,
      `development_testing`) — none silently dropped.
- [ ] Adding a new H2 not in the alias table produces a humanised
      heading without code changes.
- [ ] `npm run build` succeeds; `npx playwright test` passes.
- [ ] Manual visual check of `/mcp/mcp-shopline/` and `/mcp/mcp-591/`
      in both EN and ZH.

## Verification

```bash
node scripts/sync-gallery/sync-mcp-content.mjs   # regenerate mcp-content.json
npm run validate
npm run build
npm run preview &                                 # localhost:4321
npx playwright test
```

## Out of scope

- Upstream README content fixes.
- `audit-readme-format.mjs` rule changes.
- Sync workflow plumbing (already working).
- `intro` extraction (already working).
