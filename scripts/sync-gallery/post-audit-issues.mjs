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
import { readFileSync, writeFileSync, unlinkSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { pathToFileURL } from 'node:url';

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
      // Don't reset on duplicate H2 — accumulate into the existing array
      // so a re-encountered group preserves earlier findings (M6 fix).
      if (!groups[current]) groups[current] = [];
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

/**
 * Find every open tracking issue for a repo, deduped by issue number.
 * Looks up via label first, then via the marker-comment search — both
 * always run so an unlabelled marker issue is found even when label search
 * returns zero (M2 fix). Returns an array (possibly empty); the caller
 * updates each one (M1 fix — multiple labelled issues should not go stale).
 */
function findExistingIssues(repo) {
  const found = new Map();
  try {
    const out = gh([
      'issue', 'list',
      '--repo', `${ORG}/${repo}`,
      '--state', 'open',
      '--label', LABEL,
      '--limit', '50',
      '--json', 'number,body',
    ]);
    for (const issue of JSON.parse(out)) found.set(issue.number, issue);
  } catch {
    // Label may not exist on the repo yet — fall through to marker search.
  }
  try {
    const out = gh([
      'issue', 'list',
      '--repo', `${ORG}/${repo}`,
      '--state', 'open',
      '--search', MARKER_COMMENT,
      '--limit', '50',
      '--json', 'number,body',
    ]);
    for (const issue of JSON.parse(out)) {
      if (issue.body && issue.body.includes(MARKER_COMMENT)) {
        found.set(issue.number, issue);
      }
    }
  } catch {
    // Search disabled / GitHub flake — best effort.
  }
  return [...found.values()];
}

/**
 * Try to create (or `--force`-update) the audit label on the repo.
 * Returns true on success. False on failure (token lacks label scope, etc.) —
 * the caller should then create the issue without `--label` (M7 fix).
 */
function ensureLabelExists(repo) {
  try {
    gh([
      'label', 'create', LABEL,
      '--repo', `${ORG}/${repo}`,
      '--color', 'BFD4F2',
      '--description', 'Auto-maintained by Yggdrasil gallery audit',
      '--force',
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitize a parsed H2 heading for safe use in a temp file name. The parser
 * accepts any non-empty string after `## `; without sanitization, a heading
 * containing `/` (e.g. a future audit script that uses `## skills/foo`)
 * would expand into a path like `/tmp/yggdrasil-audit-skills/foo-<pid>.md`
 * and `writeFileSync` would fail because the intermediate dir does not
 * exist. Replace anything outside `[A-Za-z0-9._-]` with `_`. (P1 fix.)
 */
export function safeRepoForFilename(repo) {
  const cleaned = repo.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100);
  return /[A-Za-z0-9]/.test(cleaned) ? cleaned : 'unknown';
}

function postOrUpdate(repo, findings) {
  const runId = process.env.GITHUB_RUN_ID || 'local';
  const timestamp = new Date().toISOString();
  const body = formatIssueBody({ repo, findings, runId, timestamp });
  const existing = findExistingIssues(repo);
  const tmpFile = pathJoin(tmpdir(), `yggdrasil-audit-${safeRepoForFilename(repo)}-${process.pid}.md`);
  writeFileSync(tmpFile, body, 'utf-8');
  try {
    if (existing.length > 0) {
      // Update every match so duplicates do not silently go stale.
      const numbers = [];
      for (const issue of existing) {
        gh([
          'issue', 'edit', String(issue.number),
          '--repo', `${ORG}/${repo}`,
          '--body-file', tmpFile,
        ]);
        numbers.push(issue.number);
      }
      return { repo, action: 'updated', number: numbers.join(','), count: numbers.length };
    } else {
      const labelOk = ensureLabelExists(repo);
      const args = [
        'issue', 'create',
        '--repo', `${ORG}/${repo}`,
        '--title', TITLE,
        '--body-file', tmpFile,
      ];
      if (labelOk) args.push('--label', LABEL);
      const out = gh(args);
      return { repo, action: labelOk ? 'created' : 'created (unlabelled — token missing label scope)', url: out };
    }
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
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
