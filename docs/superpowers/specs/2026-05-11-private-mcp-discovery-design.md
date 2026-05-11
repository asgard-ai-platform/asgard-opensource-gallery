# Design — Auto-Append Private + Public MCP Discovery to Sync

**Date:** 2026-05-11
**Scope:** `asgard-opensource-gallery` — `scripts/sync-gallery/`, `.github/workflows/sync-content.yml`, `.github/workflows/audit-content.yml`
**Status:** Spec draft, pending approval

## Problem

`generate-new-entries.mjs:58` filters out private repos when discovering missing `mcp-*` entries. As a result, private MCPs (e.g. `mcp-buy123-vendor`, created 2026-05-08) are invisible to both the sync and audit pipelines. Maintainers have to remember to hand-author placeholder entries.

The audit workflow also only emits *drafts* under `_generated/`; promoting drafts into `data/mcp-servers.yaml` is a manual step.

## Goal

The weekly sync workflow auto-appends every `mcp-*` repo (public + private, excluding `mcp-template`) that is not yet in `data/mcp-servers.yaml` as a `coming-soon` stub, and opens the existing rolling PR. Private repos stay `coming-soon` indefinitely until their repo is made public **and** the PyPI package is published.

## Design

### New script: `scripts/sync-gallery/discover-new-mcps.mjs`

Replaces the MCP half of `generate-new-entries.mjs`. Runs **inside the sync workflow**, before `promote-candidates.mjs`.

Behaviour:
1. List org `mcp-*` repos (no `isPrivate` filter, still excludes `mcp-template`).
2. Diff against `data/mcp-servers.yaml`; ignore slugs already present.
3. For each missing slug:
   - Fetch repo metadata and `README.md` / `README.zh-TW.md` via `gh api` (already authenticated for cross-repo `Contents:Read`; private repos work).
   - Run the same heuristics as today (region, category, tags, tools_count).
   - Render a YAML stub with `status: coming-soon` (was hardcoded `released`).
4. **Append** the rendered block to `data/mcp-servers.yaml` under a generated comment header (e.g. `# Auto-added by discover-new-mcps.mjs on YYYY-MM-DD`). Do not parse-and-rewrite the YAML — string concat preserves existing comments and ordering.
5. Repo issues found during discovery (missing README, etc.) feed into the existing audit-report path via `_generated/repo-audit-report.md`.

Private repos with no `README.md` produce a minimal stub (name derived from slug, description = "MCP server for <slug>." in en/zh) — no "missing README" issue is logged for private repos, since their README is expected to be unavailable to outside readers anyway.

### Refactored script: `scripts/sync-gallery/discover-new-skills.mjs`

The skill half of `generate-new-entries.mjs`, extracted as its own script. Behaviour unchanged: still writes `_generated/new-skill-entries.yaml` for human review (skills don't have a public/private distinction, and their richer SKILL.md frontmatter benefits from human triage before merging).

`generate-new-entries.mjs` is deleted.

### Live visibility check

Add `ghIsRepoPrivate(slug)` to `scripts/sync-gallery/_lib.mjs`:

```js
export function ghIsRepoPrivate(slug) {
  try {
    const json = gh(['api', `repos/${ORG}/${slug}`, '--jq', '.private']);
    return json.trim() === 'true';
  } catch {
    return false; // missing repo treated as public — orphans audit will flag it separately
  }
}
```

Used by:
- `promote-candidates.mjs` — skip `coming-soon` entries whose repo is currently private. Prevents auto-promotion when PyPI publishes ahead of repo going public.
- `audit-pypi.mjs` — skip private MCPs in both passes (no PyPI expectations for private repos).

No YAML schema change. ~38 extra `gh api` calls per run, ~4s overhead, acceptable.

`sync-mcp-content.mjs` already skips non-`released` entries (line 159) — no change needed; private + coming-soon naturally skipped.

### Workflow changes

`sync-content.yml`, before `promote-candidates`:
```yaml
- run: node scripts/sync-gallery/discover-new-mcps.mjs
- run: node scripts/sync-gallery/promote-candidates.mjs
```

`audit-content.yml`, replace `generate-new-entries.mjs` step:
```yaml
- run: node scripts/sync-gallery/discover-new-skills.mjs
```

The artifact upload path stays the same — `repo-audit-report.md` is still written by both workflows (sync writes it as a side-effect of discovery; audit writes it for the skill side and bundles MCP issues).

## Edge Cases

| Case | Outcome |
|------|---------|
| Private repo, no README accessible | Stub with slug-derived name, no error |
| Private repo, README accessible | Stub with extracted H1/intro, status=coming-soon |
| Private repo → made public mid-week | Next sync: still in YAML as coming-soon. promote-candidates flips to released when PyPI publishes. |
| Private repo with squatter PyPI match | promote-candidates skips via visibility gate; squatter check is secondary defence |
| Repo deleted from org | `audit-orphans.mjs` continues to flag the dangling YAML entry |
| `data/mcp-servers.yaml` already has the slug | Discovery skips it, no duplicate append |

## Tests

- `discover-new-mcps.test.mjs` — new file. Mock `gh` to return mixed public/private repo list, assert: private included, stubs marked `coming-soon`, append text contains expected slugs.
- `discover-new-skills.test.mjs` — split out from `generate-new-entries.test.mjs`. Logic unchanged.
- `promote-candidates.test.mjs` — add case: coming-soon entry whose repo is private → not promoted even if PyPI returns 200 with our org metadata.
- `audit-pypi.test.mjs` — add case: private MCP skipped in both passes.

## Non-Goals

- No UI changes. Coming-soon private MCPs render exactly like coming-soon public ones (status badge, no detail content).
- No new YAML fields. Visibility is queried live, not cached.
- Skill discovery still human-review only.

## Rollout

Single PR containing all script changes, workflow updates, and tests. After merge, the next scheduled sync (Sun 18:00 UTC) opens a PR with all currently-missing private MCPs as coming-soon stubs. Maintainer reviews and merges.
