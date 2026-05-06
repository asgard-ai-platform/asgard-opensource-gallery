---
name: sync-gallery
description: "Update the Yggdrasil gallery from upstream open-source repos under github.com/asgard-ai-platform. Use when new MCPs/skills have been published, when upstream READMEs/SKILL.md have been updated, or when you need to surface inconsistencies (skeleton skills, missing translations, broken cross-refs) for the maintainer to fix. Triggers on '同步 gallery', '更新到網頁', 'sync the gallery', 'pull in new MCPs', 'audit open-source repos'."
metadata:
  category: "Operations"
  tags: ["sync", "gallery", "yaml", "github", "audit"]
  related_mcps: []
  related_skills: []
---

# Sync Gallery from Upstream

> Workflow for keeping `data/mcp-servers.yaml`, `data/skills.yaml`, `data/mcp-content.json`, and `data/skill-content.json` in sync with the public state of `github.com/asgard-ai-platform`.

## Overview

The gallery's data files are the source of truth for what shows up on `vault.asgard-ai.com`. They drift away from upstream state in three ways:

1. **New repos** — public MCP repos or skill directories appear in the org but no YAML entry exists yet, so they get no detail page.
2. **Stale rich content** — `mcp-content.json` / `skill-content.json` cache extracted README/SKILL.md sections at build time. When upstream READMEs change, these caches get stale.
3. **Upstream defects** — skill SKILL.md files marked `metadata.status: "skeleton"`, MCPs missing `README.zh-TW.md`, repo descriptions left empty, broken `metadata.related_mcps` cross-refs. These don't break the build but they degrade the live site.

This workflow handles all three.

## When to Use

- A new MCP or skill repo went public and should show on the site
- Upstream README/SKILL.md was edited and the gallery should reflect it
- You suspect drift between `github.com/asgard-ai-platform` and what's deployed
- Before a release, to confirm the catalog is current
- Triggers: "同步 gallery", "更新到網頁", "sync the gallery", "audit open-source repos"

## When NOT to Use

- Editing a single YAML entry by hand (just edit `data/*.yaml` directly)
- The structure of YAML / JSON Schema needs to change (do that first, then sync)
- Working on UI/styling — none of this touches `src/`
- The repo you want to add is **private** — only public repos sync; private ones must be added manually with `status: coming-soon` or `planned`

## Prerequisites

- `gh` CLI authenticated against an account that can read `asgard-ai-platform/*` (`gh auth status`)
- Node.js 18+ and project deps installed (`npm install`)
- Clean working tree (commit anything in progress first — this workflow modifies tracked files)

## Workflow

### Step 1 — Audit the gap

```bash
bash scripts/sync-gallery/audit-github-repos.sh
```

Reports:
- Public MCP repos missing from YAML or with `status != released`
- `tools_count` mismatches between README and YAML
- Skill directory count vs YAML entry count
- SKILL.md metadata vs YAML metadata mismatches

If the audit shows zero gaps, you're done — skip to Step 5.

### Step 2 — Refresh existing rich content

```bash
node scripts/sync-gallery/sync-mcp-content.mjs
node scripts/sync-gallery/sync-skill-content.mjs
```

These iterate the YAML, fetch the latest `README.md` / `README.zh-TW.md` / `SKILL.md` from each entry's repo, and rewrite:

- `data/mcp-content.json` (intro + sections per MCP, both languages)
- `data/skill-content.json` (overview/framework/gotchas/etc per skill)
- `data/skills.yaml` (`description.en` is back-filled from SKILL.md frontmatter when frontmatter has a richer description than YAML — preserves YAML format with surgical line-replacement, not a full rewrite)

After running these, `git diff data/` shows you what upstream content changed.

### Step 3 — Draft new entries (only if Step 1 found gaps)

```bash
node scripts/sync-gallery/generate-new-entries.mjs
```

Auto-discovers public MCP repos / skill dirs not yet in YAML and writes drafts to `scripts/sync-gallery/_generated/`:

- `new-mcp-entries.yaml` — append-ready YAML block
- `new-skill-entries.yaml` — append-ready YAML block
- `repo-audit-report.md` — issues found in upstream repos (see Error Report below)

The script uses heuristics for `category` / `region` / `skill_type` based on slug prefix and frontmatter keywords. **Always review before appending** — fix any wrong category, tweak `nameZh`, etc.

### Step 4 — Append, validate, sync, build

```bash
# Append the drafted blocks to the data files
cat scripts/sync-gallery/_generated/new-mcp-entries.yaml >> data/mcp-servers.yaml
cat scripts/sync-gallery/_generated/new-skill-entries.yaml >> data/skills.yaml

# Validate schema, slug uniqueness, cross-references
npm run validate

# Re-run sync to pull rich content for the newly added entries
node scripts/sync-gallery/sync-mcp-content.mjs
node scripts/sync-gallery/sync-skill-content.mjs

# Confirm site builds and page count grew as expected
npm run build
```

If `npm run validate` fails on cross-references (e.g. `requires_mcp` points to a non-existent slug), fix the offending YAML entry and re-validate. The generate script *should* filter unknown MCP slugs from `requires_mcp`, but new MCPs added in the same batch aren't visible to `validate.mjs` until both blocks are appended.

### Step 5 — Commit + push

```bash
git add data/ .gitignore  # only data/ usually; .gitignore changes rarely
git commit -m "feat: sync N new MCPs and M new skills from upstream"
git push origin main
```

The deploy GitHub Action picks up the push and rebuilds Cloudflare Pages.

## Output Format

The audit report (`scripts/sync-gallery/_generated/repo-audit-report.md`) groups issues by repo. Surface this back to the open-source maintainers — these are upstream defects that need fixing in the source repos, not workarounds in this gallery.

Issue categories:

| Issue | Where to fix |
|---|---|
| `tools_count not parseable from README` | Add `**N AI-callable tools**` or `N MCP tools` line to upstream MCP README |
| `README.zh-TW.md missing` | Add Chinese README to MCP repo |
| `GitHub repo description is empty` | Set repo description on github.com (Settings → About) |
| `metadata.status="skeleton"` | Finish writing SKILL.md sections |
| `frontmatter metadata.tags missing` | Add `metadata: { tags: [...] }` to SKILL.md frontmatter |
| `metadata.related_mcps references unknown slug(s)` | Fix the slug in SKILL.md or add the MCP to YAML |
| `SKILL.md has no H1 heading` | Add `# Title` after frontmatter |

## Gotchas

- **The `gh` CLI uses *your* credentials.** If you don't have read access to a private repo, the script silently fails the fetch and treats the repo as missing. Run `gh auth status` first.
- **Skeleton skills get `status: coming-soon`, not `released`.** This is deliberate — published skeleton skills have no useful content, and surfacing them as released would mislead users. The detail page still renders, just behind the "coming-soon" badge.
- **Heuristic fields are guesses.** `category`, `region`, `skill_type`, and Chinese names from the generate script are heuristic-derived. Review the YAML diff before committing — wrong category breaks filter UX.
- **`audit-github-repos.sh` clones the skills repo shallowly** for Step 5. On a slow network or if the repo is large, this can take 30+ seconds. The script cleans up the clone on exit.
- **The `_generated/` directory is gitignored.** Don't commit drafts. Once appended to YAML, they live in `data/*.yaml` as the canonical source.
- **Rebase before pushing.** This repo gets pushes from CI maintainers occasionally (e.g. workflow tweaks). Always `git pull --rebase origin main` before `git push` if your local main is behind.
- **Status drift on existing entries.** If an upstream skill's `metadata.status` flips from `skeleton` → fully-written, the sync script does NOT auto-promote `coming-soon` → `released` in YAML. That's deliberate to avoid surprising flips. Update YAML by hand.
- **Don't run on a dirty working tree.** Step 2's `sync-skill-content.mjs` does a surgical line-replace on `data/skills.yaml`. If your local YAML had un-staged edits, they may collide with the auto-update. Commit or stash first.

## Examples

### Routine refresh (no new entries)

```bash
bash scripts/sync-gallery/audit-github-repos.sh
# → "All public repos correctly marked as released" + count match

node scripts/sync-gallery/sync-mcp-content.mjs
node scripts/sync-gallery/sync-skill-content.mjs

git diff --stat data/
# → only mcp-content.json / skill-content.json changed (or nothing)

npm run build && git add data/ && git commit -m "chore: refresh gallery content from upstream"
git push
```

### New entries detected

```bash
bash scripts/sync-gallery/audit-github-repos.sh
# → "PUBLIC repo mcp-foo is NOT in YAML (should add)"
# → "New skills in GitHub (not in YAML): + bar-baz"

node scripts/sync-gallery/generate-new-entries.mjs
# → "1 MCP entries, 1 skill entries"

# Review the drafts
$EDITOR scripts/sync-gallery/_generated/new-mcp-entries.yaml
$EDITOR scripts/sync-gallery/_generated/new-skill-entries.yaml

cat scripts/sync-gallery/_generated/new-mcp-entries.yaml >> data/mcp-servers.yaml
cat scripts/sync-gallery/_generated/new-skill-entries.yaml >> data/skills.yaml
npm run validate
node scripts/sync-gallery/sync-mcp-content.mjs
node scripts/sync-gallery/sync-skill-content.mjs
npm run build

git add data/ && git commit -m "feat: add 1 MCP + 1 skill from upstream"
git push
```

### Upstream-issues report only (no sync)

```bash
node scripts/sync-gallery/generate-new-entries.mjs
cat scripts/sync-gallery/_generated/repo-audit-report.md
# → list of issues per repo, copy/paste into Slack or a Linear ticket
```

## References

- Project layout: `CLAUDE.md` (root)
- Schema definitions: `schemas/`
- Validation logic: `scripts/validate.mjs`
- YAML data: `data/mcp-servers.yaml`, `data/skills.yaml`, `data/plugins.yaml`
