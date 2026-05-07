import test from 'node:test';
import assert from 'node:assert/strict';
import { findOrphans } from './audit-orphans.mjs';

const exists = (priv = false) => async () => ({ status: 'exists', repo: { private: priv } });
const missing = async () => ({ status: 'missing' });
const erroring = (message = 'HTTP 503') => async () => ({ status: 'error', message });

test('returns empty groups when all entries exist upstream', async () => {
  const findings = await findOrphans({
    mcps: [{ slug: 'mcp-a', status: 'released' }],
    skills: [{ slug: 'skill-x' }],
    repoLookup: exists(),
    skillDirs: new Set(['x']),
  });
  assert.deepEqual(findings, { 'asgard-opensource-gallery': [], skills: [] });
});

test('flags missing released mcp under asgard-opensource-gallery group', async () => {
  const findings = await findOrphans({
    mcps: [
      { slug: 'mcp-a', status: 'released' },
      { slug: 'mcp-b', status: 'released' },
    ],
    skills: [],
    repoLookup: async (slug) =>
      slug === 'mcp-b'
        ? { status: 'missing' }
        : { status: 'exists', repo: { private: false } },
    skillDirs: new Set(),
  });
  assert.deepEqual(findings.skills, []);
  assert.equal(findings['asgard-opensource-gallery'].length, 1);
  assert.match(findings['asgard-opensource-gallery'][0], /mcp-b/);
});

test('flags repo that became private as orphan', async () => {
  const findings = await findOrphans({
    mcps: [{ slug: 'mcp-a', status: 'released' }],
    skills: [],
    repoLookup: exists(true),
    skillDirs: new Set(),
  });
  assert.equal(findings['asgard-opensource-gallery'].length, 1);
  assert.match(findings['asgard-opensource-gallery'][0], /private/);
});

test('does not check non-released mcps', async () => {
  const findings = await findOrphans({
    mcps: [{ slug: 'mcp-coming', status: 'coming-soon' }],
    skills: [],
    repoLookup: missing, // would flag if checked
    skillDirs: new Set(),
  });
  assert.deepEqual(findings['asgard-opensource-gallery'], []);
});

test('flags missing skill under skills group', async () => {
  const findings = await findOrphans({
    mcps: [],
    skills: [{ slug: 'skill-x' }, { slug: 'skill-gone' }],
    repoLookup: exists(),
    skillDirs: new Set(['x']),
  });
  assert.equal(findings.skills.length, 1);
  assert.match(findings.skills[0], /skill-gone/);
});

test('does NOT flag transient gh api errors as orphans', async () => {
  // P1 fix: a single 503 must not turn into an orphan finding.
  const findings = await findOrphans({
    mcps: [
      { slug: 'mcp-a', status: 'released' },
      { slug: 'mcp-b', status: 'released' },
      { slug: 'mcp-c', status: 'released' },
      { slug: 'mcp-d', status: 'released' },
      { slug: 'mcp-e', status: 'released' },
    ],
    skills: [],
    repoLookup: async (slug) =>
      slug === 'mcp-c'
        ? { status: 'error', message: 'HTTP 503' }
        : { status: 'exists', repo: { private: false } },
    skillDirs: new Set(),
  });
  assert.deepEqual(findings['asgard-opensource-gallery'], []);
});

test('throws when MCP error rate exceeds threshold (mass-failure abort)', async () => {
  // 3/3 errors > 20%; refuse to produce a report.
  await assert.rejects(
    findOrphans({
      mcps: [
        { slug: 'mcp-a', status: 'released' },
        { slug: 'mcp-b', status: 'released' },
        { slug: 'mcp-c', status: 'released' },
      ],
      skills: [],
      repoLookup: erroring(),
      skillDirs: new Set(),
    }),
    /aborting to avoid mass false-positive/,
  );
});

test('skips skill orphan check when skillDirs is null (tree fetch failed)', async () => {
  const findings = await findOrphans({
    mcps: [],
    skills: [{ slug: 'skill-x' }, { slug: 'skill-gone' }],
    repoLookup: exists(),
    skillDirs: null,
  });
  assert.deepEqual(findings.skills, []);
});
