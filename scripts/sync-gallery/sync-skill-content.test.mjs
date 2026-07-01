import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSkillContent } from './sync-skill-content.mjs';

const SKILL_MD = `---
name: foo
description: A much richer SKILL.md description than the short yaml one, long enough to win.
---

## Overview

What it does.

## Gotchas

Careful here.
`;

test('buildSkillContent: dir with SKILL.md is parsed into ordered sections', () => {
  const { content, stats } = buildSkillContent({
    dirs: ['foo'],
    fetchFn: () => SKILL_MD,
  });
  assert.equal(stats.processed, 1);
  assert.deepEqual(
    content['skill-foo'].sections.map((s) => s.key),
    ['overview', 'gotchas'],
  );
});

test('buildSkillContent: SKILL.md fetch failure carries over last-good content', () => {
  const prev = { 'skill-foo': { sections: [{ key: 'overview', title: 'Overview', body: 'old' }] } };
  const { content, stats } = buildSkillContent({
    dirs: ['foo'],
    fetchFn: () => null, // transient failure
    prevContent: prev,
  });
  assert.deepEqual(content['skill-foo'], prev['skill-foo']); // not deleted
  assert.equal(stats.carried, 1);
  assert.equal(stats.processed, 0);
});

test('buildSkillContent: fetch failure with no prior content is skipped', () => {
  const { content, stats } = buildSkillContent({
    dirs: ['foo'],
    fetchFn: () => null,
    prevContent: {},
  });
  assert.equal('skill-foo' in content, false);
  assert.equal(stats.skipped, 1);
});

test('buildSkillContent: queues a description update when frontmatter is meaningfully richer', () => {
  const yamlSkills = new Map([['foo', { description: { en: 'short' } }]]);
  const { descriptionUpdates } = buildSkillContent({
    dirs: ['foo'],
    fetchFn: () => SKILL_MD,
    yamlSkills,
  });
  assert.equal(descriptionUpdates.has('skill-foo'), true);
  assert.match(descriptionUpdates.get('skill-foo').newDescEn, /richer SKILL\.md description/);
});
