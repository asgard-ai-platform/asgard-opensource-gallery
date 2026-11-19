#!/usr/bin/env node
/**
 * post-slack-digest.mjs <path-to-report.md>
 *
 * Summarise the audit report (the `## <group>` + `- finding` format that
 * post-audit-issues.mjs also consumes) and post it to Slack through an
 * Incoming Webhook. Without SLACK_WEBHOOK_URL it logs and exits 0, so the
 * audit job keeps passing until the webhook secret is configured.
 *
 * Env: SLACK_WEBHOOK_URL (secret), RUN_URL (link to the workflow run),
 *      AUDIT_STATUS (job status; anything but "success" adds a warning line).
 */
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseReport } from './post-audit-issues.mjs';

const ISSUES_URL =
  'https://github.com/issues?q=org%3Aasgard-ai-platform+label%3Ayggdrasil-audit+is%3Aopen';
const TOP_REPOS = 10;
const MAX_GALLERY_FINDINGS = 10;

// Anchored to the finding templates emitted by audit-readme-format, audit-pypi,
// discover-new-mcps and refresh-boilerplate-descriptions.
const CATEGORIES = [
  ['README badges', /^Badge missing:/],
  ['README format', /^(H1 heading missing|H1 does not match|Missing \[繁體中文\]|Required section missing:|## )/],
  ['Packaging (pyproject / LICENSE / PyPI)', /^(pyproject\.toml|LICENSE file missing|Package `[^`]+` is not published on PyPI|PyPI description_content_type)/],
  ['Gallery content (README / description)', /^(README(\.zh-TW)?\.md missing|GitHub repo description is empty|tools_count not parseable|\S+ still boilerplate)/],
];

export function categorize(finding) {
  for (const [name, re] of CATEGORIES) if (re.test(finding)) return name;
  return 'Other';
}

/** Escape the characters Slack mrkdwn treats as control sequences (<!channel>, links). */
export function slackEscape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Build the Slack message text from parsed report groups. Pure, for testing. */
export function buildDigest({ groups, date, runUrl, auditStatus }) {
  const names = Object.keys(groups);
  const total = names.reduce((n, g) => n + groups[g].length, 0);
  const lines = [`*Yggdrasil gallery audit: weekly digest (${date})*`];

  if (auditStatus && auditStatus !== 'success') {
    lines.push(`Warning: audit job status is "${slackEscape(auditStatus)}", so this report may be incomplete.`);
  }

  if (total === 0) {
    lines.push('No findings this week.');
  } else {
    lines.push(`${total} finding(s) across ${names.length} group(s)`);

    const byCategory = {};
    for (const g of names) for (const f of groups[g]) {
      const c = categorize(f);
      byCategory[c] = (byCategory[c] || 0) + 1;
    }
    lines.push('', '*By type*');
    for (const [c, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) lines.push(`• ${c}: ${n}`);

    // Gallery/skills-level groups are few but actionable (orphans, promotion
    // candidates), so list their findings instead of burying them in counts.
    const galleryGroups = names.filter((g) => !g.startsWith('mcp-'));
    if (galleryGroups.length) {
      lines.push('', '*Gallery & skills*');
      for (const g of galleryGroups) {
        const shown = groups[g].slice(0, MAX_GALLERY_FINDINGS);
        for (const f of shown) lines.push(`• \`${slackEscape(g)}\`: ${slackEscape(f)}`);
        if (groups[g].length > shown.length) lines.push(`• \`${slackEscape(g)}\`: …and ${groups[g].length - shown.length} more`);
      }
    }

    const repoGroups = names.filter((g) => g.startsWith('mcp-')).sort((a, b) => groups[b].length - groups[a].length || a.localeCompare(b));
    if (repoGroups.length) {
      lines.push('', `*MCP repos with the most findings* (${repoGroups.length} total)`);
      for (const g of repoGroups.slice(0, TOP_REPOS)) lines.push(`• ${slackEscape(g)}: ${groups[g].length}`);
    }
  }

  lines.push('');
  const links = [`<${ISSUES_URL}|Open tracking issues>`];
  if (runUrl) links.unshift(`<${runUrl}|Full report (workflow run artifact)>`);
  lines.push(links.join(' · '));
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const reportPath = process.argv[2];
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) {
    console.log('::warning::SLACK_WEBHOOK_URL is not set; skipping Slack digest.');
    process.exit(0);
  }
  const md = reportPath && existsSync(reportPath) ? readFileSync(reportPath, 'utf-8') : '';
  const text = buildDigest({
    groups: parseReport(md),
    date: new Date().toISOString().slice(0, 10),
    runUrl: process.env.RUN_URL,
    // A missing report means an early step failed even if the status says otherwise.
    auditStatus: md ? process.env.AUDIT_STATUS : 'report missing',
  });
  let res;
  try {
    // redirect: 'manual' so a 3xx is reported as a failure instead of followed.
    res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      redirect: 'manual',
    });
  } catch {
    // Never print the exception: it can echo the credential-bearing webhook URL.
    console.error('::error::Slack webhook request failed (check the SLACK_WEBHOOK_URL secret)');
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`::error::Slack webhook returned HTTP ${res.status}`);
    process.exit(1);
  }
  console.log(`Posted Slack digest (${text.length} chars).`);
}
