#!/usr/bin/env node
/**
 * audit-readme-format.mjs
 *
 * Validate each released MCP repo's README.md against the golden sample
 * structure (mcp-shopline). Findings are appended under each mcp-* group
 * in the audit report.
 *
 * Calibration: mcp-shopline must pass with zero findings. If a rule
 * triggers on shopline, the rule is wrong, not shopline.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { ghFetchFile, appendGroup, ghRepoVisibility } from './_lib.mjs';

const ORG = 'asgard-ai-platform';
const ROOT = resolve(new URL('.', import.meta.url).pathname, '../..');
const REPORT_PATH = join(ROOT, 'scripts/sync-gallery/_generated/repo-audit-report.md');

const REQUIRED_BADGES = [
  { name: 'PyPI version',       pattern: /img\.shields\.io\/pypi\/v\//,            example: '![PyPI version](https://img.shields.io/pypi/v/<pkg>.svg)' },
  { name: 'Python versions',    pattern: /img\.shields\.io\/pypi\/pyversions\//,   example: '![Python versions](https://img.shields.io/pypi/pyversions/<pkg>.svg)' },
  { name: 'License',            pattern: /img\.shields\.io\/badge\/License-MIT/,   example: '![License](https://img.shields.io/badge/License-MIT-green.svg)' },
  { name: 'GitHub stars',       pattern: /img\.shields\.io\/github\/stars\//,      example: '![GitHub stars](https://img.shields.io/github/stars/asgard-ai-platform/<repo>.svg)' },
  { name: 'GitHub issues',      pattern: /img\.shields\.io\/github\/issues\//,     example: '![GitHub issues](https://img.shields.io/github/issues/asgard-ai-platform/<repo>.svg)' },
  { name: 'GitHub last commit', pattern: /img\.shields\.io\/github\/last-commit\//, example: '![GitHub last commit](https://img.shields.io/github/last-commit/asgard-ai-platform/<repo>.svg)' },
  { name: 'MCP compatible',     pattern: /MCP-compatible/,                          example: '![MCP compatible](https://img.shields.io/badge/MCP-compatible-blue.svg)' },
];

const REQUIRED_H2 = ['What This Does', 'Quick Start', 'License'];
const REQUIRED_QUICKSTART_H3 = ['Install', 'Use with Claude Code', 'Use with Claude Desktop'];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function checkReadme(text, expectedToolsCount) {
  const findings = [];
  const lines = text.split('\n');

  // 1. H1
  const h1Line = lines.find(l => /^#\s+/.test(l));
  if (!h1Line) {
    findings.push('H1 heading missing — add a top-level `# MCP <ServiceName>` heading');
  } else if (!/^#\s+MCP\s+\S+/.test(h1Line)) {
    findings.push(`H1 does not match "# MCP <ServiceName>": "${h1Line.trim()}" — rename it to that format`);
  }

  // 2. Pre-H2 region: badges + intro + 繁體中文 link
  const firstH2Idx = lines.findIndex(l => /^##\s+/.test(l));
  const preface = (firstH2Idx === -1 ? lines : lines.slice(0, firstH2Idx)).join('\n');

  for (const badge of REQUIRED_BADGES) {
    if (!badge.pattern.test(preface)) {
      findings.push(`Badge missing: ${badge.name} — add e.g. \`${badge.example}\` to the badge row below the H1`);
    }
  }
  if (!/\[繁體中文\]\(README\.zh-TW\.md\)/.test(preface)) {
    findings.push('Missing [繁體中文](README.zh-TW.md) link — add it in the header area, linking to `README.zh-TW.md`');
  }

  // 3. Required H2 sections
  const h2Titles = lines
    .filter(l => /^##\s+/.test(l))
    .map(l => l.replace(/^##\s+/, '').trim());

  for (const required of REQUIRED_H2) {
    if (!h2Titles.includes(required)) {
      findings.push(`Required section missing: ## ${required} — add this H2 section (see mcp-shopline's README)`);
    }
  }

  // 4. ## Tools (N)
  const toolsTitle = h2Titles.find(t => /^Tools \(\d+\)$/.test(t));
  if (!toolsTitle) {
    findings.push('Required section missing: ## Tools (N) — add a `## Tools (N)` section, N = number of tools listed');
  } else if (expectedToolsCount > 0) {
    const declaredN = parseInt(toolsTitle.match(/\((\d+)\)/)[1]);
    if (declaredN !== expectedToolsCount) {
      findings.push(`## ${toolsTitle} declares ${declaredN} but YAML tools_count is ${expectedToolsCount} — make the two match`);
    }
  }

  // 5. Quick Start subsections
  if (h2Titles.includes('Quick Start')) {
    const startIdx = lines.findIndex(l => l.trim() === '## Quick Start');
    const nextH2Idx = lines.findIndex((l, i) => i > startIdx && /^##\s+/.test(l));
    const block = lines.slice(startIdx, nextH2Idx === -1 ? lines.length : nextH2Idx).join('\n');
    for (const h3 of REQUIRED_QUICKSTART_H3) {
      const re = new RegExp(`^###\\s+${escapeRegex(h3)}\\b`, 'm');
      if (!re.test(block)) {
        findings.push(`## Quick Start: missing ### ${h3} — add a \`### ${h3}\` subsection under ## Quick Start (see mcp-shopline)`);
      }
    }
    if (!/```bash\s*\n[\s\S]*?pip install\s+\S+/.test(block)) {
      findings.push('## Quick Start ### Install: missing fenced `pip install` code block — add a fenced `bash` code block containing `pip install <pkg>`');
    }
  }

  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const dataDir = join(ROOT, 'data');
  const mcps = yaml.load(readFileSync(join(dataDir, 'mcp-servers.yaml'), 'utf-8')).servers;
  let totalFindings = 0;

  for (const mcp of mcps) {
    // Every PUBLIC mcp repo is format-checked regardless of status.
    // 'private' / 'unknown' (missing repo or transient gh failure) skip —
    // avoids false "README missing" findings during a GitHub outage.
    if (ghRepoVisibility(ORG, mcp.slug) !== 'public') continue;
    const readme = ghFetchFile(ORG, mcp.slug, 'README.md');
    if (!readme) {
      appendGroup(REPORT_PATH, mcp.slug, ['README.md missing or unreachable']);
      totalFindings++;
      continue;
    }
    const findings = checkReadme(readme, mcp.tools_count || 0);
    appendGroup(REPORT_PATH, mcp.slug, findings);
    totalFindings += findings.length;
  }

  console.log(`audit-readme-format: ${totalFindings} finding(s) appended to ${REPORT_PATH}`);
}
