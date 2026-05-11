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
  assert.ok(out.indexOf('mcp-x') < out.indexOf('mcp-new'));
});

test('appendStubsToYaml: input without trailing newline still produces valid output', () => {
  const input = 'servers:\n  - slug: mcp-x\n    status: released';
  const stubs = '  - slug: mcp-new\n    status: coming-soon\n';
  const out = appendStubsToYaml(input, stubs, '2026-05-11');
  assert.match(out, /released\n/);
  assert.match(out, /- slug: mcp-new/);
});
