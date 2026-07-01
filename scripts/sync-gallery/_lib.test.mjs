import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ghFetchFile, ghJSON, decodeBase64Content, appendGroup, classifyGhError, isOurPackage, ghListOrgRepos, ghIsRepoPrivate, ghRepoVisibility, extractH1, isPlaceholderH1, extractIntro, slugToTitle, escapeStr, stripMarkdownInline } from './_lib.mjs';

test('decodeBase64Content decodes base64 to utf-8', () => {
  assert.equal(decodeBase64Content('aGVsbG8='), 'hello');
});

// ── README / gallery-field text helpers ───────────────────────────

test('extractH1 returns the first H1, trimmed; empty when none', () => {
  assert.equal(extractH1('badges\n# MCP Foo\n\nintro'), 'MCP Foo');
  assert.equal(extractH1('no heading here'), '');
});

test('isPlaceholderH1: an H1 equal to the slug (with/without mcp- prefix) is a placeholder', () => {
  assert.equal(isPlaceholderH1('mcp-foo-bar', 'mcp-foo-bar'), true);
  assert.equal(isPlaceholderH1('foo-bar', 'mcp-foo-bar'), true);
  assert.equal(isPlaceholderH1('', 'mcp-foo-bar'), true);
  assert.equal(isPlaceholderH1('MCP Foo Bar', 'mcp-foo-bar'), false);
});

test('extractIntro takes text between H1 and first H2, minus badges/lang/rules', () => {
  const readme = '# MCP Foo\n\n[![badge](x)](y)\n[English](README.md)\n---\nReal intro line.\n\n## Usage\nnope';
  assert.equal(extractIntro(readme), 'Real intro line.');
});

test('slugToTitle strips mcp- prefix and title-cases each word', () => {
  assert.equal(slugToTitle('mcp-foo-bar'), 'Foo Bar');
  assert.equal(slugToTitle('mcp-uof'), 'Uof'); // no acronym awareness
});

test('escapeStr escapes backslashes and double quotes for YAML scalars', () => {
  assert.equal(escapeStr('a "b" \\ c'), 'a \\"b\\" \\\\ c');
});

test('stripMarkdownInline: links become their label, bold/italic/code markers removed', () => {
  const md = 'An **MCP** server for [Asgard](https://example.com) with `read-only` tools.';
  assert.equal(stripMarkdownInline(md), 'An MCP server for Asgard with read-only tools.');
});

test('decodeBase64Content tolerates whitespace in input', () => {
  assert.equal(decodeBase64Content('aGVs\nbG8='), 'hello');
});

test('exports ghFetchFile and ghJSON functions', () => {
  assert.equal(typeof ghFetchFile, 'function');
  assert.equal(typeof ghJSON, 'function');
});

test('classifyGhError: HTTP 404 stderr -> definitive missing', () => {
  assert.deepEqual(classifyGhError('gh: Not Found (HTTP 404)\n'), { status: 'missing' });
});

test('classifyGhError: HTTP 503 stderr -> ambiguous error (do NOT treat as missing)', () => {
  const r = classifyGhError('gh: Service Unavailable (HTTP 503)');
  assert.equal(r.status, 'error');
  assert.match(r.message, /503/);
});

test('classifyGhError: bad credentials -> ambiguous error', () => {
  const r = classifyGhError('gh: Bad credentials (HTTP 401)');
  assert.equal(r.status, 'error');
  assert.match(r.message, /credentials/);
});

test('classifyGhError: network error with no HTTP code -> ambiguous error', () => {
  const r = classifyGhError('connect ETIMEDOUT api.github.com');
  assert.equal(r.status, 'error');
});

test('classifyGhError: empty stderr (e.g. timeout) -> ambiguous error with empty message', () => {
  assert.deepEqual(classifyGhError(''), { status: 'error', message: '' });
});

test('isOurPackage: project_urls.Repository pointing to our org -> true', () => {
  const info = { project_urls: { Repository: 'https://github.com/asgard-ai-platform/mcp-shopline' } };
  assert.equal(isOurPackage(info, 'mcp-shopline'), true);
});

test('isOurPackage: home_page pointing to our org -> true', () => {
  const info = { home_page: 'https://github.com/asgard-ai-platform/mcp-shopline' };
  assert.equal(isOurPackage(info, 'mcp-shopline'), true);
});

test('isOurPackage: any project_urls key works (Source, Homepage, Documentation, ...)', () => {
  const info = {
    project_urls: {
      Documentation: 'https://docs.example.com',
      Source: 'https://github.com/asgard-ai-platform/mcp-shopline/tree/main',
    },
  };
  assert.equal(isOurPackage(info, 'mcp-shopline'), true);
});

test('isOurPackage: case-insensitive match', () => {
  const info = { project_urls: { Source: 'https://GitHub.com/asgard-AI-PLATFORM/Mcp-Shopline' } };
  assert.equal(isOurPackage(info, 'mcp-shopline'), true);
});

test('isOurPackage: third-party squatter (URLs do NOT reference our org) -> false', () => {
  const info = {
    home_page: 'https://example.com/squatter',
    project_urls: { Repository: 'https://github.com/some-other-org/mcp-google-ads' },
  };
  assert.equal(isOurPackage(info, 'mcp-google-ads'), false);
});

test('isOurPackage: empty info -> false', () => {
  assert.equal(isOurPackage({}, 'mcp-shopline'), false);
});

test('isOurPackage: null info -> false', () => {
  assert.equal(isOurPackage(null, 'mcp-shopline'), false);
});

test('isOurPackage: URL points to a DIFFERENT slug under our org -> false', () => {
  // mcp-foo's PyPI metadata references mcp-bar — that is NOT mcp-foo.
  const info = { project_urls: { Repository: 'https://github.com/asgard-ai-platform/mcp-bar' } };
  assert.equal(isOurPackage(info, 'mcp-foo'), false);
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

// ── ghListOrgRepos ───────────────────────────────────────────────

const repo = (name, isPrivate = false) => ({ name, private: isPrivate });

test('ghListOrgRepos: single short page returns all items', () => {
  const r = ghListOrgRepos('org', { fetchPageFn: (p) => p === 1 ? [repo('a'), repo('b', true)] : [] });
  assert.deepEqual(r, [{ name: 'a', isPrivate: false }, { name: 'b', isPrivate: true }]);
});

test('ghListOrgRepos: stops when page returns fewer than 100', () => {
  let calls = 0;
  const r = ghListOrgRepos('org', {
    fetchPageFn: (p) => { calls++; return p === 1 ? Array.from({ length: 50 }, (_, i) => repo(`r${i}`)) : []; },
  });
  assert.equal(r.length, 50);
  assert.equal(calls, 1);
});

test('ghListOrgRepos: paginates across multiple full pages until short page', () => {
  const fetchPageFn = (p) => {
    if (p === 1) return Array.from({ length: 100 }, (_, i) => repo(`p1-${i}`));
    if (p === 2) return Array.from({ length: 100 }, (_, i) => repo(`p2-${i}`));
    if (p === 3) return Array.from({ length: 7 }, (_, i) => repo(`p3-${i}`));
    return [];
  };
  const r = ghListOrgRepos('org', { fetchPageFn });
  assert.equal(r.length, 207);
  assert.equal(r[0].name, 'p1-0');
  assert.equal(r[206].name, 'p3-6');
});

test('ghListOrgRepos: stops on first empty page (boundary at exact multiple of 100)', () => {
  let calls = 0;
  const fetchPageFn = (p) => {
    calls++;
    if (p === 1) return Array.from({ length: 100 }, (_, i) => repo(`r${i}`));
    return [];
  };
  const r = ghListOrgRepos('org', { fetchPageFn });
  assert.equal(r.length, 100);
  assert.equal(calls, 2);
});

test('ghListOrgRepos: null mid-page throws (no silent truncation)', () => {
  assert.throws(
    () => ghListOrgRepos('org', { fetchPageFn: (p) => p === 1 ? Array.from({ length: 100 }, (_, i) => repo(`r${i}`)) : null }),
    /page 2 failed/,
  );
});

test('ghListOrgRepos: non-array response throws', () => {
  assert.throws(
    () => ghListOrgRepos('org', { fetchPageFn: () => ({ unexpected: 'shape' }) }),
    /non-array/,
  );
});

// ── ghRepoVisibility / ghIsRepoPrivate ───────────────────────────

test('ghRepoVisibility: true → private', () => {
  assert.equal(ghRepoVisibility('org', 'mcp-x', { fetchFn: () => true }), 'private');
});

test('ghRepoVisibility: false → public', () => {
  assert.equal(ghRepoVisibility('org', 'mcp-x', { fetchFn: () => false }), 'public');
});

test('ghRepoVisibility: null (gh failure) → unknown', () => {
  // Callers that want fail-open behaviour (e.g. audit-pypi Pass 1)
  // branch on === 'private' so unknown leaves the audit running.
  assert.equal(ghRepoVisibility('org', 'mcp-x', { fetchFn: () => null }), 'unknown');
});

test('ghIsRepoPrivate: gh returns true → private', () => {
  assert.equal(ghIsRepoPrivate('org', 'mcp-x', { fetchFn: () => true }), true);
});

test('ghIsRepoPrivate: gh returns false → public', () => {
  assert.equal(ghIsRepoPrivate('org', 'mcp-x', { fetchFn: () => false }), false);
});

test('ghIsRepoPrivate: gh failure (null) → fail CLOSED, treat as private', () => {
  // For the *gate* question ("should this be eligible for promotion?"),
  // a lookup blip must not let a private repo slip through.
  assert.equal(ghIsRepoPrivate('org', 'mcp-x', { fetchFn: () => null }), true);
});
