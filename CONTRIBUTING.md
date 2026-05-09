# Contributing to Yggdrasil

Thank you for your interest in contributing to the Asgard Open Source Gallery! This guide explains how to add new entries, improve existing content, and submit your changes.

## What You Can Contribute

- **New MCP Server entry** -- Add a YAML entry for an MCP Server connector
- **New SKILL entry** -- Add a YAML entry for a reusable knowledge SKILL
- **Improve descriptions** -- Fix typos, improve wording, or add missing translations
- **Report bugs** -- Open an issue if you find problems with the website or data

## How to Contribute

### Step 1: Fork and Clone

```bash
git clone https://github.com/<your-username>/asgard-opensource-gallery.git
cd asgard-opensource-gallery
npm install
```

### Step 2: Add Your Entry

Add your entry to the appropriate YAML file in the `data/` directory.

### Step 3: Validate and Submit

```bash
# Validate your changes locally
npm run validate

# Commit and push
git add data/
git commit -m "feat: add mcp-<service-name>"
git push origin main

# Open a Pull Request on GitHub
```

CI will automatically validate your YAML against the schema when you open the PR.

---

## MCP Server YAML Template

Add your entry to `data/mcp-servers.yaml` under the `servers:` list:

```yaml
  - slug: mcp-your-service              # Required. URL-safe, unique identifier
    name: "Your Service"                 # Required. Display name
    description:                         # Required. Bilingual description
      en: "MCP Server for Your Service, providing API access to..."
      zh: "Your Service 的 MCP Server，提供 API 存取..."
    status: released                     # Required: released | coming-soon | planned
    category: ecommerce                  # Required. See category list below
    region: global                       # Required: global | taiwan | sea | japan
    github: https://github.com/asgard-ai-platform/mcp-your-service  # Required
    tools_count: 12                      # Optional. Number of tools (released only)
    tags:                                # Optional
      - your-tag
    upgrade_to: Sindri                   # Optional. Commercial product name
    plugins:                             # Optional. PlugIn slug(s) this belongs to
      - plugin-slug
    api_docs: https://docs.example.com   # Optional. Original API documentation
    icon: your-service.svg               # Optional. Icon in public/icons/
    maintainer: your-github-handle       # Optional. GitHub username
```

## SKILL YAML Template

Add your entry to `data/skills.yaml` under the `skills:` list:

```yaml
  - slug: skill-domain-task              # Required. Unique identifier
    name: "Your SKILL Name"             # Required. Display name
    description:                         # Required. Bilingual description
      en: "Automated analysis that..."
      zh: "自動化分析..."
    status: released                     # Required: released | coming-soon | planned
    category: analytics                  # Required. See category list below
    skill_type: industry                 # Required: industry | methodology | theory | algorithm
    region: global                       # Required: global | taiwan | sea | japan
    github: https://github.com/asgard-ai-platform/skills/tree/main/skill-domain-task  # Required
    requires_mcp:                        # Optional. MCP Server slugs this SKILL depends on
      - mcp-some-service
    has_script: true                     # Optional. Whether this SKILL includes an executable script
    tags:                                # Optional
      - your-tag
    upgrade_to: Sindri                   # Optional. Commercial product name
    plugins:                             # Optional. PlugIn slug(s)
      - plugin-slug
    icon: your-skill.svg                 # Optional. Icon in public/icons/
    maintainer: your-github-handle       # Optional. GitHub username
```

## Status Lifecycle for MCP Servers

The `status` field on each MCP entry has three values, used like this:

| Status | When | What appears on the site |
|---|---|---|
| `planned` | Idea exists, no repo yet (or repo is private) | Card with "planned" badge, no detail content |
| `coming-soon` | Repo exists; not yet on PyPI; README may be incomplete | Card with "coming-soon" badge, no detail content |
| `released` | Published on PyPI under the slug name | Full detail page with content synced from `README.md` |

### How an entry moves through the lifecycle

1. **planned → coming-soon** — open a PR adding the YAML entry with
   `status: coming-soon` once you start implementing. You can list a
   private repo URL.
2. **coming-soon → released** — once `pip install <your-mcp-slug>`
   actually works on PyPI, this is **automated**:
   - The weekly **sync workflow** (Sunday 18:00 UTC) detects published
     packages, flips `status: coming-soon` → `status: released` in
     `data/mcp-servers.yaml`, fetches the README content, and opens the
     rolling sync PR (`chore/sync-gallery-content`).
   - The daily **audit workflow** also detects candidates and posts a
     "Candidate for promotion" line on this repo's tracking issue — a
     visibility signal so you know what's coming before the next sync.
   - You can still flip status manually in a PR if you don't want to
     wait until Sunday.

### What `released` requires

The single hard requirement is:

- The package is published on PyPI under the slug name (e.g.,
  `mcp-shopline` ↔ `pip install mcp-shopline`).

The daily audit additionally checks `pyproject.toml` metadata, README
structure (against the `mcp-shopline` golden sample), and a few other
quality signals. **Findings on these checks are advisory — they do NOT
block `released` status.** The audit opens a tracking issue on each MCP
repo with whatever it found; maintainers fix and close at their own pace.

The rationale: blocking the gallery from showing a working, installable
MCP because of a missing badge or section would be net-negative for users.

### Where to look for the audit findings

- **Per MCP repo:** `[yggdrasil-audit] Gallery sync report` issue (label
  `yggdrasil-audit`). One rolling issue per repo, edited on each daily
  audit run. Close manually once findings are resolved.
- **Gallery repo (this one):** A single rolling issue collecting orphan
  YAML entries (upstream gone) and promotion candidates (PyPI now
  available).

## Categories

| Value | Description |
|---|---|
| `ecommerce` | E-commerce platforms |
| `payment` | Payment and billing |
| `analytics` | Data analytics |
| `communication` | Messaging and notifications |
| `data` | Data sources |
| `crm` | Customer relationship management |
| `restaurant` | Restaurant and hospitality |
| `gov` | Government open data |
| `marketing` | Marketing |
| `finance` | Finance and investment |
| `manufacturing` | Manufacturing and IoT |
| `ops` | Operations management |
| `customer-service` | Customer service |
| `media` | Media and public relations |
| `methodology` | Methodologies |
| `theory` | Theoretical frameworks |
| `algorithm` | Algorithms |

## Naming Conventions

- **MCP Servers:** `mcp-{service-name}` (e.g., `mcp-shopline`, `mcp-ecpay`)
- **SKILLs:** `skill-{domain}-{task}` (e.g., `skill-ecom-order-insight`, `skill-rfm-analysis`)
- **Taiwan local services:** Include the `taiwan` tag in your tags list and set `region: taiwan`

## PR Checklist

Before submitting your pull request, please verify:

- [ ] YAML syntax is valid (run `npm run validate` locally)
- [ ] `slug` is unique and follows naming conventions
- [ ] Description includes both `en` and `zh` fields
- [ ] `status` is one of: `released`, `coming-soon`, `planned`
- [ ] `category` is a valid value from the category table above
- [ ] `region` is one of: `global`, `taiwan`, `sea`, `japan`
- [ ] For SKILLs: `skill_type` is one of: `industry`, `methodology`, `theory`, `algorithm`
- [ ] `github` URL points to a valid repository or directory

## Automated Validation

Every pull request that modifies files in `data/` triggers a GitHub Actions workflow that validates all YAML entries against their JSON Schema definitions. Your PR must pass validation before it can be merged.

You can run the same validation locally:

```bash
npm run validate
```

This checks:
- YAML syntax correctness
- Required fields are present
- Field values match the expected types and enums
- Slug uniqueness across all entries
