#!/usr/bin/env node
/**
 * sync-mcp-content.mjs
 * Fetches README.md and README.zh-TW.md from each MCP repo
 * and extracts structured sections into data/mcp-content.json.
 *
 * Usage: node scripts/sync-gallery/sync-mcp-content.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';

const ORG = 'asgard-ai-platform';
const ROOT = resolve(new URL('.', import.meta.url).pathname, '../..');
const DATA_DIR = join(ROOT, 'data');
const MCP_YAML = join(DATA_DIR, 'mcp-servers.yaml');
const OUTPUT_JSON = join(DATA_DIR, 'mcp-content.json');

// ── Helpers ──────────────────────────────────────────────────────

function ghFetchFile(repo, path) {
  try {
    const result = execFileSync(
      'gh',
      ['api', `repos/${ORG}/${repo}/contents/${path}`, '--jq', '.content'],
      { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    return Buffer.from(result, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

function extractSections(readme) {
  if (!readme) return new Map();
  const sections = new Map();
  const lines = readme.split('\n');
  let currentTitle = null;
  let currentLines = [];

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      if (currentTitle) {
        sections.set(currentTitle, currentLines.join('\n').trim());
      }
      currentTitle = h2Match[1].trim();
      currentLines = [];
    } else if (currentTitle) {
      currentLines.push(line);
    }
  }
  if (currentTitle) {
    sections.set(currentTitle, currentLines.join('\n').trim());
  }
  return sections;
}

/**
 * Extract intro text between H1 and first H2.
 */
function extractIntro(readme) {
  if (!readme) return '';
  const lines = readme.split('\n');
  const introLines = [];
  let pastH1 = false;

  for (const line of lines) {
    if (/^#\s+/.test(line)) { pastH1 = true; continue; }
    if (/^##\s+/.test(line)) break;
    if (pastH1) {
      // Skip badge lines and language toggle links
      if (/^\[!\[/.test(line) || /^\[繁體中文\]/.test(line) || /^\[English\]/.test(line) || line.trim() === '---') continue;
      introLines.push(line);
    }
  }
  return introLines.join('\n').trim();
}

function sectionKey(title) {
  const t = title.toLowerCase().replace(/[^\w\s]/g, '').trim();
  if (t.includes('what this does') || t.includes('功能特色') || t === 'features') return 'features';
  if (t.includes('quick start') || t.includes('快速開始') || t.includes('getting started')) return 'quick_start';
  if (t.includes('available tools') || t.includes('可用工具') || t === 'tools') return 'available_tools';
  if (t.includes('api reference') || t.includes('api 參考') || t.includes('api reference')) return 'api_reference';
  if (t.includes('install') || t.includes('安裝')) return 'install';
  if (t.includes('configuration') || t.includes('設定') || t.includes('config')) return 'configuration';
  if (t.includes('license') || t.includes('授權')) return 'license';
  if (t.includes('contributing') || t.includes('貢獻')) return 'contributing';
  if (t.includes('use with')) return 'usage';
  return t.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// ── Main ─────────────────────────────────────────────────────────

console.log('═══════════════════════════════════════════════════');
console.log(' Sync MCP Content → data/mcp-content.json');
console.log('═══════════════════════════════════════════════════\n');

// Load YAML
console.log('[1/3] Loading mcp-servers.yaml ...');
const yamlData = yaml.load(readFileSync(MCP_YAML, 'utf-8'));
const servers = yamlData.servers;

// Fetch READMEs
console.log(`[2/3] Fetching READMEs from ${servers.length} MCP repos ...\n`);
const mcpContent = {};
let processed = 0;
let skipped = 0;
let zhCount = 0;

for (const server of servers) {
  const repo = server.slug;
  process.stdout.write(`  ${repo} ... `);

  // Only fetch for released repos (they have public READMEs)
  if (server.status !== 'released') {
    console.log('⏭  (not released)');
    skipped++;
    continue;
  }

  const readmeEn = ghFetchFile(repo, 'README.md');
  if (!readmeEn) {
    console.log('⚠  no README');
    skipped++;
    continue;
  }

  const readmeZh = ghFetchFile(repo, 'README.zh-TW.md');

  const content = {
    intro: { en: extractIntro(readmeEn) },
    sections: { en: {}, zh: {} },
  };

  // English sections
  const enSections = extractSections(readmeEn);
  for (const [title, md] of enSections) {
    const key = sectionKey(title);
    content.sections.en[key] = md;
  }

  // Chinese sections
  if (readmeZh) {
    content.intro.zh = extractIntro(readmeZh);
    const zhSections = extractSections(readmeZh);
    for (const [title, md] of zhSections) {
      const key = sectionKey(title);
      content.sections.zh[key] = md;
    }
    zhCount++;
    console.log('✅ (en + zh)');
  } else {
    console.log('✅ (en only)');
  }

  mcpContent[server.slug] = content;
  processed++;
}

// Write output
console.log(`\n[3/3] Writing mcp-content.json ...`);
writeFileSync(OUTPUT_JSON, JSON.stringify(mcpContent, null, 2), 'utf-8');
console.log(`  ✅ ${processed} MCPs processed (${zhCount} with zh), ${skipped} skipped`);

console.log('\n═══════════════════════════════════════════════════');
console.log(' Done');
console.log('═══════════════════════════════════════════════════');
