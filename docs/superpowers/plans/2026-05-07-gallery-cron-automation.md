# Gallery Cron Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate the existing manual `scripts/sync-gallery/` workflow as two scheduled GitHub Actions: a weekly sync that opens a rolling PR with refreshed MCP/skill content, and a daily audit that opens/updates per-repo tracking issues for upstream drift, PyPI conformance, README format conformance, and orphan YAML entries.

**Architecture:** Two `.github/workflows/*.yml` files trigger five new helper scripts in `scripts/sync-gallery/`. New scripts share a thin `_lib.mjs` for `gh api` helpers; existing sync scripts are not touched. Validation logic in each new script is split into a pure function (unit-testable with fixtures) plus a CLI orchestrator (uses gh + filesystem). Tests run via `node --test`. All shell-out uses `execFileSync` with argv arrays to avoid shell-injection surface.

**Tech Stack:** Node 22 (already in `deploy.yml`), `gh` CLI, `js-yaml` (existing dep), `smol-toml` (new devDep), `node:test` (built-in), GitHub Actions, `peter-evans/create-pull-request@v7`.

**Source spec:** `docs/superpowers/specs/2026-05-07-gallery-cron-automation-design.md`

---

## File Structure

**New files:**

```
scripts/sync-gallery/
  _lib.mjs                              # Shared gh api / fs helpers (execFile-based)
  _lib.test.mjs                         # Trivial test that _lib loads
  _fixtures/                            # Test fixtures (committed)
    pyproject-good.toml                 #   Valid pyproject.toml
    pyproject-missing-fields.toml       #   Missing required fields
    readme-shopline.md                  #   Snapshot of golden sample
    readme-incomplete.md                #   Missing sections
    repo-audit-report-sample.md         #   Sample report for parser test
  check-sync-thresholds.mjs             # Sync sanity check
  check-sync-thresholds.test.mjs
  audit-pypi.mjs                        # PyPI metadata + publish status
  audit-pypi.test.mjs
  audit-readme-format.mjs               # README golden-sample conformance
  audit-readme-format.test.mjs
  audit-orphans.mjs                     # YAML → upstream existence
  audit-orphans.test.mjs
  post-audit-issues.mjs                 # Markdown report → gh issues
  post-audit-issues.test.mjs

.github/workflows/
  sync-content.yml                      # Weekly sync → rolling PR
  audit-content.yml                     # Daily audit → per-repo issues
```

**Modified files:**

```
package.json                            # Add smol-toml devDep + test:scripts script
```

**Untouched (per spec non-goals):**

```
scripts/sync-gallery/sync-mcp-content.mjs
scripts/sync-gallery/sync-skill-content.mjs
scripts/sync-gallery/audit-github-repos.sh
scripts/sync-gallery/generate-new-entries.mjs
scripts/validate.mjs
.github/workflows/deploy.yml
```

---

## Task 1: Shared lib + test scaffolding + smol-toml dep

**Files:**
- Create: `scripts/sync-gallery/_lib.mjs`
- Create: `scripts/sync-gallery/_lib.test.mjs`
- Create: `scripts/sync-gallery/_fixtures/.gitkeep`
- Modify: `package.json`

- [ ] **Step 1: Add smol-toml + test:scripts to package.json**

Edit `package.json`. Add to `"scripts"`:

```json
"test:scripts": "node --test scripts/sync-gallery/*.test.mjs"
```

Add to `"devDependencies"`:

```json
"smol-toml": "^1.4.2"
```

- [ ] **Step 2: Install the new dep**

Run: `npm install`
Expected: `package-lock.json` updated, `node_modules/smol-toml` exists.

- [ ] **Step 3: Write failing test for _lib.mjs**

Create `scripts/sync-gallery/_lib.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ghFetchFile, ghJSON, decodeBase64Content } from './_lib.mjs';

test('decodeBase64Content decodes base64 to utf-8', () => {
  // base64 of "hello"
  assert.equal(decodeBase64Content('aGVsbG8='), 'hello');
});

test('decodeBase64Content tolerates whitespace in input', () => {
  assert.equal(decodeBase64Content('aGVs\nbG8='), 'hello');
});

test('exports ghFetchFile and ghJSON functions', () => {
  assert.equal(typeof ghFetchFile, 'function');
  assert.equal(typeof ghJSON, 'function');
});
```

- [ ] **Step 4: Run test, see it fail**

Run: `npm run test:scripts`
Expected: FAIL — `Cannot find module './_lib.mjs'`.

- [ ] **Step 5: Write _lib.mjs**

Create `scripts/sync-gallery/_lib.mjs`:

```js
/**
 * _lib.mjs — Shared helpers for sync-gallery cron scripts.
 *
 * Existing scripts (sync-mcp-content.mjs, sync-skill-content.mjs,
 * generate-new-entries.mjs) intentionally do not import this — they
 * stay as-is per the spec. This lib is for the new cron-only scripts.
 *
 * Uses execFileSync (argv array) rather than execSync (shell string) so
 * interpolated repo / path / slug values cannot inject shell commands.
 */
import { execFileSync } from 'node:child_process';

export function decodeBase64Content(b64) {
  return Buffer.from(b64.replace(/\s+/g, ''), 'base64').toString('utf-8');
}

export function ghFetchFile(org, repo, path) {
  try {
    const b64 = execFileSync(
      'gh',
      ['api', `repos/${org}/${repo}/contents/${path}`, '--jq', '.content'],
      { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    return decodeBase64Content(b64);
  } catch {
    return null;
  }
}

export function ghJSON(apiPath, jq = null) {
  try {
    const args = ['api', apiPath];
    if (jq) args.push('--jq', jq);
    const result = execFileSync('gh', args, {
      encoding: 'utf-8',
      timeout: 20000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return JSON.parse(result);
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: Run test, see it pass**

Run: `npm run test:scripts`
Expected: PASS — 3 tests passing.

- [ ] **Step 7: Create fixtures directory placeholder**

Run:

```bash
mkdir -p scripts/sync-gallery/_fixtures
touch scripts/sync-gallery/_fixtures/.gitkeep
```

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json scripts/sync-gallery/_lib.mjs scripts/sync-gallery/_lib.test.mjs scripts/sync-gallery/_fixtures/.gitkeep
git commit -m "feat(sync-gallery): add shared lib and test scaffolding"
```

---

## Task 2: check-sync-thresholds.mjs

**Files:**
- Create: `scripts/sync-gallery/check-sync-thresholds.mjs`
- Create: `scripts/sync-gallery/check-sync-thresholds.test.mjs`

- [ ] **Step 1: Write failing test**

Create `scripts/sync-gallery/check-sync-thresholds.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateThresholds } from './check-sync-thresholds.mjs';

test('passes at 100 percent coverage', () => {
  const r = evaluateThresholds({
    expectedMcps: ['a', 'b', 'c'],
    actualMcpKeys: ['a', 'b', 'c'],
    expectedSkills: ['x', 'y'],
    actualSkillKeys: ['skill-x', 'skill-y'],
    floor: 0.8,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.failures, []);
});

test('passes at exactly the floor', () => {
  const r = evaluateThresholds({
    expectedMcps: ['a', 'b', 'c', 'd', 'e'],
    actualMcpKeys: ['a', 'b', 'c', 'd'], // 80%
    expectedSkills: ['x'],
    actualSkillKeys: ['skill-x'],
    floor: 0.8,
  });
  assert.equal(r.ok, true);
});

test('fails when MCP coverage is below floor', () => {
  const r = evaluateThresholds({
    expectedMcps: ['a', 'b', 'c', 'd', 'e'],
    actualMcpKeys: ['a', 'b'], // 40%
    expectedSkills: ['x'],
    actualSkillKeys: ['skill-x'],
    floor: 0.8,
  });
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /mcp-content\.json: 2 of 5/);
});

test('fails when skill coverage is below floor', () => {
  const r = evaluateThresholds({
    expectedMcps: ['a'],
    actualMcpKeys: ['a'],
    expectedSkills: ['x', 'y', 'z', 'w', 'v'],
    actualSkillKeys: ['skill-x'], // 20%
    floor: 0.8,
  });
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /skill-content\.json: 1 of 5/);
});

test('zero expected items is a vacuous pass', () => {
  const r = evaluateThresholds({
    expectedMcps: [],
    actualMcpKeys: [],
    expectedSkills: [],
    actualSkillKeys: [],
    floor: 0.8,
  });
  assert.equal(r.ok, true);
});
```

- [ ] **Step 2: Run test, see it fail**

Run: `npm run test:scripts`
Expected: FAIL — `Cannot find module './check-sync-thresholds.mjs'`.

- [ ] **Step 3: Implement check-sync-thresholds.mjs**

Create `scripts/sync-gallery/check-sync-thresholds.mjs`:

```js
#!/usr/bin/env node
/**
 * check-sync-thresholds.mjs
 *
 * Run after sync-mcp-content.mjs + sync-skill-content.mjs. Fails the job if
 * the resulting JSON outputs cover less than 80 percent of the YAML entries
 * that should have been synced. Catches silent gh-api failures (token
 * expiry mid-run) before a content-deleting PR is created.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';

const ROOT = resolve(new URL('.', import.meta.url).pathname, '../..');
const FLOOR = 0.8;

export function evaluateThresholds({ expectedMcps, actualMcpKeys, expectedSkills, actualSkillKeys, floor }) {
  const failures = [];
  const mcpExpected = expectedMcps.length;
  const mcpActual = expectedMcps.filter(s => actualMcpKeys.includes(s)).length;
  if (mcpExpected > 0 && mcpActual / mcpExpected < floor) {
    failures.push(`mcp-content.json: ${mcpActual} of ${mcpExpected} expected entries (< ${Math.round(floor * 100)}%)`);
  }
  const skillExpected = expectedSkills.length;
  const skillActual = expectedSkills.filter(s => actualSkillKeys.includes(`skill-${s}`)).length;
  if (skillExpected > 0 && skillActual / skillExpected < floor) {
    failures.push(`skill-content.json: ${skillActual} of ${skillExpected} expected entries (< ${Math.round(floor * 100)}%)`);
  }
  return { ok: failures.length === 0, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = join(ROOT, 'data');
  const mcps = yaml.load(readFileSync(join(dataDir, 'mcp-servers.yaml'), 'utf-8'));
  const skills = yaml.load(readFileSync(join(dataDir, 'skills.yaml'), 'utf-8'));
  const mcpContent = JSON.parse(readFileSync(join(dataDir, 'mcp-content.json'), 'utf-8'));
  const skillContent = JSON.parse(readFileSync(join(dataDir, 'skill-content.json'), 'utf-8'));

  const expectedMcps = mcps.servers.filter(s => s.status === 'released').map(s => s.slug);
  const expectedSkills = skills.skills.map(s => s.slug.replace(/^skill-/, ''));

  const result = evaluateThresholds({
    expectedMcps,
    actualMcpKeys: Object.keys(mcpContent),
    expectedSkills,
    actualSkillKeys: Object.keys(skillContent),
    floor: FLOOR,
  });

  if (!result.ok) {
    console.error('Sync threshold check FAILED:');
    for (const f of result.failures) console.error(`  - ${f}`);
    console.error('\nLikely cause: gh api silently failing mid-run (token expired or rate-limited).');
    process.exit(1);
  }
  console.log(`Sync threshold check OK: ${expectedMcps.length} MCPs, ${expectedSkills.length} skills.`);
}
```

- [ ] **Step 4: Run test, see it pass**

Run: `npm run test:scripts`
Expected: PASS — 5 new tests (8 total with _lib).

- [ ] **Step 5: Smoke test against current data**

Run: `node scripts/sync-gallery/check-sync-thresholds.mjs`
Expected: prints `Sync threshold check OK: <N> MCPs, <M> skills.` Exit code 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/sync-gallery/check-sync-thresholds.mjs scripts/sync-gallery/check-sync-thresholds.test.mjs
git commit -m "feat(sync-gallery): add sync threshold sanity check"
```

---

## Task 3: audit-orphans.mjs

**Files:**
- Create: `scripts/sync-gallery/audit-orphans.mjs`
- Create: `scripts/sync-gallery/audit-orphans.test.mjs`

- [ ] **Step 1: Write failing test**

Create `scripts/sync-gallery/audit-orphans.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { findOrphans } from './audit-orphans.mjs';

test('returns empty groups when all entries exist upstream', async () => {
  const findings = await findOrphans({
    mcps: [{ slug: 'mcp-a', status: 'released' }],
    skills: [{ slug: 'skill-x' }],
    repoExists: async () => true,
    skillDirExists: async () => true,
  });
  assert.deepEqual(findings, { 'asgard-opensource-gallery': [], skills: [] });
});

test('flags missing released mcp under asgard-opensource-gallery group', async () => {
  const findings = await findOrphans({
    mcps: [
      { slug: 'mcp-a', status: 'released' },
      { slug: 'mcp-b', status: 'released' },
    ],
    skills: [],
    repoExists: async (slug) => slug !== 'mcp-b',
    skillDirExists: async () => true,
  });
  assert.deepEqual(findings.skills, []);
  assert.equal(findings['asgard-opensource-gallery'].length, 1);
  assert.match(findings['asgard-opensource-gallery'][0], /mcp-b/);
});

test('does not check non-released mcps', async () => {
  const findings = await findOrphans({
    mcps: [{ slug: 'mcp-coming', status: 'coming-soon' }],
    skills: [],
    repoExists: async () => false, // would flag if checked
    skillDirExists: async () => true,
  });
  assert.deepEqual(findings['asgard-opensource-gallery'], []);
});

test('flags missing skill under skills group', async () => {
  const findings = await findOrphans({
    mcps: [],
    skills: [{ slug: 'skill-x' }, { slug: 'skill-gone' }],
    repoExists: async () => true,
    skillDirExists: async (dir) => dir !== 'gone',
  });
  assert.equal(findings.skills.length, 1);
  assert.match(findings.skills[0], /skill-gone/);
});
```

- [ ] **Step 2: Run test, see it fail**

Run: `npm run test:scripts`
Expected: FAIL — `Cannot find module './audit-orphans.mjs'`.

- [ ] **Step 3: Implement audit-orphans.mjs**

Create `scripts/sync-gallery/audit-orphans.mjs`:

```js
#!/usr/bin/env node
/**
 * audit-orphans.mjs
 *
 * Detect YAML entries pointing at upstream that no longer exists. Findings
 * are appended to scripts/sync-gallery/_generated/repo-audit-report.md
 * under "asgard-opensource-gallery" (for missing MCP repos) or "skills"
 * (for missing skill directories), since the YAML is the side that needs
 * fixing.
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { ghJSON } from './_lib.mjs';

const ORG = 'asgard-ai-platform';
const ROOT = resolve(new URL('.', import.meta.url).pathname, '../..');
const REPORT_PATH = join(ROOT, 'scripts/sync-gallery/_generated/repo-audit-report.md');

export async function findOrphans({ mcps, skills, repoExists, skillDirExists }) {
  const galleryGroup = [];
  const skillGroup = [];

  for (const m of mcps) {
    if (m.status !== 'released') continue;
    if (!(await repoExists(m.slug))) {
      galleryGroup.push(`Orphan YAML entry: \`${m.slug}\` is marked released but the upstream repo no longer exists or is private`);
    }
  }

  for (const s of skills) {
    const dir = s.slug.replace(/^skill-/, '');
    if (!(await skillDirExists(dir))) {
      skillGroup.push(`Orphan YAML entry: skill \`${s.slug}\` references directory \`${dir}\` which is no longer in the skills repo`);
    }
  }

  return { 'asgard-opensource-gallery': galleryGroup, skills: skillGroup };
}

export function appendGroup(reportPath, groupName, lines) {
  if (lines.length === 0) return;
  const existing = existsSync(reportPath) ? readFileSync(reportPath, 'utf-8') : '';
  const groupHeader = `## ${groupName}`;
  if (existing.includes(`\n${groupHeader}\n`) || existing.startsWith(`${groupHeader}\n`)) {
    const updated = existing.replace(
      new RegExp(`(${groupHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n\\n[\\s\\S]*?)(?=\\n##\\s+|$)`),
      (block) => block.trimEnd() + '\n' + lines.map(l => `- ${l}`).join('\n') + '\n',
    );
    writeFileSync(reportPath, updated, 'utf-8');
  } else {
    const block = `\n${groupHeader}\n\n${lines.map(l => `- ${l}`).join('\n')}\n`;
    appendFileSync(reportPath, block, 'utf-8');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = join(ROOT, 'data');
  const mcps = yaml.load(readFileSync(join(dataDir, 'mcp-servers.yaml'), 'utf-8')).servers;
  const skills = yaml.load(readFileSync(join(dataDir, 'skills.yaml'), 'utf-8')).skills;

  const skillDirs = new Set(
    ghJSON(`repos/${ORG}/skills/git/trees/main`, '[.tree[] | select(.type == "tree") | .path]') || [],
  );

  const findings = await findOrphans({
    mcps,
    skills,
    repoExists: async (slug) => {
      const r = ghJSON(`repos/${ORG}/${slug}`);
      return r !== null && r.private === false;
    },
    skillDirExists: async (dir) => skillDirs.has(dir),
  });

  appendGroup(REPORT_PATH, 'asgard-opensource-gallery', findings['asgard-opensource-gallery']);
  appendGroup(REPORT_PATH, 'skills', findings.skills);

  const total = findings['asgard-opensource-gallery'].length + findings.skills.length;
  console.log(`audit-orphans: ${total} finding(s) appended to ${REPORT_PATH}`);
}
```

- [ ] **Step 4: Run test, see it pass**

Run: `npm run test:scripts`
Expected: PASS — 4 new tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-gallery/audit-orphans.mjs scripts/sync-gallery/audit-orphans.test.mjs
git commit -m "feat(sync-gallery): add orphan-entry audit"
```

---

## Task 4: audit-pypi.mjs

**Files:**
- Create: `scripts/sync-gallery/_fixtures/pyproject-good.toml`
- Create: `scripts/sync-gallery/_fixtures/pyproject-missing-fields.toml`
- Create: `scripts/sync-gallery/audit-pypi.mjs`
- Create: `scripts/sync-gallery/audit-pypi.test.mjs`

- [ ] **Step 1: Write fixtures**

Create `scripts/sync-gallery/_fixtures/pyproject-good.toml`:

```toml
[project]
name = "mcp-shopline"
version = "0.3.0"
description = "MCP server for Shopline"
readme = "README.md"
requires-python = ">=3.9"
license = { text = "MIT" }
authors = [{ name = "Asgard" }]
classifiers = [
  "License :: OSI Approved :: MIT License",
  "Programming Language :: Python :: 3.9",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

Create `scripts/sync-gallery/_fixtures/pyproject-missing-fields.toml`:

```toml
[project]
name = "mcp-broken"
version = "0.0.1"
```

- [ ] **Step 2: Write failing test**

Create `scripts/sync-gallery/audit-pypi.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkPyproject, checkPypiPublish } from './audit-pypi.mjs';

const FIXTURES = resolve(new URL('.', import.meta.url).pathname, '_fixtures');

test('checkPyproject: good fixture passes when LICENSE exists', () => {
  const text = readFileSync(join(FIXTURES, 'pyproject-good.toml'), 'utf-8');
  const findings = checkPyproject(text, true);
  assert.deepEqual(findings, []);
});

test('checkPyproject: good fixture flags missing LICENSE', () => {
  const text = readFileSync(join(FIXTURES, 'pyproject-good.toml'), 'utf-8');
  const findings = checkPyproject(text, false);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /LICENSE file/);
});

test('checkPyproject: missing-fields fixture flags every required field', () => {
  const text = readFileSync(join(FIXTURES, 'pyproject-missing-fields.toml'), 'utf-8');
  const findings = checkPyproject(text, true);
  assert.ok(findings.some(f => /description/.test(f)));
  assert.ok(findings.some(f => /readme/.test(f)));
  assert.ok(findings.some(f => /requires-python/.test(f)));
  assert.ok(findings.some(f => /license/.test(f)));
  assert.ok(findings.some(f => /authors/.test(f)));
  assert.ok(findings.some(f => /classifiers/.test(f)));
  assert.ok(findings.some(f => /\[build-system\]/.test(f)));
});

test('checkPyproject: invalid TOML produces a single finding', () => {
  const findings = checkPyproject('not [valid toml', true);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /not valid TOML/);
});

test('checkPypiPublish: 404 yields a not-published finding', () => {
  const findings = checkPypiPublish('mcp-x', '0.1.0', { status: 404 });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /not published on PyPI/);
});

test('checkPypiPublish: matched version + markdown content type passes', () => {
  const findings = checkPypiPublish('mcp-x', '0.1.0', {
    status: 200,
    body: { info: { version: '0.1.0', description_content_type: 'text/markdown' } },
  });
  assert.deepEqual(findings, []);
});

test('checkPypiPublish: drift between local and pypi version flagged', () => {
  const findings = checkPypiPublish('mcp-x', '0.2.0', {
    status: 200,
    body: { info: { version: '0.1.0', description_content_type: 'text/markdown' } },
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /0\.2\.0 ahead of latest PyPI release 0\.1\.0/);
});

test('checkPypiPublish: non-markdown content type flagged', () => {
  const findings = checkPypiPublish('mcp-x', '0.1.0', {
    status: 200,
    body: { info: { version: '0.1.0', description_content_type: 'text/x-rst' } },
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /description_content_type/);
});

test('checkPypiPublish: 5xx is silent (no finding, no false positive on outage)', () => {
  const findings = checkPypiPublish('mcp-x', '0.1.0', { status: 503 });
  assert.deepEqual(findings, []);
});
```

- [ ] **Step 3: Run test, see it fail**

Run: `npm run test:scripts`
Expected: FAIL — `Cannot find module './audit-pypi.mjs'`.

- [ ] **Step 4: Implement audit-pypi.mjs**

Create `scripts/sync-gallery/audit-pypi.mjs`:

```js
#!/usr/bin/env node
/**
 * audit-pypi.mjs
 *
 * For each released MCP repo, fetch pyproject.toml + LICENSE and verify
 * required packaging metadata, then ping pypi.org to verify publish status.
 * Findings are appended under each `mcp-*` group in the audit report.
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { parse as parseToml } from 'smol-toml';
import { ghFetchFile, appendGroup } from './_lib.mjs';

const ORG = 'asgard-ai-platform';
const ROOT = resolve(new URL('.', import.meta.url).pathname, '../..');
const REPORT_PATH = join(ROOT, 'scripts/sync-gallery/_generated/repo-audit-report.md');

const REQUIRED_PROJECT_FIELDS = [
  'name', 'version', 'description', 'readme',
  'requires-python', 'license', 'authors', 'classifiers',
];

export function checkPyproject(text, hasLicenseFile) {
  const findings = [];
  let parsed;
  try {
    parsed = parseToml(text);
  } catch {
    findings.push('pyproject.toml is not valid TOML');
    return findings;
  }

  const project = parsed.project || {};
  for (const field of REQUIRED_PROJECT_FIELDS) {
    const v = project[field];
    if (v === undefined || v === null || v === '') {
      findings.push(`pyproject.toml [project] missing required field '${field}'`);
    }
  }

  const buildSystem = parsed['build-system'] || {};
  if (!buildSystem['build-backend']) {
    findings.push('pyproject.toml [build-system] missing build-backend');
  }

  if (!hasLicenseFile) {
    findings.push('LICENSE file missing at repo root');
  }

  return findings;
}

export function checkPypiPublish(name, localVersion, response) {
  const findings = [];
  if (response.status === 404) {
    findings.push(`Package \`${name}\` is not published on PyPI`);
    return findings;
  }
  if (response.status !== 200) {
    // 5xx, network error, etc — silent (no finding) per spec.
    return findings;
  }
  const info = response.body?.info || {};
  if (info.version && info.version !== localVersion) {
    findings.push(`pyproject.toml version ${localVersion} ahead of latest PyPI release ${info.version}`);
  }
  if (info.description_content_type && info.description_content_type !== 'text/markdown') {
    findings.push(`PyPI description_content_type is '${info.description_content_type}' — README will not render correctly (expected 'text/markdown')`);
  }
  return findings;
}

async function fetchPypi(name) {
  try {
    const r = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, {
      headers: { 'User-Agent': 'yggdrasil-audit/1.0' },
    });
    if (r.status >= 200 && r.status < 300) {
      return { status: r.status, body: await r.json() };
    }
    return { status: r.status };
  } catch {
    return { status: 0 };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = join(ROOT, 'data');
  const mcps = yaml.load(readFileSync(join(dataDir, 'mcp-servers.yaml'), 'utf-8')).servers;
  let totalFindings = 0;

  for (const mcp of mcps) {
    if (mcp.status !== 'released') continue;
    const slug = mcp.slug;
    const findings = [];

    const tomlText = ghFetchFile(ORG, slug, 'pyproject.toml');
    if (!tomlText) {
      findings.push('pyproject.toml missing at repo root');
    } else {
      const license = ghFetchFile(ORG, slug, 'LICENSE');
      findings.push(...checkPyproject(tomlText, license !== null));

      try {
        const parsed = parseToml(tomlText);
        const name = parsed.project?.name;
        const version = parsed.project?.version;
        if (name && version) {
          const pypi = await fetchPypi(name);
          findings.push(...checkPypiPublish(name, version, pypi));
        }
      } catch {
        // Already reported as invalid TOML.
      }
    }

    appendGroup(REPORT_PATH, slug, findings);
    totalFindings += findings.length;
  }

  console.log(`audit-pypi: ${totalFindings} finding(s) appended to ${REPORT_PATH}`);
}
```

- [ ] **Step 5: Run test, see it pass**

Run: `npm run test:scripts`
Expected: PASS — 9 new tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/sync-gallery/_fixtures/pyproject-good.toml scripts/sync-gallery/_fixtures/pyproject-missing-fields.toml scripts/sync-gallery/audit-pypi.mjs scripts/sync-gallery/audit-pypi.test.mjs
git commit -m "feat(sync-gallery): add PyPI conformance audit"
```

---

## Task 5: audit-readme-format.mjs

**Files:**
- Create: `scripts/sync-gallery/_fixtures/readme-shopline.md` (snapshot of golden sample)
- Create: `scripts/sync-gallery/_fixtures/readme-incomplete.md`
- Create: `scripts/sync-gallery/audit-readme-format.mjs`
- Create: `scripts/sync-gallery/audit-readme-format.test.mjs`

- [ ] **Step 1: Snapshot mcp-shopline README to a fixture**

Run:

```bash
gh api 'repos/asgard-ai-platform/mcp-shopline/contents/README.md' --jq '.content' \
  | base64 -d > scripts/sync-gallery/_fixtures/readme-shopline.md
```

Expected: file exists, is several KB, starts with `# MCP Shopline`.

- [ ] **Step 2: Create the incomplete fixture**

Create `scripts/sync-gallery/_fixtures/readme-incomplete.md`:

```markdown
# MCP Foo

Short blurb that says nothing.

## Quick Start

Run it.

## License

MIT.
```

- [ ] **Step 3: Write failing test**

Create `scripts/sync-gallery/audit-readme-format.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkReadme } from './audit-readme-format.mjs';

const FIXTURES = resolve(new URL('.', import.meta.url).pathname, '_fixtures');

test('shopline fixture passes (golden sample)', () => {
  const text = readFileSync(join(FIXTURES, 'readme-shopline.md'), 'utf-8');
  const findings = checkReadme(text, 143);
  assert.deepEqual(
    findings,
    [],
    `Golden sample must pass cleanly; got: ${JSON.stringify(findings, null, 2)}`,
  );
});

test('incomplete fixture flags every missing piece', () => {
  const text = readFileSync(join(FIXTURES, 'readme-incomplete.md'), 'utf-8');
  const findings = checkReadme(text, 0);
  assert.ok(findings.some(f => /Badge missing: PyPI version/.test(f)));
  assert.ok(findings.some(f => /繁體中文/.test(f)));
  assert.ok(findings.some(f => /What This Does/.test(f)));
  assert.ok(findings.some(f => /Tools \(N\)/.test(f)));
});

test('declared tools count mismatch flagged', () => {
  const text = readFileSync(join(FIXTURES, 'readme-shopline.md'), 'utf-8');
  const findings = checkReadme(text, 999);
  assert.ok(findings.some(f => /999/.test(f)));
});

test('H1 not matching MCP <Name> pattern flagged', () => {
  const findings = checkReadme('# Random Heading\n\n## Quick Start\n', 0);
  assert.ok(findings.some(f => /H1.*MCP/.test(f)));
});
```

- [ ] **Step 4: Run test, see it fail**

Run: `npm run test:scripts`
Expected: FAIL — `Cannot find module './audit-readme-format.mjs'`.

- [ ] **Step 5: Implement audit-readme-format.mjs**

Create `scripts/sync-gallery/audit-readme-format.mjs`:

```js
#!/usr/bin/env node
/**
 * audit-readme-format.mjs
 *
 * Validate each released MCP repo's README.md against the golden sample
 * structure (mcp-shopline). Findings are appended under each mcp-* group
 * in the audit report.
 *
 * Calibration: mcp-shopline must pass with zero findings. If a rule
 * triggers on shopline, the rule is wrong, not shopline.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { ghFetchFile, appendGroup } from './_lib.mjs';

const ORG = 'asgard-ai-platform';
const ROOT = resolve(new URL('.', import.meta.url).pathname, '../..');
const REPORT_PATH = join(ROOT, 'scripts/sync-gallery/_generated/repo-audit-report.md');

const REQUIRED_BADGES = [
  { name: 'PyPI version',       pattern: /img\.shields\.io\/pypi\/v\// },
  { name: 'Python versions',    pattern: /img\.shields\.io\/pypi\/pyversions\// },
  { name: 'License',            pattern: /\bLicense:\s*MIT\b|License-MIT/ },
  { name: 'GitHub stars',       pattern: /img\.shields\.io\/github\/stars\// },
  { name: 'GitHub issues',      pattern: /img\.shields\.io\/github\/issues\// },
  { name: 'GitHub last commit', pattern: /img\.shields\.io\/github\/last-commit\// },
  { name: 'MCP compatible',     pattern: /MCP-compatible/ },
];

const REQUIRED_H2 = ['What This Does', 'Quick Start', 'License'];
const REQUIRED_QUICKSTART_H3 = ['Install', 'Use with Claude Code', 'Use with Claude Desktop'];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function checkReadme(text, expectedToolsCount) {
  const findings = [];
  const lines = text.split('\n');

  // 1. H1
  const h1Line = lines.find(l => /^#\s+/.test(l));
  if (!h1Line) {
    findings.push('H1 heading missing');
  } else if (!/^#\s+MCP\s+\S+/.test(h1Line)) {
    findings.push(`H1 does not match "# MCP <ServiceName>": "${h1Line.trim()}"`);
  }

  // 2. Pre-H2 region: badges + intro + 繁體中文 link
  const firstH2Idx = lines.findIndex(l => /^##\s+/.test(l));
  const preface = (firstH2Idx === -1 ? lines : lines.slice(0, firstH2Idx)).join('\n');

  for (const badge of REQUIRED_BADGES) {
    if (!badge.pattern.test(preface)) {
      findings.push(`Badge missing: ${badge.name}`);
    }
  }
  if (!/\[繁體中文\]\(README\.zh-TW\.md\)/.test(preface)) {
    findings.push('Missing [繁體中文](README.zh-TW.md) link');
  }

  // 3. Required H2 sections
  const h2Titles = lines
    .filter(l => /^##\s+/.test(l))
    .map(l => l.replace(/^##\s+/, '').trim());

  for (const required of REQUIRED_H2) {
    if (!h2Titles.includes(required)) {
      findings.push(`Required section missing: ## ${required}`);
    }
  }

  // 4. ## Tools (N)
  const toolsTitle = h2Titles.find(t => /^Tools \(\d+\)$/.test(t));
  if (!toolsTitle) {
    findings.push('Required section missing: ## Tools (N)');
  } else if (expectedToolsCount > 0) {
    const declaredN = parseInt(toolsTitle.match(/\((\d+)\)/)[1]);
    if (declaredN !== expectedToolsCount) {
      findings.push(`## ${toolsTitle} declares ${declaredN} but YAML tools_count is ${expectedToolsCount}`);
    }
  }

  // 5. Quick Start subsections
  if (h2Titles.includes('Quick Start')) {
    const startIdx = lines.findIndex(l => l.trim() === '## Quick Start');
    const nextH2Idx = lines.findIndex((l, i) => i > startIdx && /^##\s+/.test(l));
    const block = lines.slice(startIdx, nextH2Idx === -1 ? lines.length : nextH2Idx).join('\n');
    for (const h3 of REQUIRED_QUICKSTART_H3) {
      const re = new RegExp(`^###\\s+${escapeRegex(h3)}\\b`, 'm');
      if (!re.test(block)) {
        findings.push(`## Quick Start: missing ### ${h3}`);
      }
    }
    if (!/```bash\s*\n[\s\S]*?pip install\s+\S+/.test(block)) {
      findings.push('## Quick Start ### Install: missing fenced `pip install` code block');
    }
  }

  return findings;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = join(ROOT, 'data');
  const mcps = yaml.load(readFileSync(join(dataDir, 'mcp-servers.yaml'), 'utf-8')).servers;
  let totalFindings = 0;

  for (const mcp of mcps) {
    if (mcp.status !== 'released') continue;
    const readme = ghFetchFile(ORG, mcp.slug, 'README.md');
    if (!readme) {
      appendGroup(REPORT_PATH, mcp.slug, ['README.md missing or unreachable']);
      totalFindings++;
      continue;
    }
    const findings = checkReadme(readme, mcp.tools_count || 0);
    appendGroup(REPORT_PATH, mcp.slug, findings);
    totalFindings += findings.length;
  }

  console.log(`audit-readme-format: ${totalFindings} finding(s) appended to ${REPORT_PATH}`);
}
```

- [ ] **Step 6: Run test, see it pass**

Run: `npm run test:scripts`
Expected: PASS — 4 new tests. **The shopline-fixture test must pass cleanly. If it doesn't, the rule set has drifted from the golden sample — adjust the regex in `REQUIRED_BADGES` or the section-name lists until shopline passes. Do not relax tests to pass.**

- [ ] **Step 7: Commit**

```bash
git add scripts/sync-gallery/_fixtures/readme-shopline.md scripts/sync-gallery/_fixtures/readme-incomplete.md scripts/sync-gallery/audit-readme-format.mjs scripts/sync-gallery/audit-readme-format.test.mjs
git commit -m "feat(sync-gallery): add README golden-sample audit"
```

---

## Task 6: post-audit-issues.mjs

**Files:**
- Create: `scripts/sync-gallery/_fixtures/repo-audit-report-sample.md`
- Create: `scripts/sync-gallery/post-audit-issues.mjs`
- Create: `scripts/sync-gallery/post-audit-issues.test.mjs`

- [ ] **Step 1: Create the sample-report fixture**

Create `scripts/sync-gallery/_fixtures/repo-audit-report-sample.md`:

```markdown
# Open-source repo audit report

Generated: 2026-05-07T00:00:00Z
Total issues: 4 across 3 repos

## mcp-shopline

- pyproject.toml [project] missing required field 'classifiers'
- README badge missing: GitHub last commit

## skills

- Orphan YAML entry: skill `skill-foo` references directory `foo` which is no longer in the skills repo

## asgard-opensource-gallery

- Orphan YAML entry: `mcp-deleted` is marked released but the upstream repo no longer exists or is private
```

- [ ] **Step 2: Write failing test**

Create `scripts/sync-gallery/post-audit-issues.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseReport, formatIssueBody, MARKER_COMMENT } from './post-audit-issues.mjs';

const FIXTURES = resolve(new URL('.', import.meta.url).pathname, '_fixtures');

test('parseReport groups bullets by H2 repo headers', () => {
  const md = readFileSync(join(FIXTURES, 'repo-audit-report-sample.md'), 'utf-8');
  const groups = parseReport(md);
  assert.deepEqual(Object.keys(groups).sort(), ['asgard-opensource-gallery', 'mcp-shopline', 'skills']);
  assert.equal(groups['mcp-shopline'].length, 2);
  assert.match(groups['mcp-shopline'][0], /classifiers/);
  assert.equal(groups.skills.length, 1);
});

test('parseReport ignores leading H1 and preamble', () => {
  const md = '# Header\n\nPreamble line.\n\n## mcp-foo\n\n- finding-1\n';
  const groups = parseReport(md);
  assert.deepEqual(Object.keys(groups), ['mcp-foo']);
  assert.deepEqual(groups['mcp-foo'], ['finding-1']);
});

test('parseReport returns empty when no H2 sections', () => {
  const groups = parseReport('# Just a title\n\nSome text.');
  assert.deepEqual(groups, {});
});

test('formatIssueBody includes marker, timestamp, and findings', () => {
  const body = formatIssueBody({
    repo: 'mcp-shopline',
    findings: ['finding A', 'finding B'],
    runId: 12345,
    timestamp: '2026-05-07T00:00:00Z',
  });
  assert.match(body, /Last updated: 2026-05-07T00:00:00Z/);
  assert.match(body, /run #12345/);
  assert.match(body, /- ⚠️ finding A/);
  assert.match(body, /- ⚠️ finding B/);
  assert.ok(body.includes(MARKER_COMMENT));
});

test('formatIssueBody mentions correct fix location for gallery findings', () => {
  const body = formatIssueBody({
    repo: 'asgard-opensource-gallery',
    findings: ['x'], runId: 1, timestamp: 't',
  });
  assert.match(body, /asgard-opensource-gallery/);
});
```

- [ ] **Step 3: Run test, see it fail**

Run: `npm run test:scripts`
Expected: FAIL — `Cannot find module './post-audit-issues.mjs'`.

- [ ] **Step 4: Implement post-audit-issues.mjs**

Create `scripts/sync-gallery/post-audit-issues.mjs`:

```js
#!/usr/bin/env node
/**
 * post-audit-issues.mjs <path-to-report.md>
 *
 * Parse a per-repo audit report (markdown with `## <repo-slug>` headings,
 * each followed by `- finding` bullets) and post or update one tracking
 * issue per repo on github.com/asgard-ai-platform.
 *
 * Existing tracking issue is identified by the label `yggdrasil-audit`,
 * with fallback to a marker comment in the body if label search fails.
 *
 * All shell-out uses execFileSync with argv arrays (no shell parsing).
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ORG = 'asgard-ai-platform';
const LABEL = 'yggdrasil-audit';
const TITLE = '[yggdrasil-audit] Gallery sync report';
export const MARKER_COMMENT = '<!-- yggdrasil-audit:auto-managed -->';

export function parseReport(md) {
  const groups = {};
  const lines = md.split('\n');
  let current = null;
  for (const line of lines) {
    const h2 = line.match(/^##\s+(\S.*?)\s*$/);
    if (h2) {
      current = h2[1].trim();
      groups[current] = [];
      continue;
    }
    if (current === null) continue;
    const bullet = line.match(/^-\s+(.+)$/);
    if (bullet) {
      groups[current].push(bullet[1].trim());
    }
  }
  for (const k of Object.keys(groups)) {
    if (groups[k].length === 0) delete groups[k];
  }
  return groups;
}

export function formatIssueBody({ repo, findings, runId, timestamp }) {
  const fixHint =
    repo === 'asgard-opensource-gallery'
      ? 'Open a PR on this repo (`asgard-opensource-gallery`) to update the YAML.'
      : repo === 'skills'
      ? 'Either fix the SKILL.md in this repo or open a PR on `asgard-ai-platform/asgard-opensource-gallery` to update the YAML.'
      : 'Either fix the source (this repo) or open a PR on `asgard-ai-platform/asgard-opensource-gallery` to update the YAML.';

  const findingLines = findings.map(f => `- ⚠️ ${f}`).join('\n');

  return [
    `> Auto-maintained by Yggdrasil gallery audit. Last updated: ${timestamp} (run #${runId}).`,
    '',
    '## Findings',
    '',
    findingLines,
    '',
    '## What to do',
    '',
    fixHint,
    'When all findings are resolved, close this issue manually.',
    '',
    MARKER_COMMENT,
    '',
  ].join('\n');
}

function gh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf-8',
    timeout: 20000,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function findExistingIssue(repo) {
  try {
    const out = gh([
      'issue', 'list',
      '--repo', `${ORG}/${repo}`,
      '--state', 'open',
      '--label', LABEL,
      '--limit', '1',
      '--json', 'number,body',
    ]);
    const arr = JSON.parse(out);
    if (arr.length > 0) return arr[0];
  } catch {
    // Label may not exist on the repo yet — fall through.
  }
  try {
    const out = gh([
      'issue', 'list',
      '--repo', `${ORG}/${repo}`,
      '--state', 'open',
      '--search', MARKER_COMMENT,
      '--limit', '5',
      '--json', 'number,body',
    ]);
    const arr = JSON.parse(out);
    return arr.find(i => i.body && i.body.includes(MARKER_COMMENT)) || null;
  } catch {
    return null;
  }
}

function ensureLabelExists(repo) {
  try {
    gh([
      'label', 'create', LABEL,
      '--repo', `${ORG}/${repo}`,
      '--color', 'BFD4F2',
      '--description', 'Auto-maintained by Yggdrasil gallery audit',
      '--force',
    ]);
  } catch {
    // Already exists, or token lacks label-create scope. Non-fatal.
  }
}

function postOrUpdate(repo, findings) {
  const runId = process.env.GITHUB_RUN_ID || 'local';
  const timestamp = new Date().toISOString();
  const body = formatIssueBody({ repo, findings, runId, timestamp });
  const existing = findExistingIssue(repo);
  const tmpFile = `/tmp/yggdrasil-audit-${repo}-${process.pid}.md`;
  writeFileSync(tmpFile, body, 'utf-8');
  try {
    if (existing) {
      gh([
        'issue', 'edit', String(existing.number),
        '--repo', `${ORG}/${repo}`,
        '--body-file', tmpFile,
      ]);
      return { repo, action: 'updated', number: existing.number };
    } else {
      ensureLabelExists(repo);
      const out = gh([
        'issue', 'create',
        '--repo', `${ORG}/${repo}`,
        '--title', TITLE,
        '--label', LABEL,
        '--body-file', tmpFile,
      ]);
      return { repo, action: 'created', url: out };
    }
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const reportPath = process.argv[2];
  if (!reportPath) {
    console.error('usage: post-audit-issues.mjs <path-to-report.md>');
    process.exit(2);
  }
  const md = readFileSync(reportPath, 'utf-8');
  const groups = parseReport(md);
  const errors = [];
  for (const [repo, findings] of Object.entries(groups)) {
    try {
      const r = postOrUpdate(repo, findings);
      console.log(`${r.action}: ${r.repo} (${r.number || r.url})`);
    } catch (e) {
      console.error(`FAILED for ${repo}: ${e.message}`);
      errors.push(repo);
    }
  }
  if (errors.length > 0) {
    console.error(`\n${errors.length} repo(s) failed: ${errors.join(', ')}`);
    process.exit(1);
  }
}
```

- [ ] **Step 5: Run test, see it pass**

Run: `npm run test:scripts`
Expected: PASS — 5 new tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/sync-gallery/_fixtures/repo-audit-report-sample.md scripts/sync-gallery/post-audit-issues.mjs scripts/sync-gallery/post-audit-issues.test.mjs
git commit -m "feat(sync-gallery): add post-audit-issues to dispatch findings"
```

---

## Task 7: sync-content.yml

**Files:**
- Create: `.github/workflows/sync-content.yml`

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/sync-content.yml`:

```yaml
name: Sync gallery content
on:
  schedule:
    - cron: '0 18 * * 0'    # Sunday 18:00 UTC = Mon 02:00 TW
  workflow_dispatch:

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

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
      - name: Verify token
        run: gh api user > /dev/null
      - run: node scripts/sync-gallery/sync-mcp-content.mjs
      - run: node scripts/sync-gallery/sync-skill-content.mjs
      - name: Sanity-check sync output
        run: node scripts/sync-gallery/check-sync-thresholds.mjs
      - run: npm run validate
      - run: npm run build
      - uses: peter-evans/create-pull-request@v7
        with:
          branch: chore/sync-gallery-content
          title: 'chore: sync MCP & skill content from upstream'
          body: |
            Auto-generated by `sync-content.yml`.

            See workflow run for processed counts and any sanity-threshold output.
          commit-message: 'chore: sync MCP & skill content'
          delete-branch: false
          add-paths: |
            data/**
```

- [ ] **Step 2: Validate workflow YAML parses**

Run:

```bash
node --input-type=commonjs -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/sync-content.yml','utf-8'));console.log('OK')"
```

Expected: prints `OK`. (The `--input-type=commonjs` flag overrides this project's `"type": "module"` for the inline script so the legacy `require` works.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/sync-content.yml
git commit -m "ci: add weekly gallery content sync workflow"
```

---

## Task 8: audit-content.yml

**Files:**
- Create: `.github/workflows/audit-content.yml`

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/audit-content.yml`:

```yaml
name: Audit gallery content
on:
  schedule:
    - cron: '0 19 * * *'    # Daily 19:00 UTC = 03:00 TW
  workflow_dispatch:

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

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
      - name: Verify token
        run: gh api user > /dev/null
      - run: node scripts/sync-gallery/generate-new-entries.mjs
      - run: node scripts/sync-gallery/audit-pypi.mjs
      - run: node scripts/sync-gallery/audit-readme-format.mjs
      - run: node scripts/sync-gallery/audit-orphans.mjs
      - run: node scripts/sync-gallery/post-audit-issues.mjs scripts/sync-gallery/_generated/repo-audit-report.md
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: repo-audit-report
          path: scripts/sync-gallery/_generated/repo-audit-report.md
```

- [ ] **Step 2: Validate workflow YAML parses**

Run:

```bash
node --input-type=commonjs -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/audit-content.yml','utf-8'));console.log('OK')"
```

Expected: prints `OK`.

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/audit-content.yml
git commit -m "ci: add daily gallery content audit workflow"
git push origin main
```

---

## Task 9: Manual workflow_dispatch validation

This task has no commits — it validates the live workflows before the cron schedule is relied on.

- [ ] **Step 1: Trigger sync workflow manually**

Run:

```bash
gh workflow run sync-content.yml --ref main
gh run list --workflow=sync-content.yml --limit 1
gh run watch
```

- [ ] **Step 2: Verify sync result**

Expected:
- Job completes green.
- `gh pr list --base main --head chore/sync-gallery-content` shows zero (no drift) or one PR.
- If a PR opened, `gh pr diff <number>` only changes files under `data/`.
- Build smoke test step passed.

If the sanity-check step fails: inspect the failed log; the most likely cause is `secrets.GH_TOKEN` lacking read access to all `mcp-*` repos.

- [ ] **Step 3: Trigger audit workflow manually**

Run:

```bash
gh workflow run audit-content.yml --ref main
gh run list --workflow=audit-content.yml --limit 1
gh run watch
```

- [ ] **Step 4: Verify audit result**

Expected:
- Job completes green.
- For each `mcp-*` repo with findings: an issue titled `[yggdrasil-audit] Gallery sync report` exists with label `yggdrasil-audit` and the marker comment in body.
- The `skills` repo has at most one such issue.
- The `asgard-opensource-gallery` repo has at most one such issue (orphans).
- Workflow-run artifact `repo-audit-report` contains the markdown.
- The artifact does NOT contain `new-mcp-entries.yaml` or `new-skill-entries.yaml`.

Inspect a couple of the created issues:

```bash
gh issue list --repo asgard-ai-platform/mcp-shopline --label yggdrasil-audit
gh issue view <number> --repo asgard-ai-platform/mcp-shopline
```

- [ ] **Step 5: Confirm second run is idempotent**

Trigger audit again:

```bash
gh workflow run audit-content.yml --ref main
gh run watch
```

Expected:
- No new duplicate issues (existing issues are edited, not recreated).
- Issue body's `Last updated:` timestamp advanced.
- Issue count unchanged.

- [ ] **Step 6: Hand-off**

Once both workflows run cleanly via `workflow_dispatch`, the cron schedules take over automatically (`0 18 * * 0` for sync, `0 19 * * *` for audit). No further action.

---

## Test summary

After all tasks complete, `npm run test:scripts` runs:

- `_lib.test.mjs` — 3 tests
- `check-sync-thresholds.test.mjs` — 5 tests
- `audit-orphans.test.mjs` — 4 tests
- `audit-pypi.test.mjs` — 9 tests
- `audit-readme-format.test.mjs` — 4 tests
- `post-audit-issues.test.mjs` — 5 tests

**Total: 30 unit tests.** All should pass. The shopline-fixture test in `audit-readme-format.test.mjs` is the calibration anchor — if it ever fails, the rules drifted from the golden sample and need re-tuning (the golden sample is correct, the rule is wrong).

---

## Out of scope for this plan (per spec follow-ups)

These are deferred to follow-up plans:

- Refactor `sync-skill-content.mjs` `updateYamlDescriptions` to use `yaml.dump` round-trip (escape fragility on backslash / newline / control chars).
- Atomic file writes in existing sync scripts.
- Retry-with-backoff around `gh api`.
- Add table-row `tools_count` regex pattern to `generate-new-entries.mjs` to match the legacy bash audit's fourth pattern.
- Auto-close stale `yggdrasil-audit` issues whose repo no longer appears in any report.
- A PR-time `validate.yml` workflow.
