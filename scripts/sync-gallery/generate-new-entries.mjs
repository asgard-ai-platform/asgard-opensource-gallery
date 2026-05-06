#!/usr/bin/env node
/**
 * generate-new-entries.mjs
 *
 * Auto-discover public repos on GitHub that are NOT yet in YAML data files
 * and emit draft YAML entries for human review.
 *
 * Outputs (gitignored, all in scripts/sync-gallery/_generated/):
 *   - new-mcp-entries.yaml        — draft entries for missing MCP repos
 *   - new-skill-entries.yaml      — draft entries for missing skill dirs
 *   - repo-audit-report.md        — issues found in upstream repos
 *
 * Usage:
 *   node scripts/sync-gallery/generate-new-entries.mjs
 *
 * After review, append the *.yaml files to data/mcp-servers.yaml /
 * data/skills.yaml, then run npm run validate.
 */
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';

const ORG = 'asgard-ai-platform';
const ROOT = resolve(new URL('.', import.meta.url).pathname, '../..');
const DATA_DIR = join(ROOT, 'data');
const OUT_DIR = join(ROOT, 'scripts/sync-gallery/_generated');
mkdirSync(OUT_DIR, { recursive: true });

// ── GitHub helpers ───────────────────────────────────────────────

function gh(cmd) {
  return execSync(cmd, { encoding: 'utf-8', timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function ghFetchFile(repo, path) {
  try {
    const result = gh(`gh api "repos/${ORG}/${repo}/contents/${path}" --jq '.content'`);
    return Buffer.from(result, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

function ghGetRepo(repo) {
  try {
    return JSON.parse(gh(`gh api "repos/${ORG}/${repo}"`));
  } catch {
    return null;
  }
}

function ghListPublicMcpRepos() {
  const json = gh(`gh repo list ${ORG} --limit 200 --json name,isPrivate`);
  return JSON.parse(json)
    .filter(r => r.name.startsWith('mcp-') && !r.isPrivate && r.name !== 'mcp-template')
    .map(r => r.name)
    .sort();
}

function ghListSkillDirs() {
  const json = gh(`gh api "repos/${ORG}/skills/git/trees/main" --jq '[.tree[] | select(.type == "tree") | .path | select(test("^[a-z]"))]'`);
  return JSON.parse(json)
    .filter(d => !['eval', 'tools', 'docs'].includes(d))
    .sort();
}

function ghHasSubdir(repo, parent, sub) {
  try {
    const list = JSON.parse(gh(`gh api "repos/${ORG}/${repo}/contents/${parent}" --jq '[.[] | select(.type == "dir") | .name]'`));
    return list.includes(sub);
  } catch {
    return false;
  }
}

// ── Markdown helpers ─────────────────────────────────────────────

function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return { meta: {}, body: content };
  try {
    return { meta: yaml.load(match[1]), body: content.slice(match[0].length).trim() };
  } catch {
    return { meta: {}, body: content };
  }
}

function extractH1(body) {
  const m = body.match(/^#\s+(.+)$/m);
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

// ── Heuristics for inferring fields ──────────────────────────────

function inferMcpFields(slug, repoInfo, readme) {
  let region = 'global';
  if (/^mcp-(tw|twfood|591|cwa|ezpay|newebpay|ecpay|universalec|tdcc|shopline|91app|mayo)/.test(slug)) region = 'taiwan';
  else if (/^mcp-(sg|id|ph|sea)/.test(slug)) region = 'sea';
  else if (/^mcp-jp/.test(slug)) region = 'japan';

  const desc = (repoInfo?.description || '') + ' ' + (readme || '').slice(0, 500);
  let category = 'data';
  if (/payment|invoic|einvoice|ezpay|newebpay|ecpay|jkopay|tappay/i.test(slug)) category = 'payment';
  else if (/judgment|judicial|gov|moea|gcis/i.test(slug + ' ' + desc)) category = 'gov';
  else if (/hrm|payroll|attendance|hr-/i.test(slug + ' ' + desc)) category = 'ops';
  else if (/shop|retail|ecom|e-commerce|momo|shopee/i.test(slug + ' ' + desc)) category = 'ecommerce';
  else if (/comm|message|slack|line|telegram/i.test(slug + ' ' + desc)) category = 'communication';
  else if (/manufact|iot|industrial/i.test(slug + ' ' + desc)) category = 'manufacturing';

  const slugTokens = slug.replace(/^mcp-/, '').split('-').filter(t => t.length > 1);
  const tags = [...new Set([category, region, ...slugTokens])].slice(0, 6);
  return { region, category, tags };
}

function inferSkillFields(dir, frontmatterMeta) {
  const md = frontmatterMeta?.metadata || {};
  const region = /^tw-/.test(dir) ? 'taiwan' : 'global';

  let category = 'methodology';
  if (/^med-/.test(dir)) category = 'media';
  else if (/^(tw-ecom|ecom)-/.test(dir)) category = 'ecommerce';
  else if (/^(tw-)?fin-/.test(dir)) category = 'finance';
  else if (/^mkt-/.test(dir)) category = 'marketing';
  else if (/^cs-/.test(dir)) category = 'customer-service';
  else if (/^(tw-)?manuf-/.test(dir)) category = 'manufacturing';
  else if (/^(stat|algo)-/.test(dir)) category = 'algorithm';
  else if (/^theory-/.test(dir)) category = 'theory';
  else if (/^ops-/.test(dir)) category = 'ops';
  else if (/^data-/.test(dir)) category = 'data';

  let skillType = 'industry';
  if (/^(meta|ux|ops|stat|tech)-/.test(dir)) skillType = 'methodology';
  else if (/^(theory|grad|hum|soc|econ|legal)-/.test(dir)) skillType = 'theory';
  else if (/^algo-/.test(dir)) skillType = 'algorithm';

  return { region, category, skillType, mdStatus: md.status, mdTags: md.tags || [], mdRelatedMcps: md.related_mcps || [] };
}

// ── Main ─────────────────────────────────────────────────────────

console.error('═══════════════════════════════════════════════════');
console.error(' Generate New Entries — auto-discovery from GitHub');
console.error('═══════════════════════════════════════════════════\n');

const mcpYamlData = yaml.load(readFileSync(join(DATA_DIR, 'mcp-servers.yaml'), 'utf-8'));
const skillYamlData = yaml.load(readFileSync(join(DATA_DIR, 'skills.yaml'), 'utf-8'));
const existingMcpSlugs = new Set(mcpYamlData.servers.map(s => s.slug));
const existingSkillDirs = new Set(skillYamlData.skills.map(s => s.slug.replace(/^skill-/, '')));

console.error('[1/4] Discovering missing entries ...');
const allMcps = ghListPublicMcpRepos();
const newMcps = allMcps.filter(s => !existingMcpSlugs.has(s));
const allSkills = ghListSkillDirs();
const newSkills = allSkills.filter(d => !existingSkillDirs.has(d));
console.error(`  Public MCP repos: ${allMcps.length} (${newMcps.length} new)`);
console.error(`  Skill dirs:       ${allSkills.length} (${newSkills.length} new)\n`);

const errors = [];

console.error('[2/4] Drafting MCP entries ...');
const mcpEntries = [];
newMcps.forEach(s => existingMcpSlugs.add(s));

for (const slug of newMcps) {
  process.stderr.write(`  ${slug} ... `);
  const repoInfo = ghGetRepo(slug);
  const readme = ghFetchFile(slug, 'README.md');
  const readmeZh = ghFetchFile(slug, 'README.zh-TW.md');
  const toolsCount = extractToolsCount(readme);
  const intro = extractIntro(readme || '');
  const { region, category, tags } = inferMcpFields(slug, repoInfo, readme);

  if (!readme) errors.push({ repo: slug, kind: 'mcp', issue: 'README.md missing or unreachable' });
  if (!repoInfo?.description) errors.push({ repo: slug, kind: 'mcp', issue: 'GitHub repo description is empty' });
  if (readme && !toolsCount) errors.push({ repo: slug, kind: 'mcp', issue: 'tools_count not parseable from README' });
  if (readme && !readmeZh) errors.push({ repo: slug, kind: 'mcp', issue: 'README.zh-TW.md missing — no Chinese content for detail page' });

  const nameEn = extractH1(readme || '') || slug.replace(/^mcp-/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  let descEn = repoInfo?.description || (intro ? intro.split('\n\n')[0].replace(/\n/g, ' ').trim() : '');
  if (!descEn) descEn = `MCP Server for ${nameEn}.`;
  if (descEn.length > 250) descEn = descEn.slice(0, 247) + '...';
  const descZh = `${nameEn} MCP Server，提供 AI 代理透過自然語言存取相關資料與功能。`;

  mcpEntries.push({ slug, nameEn, nameZh: nameEn, descEn, descZh, region, category, toolsCount, tags });
  console.error('✓');
}
console.error('');

console.error('[3/4] Drafting skill entries ...');
const skillEntries = [];
for (const dir of newSkills) {
  process.stderr.write(`  ${dir} ... `);
  const skillMd = ghFetchFile('skills', `${dir}/SKILL.md`);
  if (!skillMd) {
    console.error('⚠  no SKILL.md');
    errors.push({ repo: `skills/${dir}`, kind: 'skill', issue: 'SKILL.md missing or unreachable' });
    continue;
  }
  const { meta, body } = parseFrontmatter(skillMd);
  const nameEn = extractH1(body) || dir;
  const descEn = (meta.description || '').trim();
  const { region, category, skillType, mdStatus, mdTags, mdRelatedMcps } = inferSkillFields(dir, meta);
  const tags = Array.isArray(mdTags) ? mdTags.slice(0, 8) : [];
  const requiresMcpRaw = Array.isArray(mdRelatedMcps) ? mdRelatedMcps : [];
  const requiresMcp = requiresMcpRaw.filter(s => existingMcpSlugs.has(s));
  const droppedMcps = requiresMcpRaw.filter(s => !existingMcpSlugs.has(s));
  const hasScript = ghHasSubdir('skills', dir, 'scripts');

  if (!extractH1(body)) errors.push({ repo: `skills/${dir}`, kind: 'skill', issue: 'SKILL.md has no H1 heading' });
  if (!descEn) errors.push({ repo: `skills/${dir}`, kind: 'skill', issue: 'frontmatter "description" missing or empty' });
  if (!Array.isArray(mdTags) || mdTags.length === 0) errors.push({ repo: `skills/${dir}`, kind: 'skill', issue: 'frontmatter metadata.tags missing — used for filter UI' });
  if (mdStatus === 'skeleton') errors.push({ repo: `skills/${dir}`, kind: 'skill', issue: 'metadata.status="skeleton" — content is incomplete' });
  if (droppedMcps.length) errors.push({ repo: `skills/${dir}`, kind: 'skill', issue: `metadata.related_mcps references unknown slug(s): ${droppedMcps.join(', ')}` });

  const zhPrefix = category === 'media' ? '媒體技能'
    : category === 'ecommerce' && region === 'taiwan' ? '台灣電商'
    : category === 'ecommerce' ? '電商技能'
    : '技能';
  const nameZh = `${zhPrefix}：${nameEn}`;
  const descZh = `${zhPrefix}：${nameEn} 分析與應用。`;

  skillEntries.push({
    slug: `skill-${dir}`, nameEn, nameZh, descEn, descZh,
    status: mdStatus === 'skeleton' ? 'coming-soon' : 'released',
    category, region, skillType, hasScript, tags, requiresMcp, githubDir: dir,
  });
  console.error('✓');
}
console.error('');

function escapeStr(s) { return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

function renderMcp(e) {
  const lines = [
    `  - slug: ${e.slug}`,
    `    name:`,
    `      en: "${escapeStr(e.nameEn)}"`,
    `      zh: "${escapeStr(e.nameZh)}"`,
    `    description:`,
    `      en: "${escapeStr(e.descEn)}"`,
    `      zh: "${escapeStr(e.descZh)}"`,
    `    status: released`,
    `    category: ${e.category}`,
    `    region: ${e.region}`,
    `    github: https://github.com/asgard-ai-platform/${e.slug}`,
  ];
  if (e.toolsCount) lines.push(`    tools_count: ${e.toolsCount}`);
  lines.push(`    tags: [${e.tags.join(', ')}]`);
  lines.push(`    maintainer: asgard-ai-platform`);
  return lines.join('\n');
}

function renderSkill(e) {
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
    `    skill_type: ${e.skillType}`,
    `    region: ${e.region}`,
    `    github: https://github.com/asgard-ai-platform/skills/blob/main/${e.githubDir}/SKILL.md`,
  ];
  if (e.hasScript) lines.push(`    has_script: true`);
  if (e.requiresMcp.length) lines.push(`    requires_mcp: [${e.requiresMcp.join(', ')}]`);
  if (e.tags.length) {
    lines.push(`    tags:`);
    for (const t of e.tags) lines.push(`    - ${t}`);
  }
  lines.push(`    maintainer: asgard-ai-platform`);
  return lines.join('\n');
}

console.error('[4/4] Writing outputs ...');

const mcpOut = mcpEntries.length === 0
  ? '# No new MCP entries — YAML already covers all public mcp-* repos.\n'
  : [
      '# Draft entries — review heuristic-inferred category/region/tags before appending.',
      '',
      '  # ============================================================',
      `  # New Public MCPs (${mcpEntries.length}) — REVIEW & EDIT`,
      '  # ============================================================',
      ...mcpEntries.flatMap(e => [renderMcp(e), '']),
    ].join('\n').trimEnd() + '\n';

const skillOut = skillEntries.length === 0
  ? '# No new skill entries — YAML already covers all skill dirs.\n'
  : [
      '# Draft entries — review heuristic-inferred category/region/skill_type before appending.',
      '',
      '  # ============================================================',
      `  # New Skills (${skillEntries.length}) — REVIEW & EDIT`,
      '  # ============================================================',
      ...skillEntries.flatMap(e => [renderSkill(e), '']),
    ].join('\n').trimEnd() + '\n';

writeFileSync(join(OUT_DIR, 'new-mcp-entries.yaml'), mcpOut, 'utf-8');
writeFileSync(join(OUT_DIR, 'new-skill-entries.yaml'), skillOut, 'utf-8');

const byRepo = new Map();
for (const e of errors) {
  if (!byRepo.has(e.repo)) byRepo.set(e.repo, []);
  byRepo.get(e.repo).push(e);
}

const reportLines = [
  '# Open-source repo audit report',
  '',
  `Generated: ${new Date().toISOString()}`,
  `Total issues: ${errors.length} across ${byRepo.size} repos`,
  '',
];
if (!byRepo.size) {
  reportLines.push('No issues found.');
} else {
  for (const [repo, issues] of [...byRepo.entries()].sort()) {
    reportLines.push(`## ${repo}`);
    reportLines.push('');
    for (const e of issues) reportLines.push(`- ${e.issue}`);
    reportLines.push('');
  }
}
writeFileSync(join(OUT_DIR, 'repo-audit-report.md'), reportLines.join('\n'), 'utf-8');

console.error('');
console.error(`  ✅ ${mcpEntries.length} MCP entries → scripts/sync-gallery/_generated/new-mcp-entries.yaml`);
console.error(`  ✅ ${skillEntries.length} skill entries → scripts/sync-gallery/_generated/new-skill-entries.yaml`);
console.error(`  📋 ${errors.length} repo issues → scripts/sync-gallery/_generated/repo-audit-report.md`);
console.error('\n═══════════════════════════════════════════════════');
console.error(' Done — review drafts, then append to data/*.yaml');
console.error('═══════════════════════════════════════════════════');
