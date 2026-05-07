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
