import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseReport, formatIssueBody, MARKER_COMMENT, safeRepoForFilename } from './post-audit-issues.mjs';

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

test('parseReport accumulates findings when an H2 group repeats', () => {
  // M6 fix: a repeated `## mcp-foo` must not reset the existing array.
  const md = [
    '## mcp-foo',
    '',
    '- first finding',
    '',
    '## mcp-bar',
    '',
    '- bar finding',
    '',
    '## mcp-foo',
    '',
    '- second finding',
    '',
  ].join('\n');
  const groups = parseReport(md);
  assert.deepEqual(groups['mcp-foo'], ['first finding', 'second finding']);
  assert.deepEqual(groups['mcp-bar'], ['bar finding']);
});

test('safeRepoForFilename: well-formed slug passes through unchanged', () => {
  assert.equal(safeRepoForFilename('mcp-shopline'), 'mcp-shopline');
  assert.equal(safeRepoForFilename('skills'), 'skills');
  assert.equal(safeRepoForFilename('asgard-opensource-gallery'), 'asgard-opensource-gallery');
});

test('safeRepoForFilename: replaces path separators and other unsafe chars', () => {
  // P1 fix: a heading like `## skills/foo` must not produce a tmp path with `/`.
  assert.equal(safeRepoForFilename('skills/foo'), 'skills_foo');
  assert.equal(safeRepoForFilename('../etc/passwd'), '.._etc_passwd');
  assert.equal(safeRepoForFilename('a b c'), 'a_b_c');
});

test('safeRepoForFilename: empty / all-unsafe input falls back to "unknown"', () => {
  assert.equal(safeRepoForFilename(''), 'unknown');
  assert.equal(safeRepoForFilename('///'), 'unknown');
});
