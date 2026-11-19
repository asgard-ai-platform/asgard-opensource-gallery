---
name: sync-gallery
description: "Operate and troubleshoot the Yggdrasil gallery sync/audit automation, or run it by hand. The gallery mirrors upstream open-source repos under github.com/asgard-ai-platform. Use when new MCPs/skills have been published, when upstream READMEs/SKILL.md have been updated, when a scheduled sync/audit run failed or stopped running, or when you need to surface upstream defects (skeleton skills, missing translations, broken cross-refs). Triggers on '同步 gallery', '更新到網頁', 'sync the gallery', 'pull in new MCPs', 'audit open-source repos', 'gallery workflow failed'."
metadata:
  category: "Operations"
  tags: ["sync", "gallery", "yaml", "github", "audit", "github-actions"]
  related_mcps: []
  related_skills: []
---

# Sync Gallery from Upstream

> Runbook for keeping `data/mcp-servers.yaml`, `data/skills.yaml`, `data/plugins.yaml` and their content sidecars (`data/mcp-content.json`, `data/skill-content.json`, `data/pack-content.json`) in sync with `github.com/asgard-ai-platform`. Most of this runs automatically in GitHub Actions; this file describes what the automation does, how to run the same steps by hand, and how to recover when it breaks.

## Overview

The gallery's data files are the source of truth for what shows up on `vault.asgard-ai.com`. They drift away from upstream state in three ways:

1. **New repos.** New `mcp-*` repos or skill directories appear in the org but have no YAML entry yet, so they get no detail page.
2. **Stale rich content.** The content sidecars cache README / SKILL.md / pack manifest sections. When upstream changes, the cache is stale until the next sync.
3. **Upstream defects.** Skill SKILL.md files marked `metadata.status: "skeleton"`, MCPs missing `README.zh-TW.md`, empty repo descriptions, README format or packaging gaps, broken `metadata.related_mcps` cross-refs. These don't break the build, but they degrade the live site.

The weekly sync workflow handles 1 (MCPs only) and 2. The daily audit workflow reports 3, plus new skills, which need human review.

Not every defect is re-checked every day:

- **Re-checked on every audit:** README format, packaging and PyPI for `released` MCPs; boilerplate names/descriptions on `released` MCPs; orphaned entries across the catalog.
- **Checked only at discovery time:** skill SKILL.md checks (skeleton status, missing tags, broken `related_mcps`, missing H1), and MCP repo checks (empty description, missing `README.zh-TW.md`, unparseable `tools_count`). These run only for repos or directories not yet in YAML, so a regression in an already-listed entry is not reported.

## Automation

All four workflows live in `.github/workflows/`. Every job runs on Node 22.

| Workflow | Trigger | What it does |
|---|---|---|
| `validate.yml` | Every pull request, including fork PRs | `npm ci` → `npm run validate` → `npm run test:scripts` → `npm run build`. It uses a read-only token and no secrets. |
| `sync-content.yml` | Cron `0 18 * * 0` (Mon 02:00 Taiwan), or manual | Discovers new MCPs, promotes and refreshes MCP entries, and syncs content (step list below). Then it runs the threshold check, validate and build. If `data/` changed, it commits and pushes to `main` as the sync GitHub App, which triggers `deploy.yml`. If nothing changed, it exits without a commit or deploy. |
| `audit-content.yml` | Cron `0 19 * * *` (daily 03:00 Taiwan); cron `17 5 * * 1` (Mon 13:17 Taiwan, weekly digest run); manual | Runs the read-only audit (step list below). It updates per-repo tracking issues, uploads the report artifact, and on the weekly run posts a Slack digest. |
| `deploy.yml` | Push to `main` / `develop` that touches `data/`, `src/`, `public/`, `astro.config.mjs`, `tailwind.config.mjs`, `tsconfig.json`, `package.json`, `package-lock.json` or `deploy.yml` itself | `npm run build` → Cloudflare Pages (`develop` deploys to the `-dev` project). Pushes touching only scripts, docs or other workflows do not deploy. |

Sync steps, in order:

1. `discover-new-mcps.mjs`: appends a `coming-soon` stub for every `mcp-*` repo, public or private, that is missing from YAML. `mcp-template` is deliberately excluded.
2. `promote-candidates.mjs`: flips `coming-soon` → `released` when all of these hold: the repo is public, a slug-named package exists on PyPI, and that package's homepage or project URLs point back to `github.com/asgard-ai-platform/<slug>`. The URL check guards against name-squatted packages. If a promotion does not happen, check the PyPI package metadata.
3. `refresh-boilerplate-descriptions.mjs`: for `released` entries only, rewrites names and descriptions still holding discovery-time boilerplate, using the now-public README. `coming-soon` entries keep their stub text until they are promoted.
4. `sync-mcp-content.mjs`, `sync-skill-content.mjs`, `sync-pack-content.mjs`: refresh the content sidecars. `sync-skill-content.mjs` also back-fills a richer `description.en` into `skills.yaml`.
5. `check-sync-thresholds.mjs`: fails the job if `mcp-content.json` has keys for fewer than 80% of the `released` MCPs, or `skill-content.json` for fewer than 80% of the skills. Carried-over content counts as covered, so this catches mass fetch failures on entries that had no cached content (e.g. token expiry), not stale content. Pack content is not checked.

Audit steps, in order:

1. `discover-new-skills.mjs`: drafts new skill entries and **rewrites the report**, which is why it runs first.
2. `discover-new-mcps.mjs` (report-only)
3. `audit-pypi.mjs`
4. `audit-readme-format.mjs`
5. `refresh-boilerplate-descriptions.mjs` (report-only)
6. `audit-orphans.mjs`
7. `post-audit-issues.mjs`
8. `post-slack-digest.mjs`

### Secrets

- `SYNC_APP_ID` / `SYNC_APP_PRIVATE_KEY`: the GitHub App used by sync and audit. It needs cross-org Contents:Read, Issues:Write (audit), and Contents:Write on this repo (sync push).
- `SLACK_WEBHOOK_URL`: the Incoming Webhook for the weekly digest. If it is unset, the digest step logs a warning and passes.
- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`: deploy.

### Weekly Slack digest

The Monday 05:17 UTC run posts a summary of the audit report. It includes totals, counts per type, the gallery/skills-level findings (up to 10 per group, then "…and N more"), the top 10 MCP repos by finding count, and links to the run artifact and the open tracking issues. The digest must land before the Monday 21:30 (Taiwan) weekly meeting, and scheduled runs in this repo have started up to ~7.4 h late, so do not move the cron later without re-checking that delay. The schedule string is duplicated in the step's `if:`; change both together. To post one immediately:

```bash
gh workflow run audit-content.yml -f slack_digest=true   # also runs the full audit and updates issues
```

### Audit tracking issues

`post-audit-issues.mjs` opens an issue (labelled `yggdrasil-audit`) on each repo that has findings, and on later runs rewrites the body of every matching open issue. It only visits repos that currently have findings. It never closes issues, and an issue whose findings were fixed keeps its last body, so an old body does not prove the findings still exist. Close issues by hand once fixed. If you close an issue while findings remain, the next run opens a new one. Label creation can fail, so the label search is not a complete inventory; the script also matches a marker comment in the body.

## When to Run Manually

- A scheduled run failed, or you need the change live before the next schedule. Prefer re-running the workflow, using the commands under Troubleshooting.
- A new skill directory was added upstream. Skills are never auto-appended: review the draft from `discover-new-skills.mjs`.
- You are changing sync/audit scripts and want to see their effect on real data before opening a PR.

## When NOT to Use

- Editing a single YAML entry by hand: just edit `data/*.yaml` and open a PR. `validate.yml` checks it.
- The YAML / JSON Schema needs to change: do that first, then sync.
- Working on UI/styling: none of this touches `src/`.

## Prerequisites

- `gh` CLI authenticated against an account that can read `asgard-ai-platform/*`, including private `mcp-*` repos (`gh auth status`)
- Node.js 22 (matches CI) and deps installed with `npm ci`
- A clean working tree. The sync scripts surgically rewrite tracked YAML lines and would collide with unstaged edits.

## Manual Workflow

Run the scripts from the repo root, in the same order as CI. **Stop at the first command that exits non-zero**, as CI does, and do not continue to the next step or ship.

### Step 1: Audit the gap (read-only)

```bash
node scripts/sync-gallery/discover-new-skills.mjs          # first: it rewrites the report
DISCOVER_REPORT_ONLY=1 node scripts/sync-gallery/discover-new-mcps.mjs
node scripts/sync-gallery/audit-pypi.mjs
node scripts/sync-gallery/audit-readme-format.mjs
REFRESH_REPORT_ONLY=1 node scripts/sync-gallery/refresh-boilerplate-descriptions.mjs
node scripts/sync-gallery/audit-orphans.mjs
cat scripts/sync-gallery/_generated/repo-audit-report.md
```

These steps write only to the git-ignored `scripts/sync-gallery/_generated/`: the report and `new-skill-entries.yaml`. Do **not** run `post-audit-issues.mjs` or `post-slack-digest.mjs` locally unless you intend to update the real issues or post to Slack.

### Step 2: Sync

```bash
node scripts/sync-gallery/discover-new-mcps.mjs              # appends coming-soon MCP stubs
node scripts/sync-gallery/promote-candidates.mjs
node scripts/sync-gallery/refresh-boilerplate-descriptions.mjs
node scripts/sync-gallery/sync-mcp-content.mjs
node scripts/sync-gallery/sync-skill-content.mjs
node scripts/sync-gallery/sync-pack-content.mjs
node scripts/sync-gallery/check-sync-thresholds.mjs
git diff --stat data/
```

### Step 3: Add new skills (only if Step 1 drafted any)

Review `scripts/sync-gallery/_generated/new-skill-entries.yaml`, fixing `category`, `skill_type` and the Chinese name; these fields are heuristic guesses. Then append the block to `data/skills.yaml`, re-run `sync-skill-content.mjs`, and re-run `check-sync-thresholds.mjs`, because the new entries change its counts.

### Step 4: Verify

```bash
npm run validate
npm run test:scripts
npm run build
```

If `npm run validate` fails on cross-references (e.g. `requires_mcp` points to a non-existent slug), fix the offending YAML entry and re-validate.

### Step 5: Ship

Open a PR so `validate.yml` runs, then merge. A merge or direct push to `main` deploys only if it touches the `deploy.yml` paths (`data/` does). A direct push skips PR validation.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| A scheduled workflow stopped running; `gh workflow list --all` shows `disabled_inactivity` | GitHub disables scheduled workflows in a public repo after 60 days with no repository activity. A sync that finds no changes makes no commit, so a quiet catalog trips this. Re-enable with `gh workflow enable sync-content.yml` and `gh workflow enable audit-content.yml`. |
| Scheduled runs start hours after the cron time | Normal for GitHub Actions. Over 169 audit runs, start delay was median ~1.8 h, p95 ~4.2 h, max ~7.4 h. Use off-the-hour cron minutes and leave margin for anything time-sensitive. |
| Need a run now | `gh workflow run sync-content.yml` (may push to `main` and deploy). `gh workflow run audit-content.yml` creates or edits **real issues** on the affected repos, whatever `slack_digest` is set to. If you only want the report, run Step 1 locally instead. |
| Sync fails at `check-sync-thresholds` | Fewer than 80% of released MCPs or skills have content keys, usually because many fetches failed (the App token expired, or GitHub errored mid-run) for entries with no cached content. Re-run the workflow; nothing was pushed. |
| Sync fails at `npm run validate` | The run produced invalid YAML. Reproduce locally with Step 2 + Step 4. Nothing was pushed. |
| Detail page lost its Chinese content or pack setup info | The rules depend on the file:<br>• MCP `README.md` failing for any reason keeps the whole last-good entry.<br>• `README.zh-TW.md` failing transiently (anything except HTTP 404) keeps the last-good zh; a 404 drops zh.<br>• A pack's `plugin.json` failing for any reason, 404 included, keeps the whole last-good pack.<br>• The other pack files (README, `.env.example`, USE-CASES, marketplace) failing transiently keep only the field derived from that file, which needs a cached entry; without one, the pack is skipped for that run. A 404 on these files means "absent".<br>So a dropped field usually means the file is gone upstream; check the repo. |
| Run log shows "Node.js 20 is deprecated … forced to run on Node.js 24" | An action is pinned to a Node 20 major. Bump it to the current major, e.g. `actions/checkout@v6`, `actions/setup-node@v6`, `actions/create-github-app-token@v3`, `actions/upload-artifact@v7` (the versions used here today), then check the run annotations for remaining warnings. |
| Slack digest did not arrive | First check that the run happened (scheduled runs can be late or, rarely, dropped). Then open the "Post weekly Slack digest" step log:<br>• "SLACK_WEBHOOK_URL is not set": the secret is missing.<br>• `Slack webhook returned HTTP <code>`: a 4xx usually means the webhook was revoked or rotated; a 5xx is a Slack-side error, so retry.<br>• "Slack webhook request failed": the secret is not a valid URL, or the network failed.<br>• If checkout failed, the step sends a short fallback message instead. With no secret set, it fails silently.<br>Re-post with `gh workflow run audit-content.yml -f slack_digest=true`; this also updates issues. |

## Audit Report Categories

The report (`scripts/sync-gallery/_generated/repo-audit-report.md`, also uploaded as the `repo-audit-report` artifact) groups findings by repo under `## <repo>` headings. The `asgard-opensource-gallery` and `skills` groups hold gallery-side problems, such as orphaned entries and promotion candidates. The header's total line is written before later steps append, so it is not a reliable count; the Slack digest recounts from the groups. Findings under `mcp-*` repos are upstream defects: fix them in the source repo, not with workarounds in the gallery. Findings under `asgard-opensource-gallery` (orphaned MCP entries, promotion candidates) are fixed in this repo's YAML. Findings under `skills` are either a skill to fix upstream or, if the directory was intentionally removed, a stale entry to delete from `data/skills.yaml`.

| Finding (prefix) | Where to fix |
|---|---|
| `Badge missing:` / `Required section missing:` / `H1 does not match` / `H1 heading missing` | Upstream MCP README. The golden sample is `mcp-shopline`. |
| `pyproject.toml …` / `LICENSE file missing` / `Package … is not published on PyPI` | Upstream MCP packaging |
| `tools_count not parseable from README` | Add `**N AI-callable tools**` or an `N MCP tools` line to the upstream README |
| `README.zh-TW.md missing` | Add a Chinese README to the MCP repo |
| `GitHub repo description is empty` | Set the repo description on github.com (Settings → About) |
| `… still boilerplate` | The upstream README H1/intro is missing or still template text |
| `metadata.status="skeleton"` | Finish writing the SKILL.md sections |
| `frontmatter metadata.tags missing` | Add `metadata: { tags: [...] }` to the SKILL.md frontmatter |
| `metadata.related_mcps references unknown slug(s)` | Fix the slug in SKILL.md, or add the MCP to YAML |
| `SKILL.md has no H1 heading` | Add `# Title` after the frontmatter |

## Gotchas

- **Private repos are listed as `coming-soon` on purpose.** `discover-new-mcps.mjs` stubs private `mcp-*` repos too. `promote-candidates.mjs` only promotes a repo once it is public and its package is on PyPI. Taking an MCP or skill fully live still involves manual steps outside this automation.
- **Skeleton skills get `status: coming-soon`, not `released`.** Published skeleton skills have no useful content. The sync does not auto-promote a skill when its upstream status changes; update the YAML by hand.
- **Heuristic fields are guesses.** `category`, `region`, `skill_type` and the Chinese names from discovery are derived from the slug and the README. Review the YAML diff; a wrong category breaks the filter UX.
- **`_generated/` is git-ignored.** Don't commit drafts or reports.
- **The `gh` CLI uses your credentials locally.** Without access to a private repo, a fetch fails and the scripts fall back (skip or keep last-good). Results can differ from CI, which uses the App token.
- **Community MCP entries are matched by slug only.** The MCP sync scripts fetch from `asgard-ai-platform/<slug>`, not from the entry's `github` URL. A hand-added MCP whose `github` points outside the org gets no README content, and an org repo with the same slug would overwrite its description or status. Skills likewise come only from the org `skills` repo. Packs are different: `sync-pack-content.mjs` fetches from the repo in each pack's `github` URL.
- **Rebase before pushing.** The sync workflow pushes to `main` weekly.
- **`audit-github-repos.sh` is a legacy manual check.** No workflow uses it.

## References

- Project layout: `CLAUDE.md` (root)
- Workflows: `.github/workflows/`
- Schema definitions: `schemas/`
- Validation logic: `scripts/validate.mjs`
- Shared helpers: `scripts/sync-gallery/_lib.mjs`
- YAML data: `data/mcp-servers.yaml`, `data/skills.yaml`, `data/plugins.yaml`
