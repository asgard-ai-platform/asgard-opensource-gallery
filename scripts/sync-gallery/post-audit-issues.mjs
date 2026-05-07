#!/usr/bin/env node
/**
 * post-audit-issues.mjs <path-to-report.md>
 *
 * Parse a per-repo audit report (markdown with `## <repo-slug>` headings,
 * each followed by `- finding` bullets) and post or update one tracking
 * issue per repo on github.com/asgard-ai-platform.
 *
 * Existing tracking issue is identified by the label `yggdrasil-audit`,
 * with fallback to a marker comment in the body if label search fails.
 *
 * All shell-out uses execFileSync with argv arrays (no shell parsing).
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ORG = 'asgard-ai-platform';
const LABEL = 'yggdrasil-audit';
const TITLE = '[yggdrasil-audit] Gallery sync report';
export const MARKER_COMMENT = '<!-- yggdrasil-audit:auto-managed -->';

export function parseReport(md) {
  const groups = {};
  const lines = md.split('\n');
  let current = null;
  for (const line of lines) {
    const h2 = line.match(/^##\s+(\S.*?)\s*$/);
    if (h2) {
      current = h2[1].trim();
      groups[current] = [];
      continue;
    }
    if (current === null) continue;
    const bullet = line.match(/^-\s+(.+)$/);
    if (bullet) {
      groups[current].push(bullet[1].trim());
    }
  }
  for (const k of Object.keys(groups)) {
    if (groups[k].length === 0) delete groups[k];
  }
  return groups;
}

export function formatIssueBody({ repo, findings, runId, timestamp }) {
  const fixHint =
    repo === 'asgard-opensource-gallery'
      ? 'Open a PR on this repo (`asgard-opensource-gallery`) to update the YAML.'
      : repo === 'skills'
      ? 'Either fix the SKILL.md in this repo or open a PR on `asgard-ai-platform/asgard-opensource-gallery` to update the YAML.'
      : 'Either fix the source (this repo) or open a PR on `asgard-ai-platform/asgard-opensource-gallery` to update the YAML.';

  const findingLines = findings.map(f => `- ⚠️ ${f}`).join('\n');

  return [
    `> Auto-maintained by Yggdrasil gallery audit. Last updated: ${timestamp} (run #${runId}).`,
    '',
    '## Findings',
    '',
    findingLines,
    '',
    '## What to do',
    '',
    fixHint,
    'When all findings are resolved, close this issue manually.',
    '',
    MARKER_COMMENT,
    '',
  ].join('\n');
}

function gh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf-8',
    timeout: 20000,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function findExistingIssue(repo) {
  try {
    const out = gh([
      'issue', 'list',
      '--repo', `${ORG}/${repo}`,
      '--state', 'open',
      '--label', LABEL,
      '--limit', '1',
      '--json', 'number,body',
    ]);
    const arr = JSON.parse(out);
    if (arr.length > 0) return arr[0];
  } catch {
    // Label may not exist on the repo yet — fall through.
  }
  try {
    const out = gh([
      'issue', 'list',
      '--repo', `${ORG}/${repo}`,
      '--state', 'open',
      '--search', MARKER_COMMENT,
      '--limit', '5',
      '--json', 'number,body',
    ]);
    const arr = JSON.parse(out);
    return arr.find(i => i.body && i.body.includes(MARKER_COMMENT)) || null;
  } catch {
    return null;
  }
}

function ensureLabelExists(repo) {
  try {
    gh([
      'label', 'create', LABEL,
      '--repo', `${ORG}/${repo}`,
      '--color', 'BFD4F2',
      '--description', 'Auto-maintained by Yggdrasil gallery audit',
      '--force',
    ]);
  } catch {
    // Already exists, or token lacks label-create scope. Non-fatal.
  }
}

function postOrUpdate(repo, findings) {
  const runId = process.env.GITHUB_RUN_ID || 'local';
  const timestamp = new Date().toISOString();
  const body = formatIssueBody({ repo, findings, runId, timestamp });
  const existing = findExistingIssue(repo);
  const tmpFile = `/tmp/yggdrasil-audit-${repo}-${process.pid}.md`;
  writeFileSync(tmpFile, body, 'utf-8');
  try {
    if (existing) {
      gh([
        'issue', 'edit', String(existing.number),
        '--repo', `${ORG}/${repo}`,
        '--body-file', tmpFile,
      ]);
      return { repo, action: 'updated', number: existing.number };
    } else {
      ensureLabelExists(repo);
      const out = gh([
        'issue', 'create',
        '--repo', `${ORG}/${repo}`,
        '--title', TITLE,
        '--label', LABEL,
        '--body-file', tmpFile,
      ]);
      return { repo, action: 'created', url: out };
    }
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const reportPath = process.argv[2];
  if (!reportPath) {
    console.error('usage: post-audit-issues.mjs <path-to-report.md>');
    process.exit(2);
  }
  const md = readFileSync(reportPath, 'utf-8');
  const groups = parseReport(md);
  const errors = [];
  for (const [repo, findings] of Object.entries(groups)) {
    try {
      const r = postOrUpdate(repo, findings);
      console.log(`${r.action}: ${r.repo} (${r.number || r.url})`);
    } catch (e) {
      console.error(`FAILED for ${repo}: ${e.message}`);
      errors.push(repo);
    }
  }
  if (errors.length > 0) {
    console.error(`\n${errors.length} repo(s) failed: ${errors.join(', ')}`);
    process.exit(1);
  }
}
