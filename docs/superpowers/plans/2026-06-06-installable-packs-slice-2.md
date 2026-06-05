# Installable Packs — Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the sync-time **`pack-content.json` extractor** — a Node script under `scripts/sync-gallery/` that reads each installable pack's repo manifests (`.claude-plugin/plugin.json`, `marketplace.json`, `.env.example`, `docs/USE-CASES.md`, `README.md`) and emits a **committed** sidecar (`data/pack-content.json`) holding the install commands, setup/credentials model, and use-cases. Plus the `PackContent` TypeScript interface + loader (deferred from Slice 1).

**⚠ Ships with slices 1 & 3, not alone.** Slice 2 produces the experience *data* but nothing renders it yet — the pack detail page that consumes `pack-content.json` is Slice 3. Treat slices 1–3 as one production-facing release. Slice 2 is an internal, independently-reviewable increment: its output is verified by the unit tests, the committed JSON, and `npm run build`.

**Architecture:** A new extractor `scripts/sync-gallery/sync-pack-content.mjs` follows the exact shape of the existing `sync-mcp-content.mjs` — small **pure, exported parser functions** (unit-tested against fixtures via `node --test`) plus a thin `main()` I/O shell that fetches via `gh` (reusing `_lib.mjs`'s `ghFetchFile`), assembles per-pack entries, and writes the sidecar. The extractor iterates `data/plugins.yaml` entries with `kind: pack` (only `tw-ecommerce-majordomo` today), degrades gracefully per repo (keep-last-good on fetch failure, log skips), and runs at **sync time** — the Cloudflare Pages build only reads the committed JSON, making no network calls. The loader gains `getPackContent()` / `getPackContentBySlug()` mirroring `getMcpContent()`.

**Tech Stack:** Node 22 ESM (`.mjs`), `node:test` + `node:assert/strict` (run via `npm run test:scripts`), `gh` CLI, `js-yaml`, Astro/TypeScript (loader + interface), no new dependencies.

**Source spec:** `docs/superpowers/specs/2026-06-05-installable-packs-experience-design.md` — install/extraction §6, data model §7, schema/type §8, slice list §11.2, prerequisites §10.

**Testing reality (read before starting):** This repo has **no unit-test runner for `src/`** (Astro/TS) — only `node --test scripts/sync-gallery/*.test.mjs` (`npm run test:scripts`) and Playwright (`e2e/`). So: the extractor's **pure parsers are unit-tested** (`sync-pack-content.test.mjs`); the **loader + interface are verified through `npm run build`** (a build error is the failing signal), matching repo convention. There is no Playwright work in this slice (no UI yet — that's Slice 3).

---

## Scope decisions (read before starting — two deliberate deviations from the spec sketch)

1. **`content_maturity` is deferred to Slice 3, not populated here.** Spec §6 enumerates exactly five extractor sources, and none is the per-skill `SKILL.md` body that maturity requires; the screen that displays maturity (§5.2 ④ "What's inside") is Slice 3. Populating it now would mean 29 extra per-skill fetches and guessing the slice-3 join key. So: the `PackContent.content_maturity` field is **defined as optional** in the interface (so Slice 3 adds it with no type change) but the extractor emits entries **without** it. This mirrors how Slice 1 deferred the `PackContent` interface itself rather than defining an unused shape.

2. **`PackContent` lives in `src/utils/data-loader.ts`, not `src/types.ts`.** Spec §8 says "add a `PackContent` interface" to `types.ts`, but the two analogous sidecar interfaces — `McpContent` and `SkillContent` — both live in `data-loader.ts` next to their loaders (`src/utils/data-loader.ts:69-115`). Following the established pattern (type next to loader/consumer) over the spec's literal placement keeps the three sidecar interfaces together and is the CLAUDE.md "follow established patterns" call.

3. **Per-harness install commands come from the README `## 安裝` section, not reconstructed from `marketplace.json`.** Spec §6 lists `marketplace.json → marketplace install name/source` and wants "Tabs per harness: Claude Code first … if the install path actually supports it." The pack's README `## 安裝` section is the author-maintained source of truth for **every** supported harness (Claude Code, Codex, Cursor, Antigravity, OpenCode, Factory Droid), already ordered Claude-Code-first, with the exact commands and "what this does" prose. So the install **commands** are parsed from the README; `marketplace.json` is still read and recorded under `source` (marketplace name + source path + manifest URLs) for provenance.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/utils/data-loader.ts` | modify | `PackContent` interface (+ sub-types) and `getPackContent()` / `getPackContentBySlug()` loaders, mirroring the `McpContent` block |
| `scripts/sync-gallery/sync-pack-content.mjs` | create | The extractor: pure parsers (`parseRepo`, `parsePluginManifest`, `parseMarketplace`, `buildSourceBlock`, `parseInstallSection`, `parseEnvExample`, `classifySetupStatus`, `buildSetup`, `parseUseCases`, `assemblePackContent`) + `main()` I/O shell |
| `scripts/sync-gallery/sync-pack-content.test.mjs` | create | `node --test` unit tests for every pure parser + the assembler |
| `scripts/sync-gallery/_fixtures/pack-majordomo-plugin.json` | create | Trimmed real `.claude-plugin/plugin.json` fixture |
| `scripts/sync-gallery/_fixtures/pack-majordomo-marketplace.json` | create | Real `.claude-plugin/marketplace.json` fixture |
| `scripts/sync-gallery/_fixtures/pack-majordomo-README.md` | create | The real `## 安裝` README section fixture |
| `scripts/sync-gallery/_fixtures/pack-majordomo.env.example` | create | Trimmed real `.env.example` fixture (3 provider groups) |
| `scripts/sync-gallery/_fixtures/pack-majordomo-USE-CASES.md` | create | Trimmed real `docs/USE-CASES.md` fixture (2 use cases) |
| `data/pack-content.json` | create | The committed extractor output (generated live by running the script in Task 7) |
| `.github/workflows/sync-content.yml` | modify | Add a `sync-pack-content.mjs` run step |

---

## Task 1: `PackContent` interface + loader

**Files:**
- Modify: `src/utils/data-loader.ts` (append after the `McpContent` block, currently ending at `src/utils/data-loader.ts:115`)

- [ ] **Step 1: Add the `PackContent` interface and loaders**

Append to the end of `src/utils/data-loader.ts` (after `getMcpContentBySlug`). This mirrors the `McpContent` + `getMcpContent` + `getMcpContentBySlug` block immediately above it (cached read of a JSON sidecar keyed by slug; `{}` when the file is absent so `npm run build` works before the sidecar exists):

```ts
/** One harness's install tab, parsed from the pack README's install section. */
export interface PackInstall {
  harness: string;
  label: string;
  command: string;
  source: string;
  notes?: string;
}

/** A single credential the user may need to set, parsed from `.env.example`. */
export interface PackEnvVar {
  name: string;
  required_when?: string;
  default?: string;
  description?: string;
  source: string;
}

/** Credentials grouped by provider/MCP, from `.env.example` divider blocks. */
export interface PackEnvGroup {
  service: string;
  mcp_slug?: string;
  default_mode?: string;
  docs_url?: string;
  private?: boolean;
  vars: PackEnvVar[];
}

export interface PackSetup {
  status: 'none' | 'sandbox-ready' | 'keys-required';
  summary: string;
  env_groups: PackEnvGroup[];
}

/** One scenario from `docs/USE-CASES.md`. skills/mcp_servers are the pack-local
 *  names exactly as written in the doc (not gallery slugs). */
export interface PackUseCase {
  title: string;
  scenario?: string;
  prompt?: string;
  skills: string[];
  mcp_servers: string[];
  caveats?: string;
  maturity?: string;
}

export interface PackSource {
  version?: string;
  license?: string;
  repository?: string;
  homepage?: string;
  keywords: string[];
  manifest_urls: string[];
  marketplace?: { name?: string; source?: string };
}

/** The sync-extracted, committed sidecar entry for one pack (`data/pack-content.json`),
 *  keyed by gallery plugin slug. content_maturity is populated in Slice 3 (see plan §Scope). */
export interface PackContent {
  install: PackInstall[];
  setup: PackSetup;
  use_cases: PackUseCase[];
  content_maturity?: Record<string, 'full' | 'skeleton' | 'unknown'>;
  source: PackSource;
}

let _packContentCache: Record<string, PackContent> | null = null;

export function getPackContent(): Record<string, PackContent> {
  if (_packContentCache) return _packContentCache;
  const filePath = path.join(DATA_DIR, 'pack-content.json');
  if (!fs.existsSync(filePath)) return {};
  _packContentCache = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return _packContentCache!;
}

export function getPackContentBySlug(slug: string): PackContent | undefined {
  return getPackContent()[slug];
}
```

- [ ] **Step 2: Verify the build compiles with the new interface + loaders**

Run: `npm run build`
Expected: build completes (`[build] N page(s) built`), no TypeScript errors. `data/pack-content.json` does not exist yet, so `getPackContent()` returns `{}` — but nothing calls it yet, so the build is unaffected. Page count unchanged from `main`.

- [ ] **Step 3: Commit**

```bash
git add src/utils/data-loader.ts
git commit -m "feat(packs): add PackContent interface + pack-content.json loader"
```

---

## Task 2: Extractor scaffold + JSON-manifest parsers (`plugin.json`, `marketplace.json`, source block)

**Files:**
- Create: `scripts/sync-gallery/sync-pack-content.mjs`
- Create: `scripts/sync-gallery/_fixtures/pack-majordomo-plugin.json`
- Create: `scripts/sync-gallery/_fixtures/pack-majordomo-marketplace.json`
- Create: `scripts/sync-gallery/sync-pack-content.test.mjs`

- [ ] **Step 1: Create the two JSON fixtures**

Create `scripts/sync-gallery/_fixtures/pack-majordomo-plugin.json` (a trimmed-but-real `.claude-plugin/plugin.json` — 3 of the 12 MCP servers are enough to exercise env-key extraction):

```json
{
  "name": "tw-ecommerce-majordomo",
  "description": "台灣電商總管：29 個 tw-ecom-* skills ＋ 12 個 asgard MCP servers。",
  "version": "0.1.0",
  "author": {
    "name": "Asgard AI Platform",
    "url": "https://github.com/asgard-ai-platform"
  },
  "homepage": "https://github.com/asgard-ai-platform/tw-ecommerce-majordomo",
  "repository": "https://github.com/asgard-ai-platform/tw-ecommerce-majordomo",
  "license": "MIT",
  "keywords": ["taiwan", "ecommerce", "skills", "mcp", "ecpay", "newebpay"],
  "skills": "./skills/",
  "mcpServers": {
    "ecpay": {
      "command": "uvx",
      "args": ["--from", "git+https://github.com/asgard-ai-platform/mcp-ecpay@main", "mcp-ecpay"],
      "env": {
        "ECPAY_ENV": "${ECPAY_ENV:-stage}",
        "ECPAY_MERCHANT_ID": "${ECPAY_MERCHANT_ID}",
        "ECPAY_HASH_KEY": "${ECPAY_HASH_KEY}"
      }
    },
    "sf-express": {
      "command": "uvx",
      "args": ["--from", "git+https://github.com/asgard-ai-platform/mcp-sf-express@main", "mcp-sf-express"],
      "env": {
        "SF_ENV": "${SF_ENV:-sandbox}",
        "SF_PARTNER_ID": "${SF_PARTNER_ID}"
      }
    },
    "91app": {
      "command": "uvx",
      "args": ["--from", "git+https://github.com/asgard-ai-platform/mcp-91app@main", "mcp-91app"],
      "env": {
        "APP_91APP_API_KEY": "${APP_91APP_API_KEY}"
      }
    }
  }
}
```

Create `scripts/sync-gallery/_fixtures/pack-majordomo-marketplace.json` (the real `.claude-plugin/marketplace.json`):

```json
{
  "name": "tw-ecommerce-majordomo",
  "description": "Marketplace for the Taiwan e-commerce majordomo plugin: 29 tw-ecom-* skills + 12 asgard MCP servers.",
  "owner": {
    "name": "Asgard AI Platform",
    "url": "https://github.com/asgard-ai-platform"
  },
  "plugins": [
    {
      "name": "tw-ecommerce-majordomo",
      "description": "台灣電商總管：金流／物流／DTC／marketplace／電子發票／合規／營運／分析 — 29 skills + 12 MCPs.",
      "version": "0.1.0",
      "source": "./",
      "author": {
        "name": "Asgard AI Platform",
        "url": "https://github.com/asgard-ai-platform"
      }
    }
  ]
}
```

- [ ] **Step 2: Create the extractor file with the scaffold + JSON-manifest parsers**

Create `scripts/sync-gallery/sync-pack-content.mjs`. This is the first slice of the file; later tasks append more parsers and the `main()` block. The header comment and imports mirror `sync-mcp-content.mjs`; the `gh` I/O is delegated to `_lib.mjs`'s `ghFetchFile` (the newer convention).

```js
#!/usr/bin/env node
/**
 * sync-pack-content.mjs
 * For each installable pack (data/plugins.yaml entries with kind: pack), fetches
 * the pack repo's manifests (.claude-plugin/plugin.json, marketplace.json,
 * .env.example, docs/USE-CASES.md, README.md) and extracts a structured entry
 * into data/pack-content.json (committed sidecar, read at deploy with no network).
 *
 * Runs at SYNC time, not deploy time. Degrades gracefully per repo:
 * a fetch failure keeps the last-good entry rather than aborting the sync.
 *
 * Usage: node scripts/sync-gallery/sync-pack-content.mjs
 */
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { ghFetchFile } from './_lib.mjs';

const ROOT = resolve(new URL('.', import.meta.url).pathname, '../..');
const DATA_DIR = join(ROOT, 'data');
const PLUGINS_YAML = join(DATA_DIR, 'plugins.yaml');
const OUTPUT_JSON = join(DATA_DIR, 'pack-content.json');

// ── Pure parsers ─────────────────────────────────────────────────

/** Parse `{owner, repo}` from a github URL; null if it isn't one. */
export function parseRepo(githubUrl) {
  const m = (githubUrl || '').match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
}

/** Extract the fields we keep from `.claude-plugin/plugin.json`. */
export function parsePluginManifest(json) {
  if (!json) return null;
  const mcpServers =
    json.mcpServers && typeof json.mcpServers === 'object'
      ? Object.entries(json.mcpServers).map(([name, cfg]) => ({
          name,
          env_keys: Object.keys((cfg && cfg.env) || {}),
        }))
      : [];
  return {
    name: json.name,
    version: json.version,
    license: json.license,
    homepage: json.homepage,
    repository: typeof json.repository === 'string' ? json.repository : json.repository?.url,
    author: json.author,
    keywords: Array.isArray(json.keywords) ? json.keywords : [],
    skills_dir: typeof json.skills === 'string' ? json.skills : undefined,
    mcp_servers: mcpServers,
  };
}

/** Extract `{name, source}` from `marketplace.json` (first plugin entry). */
export function parseMarketplace(json) {
  if (!json) return null;
  const plugin = Array.isArray(json.plugins) ? json.plugins[0] : null;
  return { name: json.name, source: (plugin && plugin.source) || './' };
}

/** Build the `source` provenance block from the plugin manifest + marketplace. */
export function buildSourceBlock(plugin, marketplace, repo) {
  const base = `https://github.com/${repo.owner}/${repo.repo}/blob/HEAD`;
  const block = {
    version: plugin?.version,
    license: plugin?.license,
    repository: plugin?.repository || `https://github.com/${repo.owner}/${repo.repo}`,
    homepage: plugin?.homepage,
    keywords: plugin?.keywords || [],
    manifest_urls: [
      `${base}/.claude-plugin/plugin.json`,
      `${base}/.claude-plugin/marketplace.json`,
    ],
  };
  if (marketplace) block.marketplace = { name: marketplace.name, source: marketplace.source };
  return block;
}
```

- [ ] **Step 3: Write the failing tests for the JSON-manifest parsers**

Create `scripts/sync-gallery/sync-pack-content.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseRepo,
  parsePluginManifest,
  parseMarketplace,
  buildSourceBlock,
} from './sync-pack-content.mjs';

const FIX = new URL('./_fixtures/', import.meta.url).pathname;
const readFix = (name) => readFileSync(join(FIX, name), 'utf-8');
const pluginJson = JSON.parse(readFix('pack-majordomo-plugin.json'));
const marketplaceJson = JSON.parse(readFix('pack-majordomo-marketplace.json'));

// ── parseRepo ──
test('parseRepo: owner/repo from https URL', () => {
  assert.deepEqual(parseRepo('https://github.com/asgard-ai-platform/tw-ecommerce-majordomo'), {
    owner: 'asgard-ai-platform',
    repo: 'tw-ecommerce-majordomo',
  });
});
test('parseRepo: strips trailing .git', () => {
  assert.deepEqual(parseRepo('https://github.com/foo/bar.git'), { owner: 'foo', repo: 'bar' });
});
test('parseRepo: non-github → null', () => {
  assert.equal(parseRepo('https://example.com/x'), null);
  assert.equal(parseRepo(undefined), null);
});

// ── parsePluginManifest ──
test('parsePluginManifest: core fields', () => {
  const p = parsePluginManifest(pluginJson);
  assert.equal(p.name, 'tw-ecommerce-majordomo');
  assert.equal(p.version, '0.1.0');
  assert.equal(p.license, 'MIT');
  assert.equal(p.repository, 'https://github.com/asgard-ai-platform/tw-ecommerce-majordomo');
  assert.equal(p.skills_dir, './skills/');
  assert.deepEqual(p.keywords, ['taiwan', 'ecommerce', 'skills', 'mcp', 'ecpay', 'newebpay']);
});
test('parsePluginManifest: mcpServers → names + env_keys', () => {
  const p = parsePluginManifest(pluginJson);
  assert.deepEqual(p.mcp_servers.map((m) => m.name), ['ecpay', 'sf-express', '91app']);
  assert.deepEqual(p.mcp_servers[0].env_keys, ['ECPAY_ENV', 'ECPAY_MERCHANT_ID', 'ECPAY_HASH_KEY']);
});
test('parsePluginManifest: null in → null out', () => {
  assert.equal(parsePluginManifest(null), null);
});

// ── parseMarketplace ──
test('parseMarketplace: name + first plugin source', () => {
  assert.deepEqual(parseMarketplace(marketplaceJson), {
    name: 'tw-ecommerce-majordomo',
    source: './',
  });
});
test('parseMarketplace: null in → null out', () => {
  assert.equal(parseMarketplace(null), null);
});

// ── buildSourceBlock ──
test('buildSourceBlock: provenance from manifest + marketplace', () => {
  const repo = { owner: 'asgard-ai-platform', repo: 'tw-ecommerce-majordomo' };
  const block = buildSourceBlock(parsePluginManifest(pluginJson), parseMarketplace(marketplaceJson), repo);
  assert.equal(block.version, '0.1.0');
  assert.equal(block.license, 'MIT');
  assert.equal(block.homepage, 'https://github.com/asgard-ai-platform/tw-ecommerce-majordomo');
  assert.equal(
    block.manifest_urls[0],
    'https://github.com/asgard-ai-platform/tw-ecommerce-majordomo/blob/HEAD/.claude-plugin/plugin.json',
  );
  assert.equal(block.marketplace.name, 'tw-ecommerce-majordomo');
  assert.equal(block.marketplace.source, './');
});
```

- [ ] **Step 4: Run the tests — expect PASS (parsers were written in Step 2)**

Run: `npm run test:scripts`
Expected: all `sync-pack-content.test.mjs` tests pass, and the pre-existing `*.test.mjs` suites still pass (this task only adds a new test file). If a parser assertion fails, fix the parser in `sync-pack-content.mjs` — not the test.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-gallery/sync-pack-content.mjs scripts/sync-gallery/sync-pack-content.test.mjs scripts/sync-gallery/_fixtures/pack-majordomo-plugin.json scripts/sync-gallery/_fixtures/pack-majordomo-marketplace.json
git commit -m "feat(packs): pack-content extractor scaffold + plugin/marketplace manifest parsers"
```

---

## Task 3: Install-tab parser (README `## 安裝` section)

**Files:**
- Modify: `scripts/sync-gallery/sync-pack-content.mjs` (append the install parser)
- Create: `scripts/sync-gallery/_fixtures/pack-majordomo-README.md`
- Modify: `scripts/sync-gallery/sync-pack-content.test.mjs` (append install tests)

- [ ] **Step 1: Create the README fixture (the real `## 安裝` section, bounded by neighbouring H2s)**

Create `scripts/sync-gallery/_fixtures/pack-majordomo-README.md`:

````markdown
# tw-ecommerce-majordomo

> 一個 plugin 把 29 個 skills 和 12 個 MCP servers 一次塞進你的 coding agent。

## 前置需求

- 對應的 agent harness
- [`uv`](https://docs.astral.sh/uv/)

## 安裝

### Claude Code

```bash
# 註冊本 plugin 的 marketplace
/plugin marketplace add asgard-ai-platform/tw-ecommerce-majordomo

# 安裝
/plugin install tw-ecommerce-majordomo@tw-ecommerce-majordomo
```

### Codex CLI / App

```bash
# CLI
/plugins
# 搜尋 "tw-ecommerce-majordomo" → Install
```

或在 Codex App 的 Plugins 頁面搜尋安裝。

### Cursor

```bash
cursor plugin add asgard-ai-platform/tw-ecommerce-majordomo
```

> Cursor plugin 目前不會自動註冊 MCP servers — 把 [`mcp.json`](mcp.json) 的 `mcpServers` 區塊複製進 `~/.cursor/mcp.json`。

### Antigravity CLI (agy)

```bash
git clone https://github.com/asgard-ai-platform/tw-ecommerce-majordomo \
  .agents/plugins/tw-ecommerce-majordomo
```

### OpenCode

在 `opencode.json`（global 或 project）加入：

```json
{
  "plugin": ["tw-ecommerce-majordomo@git+https://github.com/asgard-ai-platform/tw-ecommerce-majordomo.git"]
}
```

### Factory Droid

```bash
droid plugin marketplace add https://github.com/asgard-ai-platform/tw-ecommerce-majordomo
droid plugin install tw-ecommerce-majordomo@tw-ecommerce-majordomo
```

## 設定 MCP 憑證

1. 把 `.env.example` 複製成 `.env`
````

- [ ] **Step 2: Append the install parser to `sync-pack-content.mjs`**

Add to `scripts/sync-gallery/sync-pack-content.mjs` (after `buildSourceBlock`):

```js
/** Map a harness heading label to a stable slug for the install tab. */
export function harnessSlug(label) {
  const map = {
    'claude code': 'claude-code',
    'codex cli / app': 'codex',
    cursor: 'cursor',
    'antigravity cli (agy)': 'antigravity',
    opencode: 'opencode',
    'factory droid': 'factory-droid',
  };
  const key = label.trim().toLowerCase();
  if (map[key]) return map[key];
  return key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function finalizeInstall(cur) {
  const notes = cur.notes.join(' ').trim();
  const entry = {
    harness: harnessSlug(cur.label),
    label: cur.label,
    command: cur.code.join('\n').trim(),
    source: 'README.md#安裝',
  };
  if (notes) entry.notes = notes;
  return entry;
}

/**
 * Parse the README "## 安裝" (or "## Install") section into one install tab per
 * "### <harness>" subsection. The tab's `command` is the content of that
 * subsection's FIRST fenced code block; any other prose (including `>` notes)
 * becomes `notes`. Returns [] when there is no install section.
 */
export function parseInstallSection(readme) {
  if (!readme) return [];
  const lines = readme.split('\n');
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    // NB: `\b` after a CJK char (裝) never matches in JS regex, so use (?:\s|$).
    if (start < 0 && /^##\s+(安裝|Install)(?:\s|$)/.test(lines[i])) {
      start = i + 1;
      continue;
    }
    if (start >= 0 && /^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (start < 0) return [];

  const entries = [];
  let cur = null;
  let inCode = false;
  let codeDone = false;
  for (const line of lines.slice(start, end)) {
    if (/^###\s+/.test(line) && !inCode) {
      if (cur) entries.push(finalizeInstall(cur));
      cur = { label: line.replace(/^###\s+/, '').trim(), code: [], notes: [] };
      codeDone = false;
      continue;
    }
    if (!cur) continue;
    if (/^\s*```/.test(line)) {
      if (!inCode) inCode = true;
      else {
        inCode = false;
        codeDone = true; // only the first fenced block is the command
      }
      continue;
    }
    if (inCode) {
      if (!codeDone) cur.code.push(line);
      continue;
    }
    const txt = line.replace(/^>\s?/, '').trim();
    if (txt) cur.notes.push(txt);
  }
  if (cur) entries.push(finalizeInstall(cur));
  return entries;
}
```

- [ ] **Step 3: Append install tests**

Add to `scripts/sync-gallery/sync-pack-content.test.mjs` (extend the import from `./sync-pack-content.mjs` to also bring in `harnessSlug, parseInstallSection`, then append):

```js
const readmeMd = readFix('pack-majordomo-README.md');

// ── harnessSlug ──
test('harnessSlug: known labels map to stable slugs', () => {
  assert.equal(harnessSlug('Claude Code'), 'claude-code');
  assert.equal(harnessSlug('Codex CLI / App'), 'codex');
  assert.equal(harnessSlug('Antigravity CLI (agy)'), 'antigravity');
  assert.equal(harnessSlug('Factory Droid'), 'factory-droid');
});
test('harnessSlug: unknown label slugifies', () => {
  assert.equal(harnessSlug('Some New Harness!'), 'some-new-harness');
});

// ── parseInstallSection ──
test('parseInstallSection: six harness tabs in README order, Claude Code first', () => {
  const tabs = parseInstallSection(readmeMd);
  assert.deepEqual(
    tabs.map((t) => t.harness),
    ['claude-code', 'codex', 'cursor', 'antigravity', 'opencode', 'factory-droid'],
  );
});
test('parseInstallSection: Claude Code command holds both slash commands', () => {
  const tabs = parseInstallSection(readmeMd);
  const cc = tabs[0];
  assert.equal(cc.source, 'README.md#安裝');
  assert.match(cc.command, /\/plugin marketplace add asgard-ai-platform\/tw-ecommerce-majordomo/);
  assert.match(cc.command, /\/plugin install tw-ecommerce-majordomo@tw-ecommerce-majordomo/);
});
test('parseInstallSection: Cursor tab captures the mcp.json note as notes', () => {
  const cursor = parseInstallSection(readmeMd).find((t) => t.harness === 'cursor');
  assert.match(cursor.command, /cursor plugin add asgard-ai-platform\/tw-ecommerce-majordomo/);
  assert.match(cursor.notes, /mcp\.json/);
});
test('parseInstallSection: OpenCode command is the JSON plugin block', () => {
  const oc = parseInstallSection(readmeMd).find((t) => t.harness === 'opencode');
  assert.match(oc.command, /"plugin":/);
  assert.match(oc.command, /git\+https:\/\/github\.com\/asgard-ai-platform\/tw-ecommerce-majordomo\.git/);
});
test('parseInstallSection: no install section → []', () => {
  assert.deepEqual(parseInstallSection('# Title\n\n## Other\n\ntext'), []);
});
```

- [ ] **Step 4: Run the tests — expect PASS**

Run: `npm run test:scripts`
Expected: the new install tests pass alongside Task 2's. If `parseInstallSection` mis-orders tabs or leaks a second fence into `command`, fix the parser.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-gallery/sync-pack-content.mjs scripts/sync-gallery/sync-pack-content.test.mjs scripts/sync-gallery/_fixtures/pack-majordomo-README.md
git commit -m "feat(packs): parse per-harness install tabs from pack README install section"
```

---

## Task 4: `.env.example` parser + setup-status classifier

**Files:**
- Modify: `scripts/sync-gallery/sync-pack-content.mjs` (append the env parser + classifier + `buildSetup`)
- Create: `scripts/sync-gallery/_fixtures/pack-majordomo.env.example`
- Modify: `scripts/sync-gallery/sync-pack-content.test.mjs` (append setup tests)

- [ ] **Step 1: Create the `.env.example` fixture (banner + 3 real provider groups)**

Create `scripts/sync-gallery/_fixtures/pack-majordomo.env.example`:

```
# =============================================================================
# tw-ecommerce-majordomo — Consolidated MCP credentials
# =============================================================================
# Copy to .env and fill in only the values for the MCP servers you want to use.

# -----------------------------------------------------------------------------
# ECPay 綠界 — payment + (separately) logistics
#   MCPs: ecpay, ecpay-logistics
# -----------------------------------------------------------------------------
ECPAY_ENV=stage                  # stage | prod
ECPAY_MERCHANT_ID=
ECPAY_HASH_KEY=
ECPAY_HASH_IV=
ECPAY_PLATFORM_ID=               # only for ecpay (special-merchant flow)

# -----------------------------------------------------------------------------
# SF Express 順豐 — OAuth2 + std/service
#   MCP: sf-express
# -----------------------------------------------------------------------------
SF_ENV=sandbox                   # sandbox | prod
SF_PARTNER_ID=
SF_SECRET=

# -----------------------------------------------------------------------------
# 91APP — DTC platform (multi-auth: Admin / IMS / Payments / Member)
#   MCP: 91app    (PRIVATE repo — requires asgard-ai-platform org access)
# -----------------------------------------------------------------------------
APP_91APP_API_KEY=
APP_91APP_BASE_URL=https://api.91app.com
APP_91APP_SHOP_ID=0
```

- [ ] **Step 2: Append the env parser, classifier, and `buildSetup`**

Add to `scripts/sync-gallery/sync-pack-content.mjs`:

```js
/** Parse one `KEY=value   # comment` line into an env var record. */
function parseVarLine(name, rest) {
  const hash = rest.indexOf('#');
  const rawVal = (hash >= 0 ? rest.slice(0, hash) : rest).trim();
  const comment = hash >= 0 ? rest.slice(hash + 1).trim() : '';
  const v = { name, source: '.env.example' };
  if (rawVal) v.default = rawVal;
  if (comment) v.description = comment;
  if (!rawVal) v.required_when = 'always'; // no shipped default ⇒ user must fill it
  return v;
}

/** Turn a block of `# ...` header comment lines into a group skeleton, or null
 *  if the block is not a provider group (it must carry a `#   MCP:`/`MCPs:` line). */
function headerToGroup(headerLines) {
  const stripped = headerLines.map((l) => l.replace(/^#\s?/, '').trimEnd());
  const mcpLine = stripped.find((l) => /^MCPs?:/.test(l.trim()));
  if (!mcpLine) return null;
  const serviceLine = stripped.find((l) => l.includes('—'));
  const service = serviceLine ? serviceLine.split('—')[0].trim() : stripped[0].trim();
  const mcpsRaw = mcpLine.trim().replace(/^MCPs?:/, '').trim();
  const isPrivate = /PRIVATE/i.test(mcpsRaw);
  const mcpSlugs = mcpsRaw
    .replace(/\(.*?\)/g, '') // drop "(PRIVATE …)" note before splitting
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const group = { service, vars: [] };
  if (mcpSlugs.length === 1) group.mcp_slug = mcpSlugs[0];
  if (isPrivate) group.private = true;
  return group;
}

/**
 * Parse a pack `.env.example` into provider-grouped credentials. Groups are
 * delimited by `# ----` divider lines wrapping a comment header; the header's
 * `#   MCP(s):` line is the signal that a block is a real provider group (so the
 * file's top `# ====` banner is ignored). `default_mode` is taken from any
 * `*_ENV` var that ships a default.
 */
export function parseEnvExample(text) {
  if (!text) return [];
  const lines = text.split('\n');
  const groups = [];
  let header = [];
  let current = null;
  const isDivider = (l) => /^#\s*-{5,}\s*$/.test(l);
  for (const line of lines) {
    if (isDivider(line)) {
      if (header.length) {
        const g = headerToGroup(header);
        if (g) {
          groups.push(g);
          current = g;
        } else {
          current = null;
        }
        header = [];
      }
      continue;
    }
    if (/^\s*#/.test(line)) {
      header.push(line);
      continue;
    }
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && current) current.vars.push(parseVarLine(m[1], m[2]));
  }
  for (const g of groups) {
    const envVar = g.vars.find((v) => /_ENV$/.test(v.name) && v.default);
    if (envVar) g.default_mode = envVar.default;
  }
  return groups;
}

/** Classify the pack's setup burden into the 3 spec states (§3.2). */
export function classifySetupStatus(envGroups, mcpCount) {
  const vars = envGroups.flatMap((g) => g.vars);
  if (vars.length === 0) return 'none';
  const hasSandbox =
    envGroups.some((g) => g.default_mode) ||
    vars.some((v) => v.default && /^(stage|test|sandbox|dev|development|false)$/i.test(v.default));
  return hasSandbox ? 'sandbox-ready' : 'keys-required';
}

/** Build the `setup` block: status + a machine-generated summary + the groups. */
export function buildSetup(envGroups, mcpCount) {
  const status = classifySetupStatus(envGroups, mcpCount);
  const summary =
    status === 'none'
      ? 'No credentials required — install and use.'
      : status === 'sandbox-ready'
        ? `${mcpCount} MCP servers; sandbox/test defaults work out of the box — add provider keys only for the services you actually use.`
        : `${mcpCount} MCP servers; each needs real provider credentials before use.`;
  return { status, summary, env_groups: envGroups };
}
```

- [ ] **Step 3: Append setup tests**

Add to `scripts/sync-gallery/sync-pack-content.test.mjs` (extend the import to also bring in `parseEnvExample, classifySetupStatus, buildSetup`):

```js
const envExample = readFix('pack-majordomo.env.example');

// ── parseEnvExample ──
test('parseEnvExample: 3 provider groups (banner ignored)', () => {
  const groups = parseEnvExample(envExample);
  assert.deepEqual(groups.map((g) => g.service), ['ECPay 綠界', 'SF Express 順豐', '91APP']);
});
test('parseEnvExample: ECPay group — 2 MCPs ⇒ no single mcp_slug, default_mode=stage', () => {
  const ecpay = parseEnvExample(envExample)[0];
  assert.equal(ecpay.mcp_slug, undefined);
  assert.equal(ecpay.default_mode, 'stage');
  assert.deepEqual(ecpay.vars[0], {
    name: 'ECPAY_ENV',
    source: '.env.example',
    default: 'stage',
    description: 'stage | prod',
  });
  assert.deepEqual(ecpay.vars[1], {
    name: 'ECPAY_MERCHANT_ID',
    source: '.env.example',
    required_when: 'always',
  });
});
test('parseEnvExample: SF group — single mcp_slug + sandbox default_mode', () => {
  const sf = parseEnvExample(envExample)[1];
  assert.equal(sf.mcp_slug, 'sf-express');
  assert.equal(sf.default_mode, 'sandbox');
});
test('parseEnvExample: 91APP group flagged private; URL default kept', () => {
  const app = parseEnvExample(envExample)[2];
  assert.equal(app.mcp_slug, '91app');
  assert.equal(app.private, true);
  const baseUrl = app.vars.find((v) => v.name === 'APP_91APP_BASE_URL');
  assert.equal(baseUrl.default, 'https://api.91app.com');
  assert.equal(baseUrl.required_when, undefined);
});
test('parseEnvExample: empty/absent input → []', () => {
  assert.deepEqual(parseEnvExample(''), []);
  assert.deepEqual(parseEnvExample(undefined), []);
});

// ── classifySetupStatus ──
test('classifySetupStatus: majordomo → sandbox-ready', () => {
  assert.equal(classifySetupStatus(parseEnvExample(envExample), 12), 'sandbox-ready');
});
test('classifySetupStatus: no env vars → none (emba shape)', () => {
  assert.equal(classifySetupStatus([], 0), 'none');
});
test('classifySetupStatus: only hard secrets, no sandbox path → keys-required', () => {
  const groups = [
    { service: 'X', vars: [{ name: 'X_TOKEN', source: '.env.example', required_when: 'always' }] },
  ];
  assert.equal(classifySetupStatus(groups, 1), 'keys-required');
});

// ── buildSetup ──
test('buildSetup: sandbox-ready summary mentions the MCP count', () => {
  const setup = buildSetup(parseEnvExample(envExample), 12);
  assert.equal(setup.status, 'sandbox-ready');
  assert.match(setup.summary, /12 MCP servers/);
  assert.equal(setup.env_groups.length, 3);
});
test('buildSetup: none status for a 0-MCP pack', () => {
  const setup = buildSetup([], 0);
  assert.equal(setup.status, 'none');
  assert.match(setup.summary, /No credentials required/);
});
```

- [ ] **Step 4: Run the tests — expect PASS**

Run: `npm run test:scripts`
Expected: all env/setup tests pass. If `parseEnvExample` produces a bogus group from the banner or mis-attributes vars across providers, fix `headerToGroup` / the divider walk — the assertions encode the intended shape.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-gallery/sync-pack-content.mjs scripts/sync-gallery/sync-pack-content.test.mjs scripts/sync-gallery/_fixtures/pack-majordomo.env.example
git commit -m "feat(packs): parse .env.example into provider groups + classify setup status"
```

---

## Task 5: `docs/USE-CASES.md` parser

**Files:**
- Modify: `scripts/sync-gallery/sync-pack-content.mjs` (append the use-case parser)
- Create: `scripts/sync-gallery/_fixtures/pack-majordomo-USE-CASES.md`
- Modify: `scripts/sync-gallery/sync-pack-content.test.mjs` (append use-case tests)

- [ ] **Step 1: Create the USE-CASES fixture (preamble + 2 real use cases)**

Create `scripts/sync-gallery/_fixtures/pack-majordomo-USE-CASES.md`:

````markdown
# Use Cases — tw-ecommerce-majordomo

> 把 29 個 `tw-ecom-*` skills 與 12 個 MCP servers 組合起來，可以服務的台灣電商情境。

---

## 1. 開店建置

### 1.1 在 Shopline 開新店，全套金物流發票串接

**情境：** 客戶要在 Shopline 開新店，需要同步把信用卡 / ATM / 超商代碼 / 超商取貨付款 / 電子發票串好。

**Prompt 範例：**
```
我要在 Shopline 開新店，幫我規劃金流（含信用卡 + ATM + 超商代碼 + 超商取貨付款）、
物流（黑貓 + 7-11 賣貨便）、電子發票（B2C 雲端發票 + 載具），給我串接順序與每段要驗證的 callback。
```

**會用到的 skills：** `tw-ecom-dtc-shopline`、`tw-ecom-payment-ecpay`、`tw-ecom-logistics-cvs`、`tw-ecom-invoice-ezpay`

**會用到的 MCPs：** `shopline`、`ecpay`、`ecpay-logistics`、`ezpay-einvoice`

**注意：** 超商取貨付款（COD）= ECPay 金流 + ECPay 物流綁定，必須走 combined 流程。發票要在出貨後 48 小時內開立。

---

### 1.2 從 Marketplace 起步：Shopee + momo 同時上架

**情境：** 新品牌沒有 DTC 站，先用 Shopee + momo 雙 marketplace 起步。

**Prompt 範例：**
```
我是新品牌，先不開 DTC，想在蝦皮和 momo 同時上架。幫我比較兩邊的上架審核、價格機制、出貨 SLA。
```

**會用到的 skills：** `tw-ecom-channel-strategy`、`tw-ecom-marketplace-shopee`、`tw-ecom-marketplace-momo`

**會用到的 MCPs：** 第一階段 marketplace API 主要靠 skill 內容；之後做 vendor portal 整合可加 `buy123-vendor`。

**注意：** momo 有 best-price 強制比價條款；蝦皮的 SIP 跨境計畫會自動同步商品到他國。

---

## 2. 商品 / 上架

> （其餘情境略）
````

- [ ] **Step 2: Append the use-case parser**

Add to `scripts/sync-gallery/sync-pack-content.mjs`:

```js
/** Pull the bare tokens out of every `backtick` span on a line. */
function backtickTokens(line) {
  return (line.match(/`([^`]+)`/g) || []).map((s) => s.replace(/`/g, ''));
}

/**
 * Parse `docs/USE-CASES.md` into scenarios. Each `### N.M <title>` heading is one
 * use case; its body carries `**情境：**`, a `**Prompt 範例：**` fenced block,
 * `**會用到的 skills：**` / `**會用到的 MCPs：**` backtick lists, and `**注意：**`.
 * skills/mcp_servers are kept as the pack-local names exactly as written.
 */
export function parseUseCases(md) {
  if (!md) return [];
  const lines = md.split('\n');
  const cases = [];
  let cur = null;
  let inFence = false;
  let promptLines = null; // non-null while collecting the prompt fence body

  const pushCur = () => {
    if (cur) cases.push(cur);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h3 = line.match(/^###\s+\d+\.\d+\s+(.+)$/);
    if (h3 && !inFence) {
      pushCur();
      cur = { title: h3[1].trim(), skills: [], mcp_servers: [] };
      promptLines = null;
      continue;
    }
    if (!cur) continue;

    if (/^\s*```/.test(line)) {
      if (!inFence && promptLines) {
        inFence = true; // opening the prompt fence
      } else if (inFence) {
        inFence = false;
        cur.prompt = promptLines.join('\n').trim();
        promptLines = null;
      }
      continue;
    }
    if (inFence) {
      promptLines.push(line);
      continue;
    }

    const field = line.match(/^\*\*(.+?)[:：]\*\*\s*(.*)$/);
    if (field) {
      const label = field[1].trim();
      const value = field[2].trim();
      if (/情境/.test(label)) cur.scenario = value;
      else if (/Prompt/i.test(label)) promptLines = []; // next fence is the prompt
      else if (/skills/i.test(label)) cur.skills = backtickTokens(line);
      else if (/MCP/i.test(label)) cur.mcp_servers = backtickTokens(line);
      else if (/注意/.test(label)) cur.caveats = value;
    }
  }
  pushCur();
  return cases;
}
```

- [ ] **Step 3: Append use-case tests**

Add to `scripts/sync-gallery/sync-pack-content.test.mjs` (extend the import to also bring in `parseUseCases`):

```js
const useCasesMd = readFix('pack-majordomo-USE-CASES.md');

// ── parseUseCases ──
test('parseUseCases: two scenarios parsed (preamble + section headers ignored)', () => {
  const cases = parseUseCases(useCasesMd);
  assert.equal(cases.length, 2);
  assert.equal(cases[0].title, '在 Shopline 開新店，全套金物流發票串接');
  assert.equal(cases[1].title, '從 Marketplace 起步：Shopee + momo 同時上架');
});
test('parseUseCases: case 1 fields', () => {
  const c = parseUseCases(useCasesMd)[0];
  assert.match(c.scenario, /客戶要在 Shopline 開新店/);
  assert.match(c.prompt, /我要在 Shopline 開新店/);
  assert.deepEqual(c.skills, [
    'tw-ecom-dtc-shopline',
    'tw-ecom-payment-ecpay',
    'tw-ecom-logistics-cvs',
    'tw-ecom-invoice-ezpay',
  ]);
  assert.deepEqual(c.mcp_servers, ['shopline', 'ecpay', 'ecpay-logistics', 'ezpay-einvoice']);
  assert.match(c.caveats, /48 小時內開立/);
});
test('parseUseCases: case 2 picks the single backticked MCP out of prose', () => {
  const c = parseUseCases(useCasesMd)[1];
  assert.deepEqual(c.mcp_servers, ['buy123-vendor']);
  assert.match(c.prompt, /蝦皮和 momo 同時上架/);
});
test('parseUseCases: empty/absent input → []', () => {
  assert.deepEqual(parseUseCases(''), []);
  assert.deepEqual(parseUseCases(undefined), []);
});
```

- [ ] **Step 4: Run the tests — expect PASS**

Run: `npm run test:scripts`
Expected: use-case tests pass. If the prompt fence leaks into the next field or backtick extraction misses a token, fix `parseUseCases`.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-gallery/sync-pack-content.mjs scripts/sync-gallery/sync-pack-content.test.mjs scripts/sync-gallery/_fixtures/pack-majordomo-USE-CASES.md
git commit -m "feat(packs): parse docs/USE-CASES.md into scenario/prompt/skills/mcp/caveats"
```

---

## Task 6: `assemblePackContent` (pure end-to-end assembler)

**Files:**
- Modify: `scripts/sync-gallery/sync-pack-content.mjs` (append the assembler)
- Modify: `scripts/sync-gallery/sync-pack-content.test.mjs` (append an integration test over all fixtures)

- [ ] **Step 1: Append `assemblePackContent`**

Add to `scripts/sync-gallery/sync-pack-content.mjs` (after `parseUseCases`):

```js
/**
 * Assemble one pack's `PackContent` entry from already-fetched raw sources.
 * Pure: the `main()` shell does the fetching, this does the shaping (so it is
 * unit-testable end-to-end against fixtures). `content_maturity` is intentionally
 * omitted in this slice (populated in Slice 3 — see the slice-2 plan §Scope).
 *
 * @param {object} s
 * @param {{owner:string,repo:string}} s.repo
 * @param {object|null} s.pluginManifest  parsed plugin.json
 * @param {object|null} s.marketplace     parsed marketplace.json
 * @param {string|null} s.readme          raw README.md text
 * @param {string|null} s.envExample      raw .env.example text
 * @param {string|null} s.useCases        raw docs/USE-CASES.md text
 * @param {number} s.mcpCount             mcp_servers.length from plugins.yaml
 */
export function assemblePackContent(s) {
  const envGroups = parseEnvExample(s.envExample);
  return {
    install: parseInstallSection(s.readme),
    setup: buildSetup(envGroups, s.mcpCount),
    use_cases: parseUseCases(s.useCases),
    source: buildSourceBlock(s.pluginManifest, s.marketplace, s.repo),
  };
}
```

- [ ] **Step 2: Append the integration test**

Add to `scripts/sync-gallery/sync-pack-content.test.mjs` (extend the import to also bring in `assemblePackContent`):

```js
// ── assemblePackContent (end-to-end over all fixtures) ──
test('assemblePackContent: full majordomo entry shape', () => {
  const entry = assemblePackContent({
    repo: { owner: 'asgard-ai-platform', repo: 'tw-ecommerce-majordomo' },
    pluginManifest: parsePluginManifest(pluginJson),
    marketplace: parseMarketplace(marketplaceJson),
    readme: readmeMd,
    envExample,
    useCases: useCasesMd,
    mcpCount: 12,
  });
  // install
  assert.equal(entry.install.length, 6);
  assert.equal(entry.install[0].harness, 'claude-code');
  // setup
  assert.equal(entry.setup.status, 'sandbox-ready');
  assert.equal(entry.setup.env_groups.length, 3);
  // use_cases
  assert.equal(entry.use_cases.length, 2);
  // source
  assert.equal(entry.source.version, '0.1.0');
  assert.equal(entry.source.marketplace.name, 'tw-ecommerce-majordomo');
  // content_maturity deferred to Slice 3 — must be absent here
  assert.equal('content_maturity' in entry, false);
});
test('assemblePackContent: degrades when optional sources are missing', () => {
  const entry = assemblePackContent({
    repo: { owner: 'x', repo: 'y' },
    pluginManifest: null,
    marketplace: null,
    readme: null,
    envExample: null,
    useCases: null,
    mcpCount: 0,
  });
  assert.deepEqual(entry.install, []);
  assert.equal(entry.setup.status, 'none');
  assert.deepEqual(entry.use_cases, []);
  assert.deepEqual(entry.source.keywords, []);
});
```

- [ ] **Step 3: Run the tests — expect PASS**

Run: `npm run test:scripts`
Expected: the two assembler tests pass alongside everything from Tasks 2–5.

- [ ] **Step 4: Commit**

```bash
git add scripts/sync-gallery/sync-pack-content.mjs scripts/sync-gallery/sync-pack-content.test.mjs
git commit -m "feat(packs): assemblePackContent — pure per-pack entry assembler"
```

---

## Task 7: `main()` I/O shell + generate the committed `data/pack-content.json`

**Files:**
- Modify: `scripts/sync-gallery/sync-pack-content.mjs` (append the CLI `main()` block)
- Create: `data/pack-content.json` (generated by running the script live)

- [ ] **Step 1: Append the `main()` block**

Add to the end of `scripts/sync-gallery/sync-pack-content.mjs`. The CLI-guard idiom (`import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href`) matches `sync-mcp-content.mjs` so importing the module in tests does not run the I/O. `ghJSONFile` decodes a fetched JSON file via the shared `ghFetchFile`. Keep-last-good: the previous `pack-content.json` is the baseline; a pack whose anchor (`plugin.json`) can't be fetched keeps its prior entry instead of being dropped.

```js
// ── I/O shell ────────────────────────────────────────────────────

/** Normalize CRLF → LF so the line-based parsers work on Windows-committed files. */
const normalizeText = (s) => (s == null ? s : s.replace(/\r\n?/g, '\n'));

/** Fetch + JSON-parse a file from a repo; null on any fetch/parse failure. */
function ghJSONFile(repo, filePath) {
  const raw = ghFetchFile(repo.owner, repo.repo, filePath);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  console.log('═══════════════════════════════════════════════════');
  console.log(' Sync Pack Content → data/pack-content.json');
  console.log('═══════════════════════════════════════════════════\n');

  const pluginsYaml = yaml.load(readFileSync(PLUGINS_YAML, 'utf-8'));
  const packs = (pluginsYaml.plugins || []).filter((p) => p.kind === 'pack');
  console.log(`[1/2] ${packs.length} pack(s) marked kind: pack in plugins.yaml\n`);

  // Prior committed entries, consulted per-pack for keep-last-good on a fetch
  // failure. `out` is rebuilt fresh (only currently-declared packs) so a pack
  // removed from plugins.yaml does not leave an orphaned entry behind.
  const prior = existsSync(OUTPUT_JSON) ? JSON.parse(readFileSync(OUTPUT_JSON, 'utf-8')) : {};
  const out = {};
  let extracted = 0;
  let kept = 0;
  let skipped = 0;

  for (const pack of packs) {
    process.stdout.write(`  ${pack.slug} ... `);
    const repo = parseRepo(pack.github);
    if (!repo) {
      console.log('⏭  no github URL');
      skipped++;
      continue;
    }
    const pluginRaw = ghJSONFile(repo, '.claude-plugin/plugin.json');
    if (!pluginRaw) {
      if (prior[pack.slug]) {
        out[pack.slug] = prior[pack.slug];
        console.log('⚠  plugin.json unreachable — keeping last-good entry');
        kept++;
      } else {
        console.log('⚠  plugin.json unreachable — skipped (no prior entry)');
        skipped++;
      }
      continue;
    }
    const marketplaceRaw =
      ghJSONFile(repo, '.claude-plugin/marketplace.json') || ghJSONFile(repo, 'marketplace.json');
    const readme = normalizeText(ghFetchFile(repo.owner, repo.repo, 'README.md'));
    const envExample = normalizeText(ghFetchFile(repo.owner, repo.repo, '.env.example'));
    const useCases = normalizeText(ghFetchFile(repo.owner, repo.repo, 'docs/USE-CASES.md'));

    out[pack.slug] = assemblePackContent({
      repo,
      pluginManifest: parsePluginManifest(pluginRaw),
      marketplace: parseMarketplace(marketplaceRaw),
      readme,
      envExample,
      useCases,
      mcpCount: Array.isArray(pack.mcp_servers) ? pack.mcp_servers.length : 0,
    });
    const c = out[pack.slug];
    console.log(
      `✅ ${c.install.length} install tab(s), setup=${c.setup.status}, ${c.use_cases.length} use case(s)`,
    );
    extracted++;
  }

  // Total wipeout guard: fail BEFORE writing so a transient total outage cannot
  // overwrite a good committed file with {} (mirrors check-sync-thresholds' intent).
  if (packs.length > 0 && Object.keys(out).length === 0) {
    console.error('::error::pack-content.json is empty despite packs being declared');
    process.exit(1);
  }

  console.log(`\n[2/2] Writing pack-content.json ...`);
  writeFileSync(OUTPUT_JSON, JSON.stringify(out, null, 2) + '\n', 'utf-8');
  console.log(`  ✅ ${extracted} extracted, ${kept} kept-last-good, ${skipped} skipped\n`);

  console.log('═══════════════════════════════════════════════════');
  console.log(' Done');
  console.log('═══════════════════════════════════════════════════');
}
```

- [ ] **Step 2: Confirm `gh` is authenticated (the extractor needs it)**

Run: `gh auth status`
Expected: "Logged in to github.com". If not, the user must run `gh auth login` (suggest they type `! gh auth login`). The repo `asgard-ai-platform/tw-ecommerce-majordomo` is public, so a normal token suffices.

- [ ] **Step 3: Generate the committed sidecar by running the extractor live**

Run: `node scripts/sync-gallery/sync-pack-content.mjs`
Expected output (the one pack):
```
  tw-ecommerce-majordomo ... ✅ 6 install tab(s), setup=sandbox-ready, N use case(s)
  ✅ 1 extracted, 0 kept-last-good, 0 skipped
```
`N` is the live count of `### x.y` headings in the real `docs/USE-CASES.md` (30+). This writes `data/pack-content.json`.

- [ ] **Step 4: Sanity-check the generated JSON**

Run:
```bash
node -e "const d=require('./data/pack-content.json'); const p=d['tw-ecommerce-majordomo']; console.log('install tabs:', p.install.map(t=>t.harness).join(',')); console.log('setup:', p.setup.status, '| groups:', p.setup.env_groups.length); console.log('use_cases:', p.use_cases.length); console.log('version:', p.source.version, '| keywords:', p.source.keywords.length); console.log('has content_maturity:', 'content_maturity' in p);"
```
Expected:
- `install tabs: claude-code,codex,cursor,antigravity,opencode,factory-droid`
- `setup: sandbox-ready | groups: 11` (the live `.env.example` has 11 provider groups — ECPay's two MCPs `ecpay`+`ecpay-logistics` share one provider section, so 12 MCPs map to 11 groups)
- `use_cases:` a number ≥ 20
- `version: 0.1.0 | keywords: 11`
- `has content_maturity: false`

If `setup` is not `sandbox-ready` or install tabs are missing, the live manifests differ from the fixtures — inspect and adjust the parser, do not hand-edit the JSON.

- [ ] **Step 5: Verify the build reads the new sidecar without error**

Run: `npm run build`
Expected: build succeeds. `getPackContent()` now finds the committed file but nothing consumes it yet (Slice 3), so page count is unchanged from `main`. (`validate` is unaffected — `pack-content.json` is not schema-validated, exactly like `mcp-content.json`.)

- [ ] **Step 6: Commit**

```bash
git add scripts/sync-gallery/sync-pack-content.mjs data/pack-content.json
git commit -m "feat(packs): pack-content.json extractor main() + generate committed sidecar"
```

---

## Task 8: Wire the extractor into the sync workflow + final verification

**Files:**
- Modify: `.github/workflows/sync-content.yml` (add a run step after `sync-skill-content.mjs`)

- [ ] **Step 1: Add the extractor to the sync workflow**

In `.github/workflows/sync-content.yml`, the run steps currently are (lines ~51-59):
```yaml
      - run: node scripts/sync-gallery/sync-mcp-content.mjs
      - run: node scripts/sync-gallery/sync-skill-content.mjs
      - name: Sanity-check sync output
        run: node scripts/sync-gallery/check-sync-thresholds.mjs
      - run: npm run validate
      - run: npm run build
```
Insert the pack extractor after the skill-content step:
```yaml
      - run: node scripts/sync-gallery/sync-mcp-content.mjs
      - run: node scripts/sync-gallery/sync-skill-content.mjs
      - run: node scripts/sync-gallery/sync-pack-content.mjs
      - name: Sanity-check sync output
        run: node scripts/sync-gallery/check-sync-thresholds.mjs
      - run: npm run validate
      - run: npm run build
```
No change is needed to the commit step — it already does `git add data/`, which picks up `data/pack-content.json`. `check-sync-thresholds.mjs` is left as-is (it covers MCP + skill sidecars; the pack extractor self-guards on total wipeout via its own exit code — see Task 7 Step 1).

- [ ] **Step 2: Run the full script test suite (no regressions)**

Run: `npm run test:scripts`
Expected: every `scripts/sync-gallery/*.test.mjs` passes — the pre-existing suites plus all `sync-pack-content.test.mjs` cases.

- [ ] **Step 3: Validate + build once more**

Run: `npm run validate && npm run build`
Expected: `✅ All checks passed!` then a clean build with the same page count as `main`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/sync-content.yml
git commit -m "ci(packs): run sync-pack-content.mjs in the gallery sync workflow"
```

---

## Final verification

- [ ] `npm run test:scripts` → all script suites green (existing + new `sync-pack-content.test.mjs`)
- [ ] `node scripts/sync-gallery/sync-pack-content.mjs` → `1 extracted, 0 kept-last-good, 0 skipped`
- [ ] `data/pack-content.json` committed; `tw-ecommerce-majordomo` entry has 6 install tabs, `setup.status === "sandbox-ready"`, 11 env groups (12 MCPs; ECPay merges two), ≥20 use cases, `source.version === "0.1.0"`, and **no** `content_maturity` key
- [ ] `npm run validate` → `✅ All checks passed!`
- [ ] `npm run build` → builds, page count unchanged vs `main`
- [ ] `.github/workflows/sync-content.yml` runs `sync-pack-content.mjs` between `sync-skill-content.mjs` and the threshold check

## Out of scope (later slices)

- **Pack detail page** that renders `pack-content.json` — split-hero, install tabs, setup accordions, use-cases-before-contents, `hasDepEdges` graph gate, handoff/self-test → **Slice 3**. This is the slice that makes the sidecar visible; until then the data is committed but unrendered.
- **`content_maturity` population** (the `<skill_slug> → full|skeleton|unknown` map) → **Slice 3**, deferred deliberately (plan §Scope decision 1). The field is defined as optional on `PackContent`; Slice 3 adds the per-`SKILL.md` extraction and the "What's inside" maturity display together.
- **Derived view-model** (`skill_count`, `mcp_count`, `skills_only`, `has_mcp`, `hasDepEdges`, `publisher_tier`) computed in the loader for the detail page → **Slice 3** (`publisher_tier` already exists from Slice 1 as `getPublisherTier`).
- **`emba-famulus` onboarding** — needs its 13 skills' canonical source decided (spec §10) before it can be added as `kind: pack`; once added, this same extractor produces its entry with `setup.status === "none"` and `install` parsed from its README. Note: the live repo is `github.com/asgard-ai-platform/emba-famulus`, which `getPublisherTier` would classify **Core**, conflicting with spec §1's "Community (@shyuan)" — resolve in **Slice 4**.
- **Extending `check-sync-thresholds.mjs`** to cover pack coverage → not needed for one pack (the extractor's own wipeout guard suffices); revisit if packs grow.
