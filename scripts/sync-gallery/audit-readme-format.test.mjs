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
