import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseRepo,
  parsePluginManifest,
  parseMarketplace,
  buildSourceBlock,
  harnessSlug,
  parseInstallSection,
  parseEnvExample,
  classifySetupStatus,
  buildSetup,
  parseUseCases,
  assemblePackContent,
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
test('parseRepo: look-alike host (notgithub.com) → null', () => {
  assert.equal(parseRepo('https://notgithub.com/foo/bar'), null);
});
test('parseRepo: github.com subdomain still parses', () => {
  assert.deepEqual(parseRepo('https://www.github.com/foo/bar'), { owner: 'foo', repo: 'bar' });
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
  const block = buildSourceBlock(
    parsePluginManifest(pluginJson),
    parseMarketplace(marketplaceJson),
    repo,
    '.claude-plugin/marketplace.json',
  );
  assert.equal(block.version, '0.1.0');
  assert.equal(block.license, 'MIT');
  assert.equal(block.homepage, 'https://github.com/asgard-ai-platform/tw-ecommerce-majordomo');
  assert.equal(
    block.manifest_urls[0],
    'https://github.com/asgard-ai-platform/tw-ecommerce-majordomo/blob/HEAD/.claude-plugin/plugin.json',
  );
  assert.equal(
    block.manifest_urls[1],
    'https://github.com/asgard-ai-platform/tw-ecommerce-majordomo/blob/HEAD/.claude-plugin/marketplace.json',
  );
  assert.equal(block.marketplace.name, 'tw-ecommerce-majordomo');
  assert.equal(block.marketplace.source, './');
});
test('buildSourceBlock: root marketplace.json path is reflected in manifest_urls', () => {
  const repo = { owner: 'o', repo: 'r' };
  const block = buildSourceBlock(parsePluginManifest(pluginJson), parseMarketplace(marketplaceJson), repo, 'marketplace.json');
  assert.equal(block.manifest_urls[1], 'https://github.com/o/r/blob/HEAD/marketplace.json');
});
test('buildSourceBlock: no marketplace path → only the plugin.json url', () => {
  const repo = { owner: 'o', repo: 'r' };
  const block = buildSourceBlock(parsePluginManifest(pluginJson), null, repo, null);
  assert.equal(block.manifest_urls.length, 1);
  assert.match(block.manifest_urls[0], /\/\.claude-plugin\/plugin\.json$/);
  assert.equal('marketplace' in block, false);
});

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
test('parseEnvExample: empty var with an "only for …" comment is conditional, not always', () => {
  const ecpay = parseEnvExample(envExample)[0];
  const platform = ecpay.vars.find((v) => v.name === 'ECPAY_PLATFORM_ID');
  assert.equal(platform.required_when, 'conditional');
  assert.equal(platform.description, 'only for ecpay (special-merchant flow)');
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
test('parseUseCases: a stray later fence is not captured as the prompt; fields survive', () => {
  // Prompt label with NO fence right after, then other fields, then an
  // unrelated fenced block. The prompt window must close at the first
  // non-Prompt field so the stray fence is ignored and fields stay intact.
  const md = [
    '### 1.1 Title',
    '**情境：** scenario text',
    '**Prompt 範例：**',
    '**會用到的 skills：** `a`、`b`',
    '**會用到的 MCPs：** `m`',
    '**注意：** caveat text',
    '```',
    'unrelated example block',
    '```',
  ].join('\n');
  const c = parseUseCases(md)[0];
  assert.equal(c.prompt, undefined);
  assert.deepEqual(c.skills, ['a', 'b']);
  assert.deepEqual(c.mcp_servers, ['m']);
  assert.equal(c.caveats, 'caveat text');
});
test('parseUseCases: multi-fence use case — prompt fence + code fence; fields survive both fences', () => {
  const md = [
    '### 1.1 Title',
    '**情境：** scenario text',
    '**Prompt 範例：**',
    '```',
    'the prompt',
    '```',
    '**會用到的 skills：** `a`、`b`',
    '```',
    'a code example',
    '```',
    '**注意：** caveat text',
  ].join('\n');
  const c = parseUseCases(md)[0];
  assert.equal(c.prompt, 'the prompt');
  assert.deepEqual(c.skills, ['a', 'b']);
  assert.equal(c.caveats, 'caveat text');
});

test('parseUseCases: a real prompt fence still captures, and a trailing fence does not override it', () => {
  const md = [
    '### 2.1 Title',
    '**Prompt 範例：**',
    '```',
    'the real prompt',
    '```',
    '**會用到的 skills：** `a`',
    '**注意：** c',
    '```',
    'extra',
    '```',
  ].join('\n');
  const c = parseUseCases(md)[0];
  assert.equal(c.prompt, 'the real prompt');
  assert.deepEqual(c.skills, ['a']);
});

// ── assemblePackContent (end-to-end over all fixtures) ──
test('assemblePackContent: full majordomo entry shape', () => {
  const entry = assemblePackContent({
    repo: { owner: 'asgard-ai-platform', repo: 'tw-ecommerce-majordomo' },
    pluginManifest: parsePluginManifest(pluginJson),
    marketplace: parseMarketplace(marketplaceJson),
    marketplacePath: '.claude-plugin/marketplace.json',
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
  assert.equal(entry.source.manifest_urls.length, 2);
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
  // marketplace arg was null → buildSourceBlock omits the marketplace key
  assert.equal('marketplace' in entry.source, false);
});
