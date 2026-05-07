import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ghFetchFile, ghJSON, decodeBase64Content, appendGroup } from './_lib.mjs';

test('decodeBase64Content decodes base64 to utf-8', () => {
  assert.equal(decodeBase64Content('aGVsbG8='), 'hello');
});

test('decodeBase64Content tolerates whitespace in input', () => {
  assert.equal(decodeBase64Content('aGVs\nbG8='), 'hello');
});

test('exports ghFetchFile and ghJSON functions', () => {
  assert.equal(typeof ghFetchFile, 'function');
  assert.equal(typeof ghJSON, 'function');
});

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'yggdrasil-test-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readFileSafe(p) {
  try { return readFileSync(p, 'utf-8'); } catch { return null; }
}

test('appendGroup: empty lines is a no-op (does not create file)', () => {
  withTmp(dir => {
    const p = join(dir, 'report.md');
    appendGroup(p, 'mcp-x', []);
    assert.equal(readFileSafe(p), null, 'no file should be created on empty lines');
  });
});

test('appendGroup: creates new H2 block on a fresh file', () => {
  withTmp(dir => {
    const p = join(dir, 'report.md');
    appendGroup(p, 'mcp-shopline', ['finding A', 'finding B']);
    const text = readFileSync(p, 'utf-8');
    assert.equal(text, '\n## mcp-shopline\n\n- finding A\n- finding B\n');
  });
});

test('appendGroup: appends a second group as a separate H2 block', () => {
  withTmp(dir => {
    const p = join(dir, 'report.md');
    appendGroup(p, 'mcp-shopline', ['a']);
    appendGroup(p, 'skills', ['x']);
    const text = readFileSync(p, 'utf-8');
    assert.equal(text, '\n## mcp-shopline\n\n- a\n\n## skills\n\n- x\n');
  });
});

test('appendGroup: extends an existing group rather than duplicating its header', () => {
  withTmp(dir => {
    const p = join(dir, 'report.md');
    appendGroup(p, 'mcp-shopline', ['first']);
    appendGroup(p, 'mcp-shopline', ['second']);
    const text = readFileSync(p, 'utf-8');
    assert.equal(text.match(/## mcp-shopline/g).length, 1);
    assert.match(text, /- first\n- second/);
  });
});

test('appendGroup: extending the first of two groups leaves the second intact', () => {
  withTmp(dir => {
    const p = join(dir, 'report.md');
    appendGroup(p, 'mcp-shopline', ['shopline-a']);
    appendGroup(p, 'skills', ['skills-a']);
    appendGroup(p, 'mcp-shopline', ['shopline-b']);
    const text = readFileSync(p, 'utf-8');
    assert.match(text, /## mcp-shopline\n\n- shopline-a\n- shopline-b\n/);
    assert.match(text, /## skills\n\n- skills-a\n/);
    assert.equal(text.match(/## mcp-shopline/g).length, 1);
    assert.equal(text.match(/## skills/g).length, 1);
  });
});

test('appendGroup: preserves a pre-existing preamble written by another tool', () => {
  withTmp(dir => {
    const p = join(dir, 'report.md');
    writeFileSync(p, '# Open-source repo audit report\n\nGenerated: t\n', 'utf-8');
    appendGroup(p, 'mcp-x', ['orphan finding']);
    const text = readFileSync(p, 'utf-8');
    assert.match(text, /^# Open-source repo audit report\n\nGenerated: t\n/);
    assert.match(text, /\n## mcp-x\n\n- orphan finding\n$/);
  });
});
