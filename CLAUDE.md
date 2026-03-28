# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Yggdrasil** is a static open-source gallery site for the Asgard AI Platform ecosystem. It showcases 63 MCP Servers, 277 SKILLs, and 10 Solution Bundles, plus an Asgard AI Solution (Ecosystem) page describing the commercial product suite. All catalog content is YAML-driven; community contributors add entries via PRs.

- **Repo:** `asgard-ai-platform/asgard-opensource-gallery`
- **Domain:** `hub.asgard-ai.com`
- **License:** MIT

## Tech Stack

- **SSG:** Astro 5 (static output, zero JS by default)
- **Styling:** Tailwind CSS 3 with `@astrojs/tailwind`
- **Font:** Space Grotesk (Google Fonts, loaded via CSS)
- **Data:** YAML files in `data/` validated against JSON Schema via Ajv
- **Deployment:** AWS S3 + CloudFront, auto-deployed via GitHub Actions
- **Language:** TypeScript
- **E2E Tests:** Playwright (Chromium)

## Commands

```bash
npm run dev          # Dev server at localhost:4321
npm run build        # Build static site to dist/ (357 pages)
npm run preview      # Preview production build locally
npm run validate     # YAML schema validation
npx playwright test  # Run e2e tests (requires preview server on :4321)
```

## Architecture

```
data/
  mcp-servers.yaml          # 63 MCP Server entries
  skills.yaml               # 277 SKILL entries
  bundles.yaml              # 10 Solution Bundle entries
schemas/                    # JSON Schema for YAML validation
scripts/
  validate.mjs              # CI validation script (Ajv)
  deploy.sh                 # Manual S3 deploy script
src/
  types.ts                  # Shared TypeScript interfaces + constants
  utils/data-loader.ts      # YAML parsing, sorting, lookup functions
  styles/global.css         # Tailwind base + Space Grotesk + design tokens + i18n CSS
  layouts/BaseLayout.astro  # HTML shell with SEO meta, header, footer, i18n script
  components/
    Header.astro            # Sticky header, gradient logo, nav-underline, language toggle, mobile sidebar
    Footer.astro            # Centered gradient branding
    Hero.astro              # Homepage hero with animated glows, gradient text, stats
    StatsBar.astro          # Gradient stat cards (MCP/SKILL/Bundle counts)
    McpCard.astro           # MCP card with gradient header, data-* attrs for filtering
    SkillCard.astro         # SKILL card with type-colored gradient header
    BundleCard.astro        # Bundle card with MCP/SKILL counts
    FilterBar.astro         # Sticky sidebar filter (search, status, region, category, skill type) + client-side JS
    StatusBadge.astro       # Released/coming-soon/planned pill badges
    CardGrid.astro          # Responsive grid wrapper
    UpgradeCTA.astro        # Commercial upgrade callout
    BundleGraph.astro       # SVG dependency graph (MCP <-> SKILL)
  pages/
    index.astro             # Homepage
    ecosystem.astro         # Asgard AI Solution page (Mimir/Sindri/Odin/Heimdall)
    mcp/index.astro         # MCP list with sidebar filters
    mcp/[slug].astro        # MCP detail (63 pages)
    skills/index.astro      # SKILL list with sidebar filters + skill type
    skills/[slug].astro     # SKILL detail (277 pages)
    bundles/index.astro     # Bundle list
    bundles/[slug].astro    # Bundle detail with dependency graph
    contribute.astro        # Contribution guide
    404.astro               # Error page
public/
  icons/                    # SVG logos (asgard-logo.svg, yggdrasil-logo.svg)
  screenshots/              # Product screenshots (Mimir, Sindri, Odin)
e2e/                        # Playwright e2e tests (45 tests)
.github/workflows/
  validate.yml              # PR validation on data/** changes
  deploy.yml                # Auto-deploy on push to main
```

## i18n System

Client-side language toggle (EN/ZH-TW):
- `<html data-lang="en">` attribute controls active language
- CSS rules: `[data-lang="en"] .lang-zh { display: none }` and inverse
- All UI text uses `<span class="lang-en">...</span><span class="lang-zh">...</span>` pairs
- YAML descriptions already have `en` and `zh` fields — cards render both with lang classes
- Language preference stored in `localStorage` key `ygg-lang`
- Restored early in `<head>` to prevent flash

## Design System

- **Primary:** `#4ade80` (green) — used for accents, links, badges, CTAs
- **Background:** `#020306` (near-black) / Card: `#0a0d12` / Accent: `#1a1d24`
- **Text:** `#e8f5e9` (foreground) / `#86a68a` (muted)
- **Border:** `rgba(74, 222, 128, 0.12)` (subtle green)
- **Status:** released=green, coming-soon=yellow, planned=gray

**CSS utility classes** (defined in global.css):
- `.text-gradient` — green-to-cyan gradient text
- `.btn-gradient` — green-to-cyan gradient button
- `.glass-card` — backdrop-blur card with border
- `.nav-underline` — animated underline on hover
- `.card-hover` — lift + glow shadow on hover
- `.bg-grid` — subtle grid background pattern

## Data Model

Three entity types with cross-references:

- **McpServer**: `slug`, `name`, `description` (en/zh), `status`, `category`, `region`, `github`, optional `tools_count`, `upgrade_to`, `bundles[]`
- **Skill**: Same as MCP + `skill_type` (industry/methodology/theory/algorithm), `requires_mcp[]`, `has_script`
- **Bundle**: Groups MCPs + SKILLs, always has `upgrade_to` commercial product

Status: `released` | `coming-soon` | `planned`
Region: `global` | `taiwan` | `sea` | `japan`
Categories: ecommerce, payment, analytics, communication, data, crm, restaurant, gov, marketing, finance, manufacturing, ops, customer-service, media, methodology, theory, algorithm

## Key Patterns

- **FilterBar** uses client-side vanilla JS with `data-*` attributes on cards for filtering. Cards include `data-slug` for slug-based search matching.
- **Sidebar** is `lg:sticky lg:top-24 lg:self-start` with `lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto`.
- **Mobile menu** overlay and sidebar are rendered **outside** `<header>` to avoid stacking context issues. Z-index: overlay `z-[60]`, sidebar `z-[70]`.
- **Ecosystem page** has its own image gallery JS with auto-rotation and dot navigation. Gallery uses `display:flex + flex:1` chain for height propagation.
- **Build** generates 357 static pages (1 home + 1 ecosystem + 2 list + 340 detail + 10 bundle detail + 1 contribute + 1 bundles list + 1 404).

## Naming Conventions

- MCP slugs: `mcp-{service-name}` (lowercase, hyphens)
- SKILL slugs: `skill-{domain}-{task}`
- Bundle slugs: `{region/purpose}-{use-case}`
- Astro components: PascalCase
- Utility functions: camelCase

## Validation (scripts/validate.mjs)

1. YAML syntax
2. JSON Schema conformance (`schemas/`)
3. Unique slugs
4. Cross-reference integrity (bundles, requires_mcp)
5. Icon file existence in `public/icons/`

## E2E Tests

45 Playwright tests in `e2e/` covering:
- Mobile menu (open/close, overlay click, nav links, language toggle, z-index)
- Filter/search (sidebar sticky, search by slug/name, status/region/category/skill-type filters, mobile)
- Ecosystem page (image loading, gallery dimensions, dot navigation, section presence, horizontal scroll)
