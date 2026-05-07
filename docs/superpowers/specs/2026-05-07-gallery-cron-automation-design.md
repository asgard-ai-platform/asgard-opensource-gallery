# Design — Gallery Content Sync & Audit via Scheduled GitHub Actions

**Date:** 2026-05-07
**Scope:** `asgard-opensource-gallery` (Yggdrasil) — `.github/workflows/`, `scripts/sync-gallery/`
**Author:** Brainstorming session

## Background

`scripts/sync-gallery/` already contains four scripts (and a `SKILL.md`
describing the manual workflow), but they only run on a developer's laptop:

- `sync-mcp-content.mjs` — fetches `README.md` (+ `README.zh-TW.md`) from each
  released MCP repo via `gh api`, extracts H2 sections, writes
  `data/mcp-content.json`.
- `sync-skill-content.mjs` — fetches `SKILL.md` from each directory in
  `asgard-ai-platform/skills`, extracts frontmatter + H2 sections, writes
  `data/skill-content.json`, and surgically rewrites `description.en` in
  `data/skills.yaml` when the upstream description is meaningfully longer.
- `audit-github-repos.sh` — Bash + inline Python audit comparing org repos to
  YAML state (status, `tools_count`, skill directory ↔ YAML, `has_script`,
  description). Prints to stdout only.
- `generate-new-entries.mjs` — auto-discovers public MCP repos / skill
  directories not in YAML and emits drafts to
  `scripts/sync-gallery/_generated/` (gitignored): `new-mcp-entries.yaml`,
  `new-skill-entries.yaml`, and `repo-audit-report.md`. The last file groups
  upstream defects (missing `README.zh-TW.md`, empty repo description,
  unparseable `tools_count`, skeleton-status skills, missing tags, broken
  `related_mcps` cross-references, missing H1 in `SKILL.md`) by repo.

The goal is to run these continuously without human babysitting and surface
findings in places maintainers already watch. The only existing workflow is
`deploy.yml` (push-to-main triggers Cloudflare Pages deploy).

## Goals

1. Sync MCP and skill content automatically; surface drift as a reviewable PR.
2. Audit the gallery against upstream repos automatically; surface findings as
   issues on the offending repo (the source of truth lives where the maintainer
   works).
3. Two flows are independent: audit failures must NOT block sync.

## Non-Goals

- Auto-add or auto-remove YAML entries. Even if audit detects "public repo not
  in YAML", a human still adds the entry via PR. The audit workflow runs
  `generate-new-entries.mjs` only to obtain `repo-audit-report.md`; the YAML
  drafts in `_generated/` are not committed, not uploaded as artifacts, and
  not appended to data files.
- Touch `validate.mjs`, `generate-og.mjs`, or `deploy.sh`.
- Add a PR-time `validate.yml` workflow (orthogonal; tracked separately).
- Auto-merge sync PRs.
- Slack / email notifications.
- Change schemas, `data/*.json` shape, or Astro rendering.
- Rewrite `audit-github-repos.sh`. It stays as-is and is not invoked by either
  workflow. (Earlier draft proposed a Node rewrite; superseded by reusing
  `generate-new-entries.mjs`'s richer report.)

## Architecture

Two independent scheduled workflows, plus one new helper script
(`post-audit-issues.mjs`) that consumes the existing
`generate-new-entries.mjs` markdown report.

| Workflow | Cron (UTC) | Local (TW) | Output |
|---|---|---|---|
| `.github/workflows/sync-content.yml` | `0 18 * * 0` | Mon 02:00 | Single rolling PR `chore/sync-gallery-content` |
| `.github/workflows/audit-content.yml` | `0 19 * * *` | Daily 03:00 | One rolling issue per `mcp-*` repo + one on `skills` |

Sync is weekly because it produces a PR a human reviews; weekly cadence
keeps review noise down. Audit is daily because it surfaces drift without
mutating gallery state — faster feedback is strictly better, and rolling
issues mean repeat runs do not create extra notifications past the initial
edit. On Sunday, audit naturally runs one hour after sync (incidental load
spacing); other days it runs alone.

Both workflows also expose `workflow_dispatch` for manual runs.

### Auth

Both workflows authenticate with `secrets.GH_TOKEN` (assumed pre-existing in
this repo's settings). Required scopes:

- Org `asgard-ai-platform`: `Contents: Read` on every `mcp-*` repo and on
  `skills`.
- Org `asgard-ai-platform`: `Issues: Write` on every `mcp-*` repo and on
  `skills` (for audit).
- This repo: `Contents: Write` and `Pull requests: Write` (for sync PR).

If the existing token lacks any of these, the relevant workflow's first run
will 401/403 and the missing scope will be visible in the failed step's log.

### Runner

Both workflows use `runs-on: action-runner-scale-set` (the same self-hosted
runner used by `deploy.yml`). `gh` CLI availability on this runner is an
**open assumption**: if it is not preinstalled, add `cli/cli` setup or fall
back to `ubuntu-latest`.

## Sync Workflow

**File:** `.github/workflows/sync-content.yml`

### Steps

```yaml
name: Sync gallery content
on:
  schedule:
    - cron: '0 18 * * 0'
  workflow_dispatch:

jobs:
  sync:
    runs-on: action-runner-scale-set
    permissions:
      contents: write
      pull-requests: write
    env:
      GH_TOKEN: ${{ secrets.GH_TOKEN }}
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v6
        with:
          node-version: 22
      - run: npm ci
      - run: node scripts/sync-gallery/sync-mcp-content.mjs
      - run: node scripts/sync-gallery/sync-skill-content.mjs
      - run: npm run validate
      - run: npm run build
      - uses: peter-evans/create-pull-request@v7
        with:
          branch: chore/sync-gallery-content
          title: 'chore: sync MCP & skill content from upstream'
          body: |
            Auto-generated by `sync-content.yml`.

            See workflow run for processed counts.
          commit-message: 'chore: sync MCP & skill content'
          delete-branch: false
          add-paths: |
            data/**
```

`add-paths: data/**` ensures only the data files get staged. If a future
change makes `generate-new-entries.mjs` run earlier (or anything else writes
to `_generated/`), those files will not accidentally land in the PR.

### PR behaviour

- Single rolling branch `chore/sync-gallery-content`. If a PR is already open
  for this branch, the action force-pushes and updates body; no duplicates.
- If no files changed, the action is a no-op — no empty PR is created.
- A reviewer who wants to amend the sync PR by hand should expect the next
  scheduled run to overwrite their edits. Trade-off accepted: keeps state
  simple.

### Why a rolling branch instead of one-PR-per-run

Sync output is a deterministic snapshot of upstream. Stacking PRs creates noise
and forces cleanup logic. A single rolling PR is always the latest snapshot.

### Failure handling

- Any sync script exits non-zero → job fails before `create-pull-request` step.
- `npm run validate` fail → job fails (catches upstream content that breaks
  schema, e.g., a description that smashes a length cap).
- `npm run build` fail → job fails (catches structural issues the schema does
  not catch).

### Optional follow-up (not in this spec)

The sync scripts currently swallow `gh api` failures (return `null`). If a
token expires mid-run the output silently shrinks. Adding a sanity check
("processed < 80 % of last run → fail") would prevent a quietly-empty PR. Not
in scope for this design.

### Script changes

None to the sync scripts. They already work from CLI; running them in CI is a
no-op move.

## Audit Workflow

**File:** `.github/workflows/audit-content.yml`

### Decision: reuse `generate-new-entries.mjs`, add only `post-audit-issues.mjs`

`generate-new-entries.mjs` already produces a per-repo upstream-defect report
at `scripts/sync-gallery/_generated/repo-audit-report.md`. Its issue
categories (see Background) are richer than what `audit-github-repos.sh`
checks. Reusing it removes the need to write a parallel audit tool.

The audit workflow:

1. Runs `generate-new-entries.mjs`. The script also writes
   `new-mcp-entries.yaml` and `new-skill-entries.yaml` drafts; these are
   discarded (the working directory is ephemeral CI state, and `_generated/`
   is gitignored anyway).
2. Runs a new `post-audit-issues.mjs` that parses the markdown report and
   posts/updates one tracking issue per target repo.

`audit-github-repos.sh` is not invoked. It stays in the repo for the manual
workflow described in `scripts/sync-gallery/SKILL.md` but plays no role in
the cron flow.

### New script: `scripts/sync-gallery/post-audit-issues.mjs`

Input: `scripts/sync-gallery/_generated/repo-audit-report.md` produced by
`generate-new-entries.mjs`. The report groups findings by repo using H2
headings (e.g. `## mcp-shopline`, `## skills`); each group lists bullets that
are upstream defects.

For each target repo that appears in the parsed report (i.e., has at least one
finding):

1. Search the target repo for the existing tracking issue:
   `gh issue list --repo asgard-ai-platform/<repo> --state open --label yggdrasil-audit --limit 1`
   (fallback: search by marker comment `<!-- yggdrasil-audit:auto-managed -->`
   if label lookup fails).
2. **Hit** → `gh issue edit` to update body with new timestamp + finding list.
3. **Miss** → `gh issue create` with title
   `[yggdrasil-audit] Gallery sync report`, label `yggdrasil-audit`, marker
   comment in body.

If the `yggdrasil-audit` label does not yet exist on a repo, attempt to create
it (`gh label create yggdrasil-audit`); on failure, fall back to creating the
issue without a label and rely on the marker-comment identifier.

**Stale issues (open issue exists but the repo no longer appears in the
report)**: not auto-closed. Maintainer closes manually once they verify.
Auto-closing is a follow-up — would require listing all open
`yggdrasil-audit`-labelled issues across the org each run and diffing.

#### Issue body template

```markdown
> Auto-maintained by Yggdrasil gallery audit. Last updated: <ISO timestamp> (run #<run-id>).

## Findings

- ⚠️ tools_count mismatch: README=143, YAML=140
- ⚠️ Public repo not in gallery YAML

## What to do

Either fix the source (this repo's README) or open a PR on
`asgard-ai-platform/asgard-opensource-gallery` to update YAML.
When all findings are resolved, close this issue manually.

<!-- yggdrasil-audit:auto-managed -->
```

### Workflow steps

```yaml
name: Audit gallery content
on:
  schedule:
    - cron: '0 19 * * 0'
  workflow_dispatch:

jobs:
  audit:
    runs-on: action-runner-scale-set
    permissions:
      contents: read
    env:
      GH_TOKEN: ${{ secrets.GH_TOKEN }}
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 22
      - run: npm ci
      - run: node scripts/sync-gallery/generate-new-entries.mjs
      - run: node scripts/sync-gallery/post-audit-issues.mjs scripts/sync-gallery/_generated/repo-audit-report.md
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: repo-audit-report
          path: scripts/sync-gallery/_generated/repo-audit-report.md
```

`permissions.contents` is `read` because the audit workflow does not push to
this repo. Cross-repo issue write is granted by `secrets.GH_TOKEN`, not by
the workflow's `GITHUB_TOKEN` permissions block.

The artifact uploads only the audit markdown — never `new-mcp-entries.yaml` /
`new-skill-entries.yaml`, to keep the non-goal of "no auto-add" honest.

### Failure handling

- Audit script exits non-zero → job fails (data sources are unreachable —
  worth a notification).
- Issue posting failure for one repo → log error, accumulate, continue with
  next repo. Job fails at the end if any errors accumulated, so the failure
  is surfaced without losing partial progress.

## Conditions for the Automation to Work

These are pre-existing requirements on upstream repos. The design assumes them.
A separate doc (or follow-up PR to `CONTRIBUTING.md`) should formalise these
for contributors.

### `asgard-ai-platform/skills` repo

- Token has `Contents: Read` on the repo.
- Skill directories on `main` start with a lowercase letter and are not in
  the exclusion list. Note: `sync-skill-content.mjs` excludes `eval` and
  `tools`; `generate-new-entries.mjs` additionally excludes `docs`. Both
  scripts run in this design, so any directory named `docs` is filtered out
  by the audit path but would still be processed by sync. Pre-existing
  inconsistency; out of scope to align here.
- Each skill directory contains `SKILL.md`.
- `SKILL.md` has YAML frontmatter delimited by `---`.
- Frontmatter `description` is a single-line string.
- Body uses `## H2` for sections. H2 titles matching keywords in
  `sectionKey()` (overview / when to use / framework / output format /
  examples / gotchas / references / assumptions) map to structured keys; other
  H2s map to slugified keys (frontend may not render them).
- A `scripts/` subdirectory marks the skill as `has_script: true` in audit.
- Slug is `skill-{dirname}`.

### Each `mcp-*` repo

- Slug in `data/mcp-servers.yaml` matches the actual repo name.
- `status: released` to be eligible for content sync.
- Token has `Contents: Read` (private repos require explicit scope).
- Has `README.md` at repo root with H1 + intro + H2 sections.
- Optional `README.zh-TW.md` for Chinese translation.
- For audit `tools_count` check: README contains one of `N AI-callable tools`,
  `**N tools**`, `N MCP tools`, or an `## Available Tools` table whose rows
  start with `` | `tool_name` | ``.
- H2 titles matching `sectionKey()` keywords (features / quick_start /
  available_tools / api_reference / install / configuration / license /
  contributing / usage) render as structured sections.

### GitHub Actions

- `secrets.GH_TOKEN` exists with the scopes listed in the Auth section above.
- `gh` CLI is available on `action-runner-scale-set` (open assumption).
- Node 22 + `js-yaml` (already in `package.json`).
- Rate limit: ~700 API calls per audit run × daily ≈ 4900/week; ~700 per
  sync run × weekly = 700/week. Combined cadence is well under PAT 5000/h.

## Risks

| Risk | Mitigation |
|---|---|
| `secrets.GH_TOKEN` missing or insufficiently scoped | First run fails with a 401/403 in the API step; log identifies missing scope. |
| `description.en` overwritten unintentionally | PR mode + human review; no auto-merge. |
| `gh api` silent failure (current behaviour: catch → null) | Out of scope; called out as follow-up. |
| Audit issue body is hand-edited and clobbered next run | Marker comment + label + body opening line warns "Auto-maintained". |
| `peter-evans/create-pull-request@v7` incompatible with self-hosted runner | Same runner already executes a Node-based action in `deploy.yml` (`cloudflare/wrangler-action@v3.15.0`); precedent. |
| PR merged by token identity does not trigger `deploy.yml` | Sync PR is human-merged; deploy.yml fires on push-to-main as today. |
| GitHub label `yggdrasil-audit` missing on a repo | Script attempts to create it; falls back to label-less issue keyed by marker comment. |
| `_generated/` YAML drafts accidentally committed | Audit workflow uploads only the markdown report; sync workflow uses `add-paths: data/**` so `_generated/` cannot leak into the PR. |
| `repo-audit-report.md` format changes in a future `generate-new-entries.mjs` revision | `post-audit-issues.mjs` parser is the only consumer; bump together. Pin a fixture-based test if drift becomes a concern. |

## Implementation Outline

This is a sketch only. Detailed steps and tests belong in the implementation
plan produced by the writing-plans skill.

1. Add `scripts/sync-gallery/post-audit-issues.mjs`. Test against a sample
   `repo-audit-report.md` fixture and a sandbox repo before pointing at
   production.
2. Add `.github/workflows/sync-content.yml`. First run via
   `workflow_dispatch`; verify rolling PR opens correctly and only `data/`
   files are staged.
3. Add `.github/workflows/audit-content.yml`. First run via
   `workflow_dispatch`; verify per-repo issues are created with correct title
   + label + marker, and `_generated/` YAML drafts are not in the artifact.
4. Once both manual runs are clean, the cron triggers take over.

## Open Assumptions Tracker

Resolve before / during implementation:

- [ ] Confirm `secrets.GH_TOKEN` exists in this repo's Actions settings.
- [ ] Confirm token scopes match the Auth section.
- [ ] Confirm `gh` CLI is on `action-runner-scale-set`.
- [ ] Confirm `peter-evans/create-pull-request@v7` runs on the self-hosted
      runner (or fall back to `ubuntu-latest` for the sync workflow).
