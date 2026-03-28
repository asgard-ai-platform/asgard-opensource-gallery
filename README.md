# Yggdrasil -- Asgard Open Source Gallery

**Live:** [https://hub.asgard-ai.com](https://hub.asgard-ai.com)

Yggdrasil is a static gallery showcasing every MCP Server, SKILL, and Solution Bundle in the [Asgard AI Platform](https://github.com/asgard-ai-platform) ecosystem. All content is driven by YAML data files -- community contributors add or update entries via pull requests.

The site is fully bilingual (English / Traditional Chinese) with a client-side language toggle.

## At a Glance

| | Count |
|---|---|
| MCP Servers | 63 |
| SKILLs | 277 |
| Solution Bundles | 10 |
| Static Pages | 357 |

## What Is This?

**MCP Servers** -- Model Context Protocol connectors that expose third-party APIs (e-commerce, payments, analytics, government data, and more) as tool interfaces for AI agents.

**SKILLs** -- Reusable knowledge units encoding domain expertise: industry practices, methodologies, theories, and algorithms. Four types: Industry, Methodology, Theory, Algorithm.

**Solution Bundles** -- Pre-packaged combinations of MCP Servers and SKILLs for specific business scenarios, each mapping to an Asgard commercial product.

**Asgard AI Solution** -- A dedicated page showcasing the commercial product ecosystem: Mimir (AI Brain), Sindri (Agent Hub), Odin (Studio), and Heimdall (PR AI).

## Quick Start

```bash
# Clone
git clone git@github.com:asgard-ai-platform/asgard-opensource-gallery.git
cd asgard-opensource-gallery

# Install
npm install

# Develop
npm run dev           # http://localhost:4321

# Build & Preview
npm run build         # 357 static pages to dist/
npm run preview       # Preview production build

# Validate YAML data
npm run validate

# Run e2e tests (requires preview server running)
npx playwright test
```

## Tech Stack

| Component | Technology |
|---|---|
| Static Site Generator | [Astro 5](https://astro.build) |
| Styling | [Tailwind CSS 3](https://tailwindcss.com) |
| Font | [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) |
| Data Format | YAML |
| Schema Validation | [Ajv](https://ajv.js.org) (JSON Schema) |
| E2E Tests | [Playwright](https://playwright.dev) |
| Hosting | [Cloudflare Pages](https://pages.cloudflare.com) |
| CI/CD | GitHub Actions |

## Project Structure

```
asgard-opensource-gallery/
├── data/                    # YAML data (MCP Servers, SKILLs, Bundles)
├── schemas/                 # JSON Schema for YAML validation
├── src/
│   ├── components/          # 12 Astro components
│   ├── layouts/             # BaseLayout with SEO + i18n
│   ├── pages/               # 10 route pages (357 static outputs)
│   ├── styles/              # Global CSS (design tokens, i18n rules)
│   ├── types.ts             # TypeScript interfaces
│   └── utils/               # YAML data loader
├── public/
│   ├── icons/               # SVG logos
│   └── screenshots/         # Product screenshots (Ecosystem page)
├── scripts/                 # Validation + deploy scripts
├── e2e/                     # Playwright e2e tests (45 tests)
└── .github/workflows/       # CI/CD (validate + deploy)
```

## Pages

| Route | Description |
|---|---|
| `/` | Homepage with hero, stats, featured projects, ecosystem diagram |
| `/mcp/` | MCP Server list with sidebar filters and search |
| `/mcp/{slug}/` | MCP Server detail (63 pages) |
| `/skills/` | SKILL list with sidebar filters, skill type filter, and search |
| `/skills/{slug}/` | SKILL detail (277 pages) |
| `/bundles/` | Solution Bundle list |
| `/bundles/{slug}/` | Bundle detail with dependency graph (10 pages) |
| `/ecosystem/` | Asgard AI Solution -- Mimir, Sindri, Odin, Heimdall |
| `/contribute/` | Contribution guide with YAML templates |

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for YAML templates, naming conventions, and the PR checklist.

## License

MIT -- see [LICENSE](LICENSE).
