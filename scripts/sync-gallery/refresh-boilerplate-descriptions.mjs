#!/usr/bin/env node
/**
 * refresh-boilerplate-descriptions.mjs
 *
 * Runs in the sync workflow after promote-candidates.mjs. discover-new-mcps
 * writes name/description from whatever the repo looks like at discovery
 * time — for repos created from mcp-template that means template text, and
 * the zh description is always a generic stub. Nothing else ever rewrites
 * those fields, so a promoted entry can reach the live gallery still
 * describing itself as "MCP Server Template" (see mcp-heimdall).
 *
 * For each `released` entry whose name/description fields still match the
 * discovery-time boilerplate, re-derive them from the now-public README
 * (H1 + intro paragraph) and surgically rewrite data/mcp-servers.yaml.
 * Hand-curated fields are never touched. Fields that stay boilerplate
 * (e.g. README.zh-TW.md missing) are appended to the audit report so the
 * audit workflow can open a tracking issue on the repo.
 *
 * REFRESH_REPORT_ONLY=1 skips the YAML write (audit workflow mode) but
 * still appends unresolved findings to the report.
 */
import { readFileSync, writeFileSync, realpathSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { ghFetchFile, appendGroup } from './_lib.mjs';

const ORG = 'asgard-ai-platform';
const ROOT = resolve(new URL('.', import.meta.url).pathname, '../..');
const MCP_YAML = join(ROOT, 'data/mcp-servers.yaml');
const REPORT_PATH = join(ROOT, 'scripts/sync-gallery/_generated/repo-audit-report.md');

// ── Boilerplate detection ─────────────────────────────────────────

const TEMPLATE_NAMES = new Set(['MCP Server Template', 'MCP Server 範本']);
// Distinctive fragment of the mcp-template repo description.
const TEMPLATE_DESC_EN = /reusable template for building/i;
// Exact zh stub written by discover-new-mcps for every discovered repo.
const STUB_DESC_ZH = '，提供 AI 代理透過自然語言存取相關資料與功能。';

export function isBoilerplateName(name) {
  return TEMPLATE_NAMES.has((name || '').trim());
}

export function isBoilerplateDescEn(desc, nameEn) {
  const d = (desc || '').trim();
  if (TEMPLATE_DESC_EN.test(d)) return true;
  // discover-new-mcps fallback when both repo description and intro were
  // empty: exactly `MCP Server for <name>.` — nothing more.
  return d === `MCP Server for ${nameEn}.`;
}

export function isBoilerplateDescZh(desc) {
  return (desc || '').includes(STUB_DESC_ZH);
}

// ── README derivation (mirrors discover-new-mcps heuristics) ──────

function extractH1(body) {
  const m = (body || '').match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

function isPlaceholderH1(h1, slug) {
  if (!h1) return true;
  const norm = h1.toLowerCase().trim();
  return norm === slug.toLowerCase() || norm === slug.replace(/^mcp-/, '').toLowerCase();
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

function slugToTitle(slug) {
  return slug.replace(/^mcp-/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Flatten inline markdown to plain text — description fields are rendered
 * verbatim on the cards, so raw `[label](url)` / `**bold**` would show up
 * literally (the original mcp-heimdall bug).
 */
export function stripMarkdownInline(text) {
  return (text || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')        // images dropped
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')     // links → label
    .replace(/\*\*([^*]+)\*\*/g, '$1')           // bold
    .replace(/\*([^*]+)\*/g, '$1')               // italic
    .replace(/`([^`]+)`/g, '$1');                // inline code
}

function deriveName(readme, slug) {
  const h1 = extractH1(readme);
  if (isPlaceholderH1(h1, slug)) return slugToTitle(slug);
  // README convention is `# MCP <ServiceName>`; the gallery name field
  // holds just the service name.
  return stripMarkdownInline(h1).replace(/^MCP\s+/, '').trim();
}

function deriveDesc(readme) {
  const intro = extractIntro(readme);
  if (!intro) return '';
  let desc = stripMarkdownInline(intro.split('\n\n')[0].replace(/\n/g, ' ')).trim();
  if (desc.length > 250) desc = desc.slice(0, 247) + '...';
  return desc;
}

// ── Pure core (exported for tests) ────────────────────────────────

/**
 * Compute field refreshes for released entries still carrying
 * discovery-time boilerplate.
 *
 * @param {object} params
 * @param {Array} params.servers                 parsed mcp-servers.yaml entries
 * @param {(slug:string) => string|null} params.fetchReadmeFn
 * @param {(slug:string) => string|null} params.fetchReadmeZhFn
 * @returns {{updates: Array<{slug:string, fields:object}>, findings: Array<{repo:string, issue:string}>}}
 */
export function buildRefreshes({ servers, fetchReadmeFn, fetchReadmeZhFn }) {
  const updates = [];
  const findings = [];

  for (const server of servers) {
    if (server.status !== 'released') continue;

    const boil = {
      nameEn: isBoilerplateName(server.name?.en),
      nameZh: isBoilerplateName(server.name?.zh),
      descEn: isBoilerplateDescEn(server.description?.en, server.name?.en),
      descZh: isBoilerplateDescZh(server.description?.zh),
    };
    if (!Object.values(boil).some(Boolean)) continue;

    const slug = server.slug;
    const readmeEn = fetchReadmeFn(slug);
    if (!readmeEn) {
      findings.push({ repo: slug, issue: 'README.md missing — gallery name/description still boilerplate' });
      continue;
    }
    const needsZh = boil.nameZh || boil.descZh;
    const readmeZh = needsZh ? fetchReadmeZhFn(slug) : null;

    const candidates = {
      nameEn: deriveName(readmeEn, slug),
      descEn: deriveDesc(readmeEn),
      nameZh: readmeZh ? deriveName(readmeZh, slug) : '',
      descZh: readmeZh ? deriveDesc(readmeZh) : '',
    };

    const stillBoilerplate = (field, value) => {
      if (field === 'nameEn' || field === 'nameZh') return isBoilerplateName(value);
      if (field === 'descEn') return isBoilerplateDescEn(value, candidates.nameEn);
      return isBoilerplateDescZh(value);
    };

    const fields = {};
    for (const field of ['nameEn', 'nameZh', 'descEn', 'descZh']) {
      if (!boil[field]) continue;
      const candidate = candidates[field];
      if (candidate && !stillBoilerplate(field, candidate)) {
        fields[field] = candidate;
      } else {
        const source = field.endsWith('Zh') ? 'README.zh-TW.md' : 'README.md';
        const yamlField = field.startsWith('name') ? 'name' : 'description';
        const lang = field.endsWith('Zh') ? 'zh' : 'en';
        findings.push({ repo: slug, issue: `${yamlField}.${lang} still boilerplate — ${source} H1/intro missing or unusable` });
      }
    }
    if (Object.keys(fields).length > 0) updates.push({ slug, fields });
  }

  return { updates, findings };
}

function escapeStr(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Surgically rewrite YAML text: inside each updated entry, replace the
 * `en:`/`zh:` child lines of `name:`/`description:` with the new values.
 * Preserves all surrounding formatting — does NOT round-trip through
 * yaml.dump (same contract as promote-candidates.applyPromotions).
 */
export function applyFieldUpdates(yamlText, updates) {
  if (updates.length === 0) return yamlText;
  const bySlug = new Map(updates.map(u => [u.slug, u.fields]));
  const lines = yamlText.split('\n');
  let fields = null;   // fields for the entry being walked, or null
  let parent = null;   // 'name' | 'description' | null

  for (let i = 0; i < lines.length; i++) {
    const slugMatch = lines[i].match(/^\s+-\s+slug:\s*(\S+)/);
    if (slugMatch) {
      fields = bySlug.get(slugMatch[1]) || null;
      parent = null;
      continue;
    }
    if (!fields) continue;
    const parentMatch = lines[i].match(/^ {4}(\w+):\s*$/);
    if (parentMatch) {
      parent = (parentMatch[1] === 'name' || parentMatch[1] === 'description') ? parentMatch[1] : null;
      continue;
    }
    if (/^ {4}\S/.test(lines[i])) { parent = null; continue; }
    if (!parent) continue;
    const langMatch = lines[i].match(/^ {6}(en|zh):/);
    if (!langMatch) continue;
    const field = (parent === 'name' ? 'name' : 'desc') + (langMatch[1] === 'en' ? 'En' : 'Zh');
    if (field in fields) {
      lines[i] = `      ${langMatch[1]}: "${escapeStr(fields[field])}"`;
    }
  }
  return lines.join('\n');
}

// ── CLI entrypoint ───────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const yamlText = readFileSync(MCP_YAML, 'utf-8');
  const data = yaml.load(yamlText);

  const { updates, findings } = buildRefreshes({
    servers: data.servers,
    fetchReadmeFn: (slug) => ghFetchFile(ORG, slug, 'README.md'),
    fetchReadmeZhFn: (slug) => ghFetchFile(ORG, slug, 'README.zh-TW.md'),
  });

  const reportOnly = process.env.REFRESH_REPORT_ONLY === '1';

  if (updates.length === 0) {
    console.log('refresh-boilerplate-descriptions: no boilerplate fields to refresh');
  } else if (reportOnly) {
    console.log(`refresh-boilerplate-descriptions: ${updates.length} entry(ies) pending refresh (report-only, YAML not modified):`);
    for (const u of updates) console.log(`  - ${u.slug}: ${Object.keys(u.fields).join(', ')}`);
  } else {
    writeFileSync(MCP_YAML, applyFieldUpdates(yamlText, updates), 'utf-8');
    console.log(`refresh-boilerplate-descriptions: refreshed ${updates.length} entry(ies):`);
    for (const u of updates) console.log(`  - ${u.slug}: ${Object.keys(u.fields).join(', ')}`);
  }

  if (findings.length > 0) {
    console.log(`refresh-boilerplate-descriptions: ${findings.length} unresolved boilerplate finding(s):`);
    const byRepo = new Map();
    for (const f of findings) {
      console.log(`  - ${f.repo}: ${f.issue}`);
      if (!byRepo.has(f.repo)) byRepo.set(f.repo, []);
      byRepo.get(f.repo).push(f.issue);
    }
    mkdirSync(join(ROOT, 'scripts/sync-gallery/_generated'), { recursive: true });
    for (const [repo, issues] of byRepo) appendGroup(REPORT_PATH, repo, issues);
  }
}
