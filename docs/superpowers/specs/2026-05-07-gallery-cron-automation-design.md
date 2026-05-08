# Design — Gallery Content Sync & Audit via Scheduled GitHub Actions

**Date:** 2026-05-07 (initial spec) / 2026-05-08 (last as-built sync)
**Scope:** `asgard-opensource-gallery` (Yggdrasil) — `.github/workflows/`, `scripts/sync-gallery/`
**Status:** Built and operational. Audit workflow ran end-to-end at 2026-05-08T01:48Z, opening tracking issues across 13+ `mcp-*` repos. Sync workflow not yet exercised live (cron next: Sunday 18:00 UTC).

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
3. Audit MCP repos for **PyPI publishing conformance** — packaging metadata
   present and the package actually published — surfacing gaps via the same
   per-repo issue.
4. Detect **orphan YAML entries** (entries pointing at upstream repos /
   directories that no longer exist) so the gallery does not silently render
   broken detail pages.
5. Two flows are independent: audit failures must NOT block sync.

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

Two independent scheduled workflows, plus a thin shared library
(`scripts/sync-gallery/_lib.mjs`) and five new helper scripts:

- `check-sync-thresholds.mjs` — sync sanity floor (80% coverage)
- `audit-pypi.mjs` — PyPI metadata + publish status
- `audit-readme-format.mjs` — golden-sample README structure
- `audit-orphans.mjs` — YAML pointing at vanished upstream
- `post-audit-issues.mjs` — markdown report → per-repo tracking issues

`_lib.mjs` exports `ghFetchFile`, `ghJSON`, `ghRepoLookup` (tagged union for
distinguishing 404 from transient errors), `decodeBase64Content`,
`appendGroup`, and `classifyGhError`. **All shell-out is via `execFileSync`
with argv arrays** — no `execSync` shell-string interpolation in any new
script. The same hardening is applied to the existing
`sync-mcp-content.mjs`, `sync-skill-content.mjs`, and
`generate-new-entries.mjs` (Codex review HIGH findings).

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

Two distinct tokens are in play:

- **`secrets.GH_TOKEN`** — a fine-grained PAT the repo admin must provision.
  Used by every `gh api` call from the helper scripts. Required scopes (on
  resource owner `asgard-ai-platform`, all repositories):
  - `Metadata: Read` (auto-granted)
  - `Contents: Read`
  - `Issues: Write` (audit only — covers create / edit / list issues + label
    create)
- **`${{ github.token }}`** — the auto-injected `GITHUB_TOKEN`. Used by
  `peter-evans/create-pull-request` to push the rolling branch and open
  the PR on this repo. The sync workflow's `permissions:` block grants it
  `contents: write` + `pull-requests: write`.

Each workflow has an explicit `Verify token` step that errors with a clear
`::error::` annotation if `secrets.GH_TOKEN` is empty (distinguishes "secret
not configured" from "token expired"). After that, `gh api user` confirms
the token is live before any bulk fetching happens.

`secrets.GH_TOKEN` was confirmed live on 2026-05-08 — the audit run
successfully opened tracking issues across 13+ `mcp-*` repos.

### Runner

Both workflows use `runs-on: ubuntu-latest`. The repo briefly used a
self-hosted `action-runner-scale-set` for `deploy.yml` (commit `d6e9b61`)
but reverted to `ubuntu-latest` in `13e4f1c`; the original spec draft was
written against the self-hosted version and missed the revert. The label
mismatch left the first scheduled audit queued without pickup until
discovered on 2026-05-08 and corrected in `4b52a55`.

`gh` CLI is preinstalled on `ubuntu-latest` runner images.

## Sync Workflow

**File:** `.github/workflows/sync-content.yml`

### Steps

```yaml
name: Sync gallery content
on:
  schedule:
    - cron: '0 18 * * 0'    # Sunday 18:00 UTC = Mon 02:00 TW
  workflow_dispatch:

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

# Serialise scheduled and manual runs so a workflow_dispatch never overlaps
# the cron run. Both write to the same rolling branch.
concurrency:
  group: sync-gallery-content
  cancel-in-progress: false

jobs:
  sync:
    runs-on: ubuntu-latest
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
      - name: Verify token
        run: |
          if [ -z "$GH_TOKEN" ]; then
            echo "::error::secrets.GH_TOKEN is empty. ..."
            exit 1
          fi
          gh api user > /dev/null
      - run: node scripts/sync-gallery/sync-mcp-content.mjs
      - run: node scripts/sync-gallery/sync-skill-content.mjs
      - name: Sanity-check sync output
        run: node scripts/sync-gallery/check-sync-thresholds.mjs
      - run: npm run validate
      - run: npm run build
      - uses: peter-evans/create-pull-request@v8
        with:
          branch: chore/sync-gallery-content
          title: 'chore: sync MCP & skill content from upstream'
          body: |
            Auto-generated by `sync-content.yml`.
          commit-message: 'chore: sync MCP & skill content'
          delete-branch: false
          add-paths: |
            data/**
```

> The verbatim live YAML lives in `.github/workflows/sync-content.yml`. The
> snippet above elides the full `::error::` message body for readability.

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

- `gh api user` fails → job fails immediately, no bulk fetch attempted.
- Any sync script exits non-zero → job fails before `create-pull-request` step.
- Sanity check fails → job fails (see below).
- `npm run validate` fail → job fails (catches upstream content that breaks
  schema, e.g., a description that smashes a length cap).
- `npm run build` fail → job fails (catches structural issues the schema does
  not catch).

### New helper: `scripts/sync-gallery/check-sync-thresholds.mjs`

Both `sync-mcp-content.mjs` and `sync-skill-content.mjs` swallow `gh api`
failures (`catch { return null; }`). If the token expires mid-run, half the
upstream fetches return null and the output JSON quietly shrinks — the PR
deletes a chunk of content with no signal that anything is wrong.

This helper runs after both sync scripts and fails the job if either output
is suspiciously small:

- Count released MCPs in `data/mcp-servers.yaml` → expect at least 80 % of
  them as keys in `data/mcp-content.json`.
- Count skill directories that should sync (entries in `data/skills.yaml`)
  → expect at least 80 % as keys in `data/skill-content.json`.

The 80 % threshold tolerates a handful of legitimate per-repo failures (a
single repo whose README was just deleted) but stops a token-expiry-style
mass failure from landing.

### Script changes

None to existing sync scripts. New helper `check-sync-thresholds.mjs` added.

## Audit Workflow

**File:** `.github/workflows/audit-content.yml`

### Decision: reuse `generate-new-entries.mjs`, augment with PyPI + README + orphan checks

`generate-new-entries.mjs` already produces a per-repo upstream-defect report
at `scripts/sync-gallery/_generated/repo-audit-report.md`. Its issue
categories (see Background) are richer than what `audit-github-repos.sh`
checks. Reusing it removes the need to write a parallel audit tool.

Three gaps that `generate-new-entries.mjs` does not cover, all surfaced in
the risk review and added to scope:

- **PyPI conformance** — none of the existing scripts check whether an MCP
  repo is packaged and published.
- **README format conformance** — current checks only verify that an H1 and
  *some* H2 sections exist. They do not verify that an MCP repo follows the
  golden-sample structure (`mcp-shopline`) for sections, badges, install
  instructions, and tool tables.
- **Orphan detection** — `generate-new-entries.mjs` only finds repos /
  directories that exist upstream but are missing from YAML. It does not
  catch the reverse: YAML entries pointing at upstream that no longer
  exists (renamed / deleted / made private).

Three new scripts cover these gaps and append to the same
`repo-audit-report.md` so `post-audit-issues.mjs` has a single source.

The audit workflow:

1. Verify token (`gh api user`) — fail loud if dead.
2. Run `generate-new-entries.mjs`. The YAML drafts in `_generated/` are
   discarded (CI working directory is ephemeral; `_generated/` is gitignored).
3. Run `audit-pypi.mjs` — append PyPI findings to `repo-audit-report.md`.
4. Run `audit-readme-format.mjs` — append README structure findings.
5. Run `audit-orphans.mjs` — append orphan-entry findings.
6. Run `post-audit-issues.mjs` — parse the merged report, post/update one
   tracking issue per target repo.

`audit-github-repos.sh` is not invoked by the workflow. It stays in the repo
for the manual flow described in `scripts/sync-gallery/SKILL.md`.

### New script: `scripts/sync-gallery/audit-pypi.mjs`

For each released MCP repo in `data/mcp-servers.yaml`, append findings to
`repo-audit-report.md`. Checks:

**Packaging metadata** (read `pyproject.toml` from repo root via `gh api`):

- File exists (else: `pyproject.toml missing`).
- Parses as TOML (else: `pyproject.toml is not valid TOML`).
- `[project]` table has: `name`, `version`, `description`, `readme`,
  `requires-python`, `license`, `authors`, `classifiers`. Each missing field
  is one finding (e.g. `pyproject.toml [project] missing 'classifiers'`).
- `[build-system]` table present with `build-backend` set.
- LICENSE file at repo root (else: `LICENSE file missing at repo root`).

**PyPI publish status** (`GET https://pypi.org/pypi/<name>/json`, where
`<name>` is `pyproject.toml`'s `[project].name`):

- 404 → `Package <name> is not published on PyPI`.
- 200 → compare `info.version` to local `pyproject.toml` version. Mismatch →
  `pyproject.toml version <X> ahead of latest PyPI release <Y>` (informational).
- Check `info.description_content_type` is `text/markdown` (else: README will
  not render correctly on PyPI).

PyPI is queried unauthenticated (public endpoint). On network failure or
non-2xx/4xx response, the script logs a warning but does not append a finding
(prevents false positives from PyPI outages).

### New script: `scripts/sync-gallery/audit-readme-format.mjs`

Source of truth: `mcp-shopline`'s `README.md` is the **golden sample** for
every published MCP repo. `mcp-template`'s `README.md` is the bootstrap
template that a new repo starts from; before a repo is marked
`status: released` in the gallery, its README must match the shopline
shape.

For each released MCP repo in `data/mcp-servers.yaml`, fetch `README.md`
and append findings if any of the following fail:

**Header / metadata**

- H1 matches `^MCP\s+\S+` (e.g., `# MCP Shopline`).
- Badge row immediately under H1, containing references to all of:
  PyPI version, Python versions, License, GitHub stars, GitHub issues,
  GitHub last-commit, and `MCP-compatible`. Detected by URL substring
  match (`shields.io`, `pypi.org`, `github.com/.../stargazers`, etc.).
  Each missing badge is one finding.
- `[繁體中文](README.zh-TW.md)` link (or equivalent) before the first H2.
- An intro paragraph between the badges and the first H2 (non-empty after
  trimming).

**Required H2 sections** (case-sensitive headings):

- `## What This Does`
- `## Quick Start`
- `## Tools (N)` where `N` matches the YAML `tools_count`.
- `## License`

**Required H3 subsections under `## Quick Start`**:

- `### Install` containing a fenced code block with `pip install <name>`.
- `### Use with Claude Code`
- `### Use with Claude Desktop`

**Required structure under `## Tools (N)`**:

- `### Read Tools (M)` and (if any write tools) `### Write Tools (K)`.
- At least one Markdown table per subsection with header `| Tool |
  Description |`.
- The sum of tool-rows across both subsections equals `N` from the parent
  H2.

**Optional sections** are allowed but not required:
`API Reference`, `Important: Write Tools`, `API Endpoint Coverage`,
`Project Structure`, `API Constraints`, `Development`,
`Known Test Gaps`, `Roadmap`, `Usage Examples`, `Contributing`.

Findings are concise and reference the exact section name, e.g.:

- `README missing required section: ## What This Does`
- `README ## Tools (N) — N=143 in heading but 140 tool rows counted`
- `README badge row missing: PyPI version`
- `README ### Install: no fenced 'pip install mcp-shopline' code block found`

`mcp-shopline` is itself audited and is expected to pass; if a check rule
fails on `mcp-shopline`, the rule is wrong and should be relaxed (the rule
set is calibrated to the golden sample).

### New script: `scripts/sync-gallery/audit-orphans.mjs`

Detects YAML entries whose upstream is gone, with explicit defence against
turning transient GitHub failures into mass false orphan findings (P1
review concern).

- For each `status: released` entry in `data/mcp-servers.yaml`, calls
  `ghRepoLookup(org, slug)` from `_lib.mjs`. The helper uses `execFileSync`
  + `gh api repos/<org>/<slug>` and parses `gh`'s stderr to return one of:
  - `{ status: 'exists', repo }` — 2xx body
  - `{ status: 'missing' }` — definitive HTTP 404
  - `{ status: 'error', message }` — anything else (5xx / auth / network /
    timeout)
- An orphan finding is appended **only** for `missing` or for `exists +
  private: true`. `error` results are logged and the repo is skipped.
- If more than 20% of MCP lookups return `error`, the script throws —
  failing the audit job rather than letting `post-audit-issues` flood the
  org with false positives.
- For skills: the CLI fetches the skills repo tree once. If the fetch
  returns `null` (transient failure), `skillDirs` is set to `null` and the
  entire skill orphan loop is skipped with a warning. Otherwise each
  `data/skills.yaml` entry's stripped directory name is checked against
  the Set.

Findings target `asgard-opensource-gallery` (for missing MCPs) or `skills`
(for missing skill dirs) because the YAML is the side that needs fixing,
not the vanished upstream.

### New script: `scripts/sync-gallery/post-audit-issues.mjs`

Input: `scripts/sync-gallery/_generated/repo-audit-report.md` after the three
audit scripts have appended to it. The report groups findings by repo using
H2 headings (e.g. `## mcp-shopline`, `## skills`,
`## asgard-opensource-gallery`); each group lists bullets that are findings.

For each target repo that appears in the parsed report (i.e., has at least
one finding):

1. **Find every existing tracking issue** via `findExistingIssues(repo)`.
   Both the label search (`--label yggdrasil-audit --limit 50`) and the
   marker-comment search run unconditionally and the results are deduped by
   issue number. This catches:
   - duplicate labelled issues (would otherwise silently go stale),
   - issues created without the label (e.g. when `gh label create` was
     unavailable on a previous run — keyed by the marker comment in body).
2. **Hit** (one or more) → `gh issue edit` runs against every match so no
   duplicate goes stale.
3. **Miss** → `ensureLabelExists(repo)` tries `gh label create --force` and
   returns a boolean. `gh issue create` then includes `--label
   yggdrasil-audit` only if creation succeeded; if the token lacks label
   scope on that repo, the issue is created without a label and the marker
   comment in the body is its sole cross-run identifier. The action label
   is logged as `created (unlabelled — token missing label scope)`.

The issue body is rendered to a temp file under `os.tmpdir()`, with the
parsed repo name run through `safeRepoForFilename()` (replaces anything
outside `[A-Za-z0-9._-]` with `_`, falls back to `unknown` for empty /
all-unsafe input). This guards against a future audit script writing an H2
heading with `/` or other path-separators that would otherwise expand into
a missing-directory `writeFileSync`.

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
    - cron: '0 19 * * *'    # Daily 19:00 UTC = 03:00 TW
  workflow_dispatch:

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

# Serialise scheduled and manual runs so two parallel jobs cannot both miss
# the dedup check and create duplicate tracking issues.
concurrency:
  group: audit-gallery-content
  cancel-in-progress: false

jobs:
  audit:
    runs-on: ubuntu-latest
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
      - name: Verify token
        run: |
          if [ -z "$GH_TOKEN" ]; then
            echo "::error::secrets.GH_TOKEN is empty. ..."
            exit 1
          fi
          gh api user > /dev/null
      - run: node scripts/sync-gallery/generate-new-entries.mjs
      - run: node scripts/sync-gallery/audit-pypi.mjs
      - run: node scripts/sync-gallery/audit-readme-format.mjs
      - run: node scripts/sync-gallery/audit-orphans.mjs
      - run: node scripts/sync-gallery/post-audit-issues.mjs scripts/sync-gallery/_generated/repo-audit-report.md
      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: repo-audit-report
          path: scripts/sync-gallery/_generated/repo-audit-report.md
```

> The verbatim live YAML lives in `.github/workflows/audit-content.yml`.

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

The reference repos are:

- **`mcp-template`** — bootstrap template for a new MCP repo (light README).
- **`mcp-shopline`** — golden sample. Every repo with `status: released`
  in the gallery is expected to match shopline's README structure (see
  `audit-readme-format.mjs` for the explicit rules).

Required for the cron flow to work without false-positive findings:

- Slug in `data/mcp-servers.yaml` matches the actual repo name.
- `status: released` to be eligible for content sync. (`released` is also
  what makes README format conformance audited; `coming-soon` and `planned`
  are excluded from the format audit.)
- Token has `Contents: Read` (private repos require explicit scope).
- `README.md` at repo root following the golden-sample structure:
  - H1 `# MCP <ServiceName>`
  - Badge row (PyPI version, Python versions, License, GitHub stars /
    issues / last-commit, MCP-compatible)
  - `[繁體中文](README.zh-TW.md)` link
  - Intro paragraph
  - H2 sections: `What This Does`, `Quick Start`, `Tools (N)`, `License`
    (others optional)
  - `## Quick Start` includes `### Install` with a `pip install` fenced
    block, plus `### Use with Claude Code` and `### Use with Claude Desktop`
  - `## Tools (N)` includes `### Read Tools (M)` and (if applicable)
    `### Write Tools (K)`, each with a `| Tool | Description |` table; row
    count sums to `N`
- `README.zh-TW.md` parallel translation.
- `pyproject.toml` at repo root with `[project]` (`name`, `version`,
  `description`, `readme`, `requires-python`, `license`, `authors`,
  `classifiers`) and `[build-system]` `build-backend` set.
- `LICENSE` file at repo root.
- Package published on PyPI under `pyproject.toml` `[project].name`, with
  `description_content_type` = `text/markdown` for proper README rendering.
- For the legacy bash audit `tools_count` check: README contains one of
  `N AI-callable tools`, `**N tools**`, `N MCP tools`, or an
  `## Available Tools` table whose rows start with `` | `tool_name` | ``.
  (The cron audit reads tools_count from the `## Tools (N)` heading
  instead.)
- H2 titles matching `sectionKey()` keywords (features / quick_start /
  available_tools / api_reference / install / configuration / license /
  contributing / usage) render as structured sections in the gallery
  detail page.

### GitHub Actions

- `secrets.GH_TOKEN` exists with the scopes listed in the Auth section above.
- `gh` CLI is available on `action-runner-scale-set` (open assumption).
- Node 22 + `js-yaml` (already in `package.json`).
- Rate limit: ~700 API calls per audit run × daily ≈ 4900/week; ~700 per
  sync run × weekly = 700/week. Combined cadence is well under PAT 5000/h.

## Risks

### Workflow-level risks

| Risk | Mitigation |
|---|---|
| `secrets.GH_TOKEN` missing or insufficiently scoped | `gh api user` precheck step fails the job loud before bulk fetching. |
| `description.en` overwritten unintentionally | PR mode + human review; no auto-merge. |
| Audit issue body is hand-edited and clobbered next run | Marker comment + label + body opening line warns "Auto-maintained". |
| `peter-evans/create-pull-request@v7` incompatible with self-hosted runner | Same runner already executes a Node-based action in `deploy.yml` (`cloudflare/wrangler-action@v3.15.0`); precedent. |
| PR merged by token identity does not trigger `deploy.yml` | Sync PR is human-merged; deploy.yml fires on push-to-main as today. |
| GitHub label `yggdrasil-audit` missing on a repo | Script attempts to create it; falls back to label-less issue keyed by marker comment. |
| `_generated/` YAML drafts accidentally committed | Audit workflow uploads only the markdown report; sync workflow uses `add-paths: data/**` so `_generated/` cannot leak into the PR. |
| `repo-audit-report.md` format changes in a future `generate-new-entries.mjs` revision | `post-audit-issues.mjs` parser is the only consumer; bump together. Pin a fixture-based test if drift becomes a concern. |
| pypi.org outage causes false-positive "not published" findings | `audit-pypi.mjs` treats network errors / 5xx as warning logs, not findings. Only 404 turns into a finding. |
| Transient gh-api error (5xx / network / 401) treated as missing repo → mass false orphan reports | `audit-orphans.mjs` uses `ghRepoLookup` (tagged union) — only HTTP 404 becomes a finding. Other errors are skipped per repo; if >20% error out, the audit job throws to avoid spamming. |
| Skill-tree fetch failure → every skill flagged as orphan | CLI sets `skillDirs = null` (not `new Set([])`) when the tree call returns null; `findOrphans` skips the skill loop entirely with a warning. |
| Multiple labelled tracking issues silently go stale (older duplicates not updated) | `findExistingIssues` returns *all* matches via both label and marker-comment search (deduped by issue number), and `postOrUpdate` updates every match. |
| Unlabelled marker-only issue missed when label search returns zero results | Marker-comment search runs unconditionally on every repo, not only on label-search throw. |
| Token lacks label-create scope on a target repo | `ensureLabelExists` returns a boolean; if false, `gh issue create` runs without `--label` and the marker comment in the body is the cross-run key. Action label is `created (unlabelled — token missing label scope)`. |
| Cron run overlaps a manual `workflow_dispatch` → duplicate state mutations | Both workflows declare `concurrency:` (`sync-gallery-content` and `audit-gallery-content`) with `cancel-in-progress: false`. |
| Parsed H2 heading containing path separators expands into a missing-directory write | `post-audit-issues.mjs` runs the repo name through `safeRepoForFilename` before joining with `os.tmpdir()`. |
| `secrets.GH_TOKEN` unset (different from "expired") | Workflow's `Verify token` step explicitly checks `[ -z "$GH_TOKEN" ]` and emits an `::error::` annotation naming the required PAT scopes before exiting 1. |

### Risks rooted in existing scripts (carried over, partially mitigated)

| Risk | Mitigation |
|---|---|
| `gh api` failure silently returns `null` in all four sync-gallery scripts → resulting JSON / errors lists become wrong | Mitigated for sync via `check-sync-thresholds.mjs` (80 % floor) and for both workflows via the `gh api user` precheck. Not fully eliminated: a token that goes 401 *during* the run still produces shrunken output, but mass failure is now caught. |
| `sync-skill-content.mjs` surgical YAML rewrite escapes only `"` — backslash, real newline, control chars in upstream `description` produce invalid YAML | `npm run validate` catches it → job fails before PR. **`data/skills.yaml` is left half-rewritten on disk for that CI job**, but CI workspaces are ephemeral so no follow-on damage. Reviewer of the next clean run sees the same input again. Out of scope to refactor the rewriter; flagged for follow-up. |
| `sync-skill-content.mjs` rewrite assumes `description:` is followed *immediately* by `en:` — a comment, blank line, or reordered `zh: / en:` silently skips the update | Validation does not catch this (no error, just no change). Accept for now; flag follow-up to use `yaml.dump`-based rewrite. |
| `tools_count` regex differs between `audit-github-repos.sh` (4 patterns including table-row counting) and `generate-new-entries.mjs` (3 patterns) | Audit workflow uses only `generate-new-entries.mjs`, so the table-row case is no longer recognised. False-positive `tools_count not parseable` findings on repos that document tools as a Markdown table. **Follow-up:** add the 4th pattern to `generate-new-entries.mjs`. |
| Non-atomic file writes (`writeFileSync` straight to target) — a runner kill mid-write produces a half file | Low probability in CI (no manual interrupts). Not mitigated; flagged for follow-up. |
| No retry on transient `gh api` 502/503 | Daily/weekly cadence keeps blast radius small; sanity threshold catches widespread failure. Not mitigated; flagged for follow-up. |
| Heuristic checks in `generate-new-entries.mjs` (missing `metadata.tags`, missing H1, etc.) are surfaced as upstream defects | Intentional — these are gallery-side expectations of upstream contributors. Maintainers may push back; in that case adjust `generate-new-entries.mjs` to drop the check. Documented as policy here, not a bug. |
| Renamed / deleted upstream skill leaves orphan YAML entry with no rich content | Now caught by `audit-orphans.mjs` and reported on the gallery repo's tracking issue. |

## As-built status

Implementation history (PR #12, merged 2026-05-07) plus a runner-label
hotfix on 2026-05-08.

| Area | Built | Live-verified |
|---|---|---|
| `_lib.mjs` (shared helpers + `ghRepoLookup` + `appendGroup` + `classifyGhError`) | ✅ | indirectly via 49 unit tests + audit live run |
| `check-sync-thresholds.mjs` | ✅ | not yet (sync workflow not exercised live; cron next Sun 18:00 UTC) |
| `audit-pypi.mjs` | ✅ | ✅ 6 findings on 2026-05-08 run |
| `audit-readme-format.mjs` | ✅ | ✅ 75 findings on 2026-05-08 run |
| `audit-orphans.mjs` (with transient-failure defence + threshold abort) | ✅ | ✅ 0 findings on 2026-05-08 run |
| `post-audit-issues.mjs` (multi-issue lookup + label fallback + sanitized tmp path) | ✅ | ✅ created tracking issues across 13+ repos |
| `.github/workflows/sync-content.yml` | ✅ | not yet exercised live |
| `.github/workflows/audit-content.yml` | ✅ | ✅ 56s on `workflow_dispatch` |
| 49 unit tests (`npm run test:scripts`) | ✅ | green locally |

### Action versions in use (as of 2026-05-08)

| Action | Pin | Latest major |
|---|---|---|
| `actions/checkout` | `@v6` | v6 ✓ |
| `actions/setup-node` | `@v6` | v6 ✓ |
| `actions/upload-artifact` | `@v7` | v7 ✓ |
| `peter-evans/create-pull-request` | `@v8` | v8 ✓ |
| `cloudflare/wrangler-action` (deploy.yml only) | `@v3.15.0` | v3.15.0 ✓ |

Floating-major pin is the convention for first-party `actions/*`. Cloudflare
is patch-pinned because its third-party + we want explicit upgrades.

## Optional Follow-ups (out of scope here)

- Refactor `sync-skill-content.mjs` `updateYamlDescriptions` to use
  `yaml.dump` round-trip instead of regex line-replace. Removes the
  escape-fragility risk for backslash / newline / control chars.
- Atomic file writes (`writeFileSync(tmp); rename(tmp, target)`) in all
  three sync scripts.
- Retry-with-backoff wrapper around `gh api` calls.
- Add the 4th `tools_count` regex pattern (table-row counting) to
  `generate-new-entries.mjs` to match `audit-github-repos.sh`.
- Auto-close `yggdrasil-audit` issues whose repo no longer appears in any
  `repo-audit-report.md`. Requires listing all `yggdrasil-audit`-labelled
  issues across the org each run.
- Add a `validate.yml` PR workflow (mentioned in `README.md` as existing
  but not yet present) so YAML changes are schema-checked at PR time
  independently of the deploy path.

## Open Assumptions Tracker

- [x] `secrets.GH_TOKEN` configured with the right scopes — confirmed by
      successful 2026-05-08 audit run.
- [x] `gh` CLI is available on the runner — confirmed (using
      `ubuntu-latest`, gh preinstalled).
- [x] `peter-evans/create-pull-request` runs on the runner — N/A; we use
      `ubuntu-latest`. Bumped to `@v8` (latest major) on 2026-05-08.
- [ ] Confirm with maintainers that the README format rules in
      `audit-readme-format.mjs` (calibrated to `mcp-shopline`) are the
      target — the 2026-05-08 run produced 75 findings across MCP repos;
      maintainer review will tell us if any rule is wrong. If they push
      back, relax the rule rather than the fixture.
- [ ] Confirm PyPI publishing is the target for every released MCP repo
      (vs. some repos intentionally not on PyPI). If selective, add an
      opt-out flag in `data/mcp-servers.yaml`.
- [ ] Sync workflow has not yet been exercised live. Either trigger via
      `workflow_dispatch` or wait for the first cron (Sun 18:00 UTC).
