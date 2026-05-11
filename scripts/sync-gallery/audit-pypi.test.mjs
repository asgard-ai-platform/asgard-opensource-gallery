import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkPyproject, checkPypiPublish, findPromotionCandidates } from './audit-pypi.mjs';

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
  assert.match(findings[0], /0\.2\.0 does not match latest PyPI release 0\.1\.0/);
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

test('findPromotionCandidates: coming-soon MCP on PyPI is a candidate', async () => {
  const cands = await findPromotionCandidates({
    mcps: [{ slug: 'mcp-foo', status: 'coming-soon' }],
    fetchPypiFn: async () => ({ status: 200, body: { info: { version: '0.1.0', project_urls: { Repository: 'https://github.com/asgard-ai-platform/mcp-foo' } } } }),
  });
  assert.equal(cands.length, 1);
  assert.match(cands[0], /Candidate for promotion/);
  assert.match(cands[0], /mcp-foo/);
  assert.match(cands[0], /0\.1\.0/);
});

test('findPromotionCandidates: coming-soon MCP not on PyPI is NOT a candidate', async () => {
  const cands = await findPromotionCandidates({
    mcps: [{ slug: 'mcp-foo', status: 'coming-soon' }],
    fetchPypiFn: async () => ({ status: 404 }),
  });
  assert.deepEqual(cands, []);
});

test('findPromotionCandidates: released MCP is skipped (already promoted)', async () => {
  const cands = await findPromotionCandidates({
    mcps: [{ slug: 'mcp-foo', status: 'released' }],
    fetchPypiFn: async () => ({ status: 200, body: { info: { version: '1.0.0' } } }),
  });
  assert.deepEqual(cands, []);
});

test('findPromotionCandidates: planned MCP is skipped', async () => {
  const cands = await findPromotionCandidates({
    mcps: [{ slug: 'mcp-foo', status: 'planned' }],
    fetchPypiFn: async () => ({ status: 200, body: { info: { version: '1.0.0' } } }),
  });
  assert.deepEqual(cands, []);
});

test('findPromotionCandidates: PyPI 5xx is silent (no false-positive candidate on outage)', async () => {
  const cands = await findPromotionCandidates({
    mcps: [{ slug: 'mcp-foo', status: 'coming-soon' }],
    fetchPypiFn: async () => ({ status: 503 }),
  });
  assert.deepEqual(cands, []);
});

test('findPromotionCandidates: missing version field falls back to "unknown"', async () => {
  const cands = await findPromotionCandidates({
    mcps: [{ slug: 'mcp-foo', status: 'coming-soon' }],
    fetchPypiFn: async () => ({
      status: 200,
      body: { info: {
        project_urls: { Repository: 'https://github.com/asgard-ai-platform/mcp-foo' },
      } },
    }),
  });
  assert.equal(cands.length, 1);
  assert.match(cands[0], /unknown/);
});

test('findPromotionCandidates: third-party squatter (URLs do not point at our org) is NOT a candidate', async () => {
  // Real-world case: someone unrelated published `mcp-google-ads` on PyPI
  // before us. Without this guard we would auto-flag for promotion.
  const cands = await findPromotionCandidates({
    mcps: [{ slug: 'mcp-google-ads', status: 'coming-soon' }],
    fetchPypiFn: async () => ({
      status: 200,
      body: { info: {
        version: '1.5.0',
        home_page: 'https://example.com/random-author',
        project_urls: { Homepage: 'https://example.com/random-author' },
      } },
    }),
  });
  assert.deepEqual(cands, []);
});

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
