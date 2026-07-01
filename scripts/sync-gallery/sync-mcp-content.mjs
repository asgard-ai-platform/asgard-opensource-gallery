#!/usr/bin/env node
/**
 * sync-mcp-content.mjs
 * Fetches README.md and README.zh-TW.md from each MCP repo
 * and extracts structured sections into data/mcp-content.json.
 *
 * Usage: node scripts/sync-gallery/sync-mcp-content.mjs
 */
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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

export function extractSections(readme) {
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
export function extractIntro(readme) {
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

export function sectionKey(title) {
  const raw = title.trim().toLowerCase();
  if (!raw) return '';

  // Normalised form: replace non-letter/number/whitespace with space (preserves
  // word boundaries that punctuation would otherwise cross), then collapse spaces.
  // \p{L} keeps CJK; \p{N} keeps digits.
  const t = raw
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!t) return '';

  // Tools — many en/zh variants with optional counts. Match on normalised t so
  // decorative leading chars (emoji, etc.) don't block the alias.
  // \b after `tools?` ensures "toolkit" / "tooling" don't match.
  if (/^(?:available\s+)?tools?\b/.test(t)) return 'available_tools';
  if (/^(?:可用)?工具/.test(t)) return 'available_tools';

  // ── en whitelist + zh aliases (both canonicalise to the same en key) ──
  if (t.includes('what this does') || t === 'features' || t.includes('功能特色') || t === '功能' || t === '特色') return 'features';
  if (t.includes('quick start') || t.includes('getting started') || t.includes('快速開始') || t === '入門') return 'quick_start';
  if (t.includes('api reference') || t.includes('api 參考')) return 'api_reference';
  if (t.includes('important write tools') || t.includes('重要寫入工具') || t.includes('重要 寫入工具')) return 'important_write_tools';
  if (t.includes('install') || t.includes('安裝')) return 'install';
  if (t.includes('configuration') || t.includes('config') || t.includes('設定') || t.includes('配置')) return 'configuration';
  if (t === 'development' || t === '開發') return 'development';
  if (t.includes('contributing') || t.includes('貢獻')) return 'contributing';
  if (t.includes('license') || t.includes('授權')) return 'license';
  if (t.includes('usage examples') || t.includes('example usage') || t.includes('使用範例') || t === '範例' || t === 'example') return 'usage_examples';
  if (t === 'usage' || t === '使用方式' || t.includes('use with')) return 'usage';
  if (t.includes('project structure') || t.includes('專案結構')) return 'project_structure';
  if (t.includes('api constraints') || t.includes('api 限制')) return 'api_constraints';
  if (t.includes('api endpoint coverage') || t.includes('api 端點覆蓋')) return 'api_endpoint_coverage';
  if (t.includes('known test gaps') || t.includes('已知測試缺口')) return 'known_test_gaps';
  if (t.includes('roadmap') || t.includes('路線圖') || t.includes('開發計畫')) return 'roadmap';
  if (t === 'testing' || t === '測試') return 'testing';
  if (t === 'architecture' || t === '架構') return 'architecture';
  if (t.includes('data source') || t.includes('資料來源')) return 'data_source';
  if (t.includes('part of the asgard ecosystem') || t.includes('asgard 生態系') || t.includes('asgard生態系')) return 'part_of_the_asgard_ecosystem';
  if (t.includes('prerequisites') || t.includes('前置條件') || t.includes('前置需求') || t.includes('先決條件')) return 'prerequisites';
  if (t.includes('requirements') || t.includes('環境需求')) return 'requirements';
  if (t === 'overview' || t === '概述') return 'overview';
  if (t.includes('categories') || t.includes('資料分類')) return 'categories';
  if (t.includes('error codes reference') || t.includes('錯誤代碼參考')) return 'error_codes_reference';
  if (t.includes('item code reference') || t.includes('itemcode reference') || t.includes('品項代碼參考')) return 'itemcode_reference';
  if (t.includes('publishing to pypi') || t.includes('發布至 pypi') || t.includes('發布至pypi')) return 'publishing_to_pypi';

  // Slugify fallback (preserves CJK as legal key)
  return t.replace(/\s+/g, '_').replace(/^_|_$/g, '');
}

/**
 * Build the mcp-content map from the released servers. Pure/testable — fetchers
 * and the previous on-disk content are injected.
 *
 * A released repo whose README fetch returns null is treated as a TRANSIENT
 * failure, not a deletion: its last-good content is carried over from
 * `prevContent` instead of being dropped. Dropping it would let a single flaky
 * gh-api call auto-commit the removal of that MCP's detail-page content
 * (check-sync-thresholds only trips below 80% coverage). Non-released repos are
 * still omitted — that is a deliberate YAML status change, not a fetch failure.
 */
export function buildMcpContent({ servers, fetchEnFn, fetchZhFn, prevContent = {} }) {
  const content = {};
  const stats = { processed: 0, carried: 0, skipped: 0, zhCount: 0 };

  for (const server of servers) {
    const repo = server.slug;
    if (server.status !== 'released') { stats.skipped++; continue; }

    const readmeEn = fetchEnFn(repo);
    if (!readmeEn) {
      if (prevContent[repo]) { content[repo] = prevContent[repo]; stats.carried++; }
      else { stats.skipped++; }
      continue;
    }

    const entry = { intro: { en: extractIntro(readmeEn) }, sections: { en: {}, zh: {} } };
    for (const [title, md] of extractSections(readmeEn)) entry.sections.en[sectionKey(title)] = md;

    const readmeZh = fetchZhFn(repo);
    if (readmeZh) {
      entry.intro.zh = extractIntro(readmeZh);
      for (const [title, md] of extractSections(readmeZh)) entry.sections.zh[sectionKey(title)] = md;
      stats.zhCount++;
    }

    content[repo] = entry;
    stats.processed++;
  }

  return { content, stats };
}

// ── Main ─────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  console.log('═══════════════════════════════════════════════════');
  console.log(' Sync MCP Content → data/mcp-content.json');
  console.log('═══════════════════════════════════════════════════\n');

  // Load YAML
  console.log('[1/3] Loading mcp-servers.yaml ...');
  const servers = yaml.load(readFileSync(MCP_YAML, 'utf-8')).servers;

  // Last-good content, so a transient fetch failure carries over rather than
  // deleting an entry (see buildMcpContent). A corrupt file must not crash the
  // sync — fall back to empty (this run then behaves like the pre-carry-over
  // build for entries without a successful fetch).
  let prevContent = {};
  if (existsSync(OUTPUT_JSON)) {
    try {
      prevContent = JSON.parse(readFileSync(OUTPUT_JSON, 'utf-8'));
    } catch {
      console.warn(`  ⚠ existing ${OUTPUT_JSON} is unparseable; starting from empty`);
    }
  }

  // Fetch READMEs
  console.log(`[2/3] Fetching READMEs from ${servers.length} MCP repos ...`);
  const { content: mcpContent, stats } = buildMcpContent({
    servers,
    fetchEnFn: (repo) => ghFetchFile(repo, 'README.md'),
    fetchZhFn: (repo) => ghFetchFile(repo, 'README.zh-TW.md'),
    prevContent,
  });

  // Write output
  console.log(`[3/3] Writing mcp-content.json ...`);
  writeFileSync(OUTPUT_JSON, JSON.stringify(mcpContent, null, 2), 'utf-8');
  console.log(`  ✅ ${stats.processed} processed (${stats.zhCount} with zh), ${stats.carried} carried over, ${stats.skipped} skipped`);

  console.log('\n═══════════════════════════════════════════════════');
  console.log(' Done');
  console.log('═══════════════════════════════════════════════════');
}
