import test from 'node:test';
import assert from 'node:assert/strict';
import { categorize, slackEscape, buildDigest } from './post-slack-digest.mjs';

test('categorize: maps the audit finding shapes to digest categories', () => {
  assert.equal(categorize('Badge missing: PyPI version — add e.g. ...'), 'README badges');
  assert.equal(categorize('Required section missing: ## Quick Start — add ...'), 'README format');
  assert.equal(categorize('H1 does not match "# MCP <ServiceName>": "# mcp-ptt"'), 'README format');
  assert.equal(categorize('Missing [繁體中文](README.zh-TW.md) link below the H1'), 'README format');
  assert.equal(categorize("pyproject.toml [project] missing required field 'license'"), 'Packaging (pyproject / LICENSE / PyPI)');
  assert.equal(categorize('LICENSE file missing at repo root'), 'Packaging (pyproject / LICENSE / PyPI)');
  assert.equal(categorize('Package `mcp-x` is not published on PyPI'), 'Packaging (pyproject / LICENSE / PyPI)');
  assert.equal(categorize('H1 heading missing — add a top-level `# MCP <ServiceName>`'), 'README format');
  assert.equal(categorize("PyPI description_content_type is 'text/x-rst' — README will not render"), 'Packaging (pyproject / LICENSE / PyPI)');
  assert.equal(categorize('README.zh-TW.md missing — no Chinese content for detail page'), 'Gallery content (README / description)');
  assert.equal(categorize('description.zh still boilerplate — README.zh-TW.md H1/intro missing or unusable'), 'Gallery content (README / description)');
  // Keywords appearing mid-sentence must not pull a finding into a category.
  assert.equal(categorize('skill-x references unknown slug `LICENSE`'), 'Other');
  assert.equal(categorize('mcp-mayo is orphan'), 'Other');
});

test('slackEscape: neutralises mention and link syntax', () => {
  assert.equal(slackEscape('<!channel> & <https://x|y>'), '&lt;!channel&gt; &amp; &lt;https://x|y&gt;');
});

const GROUPS = {
  'mcp-a': ['Badge missing: License', 'Required section missing: ## Tools (N)', 'LICENSE file missing at repo root'],
  'mcp-b': ['Badge missing: PyPI version'],
  'asgard-opensource-gallery': ['mcp-old is orphan <!here>'],
};

test('buildDigest: totals, per-type counts, gallery findings listed, repos ranked', () => {
  const text = buildDigest({ groups: GROUPS, date: '2026-11-23', runUrl: 'https://run', auditStatus: 'success' });
  assert.match(text, /weekly digest \(2026-11-23\)/);
  assert.match(text, /5 finding\(s\) across 3 group\(s\)/);
  assert.match(text, /• README badges: 2/);
  assert.match(text, /• README format: 1/);
  assert.match(text, /• Packaging \(pyproject \/ LICENSE \/ PyPI\): 1/);
  assert.match(text, /`asgard-opensource-gallery`: mcp-old is orphan &lt;!here&gt;/);
  assert.ok(text.indexOf('• mcp-a: 3') < text.indexOf('• mcp-b: 1'));
  assert.match(text, /<https:\/\/run\|Full report/);
  assert.doesNotMatch(text, /Warning/);
});

test('buildDigest: non-success status adds a warning; empty report says no findings', () => {
  const text = buildDigest({ groups: {}, date: '2026-11-23', auditStatus: 'failure' });
  assert.match(text, /Warning: audit job status is "failure"/);
  assert.match(text, /No findings this week\./);
  assert.doesNotMatch(text, /Full report/);
});
