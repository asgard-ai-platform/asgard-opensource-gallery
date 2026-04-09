# sync-gallery

Utility scripts for keeping the Yggdrasil gallery YAML data in sync with the actual open-source repos on [github.com/asgard-ai-platform](https://github.com/asgard-ai-platform).

## Prerequisites

- [GitHub CLI (`gh`)](https://cli.github.com/) — authenticated with access to `asgard-ai-platform`
- Python 3.10+ with `pyyaml` (`pip install pyyaml`)

## Scripts

| Script | Purpose |
|--------|---------|
| `audit-github-repos.sh` | Compare GitHub org repos (public/private) against current YAML entries. Reports missing repos, wrong statuses, and count mismatches. |
| `extract-skills-metadata.py` | Clone the `skills` repo and parse each `SKILL.md` frontmatter into a flat JSON file for downstream processing. |
| `generate-skills-yaml.py` | Read the extracted JSON and produce a schema-valid `skills.yaml` with correct slugs, categories, and bilingual descriptions. |

## Quick Start — Full Sync

```bash
# 1. Audit: see what's changed on GitHub vs current YAML
./scripts/sync-gallery/audit-github-repos.sh

# 2. Clone the skills repo (shallow, temporary)
git clone --depth 1 https://github.com/asgard-ai-platform/skills.git /tmp/skills-repo

# 3. Extract metadata from all SKILL.md files → JSON
python3 scripts/sync-gallery/extract-skills-metadata.py /tmp/skills-repo /tmp/skills-data.json

# 4. Generate new skills.yaml from the JSON
python3 scripts/sync-gallery/generate-skills-yaml.py /tmp/skills-data.json data/skills.yaml

# 5. Validate & build
npm run validate
npm run build

# 6. Clean up
rm -rf /tmp/skills-repo /tmp/skills-data.json
```

## Individual Usage

### audit-github-repos.sh

```bash
./scripts/sync-gallery/audit-github-repos.sh
```

Output example:

```
[1/4] Fetching MCP repos from GitHub org: asgard-ai-platform ...
  Public MCP repos:  9
  Private MCP repos: 4

[3/4] Cross-referencing...
  Public repos MISSING from YAML (should add):
    (none)
  Public repos IN YAML but wrong status (should be released):
    (none - all correct)

[4/4] Auditing skills repo...
  Skills repo directories: 263
  Skills YAML entries:     263
  ✅ Counts match
```

### extract-skills-metadata.py

```bash
python3 scripts/sync-gallery/extract-skills-metadata.py <skills-repo-path> [output-json-path]
```

- `skills-repo-path` — local clone of `asgard-ai-platform/skills` (required)
- `output-json-path` — defaults to `/tmp/skills-data.json`

Parses each skill directory's `SKILL.md` frontmatter and extracts:
- `slug` — directory name (e.g. `algo-ad-bidding`)
- `name` — H1 title from the markdown
- `description_en` — from YAML frontmatter `description` field
- `skill_type` / `category` — mapped from the directory prefix
- `tags` — from `metadata.tags`
- `has_script` — `true` if a `scripts/` subdirectory exists

### generate-skills-yaml.py

```bash
python3 scripts/sync-gallery/generate-skills-yaml.py <input-json> [output-yaml]
```

- `input-json` — JSON produced by `extract-skills-metadata.py` (required)
- `output-yaml` — defaults to `data/skills.yaml`

Generates a gallery-schema-valid YAML with:
- `skill-{prefix}-{name}` slug format (matches `^skill-[a-z0-9-]+$` schema pattern)
- Bilingual descriptions (EN from SKILL.md, ZH auto-generated)
- Grouped by prefix with section comment headers
- All entries set to `status: released`

## Notes

- **MCP servers** are updated manually in `data/mcp-servers.yaml` — the audit script identifies which repos need adding/updating but doesn't auto-modify the file.
- **Plugins** (`data/plugins.yaml`) reference both MCP and skill slugs — after regenerating skills, verify cross-references with `npm run validate`.
- The prefix-to-category mapping is defined in both `extract-skills-metadata.py` and `generate-skills-yaml.py`. Keep them in sync if you add new prefixes.
