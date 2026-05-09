import test from 'node:test';
import assert from 'node:assert/strict';
import { findPromotions, applyPromotions } from './promote-candidates.mjs';

const exists = (version = '0.1.0') => async () => ({ status: 200, body: { info: { version } } });
const missing = async () => ({ status: 404 });
const flaky = async () => ({ status: 503 });

// ── findPromotions ───────────────────────────────────────────────

test('findPromotions: coming-soon + PyPI 200 → promoted with version', async () => {
  const r = await findPromotions({
    mcps: [{ slug: 'mcp-foo', status: 'coming-soon' }],
    fetchPypiFn: exists('1.2.3'),
  });
  assert.deepEqual(r, [{ slug: 'mcp-foo', version: '1.2.3' }]);
});

test('findPromotions: coming-soon + 404 → not promoted', async () => {
  const r = await findPromotions({
    mcps: [{ slug: 'mcp-foo', status: 'coming-soon' }],
    fetchPypiFn: missing,
  });
  assert.deepEqual(r, []);
});

test('findPromotions: released + PyPI 200 → not re-promoted', async () => {
  const r = await findPromotions({
    mcps: [{ slug: 'mcp-foo', status: 'released' }],
    fetchPypiFn: exists(),
  });
  assert.deepEqual(r, []);
});

test('findPromotions: planned → skipped even if on PyPI', async () => {
  const r = await findPromotions({
    mcps: [{ slug: 'mcp-foo', status: 'planned' }],
    fetchPypiFn: exists(),
  });
  assert.deepEqual(r, []);
});

test('findPromotions: PyPI 5xx is silent (no false positive on outage)', async () => {
  const r = await findPromotions({
    mcps: [{ slug: 'mcp-foo', status: 'coming-soon' }],
    fetchPypiFn: flaky,
  });
  assert.deepEqual(r, []);
});

test('findPromotions: missing version field → "unknown"', async () => {
  const r = await findPromotions({
    mcps: [{ slug: 'mcp-foo', status: 'coming-soon' }],
    fetchPypiFn: async () => ({ status: 200, body: { info: {} } }),
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].version, 'unknown');
});

// ── applyPromotions ──────────────────────────────────────────────

test('applyPromotions: empty list → input returned unchanged', () => {
  const input = '  - slug: mcp-x\n    status: coming-soon\n';
  assert.equal(applyPromotions(input, []), input);
});

test('applyPromotions: flips status of matched slug only', () => {
  const input = [
    '  - slug: mcp-target',
    '    name:',
    '      en: "Target"',
    '    status: coming-soon',
    '    category: data',
    '  - slug: mcp-other',
    '    status: coming-soon',
    '',
  ].join('\n');
  const out = applyPromotions(input, [{ slug: 'mcp-target', version: '0.1.0' }]);
  // Target entry: flipped.
  assert.match(out, /- slug: mcp-target\n    name:\n      en: "Target"\n    status: released\n/);
  // Other entry: still coming-soon.
  assert.match(out, /- slug: mcp-other\n    status: coming-soon/);
});

test('applyPromotions: preserves indentation, comments, and trailing blank line', () => {
  const input = [
    '  # M-01 Taiwan E-commerce',
    '  - slug: mcp-foo',
    '    name:',
    '      en: "Foo"',
    '    status: coming-soon',
    '    category: data',
    '',
  ].join('\n');
  const out = applyPromotions(input, [{ slug: 'mcp-foo', version: '0.1.0' }]);
  assert.equal(out, [
    '  # M-01 Taiwan E-commerce',
    '  - slug: mcp-foo',
    '    name:',
    '      en: "Foo"',
    '    status: released',
    '    category: data',
    '',
  ].join('\n'));
});

test('applyPromotions: promotion for slug not in YAML is silently no-op', () => {
  const input = '  - slug: mcp-foo\n    status: coming-soon\n';
  const out = applyPromotions(input, [{ slug: 'mcp-not-here', version: '0.1.0' }]);
  assert.equal(out, input);
});

test('applyPromotions: entry already released stays released', () => {
  const input = [
    '  - slug: mcp-foo',
    '    status: released',
    '',
  ].join('\n');
  const out = applyPromotions(input, [{ slug: 'mcp-foo', version: '0.1.0' }]);
  assert.equal(out, input);
});

test('applyPromotions: handles multiple promotions in one pass', () => {
  const input = [
    '  - slug: mcp-a',
    '    status: coming-soon',
    '  - slug: mcp-b',
    '    status: coming-soon',
    '  - slug: mcp-c',
    '    status: coming-soon',
    '',
  ].join('\n');
  const out = applyPromotions(input, [
    { slug: 'mcp-a', version: '0.1.0' },
    { slug: 'mcp-c', version: '0.2.0' },
  ]);
  assert.match(out, /- slug: mcp-a\n    status: released/);
  assert.match(out, /- slug: mcp-b\n    status: coming-soon/);
  assert.match(out, /- slug: mcp-c\n    status: released/);
});
