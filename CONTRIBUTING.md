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
    upgrade_to: Fyrer                    # Optional. Commercial product name
    bundles:                             # Optional. Bundle slug(s) this belongs to
      - bundle-slug
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
    upgrade_to: Fyrer                    # Optional. Commercial product name
    bundles:                             # Optional. Bundle slug(s)
      - bundle-slug
    icon: your-skill.svg                 # Optional. Icon in public/icons/
    maintainer: your-github-handle       # Optional. GitHub username
```

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
