# Private + Public MCP Discovery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Have the weekly sync workflow auto-append every `mcp-*` org repo (public + private, except `mcp-template`) that is missing from `data/mcp-servers.yaml` as a `coming-soon` stub, gated so private repos never auto-promote to `released`.

**Architecture:** Split the MCP and skill halves of `generate-new-entries.mjs` into two scripts. The MCP half (`discover-new-mcps.mjs`) runs in the sync workflow and appends YAML stubs directly. The skill half (`discover-new-skills.mjs`) keeps its draft-only behaviour in the audit workflow. A new live `ghIsRepoPrivate()` lookup in `_lib.mjs` gates `promote-candidates.mjs` and `audit-pypi.mjs` so private repos don't get auto-promoted when a same-named PyPI package exists.

**Tech Stack:** Node 22, `node:test`, `gh` CLI (via `execFileSync`), `js-yaml`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-05-11-private-mcp-discovery-design.md`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `scripts/sync-gallery/_lib.mjs` | Modify | Add `ghIsRepoPrivate(org, slug)` |
| `scripts/sync-gallery/promote-candidates.mjs` | Modify | Inject `isPrivateFn`, skip private |
| `scripts/sync-gallery/promote-candidates.test.mjs` | Modify | Add private-skip test case |
| `scripts/sync-gallery/audit-pypi.mjs` | Modify | Inject `isPrivateFn`, skip private in both passes |
| `scripts/sync-gallery/audit-pypi.test.mjs` | Modify | Add private-skip test cases |
| `scripts/sync-gallery/discover-new-mcps.mjs` | Create | Auto-appender for missing MCP repos |
| `scripts/sync-gallery/discover-new-mcps.test.mjs` | Create | Unit tests for pure helpers |
| `scripts/sync-gallery/discover-new-skills.mjs` | Create | Skill draft logic extracted from `generate-new-entries.mjs` |
| `scripts/sync-gallery/generate-new-entries.mjs` | Delete | Replaced by the two scripts above |
| `.github/workflows/sync-content.yml` | Modify | Run `discover-new-mcps.mjs` before `promote-candidates.mjs` |
| `.github/workflows/audit-content.yml` | Modify | Replace `generate-new-entries.mjs` with `discover-new-skills.mjs` |

---

## Task 1: Add `ghIsRepoPrivate` to `_lib.mjs`

**Files:**
- Modify: `scripts/sync-gallery/_lib.mjs`

No dedicated unit test — covered via injection in downstream tests (Tasks 2 & 3). Mirrors the existing pattern where `ghFetchFile` and `ghJSON` are only tested for export existence.

- [ ] **Step 1: Implement `ghIsRepoPrivate`**

Append after `ghRepoLookup` (around line 95):

```js
/**
 * Live check: is the given org repo currently private?
 *
 * Returns `false` on any failure (missing repo, network error, auth issue) —
 * the safe default is "treat as public", because:
 *   - missing repos are handled separately by audit-orphans.mjs
 *   - network errors should NOT cause us to silently skip a real release-gating
 *     check; downstream callers want false negatives (don't skip), not false
 *     positives (skip when we shouldn't).
 */
export function ghIsRepoPrivate(org, slug) {
  const v = ghJSON(`repos/${org}/${slug}`, '.private');
  return v === true;
}
```

- [ ] **Step 2: Run lint/build to confirm no syntax error**

Run: `node --check scripts/sync-gallery/_lib.mjs`
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add scripts/sync-gallery/_lib.mjs
git commit -m "feat(sync-gallery): add ghIsRepoPrivate helper"
```

---

## Task 2: Gate `promote-candidates.mjs` on visibility

**Files:**
- Modify: `scripts/sync-gallery/promote-candidates.mjs`
- Test: `scripts/sync-gallery/promote-candidates.test.mjs`

- [ ] **Step 1: Add failing test for private skip**

Add at the end of `promote-candidates.test.mjs`, after the existing squatter test (line 88):

```js
test('findPromotions: private repo on PyPI is NOT promoted', async () => {
  // Even if the PyPI package metadata points back at our org, a still-private
  // repo must stay coming-soon — release gate requires the repo to be public.
  const r = await findPromotions({
    mcps: [{ slug: 'mcp-secret', status: 'coming-soon' }],
    fetchPypiFn: exists('1.0.0', 'mcp-secret'),
    isPrivateFn: () => true,
  });
  assert.deepEqual(r, []);
});

test('findPromotions: public repo (default isPrivateFn) is promoted', async () => {
  const r = await findPromotions({
    mcps: [{ slug: 'mcp-foo', status: 'coming-soon' }],
    fetchPypiFn: exists('1.0.0', 'mcp-foo'),
    isPrivateFn: () => false,
  });
  assert.deepEqual(r, [{ slug: 'mcp-foo', version: '1.0.0' }]);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test:scripts -- --test-name-pattern "private repo|public repo"`
Expected: FAIL — `findPromotions` does not accept `isPrivateFn`; the private-skip test fails because the entry IS promoted.

- [ ] **Step 3: Implement private gate in `findPromotions`**

Replace the `findPromotions` function body (around line 53–69) with:

```js
export async function findPromotions({ mcps, fetchPypiFn, isPrivateFn = () => false }) {
  const promotions = [];
  for (const mcp of mcps) {
    if (mcp.status !== 'coming-soon') continue;
    // Visibility gate: a still-private repo must stay coming-soon even when a
    // same-named PyPI package is published. PyPI is global; the repo being
    // public is the actual release signal.
    if (isPrivateFn(mcp.slug)) continue;
    const r = await fetchPypiFn(mcp.slug);
    if (r.status !== 200) continue;
    if (!isOurPackage(r.body?.info, mcp.slug)) continue;
    promotions.push({
      slug: mcp.slug,
      version: r.body?.info?.version || 'unknown',
    });
  }
  return promotions;
}
```

- [ ] **Step 4: Wire `ghIsRepoPrivate` into the CLI entrypoint**

Update the import at line 27:

```js
import { isOurPackage, ghIsRepoPrivate } from './_lib.mjs';
```

Add a constant near the top (after `MCP_YAML`):

```js
const ORG = 'asgard-ai-platform';
```

Update the `findPromotions` call in the CLI block (around line 105–108):

```js
  const promotions = await findPromotions({
    mcps: data.servers,
    fetchPypiFn: fetchPypi,
    isPrivateFn: (slug) => ghIsRepoPrivate(ORG, slug),
  });
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm run test:scripts`
Expected: all `promote-candidates.test.mjs` tests pass (including the two new ones).

- [ ] **Step 6: Commit**

```bash
git add scripts/sync-gallery/promote-candidates.mjs scripts/sync-gallery/promote-candidates.test.mjs
git commit -m "feat(sync-gallery): gate promote-candidates on repo visibility"
```

---

## Task 3: Gate `audit-pypi.mjs` on visibility

**Files:**
- Modify: `scripts/sync-gallery/audit-pypi.mjs`
- Test: `scripts/sync-gallery/audit-pypi.test.mjs`

- [ ] **Step 1: Add failing tests**

Append to `audit-pypi.test.mjs`, after the squatter test (line 149):

```js
test('findPromotionCandidates: private repo on PyPI is NOT a candidate', async () => {
  const cands = await findPromotionCandidates({
    mcps: [{ slug: 'mcp-secret', status: 'coming-soon' }],
    fetchPypiFn: async () => ({ status: 200, body: { info: { version: '1.0.0', project_urls: { Repository: 'https://github.com/asgard-ai-platform/mcp-secret' } } } }),
    isPrivateFn: () => true,
  });
  assert.deepEqual(cands, []);
});

test('findPromotionCandidates: public repo (explicit isPrivateFn=false) is a candidate', async () => {
  const cands = await findPromotionCandidates({
    mcps: [{ slug: 'mcp-foo', status: 'coming-soon' }],
    fetchPypiFn: async () => ({ status: 200, body: { info: { version: '0.1.0', project_urls: { Repository: 'https://github.com/asgard-ai-platform/mcp-foo' } } } }),
    isPrivateFn: () => false,
  });
  assert.equal(cands.length, 1);
  assert.match(cands[0], /mcp-foo/);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test:scripts -- --test-name-pattern "private repo|public repo \\(explicit"`
Expected: FAIL — `findPromotionCandidates` does not accept `isPrivateFn`.

- [ ] **Step 3: Add `isPrivateFn` to `findPromotionCandidates`**

Replace the function (line 109–124):

```js
export async function findPromotionCandidates({ mcps, fetchPypiFn, isPrivateFn = () => false }) {
  const candidates = [];
  for (const mcp of mcps) {
    if (mcp.status !== 'coming-soon') continue;
    if (isPrivateFn(mcp.slug)) continue;
    const r = await fetchPypiFn(mcp.slug);
    if (r.status !== 200) continue;
    if (!isOurPackage(r.body?.info, mcp.slug)) continue;
    const version = r.body?.info?.version || 'unknown';
    candidates.push(
      `Candidate for promotion: \`${mcp.slug}\` is published on PyPI (latest: ${version}) — flip \`status\` from \`coming-soon\` to \`released\``,
    );
  }
  return candidates;
}
```

- [ ] **Step 4: Skip private repos in pass-1 (released metadata audit)**

Update the import at line 24:

```js
import { ghFetchFile, appendGroup, isOurPackage, ghIsRepoPrivate } from './_lib.mjs';
```

In the CLI block, replace the `if (mcp.status !== 'released') continue;` guard (line 133) with:

```js
    if (mcp.status !== 'released') continue;
    // A private repo with status=released is anomalous (release gate normally
    // requires public + PyPI). Skip the metadata audit here — audit-orphans.mjs
    // is the right place to flag the visibility inconsistency.
    if (ghIsRepoPrivate(ORG, mcp.slug)) continue;
```

Update the pass-2 call (line 162):

```js
  const candidates = await findPromotionCandidates({
    mcps,
    fetchPypiFn: fetchPypi,
    isPrivateFn: (slug) => ghIsRepoPrivate(ORG, slug),
  });
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm run test:scripts`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/sync-gallery/audit-pypi.mjs scripts/sync-gallery/audit-pypi.test.mjs
git commit -m "feat(sync-gallery): gate audit-pypi on repo visibility"
```

---

## Task 4: Create `discover-new-mcps.mjs` — pure helpers

**Files:**
- Create: `scripts/sync-gallery/discover-new-mcps.mjs`
- Test: `scripts/sync-gallery/discover-new-mcps.test.mjs`

This task adds the *pure* logic — listing diff, stub building, YAML rendering, and YAML appending — fully unit-tested via injected dependencies. Task 5 adds the live CLI entrypoint.

- [ ] **Step 1: Write failing tests for `buildMcpStubs`**

Create `scripts/sync-gallery/discover-new-mcps.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMcpStubs, renderMcpStubs, appendStubsToYaml } from './discover-new-mcps.mjs';

// ── buildMcpStubs ────────────────────────────────────────────────

test('buildMcpStubs: filters out slugs already in YAML', () => {
  const { entries } = buildMcpStubs({
    existingSlugs: new Set(['mcp-foo']),
    repoSlugs: ['mcp-foo', 'mcp-bar'],
    fetchRepoFn: () => ({ description: 'desc' }),
    fetchReadmeFn: () => '# Bar\n\nIntro.',
    fetchReadmeZhFn: () => '# Bar',
    isPrivateFn: () => false,
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].slug, 'mcp-bar');
});

test('buildMcpStubs: every new entry is coming-soon', () => {
  const { entries } = buildMcpStubs({
    existingSlugs: new Set(),
    repoSlugs: ['mcp-foo'],
    fetchRepoFn: () => ({ description: 'desc' }),
    fetchReadmeFn: () => '# Foo',
    fetchReadmeZhFn: () => '# Foo',
    isPrivateFn: () => false,
  });
  assert.equal(entries[0].status, 'coming-soon');
});

test('buildMcpStubs: private repo with no README still produces a usable stub', () => {
  const { entries, errors } = buildMcpStubs({
    existingSlugs: new Set(),
    repoSlugs: ['mcp-secret'],
    fetchRepoFn: () => null, // gh api may also return null for private
    fetchReadmeFn: () => null,
    fetchReadmeZhFn: () => null,
    isPrivateFn: () => true,
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].slug, 'mcp-secret');
  // Name derived from slug fallback.
  assert.equal(entries[0].nameEn, 'Secret');
  assert.match(entries[0].descEn, /MCP Server/);
  // No errors logged for private repos — README unavailability is expected.
  assert.deepEqual(errors, []);
});

test('buildMcpStubs: public repo with missing README emits an error', () => {
  const { errors } = buildMcpStubs({
    existingSlugs: new Set(),
    repoSlugs: ['mcp-public-broken'],
    fetchRepoFn: () => ({ description: '' }),
    fetchReadmeFn: () => null,
    fetchReadmeZhFn: () => null,
    isPrivateFn: () => false,
  });
  assert.ok(errors.some(e => /README\.md missing/.test(e.issue)));
});

test('buildMcpStubs: applies region/category heuristics from slug', () => {
  const { entries } = buildMcpStubs({
    existingSlugs: new Set(),
    repoSlugs: ['mcp-tw-judgment', 'mcp-jp-pos', 'mcp-stripe-payment'],
    fetchRepoFn: () => ({ description: '' }),
    fetchReadmeFn: () => null,
    fetchReadmeZhFn: () => null,
    isPrivateFn: () => false,
  });
  const byslug = Object.fromEntries(entries.map(e => [e.slug, e]));
  assert.equal(byslug['mcp-tw-judgment'].region, 'taiwan');
  assert.equal(byslug['mcp-tw-judgment'].category, 'gov');
  assert.equal(byslug['mcp-jp-pos'].region, 'japan');
  assert.equal(byslug['mcp-stripe-payment'].category, 'payment');
});

// ── renderMcpStubs ───────────────────────────────────────────────

test('renderMcpStubs: empty list yields empty string', () => {
  assert.equal(renderMcpStubs([]), '');
});

test('renderMcpStubs: single entry produces a parseable YAML block', () => {
  const out = renderMcpStubs([{
    slug: 'mcp-foo',
    nameEn: 'Foo',
    nameZh: 'Foo',
    descEn: 'A foo MCP',
    descZh: 'Foo 描述',
    status: 'coming-soon',
    category: 'data',
    region: 'global',
    toolsCount: null,
    tags: ['data', 'global', 'foo'],
  }]);
  assert.match(out, /- slug: mcp-foo/);
  assert.match(out, /status: coming-soon/);
  assert.match(out, /github: https:\/\/github\.com\/asgard-ai-platform\/mcp-foo/);
  assert.match(out, /tags: \[data, global, foo\]/);
});

test('renderMcpStubs: omits tools_count when null', () => {
  const out = renderMcpStubs([{
    slug: 'mcp-foo', nameEn: 'Foo', nameZh: 'Foo',
    descEn: 'd', descZh: 'd', status: 'coming-soon',
    category: 'data', region: 'global', toolsCount: null, tags: [],
  }]);
  assert.doesNotMatch(out, /tools_count/);
});

// ── appendStubsToYaml ────────────────────────────────────────────

test('appendStubsToYaml: empty stubs returns input unchanged', () => {
  const input = 'servers:\n  - slug: mcp-x\n';
  assert.equal(appendStubsToYaml(input, '', '2026-05-11'), input);
});

test('appendStubsToYaml: appends header + stubs after existing content', () => {
  const input = 'servers:\n  - slug: mcp-x\n    status: released\n';
  const stubs = '  - slug: mcp-new\n    status: coming-soon\n';
  const out = appendStubsToYaml(input, stubs, '2026-05-11');
  assert.match(out, /- slug: mcp-x/);
  assert.match(out, /Auto-added by discover-new-mcps\.mjs on 2026-05-11/);
  assert.match(out, /- slug: mcp-new/);
  // Existing content comes first.
  assert.ok(out.indexOf('mcp-x') < out.indexOf('mcp-new'));
});

test('appendStubsToYaml: input without trailing newline still produces valid output', () => {
  const input = 'servers:\n  - slug: mcp-x\n    status: released';
  const stubs = '  - slug: mcp-new\n    status: coming-soon\n';
  const out = appendStubsToYaml(input, stubs, '2026-05-11');
  // Existing entry stays intact, no merged lines.
  assert.match(out, /released\n/);
  assert.match(out, /- slug: mcp-new/);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test:scripts -- --test-name-pattern "buildMcpStubs|renderMcpStubs|appendStubsToYaml"`
Expected: FAIL — `discover-new-mcps.mjs` does not exist.

- [ ] **Step 3: Create `discover-new-mcps.mjs` with pure helpers**

Create `scripts/sync-gallery/discover-new-mcps.mjs`:

```js
#!/usr/bin/env node
/**
 * discover-new-mcps.mjs
 *
 * Runs in the sync workflow before promote-candidates.mjs. Lists every
 * mcp-* repo in the org (public + private, excluding mcp-template),
 * diffs against data/mcp-servers.yaml, and appends any missing slug as
 * a coming-soon stub. The visibility gate in promote-candidates.mjs
 * keeps private stubs from auto-promoting when a same-named PyPI
 * package exists.
 *
 * Public repos with no README emit a repo-issue line (consumed by the
 * audit report). Private repos silently produce minimal stubs — their
 * README is expected to be unavailable to outside readers.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { ghFetchFile, ghJSON, ghIsRepoPrivate, appendGroup } from './_lib.mjs';

const ORG = 'asgard-ai-platform';
const ROOT = resolve(new URL('.', import.meta.url).pathname, '../..');
const MCP_YAML = join(ROOT, 'data/mcp-servers.yaml');
const REPORT_PATH = join(ROOT, 'scripts/sync-gallery/_generated/repo-audit-report.md');

// ── Heuristic helpers (ported from generate-new-entries.mjs) ──────

function inferRegion(slug) {
  if (/^mcp-(tw|twfood|591|cwa|ezpay|newebpay|ecpay|universalec|tdcc|shopline|91app|mayo)/.test(slug)) return 'taiwan';
  if (/^mcp-(sg|id|ph|sea)/.test(slug)) return 'sea';
  if (/^mcp-jp/.test(slug)) return 'japan';
  return 'global';
}

function inferCategory(slug, repoInfo, readme) {
  const desc = (repoInfo?.description || '') + ' ' + (readme || '').slice(0, 500);
  if (/payment|invoic|einvoice|ezpay|newebpay|ecpay|jkopay|tappay/i.test(slug)) return 'payment';
  if (/judgment|judicial|gov|moea|gcis/i.test(slug + ' ' + desc)) return 'gov';
  if (/hrm|payroll|attendance|hr-/i.test(slug + ' ' + desc)) return 'ops';
  if (/shop|retail|ecom|e-commerce|momo|shopee/i.test(slug + ' ' + desc)) return 'ecommerce';
  if (/comm|message|slack|line|telegram/i.test(slug + ' ' + desc)) return 'communication';
  if (/manufact|iot|industrial/i.test(slug + ' ' + desc)) return 'manufacturing';
  return 'data';
}

function extractH1(body) {
  const m = (body || '').match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

function extractIntro(readme) {
  if (!readme) return '';
  const lines = readme.split('\n');
  const intro = [];
  let pastH1 = false;
  for (const line of lines) {
    if (/^#\s+/.test(line)) { pastH1 = true; continue; }
    if (/^##\s+/.test(line)) break;
    if (pastH1) {
      if (/^\[!\[/.test(line) || /^\[繁體中文\]/.test(line) || /^\[English\]/.test(line) || line.trim() === '---') continue;
      intro.push(line);
    }
  }
  return intro.join('\n').trim();
}

function extractToolsCount(readme) {
  if (!readme) return null;
  const patterns = [
    /(\d+)\s+AI-callable tools/,
    /\*\*(\d+)\s+[a-zA-Z-]*\s*tools\*\*/,
    /(\d+)\s+MCP tools/,
  ];
  for (const p of patterns) {
    const m = readme.match(p);
    if (m) return parseInt(m[1]);
  }
  return null;
}

function slugToTitle(slug) {
  return slug.replace(/^mcp-/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function escapeStr(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ── Pure helpers (exported for tests) ────────────────────────────

/**
 * Build coming-soon stub records for repos missing from YAML.
 *
 * @param {object} params
 * @param {Set<string>} params.existingSlugs   slugs already present in YAML
 * @param {string[]} params.repoSlugs          full list of mcp-* repos in the org
 * @param {(slug:string) => object|null} params.fetchRepoFn        returns gh repo metadata or null
 * @param {(slug:string) => string|null} params.fetchReadmeFn      returns README body or null
 * @param {(slug:string) => string|null} params.fetchReadmeZhFn    returns README.zh-TW.md body or null
 * @param {(slug:string) => boolean} params.isPrivateFn            true if repo is private
 * @returns {{entries: object[], errors: {repo:string, issue:string}[]}}
 */
export function buildMcpStubs({ existingSlugs, repoSlugs, fetchRepoFn, fetchReadmeFn, fetchReadmeZhFn, isPrivateFn }) {
  const entries = [];
  const errors = [];

  for (const slug of repoSlugs) {
    if (existingSlugs.has(slug)) continue;
    const isPrivate = isPrivateFn(slug);
    const repoInfo = fetchRepoFn(slug);
    const readme = fetchReadmeFn(slug);
    const readmeZh = fetchReadmeZhFn(slug);

    if (!isPrivate) {
      if (!readme) errors.push({ repo: slug, issue: 'README.md missing or unreachable' });
      if (!repoInfo?.description) errors.push({ repo: slug, issue: 'GitHub repo description is empty' });
      if (readme && !readmeZh) errors.push({ repo: slug, issue: 'README.zh-TW.md missing — no Chinese content for detail page' });
    }

    const region = inferRegion(slug);
    const category = inferCategory(slug, repoInfo, readme);
    const slugTokens = slug.replace(/^mcp-/, '').split('-').filter(t => t.length > 1);
    const tags = [...new Set([category, region, ...slugTokens])].slice(0, 6);
    const toolsCount = extractToolsCount(readme);
    const intro = extractIntro(readme || '');

    const nameEn = extractH1(readme || '') || slugToTitle(slug);
    let descEn = repoInfo?.description || (intro ? intro.split('\n\n')[0].replace(/\n/g, ' ').trim() : '');
    if (!descEn) descEn = `MCP Server for ${nameEn}.`;
    if (descEn.length > 250) descEn = descEn.slice(0, 247) + '...';
    const descZh = `${nameEn} MCP Server，提供 AI 代理透過自然語言存取相關資料與功能。`;

    entries.push({
      slug, nameEn, nameZh: nameEn, descEn, descZh,
      status: 'coming-soon', category, region, toolsCount, tags,
    });
  }

  return { entries, errors };
}

/**
 * Render a list of stub records as YAML text (no leading/trailing newlines).
 */
export function renderMcpStubs(entries) {
  if (entries.length === 0) return '';
  return entries.map(e => {
    const lines = [
      `  - slug: ${e.slug}`,
      `    name:`,
      `      en: "${escapeStr(e.nameEn)}"`,
      `      zh: "${escapeStr(e.nameZh)}"`,
      `    description:`,
      `      en: "${escapeStr(e.descEn)}"`,
      `      zh: "${escapeStr(e.descZh)}"`,
      `    status: ${e.status}`,
      `    category: ${e.category}`,
      `    region: ${e.region}`,
      `    github: https://github.com/asgard-ai-platform/${e.slug}`,
    ];
    if (e.toolsCount) lines.push(`    tools_count: ${e.toolsCount}`);
    lines.push(`    tags: [${e.tags.join(', ')}]`);
    lines.push(`    maintainer: asgard-ai-platform`);
    return lines.join('\n');
  }).join('\n\n');
}

/**
 * Append a rendered stubs block under a dated header. Existing content
 * is preserved verbatim; the appended block is separated by blank lines
 * so the YAML parser sees it as a new list item.
 */
export function appendStubsToYaml(yamlText, renderedStubs, dateString) {
  if (!renderedStubs) return yamlText;
  const trimmed = yamlText.endsWith('\n') ? yamlText : yamlText + '\n';
  const header = [
    '',
    '  # ============================================================',
    `  # Auto-added by discover-new-mcps.mjs on ${dateString} — REVIEW`,
    '  # ============================================================',
    '',
  ].join('\n');
  return trimmed + header + renderedStubs + '\n';
}

// ── CLI entrypoint added in Task 5 ───────────────────────────────
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test:scripts -- --test-name-pattern "buildMcpStubs|renderMcpStubs|appendStubsToYaml"`
Expected: all 11 tests pass.

- [ ] **Step 5: Run full test suite to confirm no regression**

Run: `npm run test:scripts`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/sync-gallery/discover-new-mcps.mjs scripts/sync-gallery/discover-new-mcps.test.mjs
git commit -m "feat(sync-gallery): add discover-new-mcps pure helpers"
```

---

## Task 5: Add CLI entrypoint to `discover-new-mcps.mjs`

**Files:**
- Modify: `scripts/sync-gallery/discover-new-mcps.mjs`

The CLI block lists repos via `gh repo list`, loads YAML, calls the pure helpers, writes back to disk, and feeds errors into the audit report. Not directly unit-tested — manual verification via Task 9.

- [ ] **Step 1: Append the CLI block**

Append to `scripts/sync-gallery/discover-new-mcps.mjs` (replacing the `// ── CLI entrypoint added in Task 5 ───` comment):

```js
function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf-8', timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function ghListAllMcpRepos() {
  const json = gh(['repo', 'list', ORG, '--limit', '300', '--json', 'name,isPrivate']);
  return JSON.parse(json)
    .filter(r => r.name.startsWith('mcp-') && r.name !== 'mcp-template')
    .map(r => r.name)
    .sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const yamlText = readFileSync(MCP_YAML, 'utf-8');
  const data = yaml.load(yamlText);
  const existingSlugs = new Set(data.servers.map(s => s.slug));

  const repoSlugs = ghListAllMcpRepos();
  const { entries, errors } = buildMcpStubs({
    existingSlugs,
    repoSlugs,
    fetchRepoFn: (slug) => ghJSON(`repos/${ORG}/${slug}`),
    fetchReadmeFn: (slug) => ghFetchFile(ORG, slug, 'README.md'),
    fetchReadmeZhFn: (slug) => ghFetchFile(ORG, slug, 'README.zh-TW.md'),
    isPrivateFn: (slug) => ghIsRepoPrivate(ORG, slug),
  });

  if (entries.length === 0) {
    console.log('discover-new-mcps: no new mcp-* repos to append');
  } else {
    const rendered = renderMcpStubs(entries);
    const today = new Date().toISOString().slice(0, 10);
    writeFileSync(MCP_YAML, appendStubsToYaml(yamlText, rendered, today), 'utf-8');
    console.log(`discover-new-mcps: appended ${entries.length} coming-soon stub(s):`);
    for (const e of entries) console.log(`  - ${e.slug} (${e.region}/${e.category})`);
  }

  // Feed repo issues into the same audit report consumed by the audit workflow.
  const byRepo = new Map();
  for (const e of errors) {
    if (!byRepo.has(e.repo)) byRepo.set(e.repo, []);
    byRepo.get(e.repo).push(e.issue);
  }
  for (const [repo, issues] of byRepo) appendGroup(REPORT_PATH, repo, issues);
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check scripts/sync-gallery/discover-new-mcps.mjs`
Expected: no output.

- [ ] **Step 3: Run test suite (no regression)**

Run: `npm run test:scripts`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/sync-gallery/discover-new-mcps.mjs
git commit -m "feat(sync-gallery): add discover-new-mcps CLI entrypoint"
```

---

## Task 6: Create `discover-new-skills.mjs`

**Files:**
- Create: `scripts/sync-gallery/discover-new-skills.mjs`

Extract the skill half of `generate-new-entries.mjs` verbatim — same draft-only output, same heuristics. No behavioural change; this is a rename + scope-narrowing.

- [ ] **Step 1: Create the file**

Create `scripts/sync-gallery/discover-new-skills.mjs` with this content:

```js
#!/usr/bin/env node
/**
 * discover-new-skills.mjs
 *
 * Audit-workflow companion to discover-new-mcps.mjs. Lists every
 * directory in asgard-ai-platform/skills, diffs against data/skills.yaml,
 * and writes draft YAML entries plus repo-issue findings to
 * scripts/sync-gallery/_generated/. Human review required before
 * appending to data/skills.yaml.
 *
 * Skills don't have a private/public split (all live in one repo), so
 * unlike discover-new-mcps.mjs this script doesn't auto-append.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';

const ORG = 'asgard-ai-platform';
const ROOT = resolve(new URL('.', import.meta.url).pathname, '../..');
const DATA_DIR = join(ROOT, 'data');
const OUT_DIR = join(ROOT, 'scripts/sync-gallery/_generated');
mkdirSync(OUT_DIR, { recursive: true });

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf-8', timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function ghFetchFile(repo, path) {
  try {
    const result = gh(['api', `repos/${ORG}/${repo}/contents/${path}`, '--jq', '.content']);
    return Buffer.from(result, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

function ghListSkillDirs() {
  const json = gh([
    'api',
    `repos/${ORG}/skills/git/trees/main`,
    '--jq',
    '[.tree[] | select(.type == "tree") | .path | select(test("^[a-z]"))]',
  ]);
  return JSON.parse(json)
    .filter(d => !['eval', 'tools', 'docs'].includes(d))
    .sort();
}

function ghHasSubdir(repo, parent, sub) {
  try {
    const list = JSON.parse(gh([
      'api',
      `repos/${ORG}/${repo}/contents/${parent}`,
      '--jq',
      '[.[] | select(.type == "dir") | .name]',
    ]));
    return list.includes(sub);
  } catch {
    return false;
  }
}

function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return { meta: {}, body: content };
  try {
    return { meta: yaml.load(match[1]), body: content.slice(match[0].length).trim() };
  } catch {
    return { meta: {}, body: content };
  }
}

function extractH1(body) {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

function inferSkillFields(dir, frontmatterMeta) {
  const md = frontmatterMeta?.metadata || {};
  const region = /^tw-/.test(dir) ? 'taiwan' : 'global';

  let category = 'methodology';
  if (/^med-/.test(dir)) category = 'media';
  else if (/^(tw-ecom|ecom)-/.test(dir)) category = 'ecommerce';
  else if (/^(tw-)?fin-/.test(dir)) category = 'finance';
  else if (/^mkt-/.test(dir)) category = 'marketing';
  else if (/^cs-/.test(dir)) category = 'customer-service';
  else if (/^(tw-)?manuf-/.test(dir)) category = 'manufacturing';
  else if (/^(stat|algo)-/.test(dir)) category = 'algorithm';
  else if (/^theory-/.test(dir)) category = 'theory';
  else if (/^ops-/.test(dir)) category = 'ops';
  else if (/^data-/.test(dir)) category = 'data';

  let skillType = 'industry';
  if (/^(meta|ux|ops|stat|tech)-/.test(dir)) skillType = 'methodology';
  else if (/^(theory|grad|hum|soc|econ|legal)-/.test(dir)) skillType = 'theory';
  else if (/^algo-/.test(dir)) skillType = 'algorithm';

  return { region, category, skillType, mdStatus: md.status, mdTags: md.tags || [], mdRelatedMcps: md.related_mcps || [] };
}

function escapeStr(s) { return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

function renderSkill(e) {
  const lines = [
    `  - slug: ${e.slug}`,
    `    name:`,
    `      en: "${escapeStr(e.nameEn)}"`,
    `      zh: "${escapeStr(e.nameZh)}"`,
    `    description:`,
    `      en: "${escapeStr(e.descEn)}"`,
    `      zh: "${escapeStr(e.descZh)}"`,
    `    status: ${e.status}`,
    `    category: ${e.category}`,
    `    skill_type: ${e.skillType}`,
    `    region: ${e.region}`,
    `    github: https://github.com/asgard-ai-platform/skills/blob/main/${e.githubDir}/SKILL.md`,
  ];
  if (e.hasScript) lines.push(`    has_script: true`);
  if (e.requiresMcp.length) lines.push(`    requires_mcp: [${e.requiresMcp.join(', ')}]`);
  if (e.tags.length) {
    lines.push(`    tags:`);
    for (const t of e.tags) lines.push(`    - ${t}`);
  }
  lines.push(`    maintainer: asgard-ai-platform`);
  return lines.join('\n');
}

console.error('═══════════════════════════════════════════════════');
console.error(' Discover New Skills — auto-discovery from GitHub');
console.error('═══════════════════════════════════════════════════\n');

const mcpYamlData = yaml.load(readFileSync(join(DATA_DIR, 'mcp-servers.yaml'), 'utf-8'));
const skillYamlData = yaml.load(readFileSync(join(DATA_DIR, 'skills.yaml'), 'utf-8'));
const existingMcpSlugs = new Set(mcpYamlData.servers.map(s => s.slug));
const existingSkillDirs = new Set(skillYamlData.skills.map(s => s.slug.replace(/^skill-/, '')));

console.error('[1/3] Discovering missing skill directories ...');
const allSkills = ghListSkillDirs();
const newSkills = allSkills.filter(d => !existingSkillDirs.has(d));
console.error(`  Skill dirs: ${allSkills.length} (${newSkills.length} new)\n`);

const errors = [];
const skillEntries = [];

console.error('[2/3] Drafting skill entries ...');
for (const dir of newSkills) {
  process.stderr.write(`  ${dir} ... `);
  const skillMd = ghFetchFile('skills', `${dir}/SKILL.md`);
  if (!skillMd) {
    console.error('⚠  no SKILL.md');
    errors.push({ repo: 'skills', issue: `\`${dir}\`: SKILL.md missing or unreachable` });
    continue;
  }
  const { meta, body } = parseFrontmatter(skillMd);
  const nameEn = extractH1(body) || dir;
  const descEn = (meta.description || '').trim();
  const { region, category, skillType, mdStatus, mdTags, mdRelatedMcps } = inferSkillFields(dir, meta);
  const tags = Array.isArray(mdTags) ? mdTags.slice(0, 8) : [];
  const requiresMcpRaw = Array.isArray(mdRelatedMcps) ? mdRelatedMcps : [];
  const requiresMcp = requiresMcpRaw.filter(s => existingMcpSlugs.has(s));
  const droppedMcps = requiresMcpRaw.filter(s => !existingMcpSlugs.has(s));
  const hasScript = ghHasSubdir('skills', dir, 'scripts');

  if (!extractH1(body)) errors.push({ repo: 'skills', issue: `\`${dir}\`: SKILL.md has no H1 heading` });
  if (!descEn) errors.push({ repo: 'skills', issue: `\`${dir}\`: frontmatter "description" missing or empty` });
  if (!Array.isArray(mdTags) || mdTags.length === 0) errors.push({ repo: 'skills', issue: `\`${dir}\`: frontmatter metadata.tags missing — used for filter UI` });
  if (mdStatus === 'skeleton') errors.push({ repo: 'skills', issue: `\`${dir}\`: metadata.status="skeleton" — content is incomplete` });
  if (droppedMcps.length) errors.push({ repo: 'skills', issue: `\`${dir}\`: metadata.related_mcps references unknown slug(s): ${droppedMcps.join(', ')}` });

  const zhPrefix = category === 'media' ? '媒體技能'
    : category === 'ecommerce' && region === 'taiwan' ? '台灣電商'
    : category === 'ecommerce' ? '電商技能'
    : '技能';
  const nameZh = `${zhPrefix}：${nameEn}`;
  const descZh = `${zhPrefix}：${nameEn} 分析與應用。`;

  skillEntries.push({
    slug: `skill-${dir}`, nameEn, nameZh, descEn, descZh,
    status: mdStatus === 'skeleton' ? 'coming-soon' : 'released',
    category, region, skillType, hasScript, tags, requiresMcp, githubDir: dir,
  });
  console.error('✓');
}
console.error('');

console.error('[3/3] Writing outputs ...');

const skillOut = skillEntries.length === 0
  ? '# No new skill entries — YAML already covers all skill dirs.\n'
  : [
      '# Draft entries — review heuristic-inferred category/region/skill_type before appending.',
      '',
      '  # ============================================================',
      `  # New Skills (${skillEntries.length}) — REVIEW & EDIT`,
      '  # ============================================================',
      ...skillEntries.flatMap(e => [renderSkill(e), '']),
    ].join('\n').trimEnd() + '\n';

writeFileSync(join(OUT_DIR, 'new-skill-entries.yaml'), skillOut, 'utf-8');

const byRepo = new Map();
for (const e of errors) {
  if (!byRepo.has(e.repo)) byRepo.set(e.repo, []);
  byRepo.get(e.repo).push(e);
}

const reportLines = [
  '# Open-source skill audit report',
  '',
  `Generated: ${new Date().toISOString()}`,
  `Total issues: ${errors.length} across ${byRepo.size} repo(s)`,
  '',
];
if (!byRepo.size) {
  reportLines.push('No issues found.');
} else {
  for (const [repo, issues] of [...byRepo.entries()].sort()) {
    reportLines.push(`## ${repo}`);
    reportLines.push('');
    for (const e of issues) reportLines.push(`- ${e.issue}`);
    reportLines.push('');
  }
}
writeFileSync(join(OUT_DIR, 'repo-audit-report.md'), reportLines.join('\n'), 'utf-8');

console.error(`  ✅ ${skillEntries.length} skill entries → scripts/sync-gallery/_generated/new-skill-entries.yaml`);
console.error(`  📋 ${errors.length} repo issues → scripts/sync-gallery/_generated/repo-audit-report.md`);
console.error('\n═══════════════════════════════════════════════════');
console.error(' Done — review drafts, then append to data/skills.yaml');
console.error('═══════════════════════════════════════════════════');
```

- [ ] **Step 2: Verify syntax**

Run: `node --check scripts/sync-gallery/discover-new-skills.mjs`
Expected: no output.

- [ ] **Step 3: Run test suite (no regression)**

Run: `npm run test:scripts`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/sync-gallery/discover-new-skills.mjs
git commit -m "feat(sync-gallery): add discover-new-skills (split from generate-new-entries)"
```

---

## Task 7: Delete `generate-new-entries.mjs`

**Files:**
- Delete: `scripts/sync-gallery/generate-new-entries.mjs`

- [ ] **Step 1: Confirm no other file references it**

Run: `grep -rn "generate-new-entries" --include="*.mjs" --include="*.yml" --include="*.md" .`
Expected: only references inside this plan/spec/docs and a comment in `_lib.mjs` line 5. Update or remove stale references in code (the docstring in `_lib.mjs` mentions `generate-new-entries.mjs` — leave the spec/plan docs alone).

- [ ] **Step 2: Update the `_lib.mjs` comment**

Edit `scripts/sync-gallery/_lib.mjs` line 5:

```js
 * Existing scripts (sync-mcp-content.mjs, sync-skill-content.mjs,
 * discover-new-skills.mjs) intentionally do not import this — they
 * stay as-is per the spec. This lib is for the new cron-only scripts.
```

(Change `generate-new-entries.mjs` → `discover-new-skills.mjs`.)

- [ ] **Step 3: Delete the file**

```bash
git rm scripts/sync-gallery/generate-new-entries.mjs
```

- [ ] **Step 4: Run test suite**

Run: `npm run test:scripts`
Expected: all tests pass (no test referenced the deleted file).

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-gallery/_lib.mjs
git commit -m "chore(sync-gallery): remove generate-new-entries.mjs (split into discover-new-mcps + discover-new-skills)"
```

---

## Task 8: Update GitHub Actions workflows

**Files:**
- Modify: `.github/workflows/sync-content.yml`
- Modify: `.github/workflows/audit-content.yml`

- [ ] **Step 1: Wire `discover-new-mcps.mjs` into sync workflow**

In `.github/workflows/sync-content.yml`, replace lines 39–44 (the existing promote/sync block):

```yaml
      # 1) Discover new mcp-* repos (public + private) and append as
      #    coming-soon stubs. Runs FIRST so the same PR contains both the
      #    new stubs and the README/promote outputs below.
      - run: node scripts/sync-gallery/discover-new-mcps.mjs
      # 2) Flip `coming-soon` → `released` for any MCP whose slug-named
      #    package is on PyPI (visibility-gated: private stays coming-soon).
      - run: node scripts/sync-gallery/promote-candidates.mjs
      - run: node scripts/sync-gallery/sync-mcp-content.mjs
      - run: node scripts/sync-gallery/sync-skill-content.mjs
```

- [ ] **Step 2: Wire `discover-new-skills.mjs` into audit workflow**

In `.github/workflows/audit-content.yml`, replace line 36:

```yaml
      - run: node scripts/sync-gallery/discover-new-skills.mjs
```

(Was: `- run: node scripts/sync-gallery/generate-new-entries.mjs`.)

- [ ] **Step 3: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/sync-content.yml')); yaml.safe_load(open('.github/workflows/audit-content.yml')); print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/sync-content.yml .github/workflows/audit-content.yml
git commit -m "ci(sync-gallery): wire discover-new-mcps into sync, discover-new-skills into audit"
```

---

## Task 9: Manual verification

**Files:** None.

Run the new sync discovery locally and confirm `mcp-buy123-vendor` (the originally-reported missing private MCP) shows up as a coming-soon stub.

- [ ] **Step 1: Run `discover-new-mcps.mjs` in dry-mode**

Use git stash to capture the YAML diff without committing:

```bash
node scripts/sync-gallery/discover-new-mcps.mjs
git diff data/mcp-servers.yaml | head -80
```

Expected output: a diff appending a comment block with `Auto-added by discover-new-mcps.mjs on YYYY-MM-DD — REVIEW` and at least one entry containing:

```yaml
  - slug: mcp-buy123-vendor
    ...
    status: coming-soon
```

- [ ] **Step 2: Validate the resulting YAML**

Run: `npm run validate`
Expected: passes — the rendered stubs conform to the existing schema.

- [ ] **Step 3: Build the site**

Run: `npm run build`
Expected: build succeeds; new coming-soon entries render as cards on `/mcp`.

- [ ] **Step 4: Revert the local data change**

```bash
git checkout data/mcp-servers.yaml
```

(The real append happens via the Sunday cron in the rolling PR.)

- [ ] **Step 5: Run the full test suite one more time**

Run: `npm run test:scripts && npm run validate && npm run build`
Expected: all green.

- [ ] **Step 6: Run promote-candidates locally to confirm it does not promote private stubs**

```bash
node scripts/sync-gallery/discover-new-mcps.mjs
node scripts/sync-gallery/promote-candidates.mjs
git diff data/mcp-servers.yaml | grep -E "(slug: mcp-buy123-vendor|status:)" | head
git checkout data/mcp-servers.yaml
```

Expected: `mcp-buy123-vendor` is appended with `status: coming-soon` and **not** promoted by promote-candidates.

---

## Task 10: Open PR

**Files:** None.

- [ ] **Step 1: Push branch**

```bash
git push -u origin spec/private-mcp-discovery
```

(Branch was created in the spec phase; all task commits land on top of it.)

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat(sync-gallery): auto-discover private + public MCP repos as coming-soon" --body "$(cat <<'EOF'
## Summary
- Sync workflow now lists every \`mcp-*\` repo in the org (public + private, excluding \`mcp-template\`) and appends any missing slug to \`data/mcp-servers.yaml\` as a coming-soon stub.
- Split \`generate-new-entries.mjs\` into \`discover-new-mcps.mjs\` (sync workflow, auto-append) and \`discover-new-skills.mjs\` (audit workflow, draft-only — skills don't have a private/public split).
- New \`ghIsRepoPrivate()\` helper in \`_lib.mjs\` gates \`promote-candidates.mjs\` and \`audit-pypi.mjs\` so private repos don't auto-promote when a same-named PyPI package is published.

Spec: \`docs/superpowers/specs/2026-05-11-private-mcp-discovery-design.md\`
Plan: \`docs/superpowers/plans/2026-05-11-private-mcp-discovery.md\`

## Test plan
- [ ] \`npm run test:scripts\` passes
- [ ] \`npm run validate\` passes after running \`discover-new-mcps.mjs\` locally
- [ ] \`mcp-buy123-vendor\` appears as a coming-soon stub in the generated diff
- [ ] \`promote-candidates.mjs\` does NOT promote private stubs even if same-named PyPI exists

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Self-Review

**Spec coverage:**
- Discover MCP (public + private) → Task 4/5 (`discover-new-mcps.mjs`)
- Mark `coming-soon` → covered in Task 4 (`status: 'coming-soon'` hardcoded in `buildMcpStubs`)
- Append to `data/mcp-servers.yaml` → Task 5 CLI block via `appendStubsToYaml`
- Split skill discovery → Task 6 (`discover-new-skills.mjs`)
- Delete `generate-new-entries.mjs` → Task 7
- Visibility gate in `promote-candidates.mjs` → Task 2
- Visibility gate in `audit-pypi.mjs` → Task 3
- Workflow wiring → Task 8
- Edge cases (private no README, public no README, squatter, already-in-YAML) → Task 4 tests
- Manual verification → Task 9

**Placeholder scan:** No "TBD" / "implement later". Every code step shows the actual code.

**Type consistency:** `buildMcpStubs`, `renderMcpStubs`, `appendStubsToYaml`, `findPromotions`, `findPromotionCandidates`, `ghIsRepoPrivate`, `isPrivateFn` — all spelled consistently across tasks. `isPrivateFn` is the injected dependency name in tests and CLI wiring alike.
