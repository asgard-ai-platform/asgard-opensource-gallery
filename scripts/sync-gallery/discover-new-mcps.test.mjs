import test from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
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
    fetchRepoFn: () => null,
    fetchReadmeFn: () => null,
    fetchReadmeZhFn: () => null,
    isPrivateFn: () => true,
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].slug, 'mcp-secret');
  assert.equal(entries[0].nameEn, 'Secret');
  assert.match(entries[0].descEn, /MCP Server/);
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

test('buildMcpStubs: public repo with README but no parseable tools count emits an error', () => {
  // README exists but has no "N AI-callable tools" / "N MCP tools" pattern.
  // Original generate-new-entries.mjs flagged this; the port lost the check.
  const { errors } = buildMcpStubs({
    existingSlugs: new Set(),
    repoSlugs: ['mcp-no-toolcount'],
    fetchRepoFn: () => ({ description: 'd' }),
    fetchReadmeFn: () => '# Title\n\nReadme with no tool count phrasing.',
    fetchReadmeZhFn: () => '# Title',
    isPrivateFn: () => false,
  });
  assert.ok(errors.some(e => /tools_count not parseable/.test(e.issue)));
});

test('buildMcpStubs: private repo with unparseable tools count does NOT emit error', () => {
  const { errors } = buildMcpStubs({
    existingSlugs: new Set(),
    repoSlugs: ['mcp-secret-no-count'],
    fetchRepoFn: () => null,
    fetchReadmeFn: () => '# Title\n\nNo count.',
    fetchReadmeZhFn: () => null,
    isPrivateFn: () => true,
  });
  assert.deepEqual(errors, []);
});

test('buildMcpStubs: H1 that equals the slug is treated as placeholder', () => {
  // Real-world case: README's H1 is literally `# mcp-foo-bar`. Without the
  // guard the gallery title renders the slug; with it we fall back to a
  // title-cased name.
  const { entries } = buildMcpStubs({
    existingSlugs: new Set(),
    repoSlugs: ['mcp-foo-bar'],
    fetchRepoFn: () => ({ description: 'd' }),
    fetchReadmeFn: () => '# mcp-foo-bar\n\nIntro.',
    fetchReadmeZhFn: () => '# mcp-foo-bar',
    isPrivateFn: () => false,
  });
  assert.equal(entries[0].nameEn, 'Foo Bar');
  assert.equal(entries[0].nameZh, 'Foo Bar');
});

test('buildMcpStubs: leading "MCP " prefix is stripped from H1-derived names', () => {
  // README convention is `# MCP <ServiceName>`; the gallery name holds just the
  // service name. Without the strip the prefix leaks (e.g. "MCP CPBL Statistics").
  const { entries } = buildMcpStubs({
    existingSlugs: new Set(),
    repoSlugs: ['mcp-cpbl-statistics'],
    fetchRepoFn: () => ({ description: 'd' }),
    fetchReadmeFn: () => '# MCP CPBL Statistics\n\nIntro.',
    fetchReadmeZhFn: () => '# MCP 中華職棒統計\n\n中文簡介。',
    isPrivateFn: () => false,
  });
  assert.equal(entries[0].nameEn, 'CPBL Statistics');
  assert.equal(entries[0].nameZh, '中華職棒統計');
});

test('buildMcpStubs: inline markdown is stripped from H1 name and intro description', () => {
  // Card fields render verbatim, so raw **bold**/[link](url)/`code` must not leak.
  const { entries } = buildMcpStubs({
    existingSlugs: new Set(),
    repoSlugs: ['mcp-tdx-bus'],
    fetchRepoFn: () => ({ description: '' }), // force the intro path for descEn
    fetchReadmeFn: () => '# MCP **TDX Bus**\n\nAn MCP server for [TDX](https://tdx.example) — **Bus** routes with `stop` lookups.\n\n## Usage',
    fetchReadmeZhFn: () => null,
    isPrivateFn: () => false,
  });
  assert.equal(entries[0].nameEn, 'TDX Bus');
  assert.equal(entries[0].descEn, 'An MCP server for TDX — Bus routes with stop lookups.');
});

test('buildMcpStubs: Chinese H1 is read from README.zh-TW.md', () => {
  const { entries } = buildMcpStubs({
    existingSlugs: new Set(),
    repoSlugs: ['mcp-foo'],
    fetchRepoFn: () => ({ description: 'd' }),
    fetchReadmeFn: () => '# Foo English\n\nIntro.',
    fetchReadmeZhFn: () => '# 中文標題\n\n中文簡介。',
    isPrivateFn: () => false,
  });
  assert.equal(entries[0].nameEn, 'Foo English');
  assert.equal(entries[0].nameZh, '中文標題');
});

test('buildMcpStubs: missing Chinese H1 falls back to English name', () => {
  const { entries } = buildMcpStubs({
    existingSlugs: new Set(),
    repoSlugs: ['mcp-foo'],
    fetchRepoFn: () => ({ description: 'd' }),
    fetchReadmeFn: () => '# Foo English\n\nIntro.',
    fetchReadmeZhFn: () => null,
    isPrivateFn: () => false,
  });
  assert.equal(entries[0].nameZh, 'Foo English');
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
  assert.match(out, /tags: \["data", "global", "foo"\]/);
});

test('renderMcpStubs: numeric tags round-trip as strings (schema requires tags.items: string)', () => {
  const out = renderMcpStubs([{
    slug: 'mcp-591', nameEn: 'Foo', nameZh: 'Foo',
    descEn: 'd', descZh: 'd', status: 'coming-soon',
    category: 'data', region: 'taiwan', toolsCount: null,
    tags: ['data', 'taiwan', '591'],
  }]);
  const parsed = yaml.load(`servers:\n${out}`);
  assert.deepEqual(parsed.servers[0].tags, ['data', 'taiwan', '591']);
  assert.equal(typeof parsed.servers[0].tags[2], 'string');
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
  assert.ok(out.indexOf('mcp-x') < out.indexOf('mcp-new'));
});

test('appendStubsToYaml: input without trailing newline still produces valid output', () => {
  const input = 'servers:\n  - slug: mcp-x\n    status: released';
  const stubs = '  - slug: mcp-new\n    status: coming-soon\n';
  const out = appendStubsToYaml(input, stubs, '2026-05-11');
  assert.match(out, /released\n/);
  assert.match(out, /- slug: mcp-new/);
});
