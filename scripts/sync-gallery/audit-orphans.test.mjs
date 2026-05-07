import test from 'node:test';
import assert from 'node:assert/strict';
import { findOrphans } from './audit-orphans.mjs';

test('returns empty groups when all entries exist upstream', async () => {
  const findings = await findOrphans({
    mcps: [{ slug: 'mcp-a', status: 'released' }],
    skills: [{ slug: 'skill-x' }],
    repoExists: async () => true,
    skillDirExists: async () => true,
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
    repoExists: async (slug) => slug !== 'mcp-b',
    skillDirExists: async () => true,
  });
  assert.deepEqual(findings.skills, []);
  assert.equal(findings['asgard-opensource-gallery'].length, 1);
  assert.match(findings['asgard-opensource-gallery'][0], /mcp-b/);
});

test('does not check non-released mcps', async () => {
  const findings = await findOrphans({
    mcps: [{ slug: 'mcp-coming', status: 'coming-soon' }],
    skills: [],
    repoExists: async () => false, // would flag if checked
    skillDirExists: async () => true,
  });
  assert.deepEqual(findings['asgard-opensource-gallery'], []);
});

test('flags missing skill under skills group', async () => {
  const findings = await findOrphans({
    mcps: [],
    skills: [{ slug: 'skill-x' }, { slug: 'skill-gone' }],
    repoExists: async () => true,
    skillDirExists: async (dir) => dir !== 'gone',
  });
  assert.equal(findings.skills.length, 1);
  assert.match(findings.skills[0], /skill-gone/);
});
