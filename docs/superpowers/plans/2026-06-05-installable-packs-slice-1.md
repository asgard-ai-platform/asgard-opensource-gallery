# Installable Packs — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/plugins` page distinguish installable **packs** from curated **collections** — add a `kind` discriminator, split the list into two labelled sections, and give pack cards a `PACK` + `Core/Community` badge and `Skills only` rendering. **This is taxonomy-only groundwork.**

**⚠ Ships with slices 2–3, not alone.** Slice 1 *labels* packs but deliberately gives no install action or setup-readiness signal — those require the `pack-content.json` sidecar (Slice 2) and the pack detail page (Slice 3). Shipping slice 1 to production by itself would advertise "installable" with no way to install. Treat slices 1–3 as one production-facing release; slice 1 is an internal, independently-reviewable increment. The pack card here therefore has **no Install button** (correct — it can't fulfil one yet); it only carries the `PACK`/publisher taxonomy badges and links to the (still recipe-style) detail page.

**Architecture:** Add one optional `kind` field to the plugin schema/type. The data loader normalises `kind` (absent → `collection`) so components never see `undefined`, and exposes a pure `getPublisherTier(github?)` helper that derives Core/Community from the GitHub owner string (no new YAML field). `PlugInCard.astro` branches on `kind`; `plugins/index.astro` partitions into two sections. No `pack-content.json` sidecar yet (Slice 2) and no detail-page changes (Slice 3).

**Tech Stack:** Astro 5 (static), TypeScript, Tailwind CSS 3, Ajv schema validation (`scripts/validate.mjs`), Playwright e2e (`e2e/`).

**Source spec:** `docs/superpowers/specs/2026-06-05-installable-packs-experience-design.md` (slice list §11, decisions §3).

**Testing reality (read before starting):** This repo has **no unit-test runner for `src/`** (only `node --test` for `scripts/sync-gallery/*.test.mjs` and Playwright for `e2e/`). So per-task gates are `npm run validate` and `npm run build`; the integration check is a Playwright spec (Task 6) run against the preview server. Pure helpers are verified through the rendered output, matching repo convention.

**Scope note (reconciled with spec §11):** The `/plugins` page does **not** use `FilterBar` (only `mcp/index.astro` and `skills/index.astro` do) — it renders a flat grid, so there is no existing filtering to preserve. With 12 plugins in two labelled sections, adding a filter is YAGNI. The spec §11 slice-1 line has been amended to match — **no FilterBar in this slice**; revisit if the plugin list grows.

**Slice-1 visual caveat:** The only pack right now is `tw-ecommerce-majordomo` (12 MCP). `emba-famulus` (0 MCP) is **not** added until Slice 4, so the `Skills only` branch has no live pack to render in this slice. We still implement and unit-cover the logic; the e2e assertion for `Skills only` is marked `test.fixme` with a pointer to Slice 4.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `schemas/plugin.schema.json` | modify | Allow optional `kind` enum |
| `src/types.ts` | modify | `kind?` on `PlugIn` |
| `src/utils/data-loader.ts` | modify | Normalise `kind`; `getPublisherTier()` helper |
| `data/plugins.yaml` | modify | Mark `tw-ecommerce-majordomo` as `kind: pack` |
| `src/components/PlugInCard.astro` | modify | Branch on `kind`: badges + `Skills only` + `data-kind` |
| `src/pages/plugins/index.astro` | modify | Two sections + hero copy |
| `e2e/plugins-packs.spec.ts` | create | Integration test for the split + badges |

---

## Task 1: Add optional `kind` to schema and type

**Files:**
- Modify: `schemas/plugin.schema.json` (properties block, ~line 45-47)
- Modify: `src/types.ts:41-52` (`PlugIn` interface)

- [ ] **Step 1: Add `kind` to the JSON Schema**

In `schemas/plugin.schema.json`, the `properties` block currently ends:
```json
          "mcp_servers": { "type": "array", "items": { "type": "string" } },
          "skills": { "type": "array", "items": { "type": "string" } },
          "github": { "type": "string", "format": "uri" },
          "icon": { "type": "string" }
```
Add `kind` (optional — not added to the `required` array) right after `"slug"` is not necessary; add it alongside the other optionals, before `github`:
```json
          "mcp_servers": { "type": "array", "items": { "type": "string" } },
          "skills": { "type": "array", "items": { "type": "string" } },
          "kind": { "enum": ["collection", "pack"] },
          "github": { "type": "string", "format": "uri" },
          "icon": { "type": "string" }
```
Do **not** add `kind` to `required` and do **not** add a JSON-Schema `"default"` — the default is applied in the loader (Task 2), because Ajv in `validate.mjs` does not write defaults and the 10 existing entries have no `kind`.

- [ ] **Step 2: Add `kind` to the `PlugIn` TypeScript interface**

In `src/types.ts`, the interface is:
```ts
export interface PlugIn {
  slug: string;
  name: BilingualText;
  description: BilingualText;
  scenario: BilingualText;
  upgrade_to?: string;
  upgrade_description?: BilingualText;
  mcp_servers: string[];
  skills: string[];
  github?: string;
  icon?: string;
}
```
Add `kind?` after `slug`:
```ts
export interface PlugIn {
  slug: string;
  kind?: 'collection' | 'pack';
  name: BilingualText;
  description: BilingualText;
  scenario: BilingualText;
  upgrade_to?: string;
  upgrade_description?: BilingualText;
  mcp_servers: string[];
  skills: string[];
  github?: string;
  icon?: string;
}
```

- [ ] **Step 3: Verify validation still passes (no data has `kind` yet — proves backward compatibility)**

Run: `npm run validate`
Expected: `✅ All checks passed!` (the 10 existing kind-less entries remain valid because `kind` is optional).

- [ ] **Step 4: Commit**

```bash
git add schemas/plugin.schema.json src/types.ts
git commit -m "feat(packs): add optional kind discriminator to plugin schema + type"
```

---

## Task 2: Loader — normalise `kind` and derive publisher tier

**Files:**
- Modify: `src/utils/data-loader.ts:33-36` (`getPlugIns`) and add two exported helpers

- [ ] **Step 1: Normalise `kind` in `getPlugIns`**

Replace the current loader (`src/utils/data-loader.ts:33-36`):
```ts
export function getPlugIns(): PlugIn[] {
  const data = loadYaml<{ plugins: PlugIn[] }>('plugins.yaml');
  return data.plugins;
}
```
with a version that fills the default so downstream code never sees `undefined`:
```ts
export function getPlugIns(): PlugIn[] {
  const data = loadYaml<{ plugins: PlugIn[] }>('plugins.yaml');
  return data.plugins.map((p) => ({ ...p, kind: p.kind ?? 'collection' }));
}
```

- [ ] **Step 2: Add the publisher-tier helper**

Append to `src/utils/data-loader.ts` (after `getPlugInBySlug`, before the `SkillContent` interface). Takes the `github` string (not the whole `PlugIn`) so it's a focused, side-effect-free string→tier function that is trivial to test in isolation:
```ts
/**
 * Derive publisher trust tier from the repo owner in a github URL.
 * Owner github.com/asgard-ai-platform → "core"; any other owner → "community".
 * Returns null when there is no github URL (e.g. collections).
 */
export function getPublisherTier(github?: string): 'core' | 'community' | null {
  if (!github) return null;
  const m = github.match(/github\.com\/([^/]+)/i);
  if (!m) return null;
  return m[1].toLowerCase() === 'asgard-ai-platform' ? 'core' : 'community';
}
```

- [ ] **Step 3: Verify the build compiles (TypeScript) with the new helper**

Run: `npm run build`
Expected: build completes (`[build] N page(s) built`), no TypeScript errors. Page count unchanged from before this slice.

- [ ] **Step 4: Commit**

```bash
git add src/utils/data-loader.ts
git commit -m "feat(packs): normalise plugin kind + derive publisher tier from github owner"
```

---

## Task 3: Mark majordomo as a pack

**Files:**
- Modify: `data/plugins.yaml` (the `tw-ecommerce-majordomo` entry)

- [ ] **Step 1: Add `kind: pack` to the majordomo entry**

In `data/plugins.yaml`, the entry currently starts:
```yaml
  - slug: tw-ecommerce-majordomo
    name:
      en: "Taiwan E-Commerce Majordomo"
      zh: "台灣電商總管"
```
Insert `kind: pack` immediately after the slug line:
```yaml
  - slug: tw-ecommerce-majordomo
    kind: pack
    name:
      en: "Taiwan E-Commerce Majordomo"
      zh: "台灣電商總管"
```
Leave the other 10 entries untouched (they default to `collection`).

- [ ] **Step 2: Verify schema + cross-references still pass**

Run: `npm run validate`
Expected: `✅ All checks passed!` (`kind: pack` matches the enum; cross-refs unchanged).

- [ ] **Step 3: Commit**

```bash
git add data/plugins.yaml
git commit -m "feat(packs): mark tw-ecommerce-majordomo as kind: pack"
```

---

## Task 4: Pack-aware `PlugInCard`

**Files:**
- Modify: `src/components/PlugInCard.astro` (full rewrite — it is 43 lines)

- [ ] **Step 1: Rewrite `PlugInCard.astro` to branch on kind**

Replace the entire contents of `src/components/PlugInCard.astro` with:
```astro
---
import type { PlugIn } from '../types';
import { getPublisherTier } from '../utils/data-loader';

interface Props {
  plugin: PlugIn;
}

const { plugin } = Astro.props;
// data-loader.getPlugIns() already normalises kind; this ?? is a belt-and-suspenders
// default for any direct/un-normalised caller.
const kind = plugin.kind ?? 'collection';
const isPack = kind === 'pack';
const publisher = isPack ? getPublisherTier(plugin.github) : null;
const mcpCount = plugin.mcp_servers.length;
const skillCount = plugin.skills.length;
const skillsOnly = mcpCount === 0;
---

<a href={`/plugins/${plugin.slug}/`} class="card-link group border-border" data-kind={kind}>
  <div class="card-header from-blue-600 to-cyan-900">
    <div class="absolute inset-0 bg-gradient-to-t from-card via-transparent to-transparent"></div>
    {isPack && (
      <div class="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        <span class="rounded-full bg-primary/15 text-primary text-[10px] font-semibold px-2 py-0.5 border border-primary/30">PACK</span>
        {publisher && (
          <span
            class={`rounded-full text-[10px] font-semibold px-2 py-0.5 border ${
              publisher === 'core'
                ? 'bg-primary/15 text-primary border-primary/30'
                : 'bg-accent text-muted-foreground border-border'
            }`}
            data-publisher={publisher}
          >
            <span class="lang-en">{publisher === 'core' ? 'Core' : 'Community'}</span><span class="lang-zh">{publisher === 'core' ? '官方' : '社群'}</span>
          </span>
        )}
      </div>
    )}
    <div class="relative z-10">
      <div class="card-icon-letter">{plugin.name.en.charAt(0)}</div>
    </div>
  </div>

  <div class="relative p-5">
    <h3 class="font-semibold text-foreground text-lg group-hover:text-primary transition-colors name-bilingual">
      <span class="name-en">{plugin.name.en}</span>
      <span class="name-zh">{plugin.name.zh}</span>
    </h3>
    <p class="card-desc lang-en">{plugin.scenario.en}</p>
    <p class="card-desc lang-zh">{plugin.scenario.zh}</p>

    <div class="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
      {skillsOnly ? (
        <span class="card-badge"><span class="lang-en">Skills only</span><span class="lang-zh">純技能</span></span>
      ) : (
        <span class="card-badge">
          {mcpCount} <span class="lang-en">MCPs</span><span class="lang-zh">個 MCP</span>
        </span>
      )}
      <span class="card-badge">
        {skillCount} <span class="lang-en">SKILLs</span><span class="lang-zh">個技能</span>
      </span>
    </div>
  </div>

  {plugin.upgrade_to && (
    <div class="px-5 pb-4 text-xs text-primary/70 font-medium">
      &rarr; {plugin.upgrade_to}
    </div>
  )}
</a>
```
Notes: `data-kind` and `data-publisher` are added for e2e selectors (consistent with how `McpCard` uses `data-*`). Collections render exactly as before (no badges, `data-kind="collection"`).

- [ ] **Step 2: Verify the build compiles and pages render**

Run: `npm run build`
Expected: build completes with the same page count as Task 2; no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/PlugInCard.astro
git commit -m "feat(packs): PlugInCard shows PACK + Core/Community badges and Skills-only count"
```

---

## Task 5: Split `/plugins` into two sections

**Files:**
- Modify: `src/pages/plugins/index.astro` (full rewrite — it is 47 lines)

- [ ] **Step 1: Rewrite `plugins/index.astro` to partition packs vs collections**

Replace the entire contents of `src/pages/plugins/index.astro` with:
```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import PlugInCard from '../../components/PlugInCard.astro';
import { getPlugIns } from '../../utils/data-loader';

const plugins = getPlugIns();
const packs = plugins.filter((p) => p.kind === 'pack');
const collections = plugins.filter((p) => p.kind === 'collection');
---

<BaseLayout title="PlugIns" description="Installable agent packs and curated MCP + SKILL collections">
  <!-- Hero area -->
  <section class="relative overflow-hidden border-b border-border">
    <div class="absolute inset-0 pointer-events-none">
      <div class="absolute top-1/2 left-1/3 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl animate-glow-pulse"></div>
      <div class="absolute top-1/2 right-1/3 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl animate-glow-pulse-delayed"></div>
    </div>
    <div class="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div class="flex items-center gap-3 mb-3">
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-border flex items-center justify-center">
          <svg class="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        </div>
        <div>
          <h1 class="text-3xl font-bold text-gradient">
            <span class="lang-en">PlugIns</span><span class="lang-zh">解決方案套件</span>
          </h1>
          <p class="text-sm text-muted-foreground">
            {packs.length} <span class="lang-en">installable packs</span><span class="lang-zh">個可安裝套件包</span>
            · {collections.length} <span class="lang-en">curated collections</span><span class="lang-zh">個策展組合</span>
          </p>
        </div>
      </div>
      <p class="text-muted-foreground max-w-2xl lang-en">
        One-command installable agent packs, plus curated combinations of MCP Servers and SKILLs for specific business scenarios.
      </p>
      <p class="text-muted-foreground max-w-2xl lang-zh">
        可一行安裝的 agent 套件包，以及為特定商業場景策展的 MCP 伺服器與技能組合。
      </p>
    </div>
  </section>

  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-14">
    {packs.length > 0 && (
      <section data-section="packs">
        <h2 class="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
          <span aria-hidden="true">⚡</span>
          <span class="lang-en">Installable Packs</span><span class="lang-zh">可一鍵安裝的套件包</span>
          <span class="text-sm font-normal text-muted-foreground">({packs.length})</span>
        </h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {packs.map((plugin) => <PlugInCard plugin={plugin} />)}
        </div>
      </section>
    )}

    <section data-section="collections">
      <h2 class="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
        <span class="lang-en">Curated Collections</span><span class="lang-zh">策展組合</span>
        <span class="text-sm font-normal text-muted-foreground">({collections.length})</span>
      </h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
        {collections.map((plugin) => <PlugInCard plugin={plugin} />)}
      </div>
    </section>
  </div>
</BaseLayout>
```

**SEO note (deliberate):** this rewrite changes the `BaseLayout` `description` prop (the page `<meta name="description">`) from "Pre-packaged MCP + SKILL combos for specific business scenarios" to "Installable agent packs and curated MCP + SKILL collections", to match the new page content. This is an intentional SEO copy change, not an accident — call it out in the commit message. The `<title>` stays "PlugIns".

- [ ] **Step 2: Verify build + page count unchanged**

Run: `npm run build`
Expected: build completes; the `/plugins` index still builds (1 page); total page count identical to Task 4 (this task adds no routes).

- [ ] **Step 3: Commit**

```bash
git add "src/pages/plugins/index.astro"
git commit -m "feat(packs): split /plugins into Installable Packs and Curated Collections sections"
```

---

## Task 6: e2e test for the packs/collections split

**Files:**
- Create: `e2e/plugins-packs.spec.ts`

- [ ] **Step 1: Write the e2e spec**

Create `e2e/plugins-packs.spec.ts`:
```ts
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

  // Skills-only rendering has no live pack until emba-famulus lands in Slice 4.
  // Assert the positive marker + absence of an MCP count badge (not "no '0'",
  // which would false-match any count containing 0).
  test.fixme('skills-only pack shows "Skills only" and no MCP count', async ({ page }) => {
    await page.goto(`${BASE}/plugins/`);
    const emba = page.locator('a[href="/plugins/emba-famulus/"]');
    await expect(emba.getByText('Skills only')).toBeVisible();
    await expect(emba.getByText('MCP')).toHaveCount(0);
    // also assert the community publisher path here (codex finding 4):
    await expect(emba.locator('[data-publisher="community"]')).toBeVisible();
  });
});
```

- [ ] **Step 2: Build, start preview server, run the spec**

Run:
```bash
npm run build
npm run preview &
npx playwright test e2e/plugins-packs.spec.ts
kill %1
```
Expected: 4 tests pass, 1 skipped (`test.fixme`). If the preview server is already running on :4321, skip the `npm run preview &` / `kill %1` lines.

- [ ] **Step 3: Run the full e2e suite to confirm no regressions**

Run: `npx playwright test`
Expected: all previously-passing tests still pass (the existing 45 + the 4 new), 1 skipped. No failures introduced by the `/plugins` markup change.

- [ ] **Step 4: Commit**

```bash
git add e2e/plugins-packs.spec.ts
git commit -m "test(packs): e2e for /plugins packs/collections split and pack badges"
```

---

## Final verification

- [ ] `npm run validate` → `✅ All checks passed!`
- [ ] `npm run build` → builds, page count unchanged vs start of slice
- [ ] `npx playwright test` → green (4 new pass, 1 fixme, existing suite unaffected)
- [ ] Manual smoke: `/plugins` shows "Installable Packs (1)" above "Curated Collections (10)"; majordomo card carries `PACK` + `Core`/`官方`.

## Out of scope (later slices)
- `data/pack-content.json` extractor + install/setup/use-cases data → Slice 2.
- **`PackContent` TypeScript interface** (spec §8) → **deferred to Slice 2**, intentionally. It types the `pack-content.json` sidecar; defining it now with no sidecar and no consumer is YAGNI and risks drifting from the machine-generated shape. It lands in the same slice as the extractor that produces it.
- **Card install/setup-readiness signals** (setup state, use-case teaser, Install/source CTA — the spec's dominant card axes) → require the sidecar, so **Slice 2 (data) + Slice 3 (detail handoff)**. Slice 1's card intentionally carries taxonomy badges only and has no Install button (see header note).
- Pack **detail** page (split-hero, install tabs, setup accordions, use-cases, `hasDepEdges` graph gate) → Slice 3.
- `emba-famulus` onboarding (needs the 13 skills' canonical source decided, spec §10) → Slice 4. This activates the `Skills only` path and the **`community` publisher branch** live; Slice 4 must un-`fixme` the skills-only e2e test (which now also asserts the `data-publisher="community"` badge — covering `getPublisherTier`'s community path, codex finding 4).
