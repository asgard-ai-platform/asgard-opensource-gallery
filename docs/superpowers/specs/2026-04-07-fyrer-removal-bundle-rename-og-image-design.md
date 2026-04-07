# Design — Fyrer Removal, Bundle → PlugIn Rename, Bilingual OG Images

**Date:** 2026-04-07
**Scope:** `asgard-opensource-gallery` (Yggdrasil)
**Author:** Brainstorming session

## Background

Three independent housekeeping tasks are bundled into one spec because they touch overlapping files:

1. **Fyrer is not yet launched** — every reference to it should be removed from public-facing data, but the entities that referenced it (bundles and MCP servers) must stay.
2. **Brand language unification** — "Bundle" is being renamed to "PlugIn" across the codebase to align with the wider Asgard product vocabulary. Traditional Chinese UI text stays as「解決方案套件」/「解決方案」.
3. **OG Image refresh** — generate bright-mode social-share images for Yggdrasil in both English and Traditional Chinese, replacing the existing single-language file.

The current site builds 357 static pages, has Playwright e2e tests, and uses YAML data files validated by Ajv against JSON Schemas.

---

## Task 1 — Remove Fyrer References

### Goal
Eliminate every mention of "Fyrer" from data, schemas, and documentation while preserving all bundles and MCP servers that previously referenced it.

### Affected Files
| File | Change |
|---|---|
| `schemas/bundle.schema.json` | Remove `"upgrade_to"` from the `required` array (it stays as a property, just optional). |
| `src/types.ts` | `Bundle.upgrade_to` becomes `string \| undefined` (`upgrade_to?: string`). |
| `data/bundles.yaml` | Delete `upgrade_to: Fyrer` from 3 bundles (verified by grep): `tw-ecommerce-ops` (line 10), `sea-marketplace` (line 82), `hospitality-ops` (line 118). Keep all other fields untouched. |
| `data/mcp-servers.yaml` | Delete `upgrade_to: Fyrer` from 17 server entries. Strip `→ Fyrer` from the 4 section header comments (e.g. `# M-01 Taiwan E-commerce & Hospitality (7) → Fyrer` → `# M-01 Taiwan E-commerce & Hospitality (7)`). |
| `src/pages/bundles/[slug].astro` | Wrap the "Upgrade to" block with `{bundle.upgrade_to && (...)}` so bundles without an upgrade target render cleanly. |
| `src/components/BundleCard.astro` | Wrap the trailing `→ {bundle.upgrade_to}` line with the same conditional. |
| `CONTRIBUTING.md` | Replace `upgrade_to: Fyrer` in the 2 YAML examples with `upgrade_to: Sindri` (an existing live product) so contributors still see a working example. |
| `scripts/validate.mjs` | Audit only — confirm there is no extra check that requires `upgrade_to`. If there is, relax it. |

### Verification
- `npm run validate` passes.
- `npm run build` produces 357 pages with no rendering errors on the 4 affected bundles.
- `grep -r -i fyrer .` (excluding `node_modules/`, `dist/`, `reference/`) returns zero matches.

### Why Optional Instead of Replacement
Picking a stand-in name (e.g. "TBA") would just postpone the cleanup and pollute the data. Making the field optional matches how `mcp-server.schema.json` already treats `upgrade_to` and is the most honest representation: these bundles currently have no commercial upgrade path.

---

## Task 2 — Bundle → PlugIn Full Rename (Option C)

### Goal
Rename "Bundle" to "PlugIn" everywhere — types, data files, schemas, components, routes, tests, docs, and English UI strings. Traditional Chinese UI text stays exactly as it is. Slugs remain unchanged.

### Naming Decisions
- **TypeScript type:** `PlugIn` (PascalCase, capital `I`) — matches the visual brand spelling chosen by the user.
- **Variable names:** `plugin` (lowercase) for runtime variables — `PlugIn` only for the type.
- **File names:** `PlugInCard.astro`, `PlugInGraph.astro` (PascalCase, capital `I`).
- **Routes:** `/plugins/` (lowercase, no `i` capitalization in URLs).
- **YAML keys:** `plugins:` (lowercase, plural).
- **Slugs:** unchanged. The 9 existing bundle slugs (`tw-ecommerce-ops`, `sea-marketplace`, etc.) keep their values.

### Change Matrix

#### Schemas
- `schemas/bundle.schema.json` → `schemas/plugin.schema.json` (rename file; content unchanged except as required by Task 1).
- `schemas/mcp-server.schema.json` — rename property `bundles` → `plugins`.
- `schemas/skill.schema.json` — rename property `bundles` → `plugins`.

#### Data
- `data/bundles.yaml` → `data/plugins.yaml`.
- Inside `plugins.yaml`: top-level key `bundles:` → `plugins:`.
- `data/mcp-servers.yaml` — every `bundles: [...]` field → `plugins: [...]`.
- `data/skills.yaml` — every `bundles: [...]` field → `plugins: [...]`.

#### Types & Loader
- `src/types.ts`:
  - `interface Bundle` → `interface PlugIn`. Since Task 1 already made `upgrade_to` optional, after rename `PlugIn.upgrade_to?: string` (carry-over, no extra change needed here).
  - `McpServer.bundles?: string[]` → `McpServer.plugins?: string[]`.
  - `Skill.bundles?: string[]` → `Skill.plugins?: string[]`.
- `src/utils/data-loader.ts`:
  - `getBundles()` → `getPlugIns()`.
  - `getBundleBySlug()` → `getPlugInBySlug()`.
  - Read from `plugins.yaml` with the new top-level key.

#### Components (rename + content)
- `src/components/BundleCard.astro` → `src/components/PlugInCard.astro`.
  - Props type → `PlugIn`, variable `bundle` → `plugin`, link `/bundles/${bundle.slug}/` → `/plugins/${plugin.slug}/`.
- `src/components/BundleGraph.astro` → `src/components/PlugInGraph.astro`.
  - Same variable rename, retain SVG layout.

#### Pages (rename directory + content)
- `src/pages/bundles/` → `src/pages/plugins/` (rename the directory; both `index.astro` and `[slug].astro` move with it).
  - Inside, all `bundle` variables → `plugin`, all `getBundles` → `getPlugIns`, all `BundleCard` imports → `PlugInCard`, etc.

#### Pages (content only)
- `src/pages/index.astro`:
  - Imports updated.
  - "Solution Bundles Preview" section → "Solution PlugIns Preview" (English only; ZH stays).
  - All `/bundles/` links → `/plugins/`.
  - StatsBar prop `bundleCount` → `pluginCount`.
- `src/pages/mcp/[slug].astro` — `getBundles` → `getPlugIns`, variable `bundles` → `plugins`, server reference `server.bundles` → `server.plugins`, link → `/plugins/`.
- `src/pages/skills/[slug].astro` — same treatment for the SKILL detail page.

#### Layout & shared components (content only)
- `src/layouts/BaseLayout.astro` — default `description` text "Solution Bundles" → "PlugIns".
- `src/components/Header.astro` — nav item `{ labelEn: 'Bundles', labelZh: '解決方案', href: '/bundles/' }` → `{ labelEn: 'PlugIns', labelZh: '解決方案', href: '/plugins/' }`.
- `src/components/Hero.astro` — EN text "Solution Bundles" → "PlugIns", "View Bundles" → "View PlugIns", link `/bundles/` → `/plugins/`. ZH unchanged.
- `src/components/Footer.astro` — EN footer text + link.
- `src/components/StatsBar.astro` — prop name `bundleCount` → `pluginCount`, EN label `'Solution Bundles'` → `'PlugIns'`. ZH label unchanged.

#### Validation & tests
- `scripts/validate.mjs` — read `plugins.yaml`, traverse `plugins[]` for cross-reference checks. The validator currently ensures every `bundles[]` reference in mcp/skill resolves to a real bundle slug; the same logic applies after rename.
- `e2e/mobile-menu.spec.ts` — change `bundles` link assertions to `plugins`.

#### Docs
- `CONTRIBUTING.md` — YAML examples and walkthrough text.
- `README.md` — table of pages, project structure tree, "Solution Bundles" mentions.
- `CLAUDE.md` — same.

#### Redirects
- New file: `public/_redirects` (Cloudflare Pages convention; copied verbatim into `dist/`).
  ```
  /bundles/* /plugins/:splat 301
  /bundles  /plugins  301
  ```
- This preserves SEO and any external links shared before the rename.

### English Text Mapping
| Before | After |
|---|---|
| `Solution Bundles` | `PlugIns` |
| `Bundles` (nav, footer) | `PlugIns` |
| `bundles available` | `plugins available` |
| `View Bundle` | `View PlugIn` |
| `View all bundles` | `View all plugins` |
| `View Bundles` | `View PlugIns` |
| `pre-packaged solutions` | (unchanged) |

### Chinese Text
All `lang-zh` strings (`解決方案套件`, `解決方案`, `方案`, `個方案可用`, `查看方案`, `查看解決方案`, `預打包解決方案`, etc.) remain exactly as-is.

### Verification
- `npm run validate` passes (new schema/data file paths).
- `npm run build` produces 357 pages — same count, same slugs, just `/plugins/` paths instead of `/bundles/`.
- `npx playwright test` passes (mobile menu test sees `plugins` link).
- Manual smoke: visit `/plugins/`, click into a plugin detail, switch language, verify both EN and ZH render correctly.

---

## Task 3 — Bilingual OG Image Generation

### Goal
Replace the existing single-language `public/og-image.png` with two bright-mode images at the social-share standard size, generated by a repeatable script.

### Strategy
- Single canonical template (HTML/CSS) drives both language outputs to keep them visually identical except for text.
- Default to ZH (the primary audience is Taiwan), with the EN file available for future i18n routes.
- Use Playwright (already a project dependency) to render the template and screenshot it. No new npm dependencies.

### Files to Create
- `scripts/og-template.html` — 1200×630 vanilla HTML+CSS template that mirrors the bright-mode preview from `reference/Logodesign&OgImage/src/app/components/OGImageGenerator.tsx`. Reads `?lang=en` or `?lang=zh` from the URL search params at script-load time and swaps text content via `data-lang` attributes.
- `scripts/generate-og.mjs` — Node ESM script that:
  1. Resolves the template's absolute file URL.
  2. Launches Playwright Chromium headless.
  3. For each language (`en`, `zh`):
     - Creates a context with `viewport: { width: 1200, height: 630 }` and `deviceScaleFactor: 2`.
     - Navigates to `file://.../og-template.html?lang=<lang>`.
     - Awaits `document.fonts.ready`.
     - Captures `page.screenshot({ path: 'public/og-image-<lang>.png', omitBackground: false })`.
  4. Closes the browser, prints output paths and file sizes.

### Files to Delete
- `public/og-image.png` (current single-language file).
- `public/og-image.svg` (unused SVG that lived alongside the PNG).

### Visual Specification (Bright Mode)
Lifted from `OGImageGenerator.tsx` and the existing `reference/yggdrisal-og-image.png`:

- **Canvas:** 1200×630, `linear-gradient(135deg, #0d9488, #0f766e, #134e4a)` (teal-600 → teal-700 → teal-900).
- **Decorative layer (low-opacity white):**
  - 3 large outline circles (top-right, bottom-left, mid-left).
  - 2 triangle outlines (top-right area, bottom-right area).
  - 1 hexagon outline (mid-center).
  - 40px grid pattern across full canvas.
  - 30px dot grid across full canvas.
  - Diagonal line cluster (bottom-left).
  - All decorations use `rgba(255,255,255, 0.04~0.15)`.
- **Top-left brand badge:** white-tinted pill (`background: rgba(255,255,255,0.15)`, `border: 1px rgba(255,255,255,0.2)`, `border-radius: 100px`), 12×20 padding, with a small white dot and the text:
  - EN: `Asgard AI Product Suite`
  - ZH: `Asgard AI 產品系列`
- **Left content block (left: 80px, top: 140px, width: 580px):**
  - Subtitle pill: `OPENSOURCE GALLERY` (uppercase, both languages — this is a fixed brand label).
  - Title H1: `Yggdrasil` (white, 68px, weight 900, both languages).
  - Divider: 80×4 white bar, 28px below title.
  - Tagline (white, 30px, weight 600):
    - EN: `Open Source Gallery Platform`
    - ZH: `開源專案展示平台`
  - Description (white 85% opacity, 20px, weight 400):
    - EN: `World Tree connecting nine realms — showcasing open source projects and innovations`
    - ZH: `世界樹連接九界，展示開源專案與創新成果`
- **Right logo block (right: 80px, top: 175px):**
  - Glass-card frame: `background: rgba(255,255,255,0.1)`, `border: 2px rgba(255,255,255,0.2)`, `border-radius: 30px`, `padding: 50px`, `box-shadow: 0 20px 60px rgba(0,0,0,0.2)`.
  - Inside: inline SVG copy of `public/icons/yggdrasil-logo.svg` rendered at 240×240 with white fill (variant=white).

### Font
- `Space Grotesk` from Google Fonts, loaded inline in the template `<head>` so Playwright can wait on `document.fonts.ready`.

### BaseLayout Integration
- Default `ogImage` prop value: `'/og-image-zh.png'` (ZH default per Taiwan-first audience).
- Update `<meta property="og:image:width" content="1200" />` and `<meta property="og:image:height" content="630" />` (currently `2438`/`1272`).
- Add a code comment explaining that future ZH routes can override via the `ogImage` prop, e.g. `ogImage="/og-image-en.png"`.

### package.json
- Add script: `"og": "node scripts/generate-og.mjs"`.

### Verification
- `npm run og` produces `public/og-image-en.png` and `public/og-image-zh.png` (~150KB each).
- Visual diff: `og-image-zh.png` should look essentially identical to `reference/yggdrisal-og-image.png` (allowing for minor anti-alias differences).
- Open `dist/index.html` after `npm run build` and confirm `<meta property="og:image">` points to `/og-image-zh.png` with width/height `1200`/`630`.
- Test in [opengraph.xyz](https://www.opengraph.xyz) once deployed (manual, post-merge).

### Why Playwright Instead of Other Options
- The reference React project requires installing ~600 packages just to render two images — overkill.
- Satori/sharp would add new dependencies.
- Playwright is already installed for e2e tests, supports headless Chromium, and writes PNGs at any DPR.
- The script becomes a long-lived utility: future product or page additions can render OG images by adding entries to `og-template.html`.

---

## Cross-Task Execution Order

Tasks are independent in subject matter but share files. Recommended order:

1. **Task 1 (Fyrer removal)** — smallest blast radius, gives a clean baseline.
2. **Task 2 (Bundle → PlugIn rename)** — touches the most files; running it after Task 1 means fewer merge conflicts inside `bundles.yaml` / soon-to-be `plugins.yaml`.
3. **Task 3 (OG image generation)** — touches `BaseLayout.astro` and `public/`, no overlap with the rename. Can technically run in parallel with Task 1, but sequencing avoids context-switching.

After all three: one full validation run (`npm run validate && npm run build && npx playwright test && npm run og`) to confirm a clean state.

---

## Out of Scope
- Adding ZH-only or EN-only routes (`/zh/...`). The OG image i18n design leaves room for it but does not implement it.
- Changing the visual design of the OG image beyond what reference already specified.
- Adding new bundles/PlugIns or new MCP servers.
- Modifying the `Header`/`Footer`/`Hero` visual layout.
- Touching anything inside `reference/`.
