#!/usr/bin/env node
/**
 * discover-new-mcps.mjs
 *
 * Runs in the sync workflow before promote-candidates.mjs. Lists every
 * mcp-* repo in the org (public + private, excluding mcp-template),
 * diffs against data/mcp-servers.yaml, and appends any missing slug as
 * a coming-soon stub. The visibility gate in promote-candidates.mjs
 * keeps private stubs from auto-promoting when a same-named PyPI
 * package exists.
 *
 * Public repos with no README emit a repo-issue line (consumed by the
 * audit report). Private repos silently produce minimal stubs — their
 * README is expected to be unavailable to outside readers.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, realpathSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { ghFetchFile, ghJSON, appendGroup } from './_lib.mjs';

const ORG = 'asgard-ai-platform';
const ROOT = resolve(new URL('.', import.meta.url).pathname, '../..');
const MCP_YAML = join(ROOT, 'data/mcp-servers.yaml');
const REPORT_PATH = join(ROOT, 'scripts/sync-gallery/_generated/repo-audit-report.md');

// ── Heuristic helpers (ported from generate-new-entries.mjs) ──────

function inferRegion(slug) {
  if (/^mcp-(tw|twfood|591|cwa|ezpay|newebpay|ecpay|universalec|tdcc|shopline|91app|mayo)/.test(slug)) return 'taiwan';
  if (/^mcp-(sg|id|ph|sea)/.test(slug)) return 'sea';
  if (/^mcp-jp/.test(slug)) return 'japan';
  return 'global';
}

function inferCategory(slug, repoInfo, readme) {
  const desc = (repoInfo?.description || '') + ' ' + (readme || '').slice(0, 500);
  if (/payment|invoic|einvoice|ezpay|newebpay|ecpay|jkopay|tappay/i.test(slug)) return 'payment';
  if (/judgment|judicial|gov|moea|gcis/i.test(slug + ' ' + desc)) return 'gov';
  if (/hrm|payroll|attendance|hr-/i.test(slug + ' ' + desc)) return 'ops';
  if (/shop|retail|ecom|e-commerce|momo|shopee/i.test(slug + ' ' + desc)) return 'ecommerce';
  if (/comm|message|slack|line|telegram/i.test(slug + ' ' + desc)) return 'communication';
  if (/manufact|iot|industrial/i.test(slug + ' ' + desc)) return 'manufacturing';
  return 'data';
}

function extractH1(body) {
  const m = (body || '').match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

function extractIntro(readme) {
  if (!readme) return '';
  const lines = readme.split('\n');
  const intro = [];
  let pastH1 = false;
  for (const line of lines) {
    if (/^#\s+/.test(line)) { pastH1 = true; continue; }
    if (/^##\s+/.test(line)) break;
    if (pastH1) {
      if (/^\[!\[/.test(line) || /^\[繁體中文\]/.test(line) || /^\[English\]/.test(line) || line.trim() === '---') continue;
      intro.push(line);
    }
  }
  return intro.join('\n').trim();
}

function extractToolsCount(readme) {
  if (!readme) return null;
  const patterns = [
    /(\d+)\s+AI-callable tools/,
    /\*\*(\d+)\s+[a-zA-Z-]*\s*tools\*\*/,
    /(\d+)\s+MCP tools/,
  ];
  for (const p of patterns) {
    const m = readme.match(p);
    if (m) return parseInt(m[1]);
  }
  return null;
}

function slugToTitle(slug) {
  return slug.replace(/^mcp-/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function escapeStr(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ── Pure helpers (exported for tests) ────────────────────────────

/**
 * Build coming-soon stub records for repos missing from YAML.
 *
 * @param {object} params
 * @param {Set<string>} params.existingSlugs   slugs already present in YAML
 * @param {string[]} params.repoSlugs          full list of mcp-* repos in the org
 * @param {(slug:string) => object|null} params.fetchRepoFn        returns gh repo metadata or null
 * @param {(slug:string) => string|null} params.fetchReadmeFn      returns README body or null
 * @param {(slug:string) => string|null} params.fetchReadmeZhFn    returns README.zh-TW.md body or null
 * @param {(slug:string) => boolean} params.isPrivateFn            true if repo is private
 * @returns {{entries: object[], errors: {repo:string, issue:string}[]}}
 */
export function buildMcpStubs({ existingSlugs, repoSlugs, fetchRepoFn, fetchReadmeFn, fetchReadmeZhFn, isPrivateFn }) {
  const entries = [];
  const errors = [];

  for (const slug of repoSlugs) {
    if (existingSlugs.has(slug)) continue;
    const isPrivate = isPrivateFn(slug);
    const repoInfo = fetchRepoFn(slug);
    const readme = fetchReadmeFn(slug);
    const readmeZh = fetchReadmeZhFn(slug);

    if (!isPrivate) {
      if (!readme) errors.push({ repo: slug, issue: 'README.md missing or unreachable' });
      if (!repoInfo?.description) errors.push({ repo: slug, issue: 'GitHub repo description is empty' });
      if (readme && !readmeZh) errors.push({ repo: slug, issue: 'README.zh-TW.md missing — no Chinese content for detail page' });
    }

    const region = inferRegion(slug);
    const category = inferCategory(slug, repoInfo, readme);
    const slugTokens = slug.replace(/^mcp-/, '').split('-').filter(t => t.length > 1);
    const tags = [...new Set([category, region, ...slugTokens])].slice(0, 6);
    const toolsCount = extractToolsCount(readme);
    const intro = extractIntro(readme || '');

    const nameEn = extractH1(readme || '') || slugToTitle(slug);
    let descEn = repoInfo?.description || (intro ? intro.split('\n\n')[0].replace(/\n/g, ' ').trim() : '');
    if (!descEn) descEn = `MCP Server for ${nameEn}.`;
    if (descEn.length > 250) descEn = descEn.slice(0, 247) + '...';
    const descZh = `${nameEn} MCP Server，提供 AI 代理透過自然語言存取相關資料與功能。`;

    entries.push({
      slug, nameEn, nameZh: nameEn, descEn, descZh,
      status: 'coming-soon', category, region, toolsCount, tags,
    });
  }

  return { entries, errors };
}

/**
 * Render a list of stub records as YAML text (no leading/trailing newlines).
 */
export function renderMcpStubs(entries) {
  if (entries.length === 0) return '';
  return entries.map(e => {
    const lines = [
      `  - slug: ${e.slug}`,
      `    name:`,
      `      en: "${escapeStr(e.nameEn)}"`,
      `      zh: "${escapeStr(e.nameZh)}"`,
      `    description:`,
      `      en: "${escapeStr(e.descEn)}"`,
      `      zh: "${escapeStr(e.descZh)}"`,
      `    status: ${e.status}`,
      `    category: ${e.category}`,
      `    region: ${e.region}`,
      `    github: https://github.com/asgard-ai-platform/${e.slug}`,
    ];
    if (e.toolsCount) lines.push(`    tools_count: ${e.toolsCount}`);
    lines.push(`    tags: [${e.tags.join(', ')}]`);
    lines.push(`    maintainer: asgard-ai-platform`);
    return lines.join('\n');
  }).join('\n\n');
}

/**
 * Append a rendered stubs block under a dated header. Existing content
 * is preserved verbatim; the appended block is separated by blank lines
 * so the YAML parser sees it as a new list item.
 */
export function appendStubsToYaml(yamlText, renderedStubs, dateString) {
  if (!renderedStubs) return yamlText;
  const trimmed = yamlText.endsWith('\n') ? yamlText : yamlText + '\n';
  const header = [
    '',
    '  # ============================================================',
    `  # Auto-added by discover-new-mcps.mjs on ${dateString} — REVIEW`,
    '  # ============================================================',
    '',
  ].join('\n');
  return trimmed + header + renderedStubs + '\n';
}

// ── CLI entrypoint ───────────────────────────────────────────────

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf-8', timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function ghListAllMcpRepos() {
  const json = gh(['repo', 'list', ORG, '--limit', '300', '--json', 'name,isPrivate']);
  return JSON.parse(json)
    .filter(r => r.name.startsWith('mcp-') && r.name !== 'mcp-template')
    .sort((a, b) => a.name.localeCompare(b.name));
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const yamlText = readFileSync(MCP_YAML, 'utf-8');
  const data = yaml.load(yamlText);
  const existingSlugs = new Set(data.servers.map(s => s.slug));

  // `gh repo list` already returns isPrivate per repo — reuse it instead of
  // re-querying via ghIsRepoPrivate for every new slug.
  const repos = ghListAllMcpRepos();
  const visibility = new Map(repos.map(r => [r.name, r.isPrivate]));
  const { entries, errors } = buildMcpStubs({
    existingSlugs,
    repoSlugs: repos.map(r => r.name),
    fetchRepoFn: (slug) => ghJSON(`repos/${ORG}/${slug}`),
    fetchReadmeFn: (slug) => ghFetchFile(ORG, slug, 'README.md'),
    fetchReadmeZhFn: (slug) => ghFetchFile(ORG, slug, 'README.zh-TW.md'),
    isPrivateFn: (slug) => visibility.get(slug) === true,
  });

  if (entries.length === 0) {
    console.log('discover-new-mcps: no new mcp-* repos to append');
  } else {
    const rendered = renderMcpStubs(entries);
    const today = new Date().toISOString().slice(0, 10);
    writeFileSync(MCP_YAML, appendStubsToYaml(yamlText, rendered, today), 'utf-8');
    console.log(`discover-new-mcps: appended ${entries.length} coming-soon stub(s):`);
    for (const e of entries) console.log(`  - ${e.slug} (${e.region}/${e.category})`);
  }

  // Feed repo issues into the same audit report consumed by the audit workflow.
  // `_generated/` is git-ignored, so the parent dir may not exist on a fresh
  // checkout (the sync workflow runs this script without the audit-side
  // mkdir). Create it before appendGroup tries to write.
  const byRepo = new Map();
  for (const e of errors) {
    if (!byRepo.has(e.repo)) byRepo.set(e.repo, []);
    byRepo.get(e.repo).push(e.issue);
  }
  if (byRepo.size > 0) {
    mkdirSync(join(ROOT, 'scripts/sync-gallery/_generated'), { recursive: true });
    for (const [repo, issues] of byRepo) appendGroup(REPORT_PATH, repo, issues);
  }
}
