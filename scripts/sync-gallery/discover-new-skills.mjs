#!/usr/bin/env node
/**
 * discover-new-skills.mjs
 *
 * Audit-workflow companion to discover-new-mcps.mjs. Lists every
 * directory in asgard-ai-platform/skills, diffs against data/skills.yaml,
 * and writes draft YAML entries plus repo-issue findings to
 * scripts/sync-gallery/_generated/. Human review required before
 * appending to data/skills.yaml.
 *
 * Skills don't have a private/public split (all live in one repo), so
 * unlike discover-new-mcps.mjs this script doesn't auto-append.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';

const ORG = 'asgard-ai-platform';
const ROOT = resolve(new URL('.', import.meta.url).pathname, '../..');
const DATA_DIR = join(ROOT, 'data');
const OUT_DIR = join(ROOT, 'scripts/sync-gallery/_generated');
mkdirSync(OUT_DIR, { recursive: true });

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf-8', timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function ghFetchFile(repo, path) {
  try {
    const result = gh(['api', `repos/${ORG}/${repo}/contents/${path}`, '--jq', '.content']);
    return Buffer.from(result, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

function ghListSkillDirs() {
  const json = gh([
    'api',
    `repos/${ORG}/skills/git/trees/main`,
    '--jq',
    '[.tree[] | select(.type == "tree") | .path | select(test("^[a-z]"))]',
  ]);
  return JSON.parse(json)
    .filter(d => !['eval', 'tools', 'docs'].includes(d))
    .sort();
}

function ghHasSubdir(repo, parent, sub) {
  try {
    const list = JSON.parse(gh([
      'api',
      `repos/${ORG}/${repo}/contents/${parent}`,
      '--jq',
      '[.[] | select(.type == "dir") | .name]',
    ]));
    return list.includes(sub);
  } catch {
    return false;
  }
}

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

function escapeStr(s) { return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

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

console.error('═══════════════════════════════════════════════════');
console.error(' Discover New Skills — auto-discovery from GitHub');
console.error('═══════════════════════════════════════════════════\n');

const mcpYamlData = yaml.load(readFileSync(join(DATA_DIR, 'mcp-servers.yaml'), 'utf-8'));
const skillYamlData = yaml.load(readFileSync(join(DATA_DIR, 'skills.yaml'), 'utf-8'));
const existingMcpSlugs = new Set(mcpYamlData.servers.map(s => s.slug));
const existingSkillDirs = new Set(skillYamlData.skills.map(s => s.slug.replace(/^skill-/, '')));

console.error('[1/3] Discovering missing skill directories ...');
const allSkills = ghListSkillDirs();
const newSkills = allSkills.filter(d => !existingSkillDirs.has(d));
console.error(`  Skill dirs: ${allSkills.length} (${newSkills.length} new)\n`);

const errors = [];
const skillEntries = [];

console.error('[2/3] Drafting skill entries ...');
for (const dir of newSkills) {
  process.stderr.write(`  ${dir} ... `);
  const skillMd = ghFetchFile('skills', `${dir}/SKILL.md`);
  if (!skillMd) {
    console.error('⚠  no SKILL.md');
    errors.push({ repo: 'skills', issue: `\`${dir}\`: SKILL.md missing or unreachable` });
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

  if (!extractH1(body)) errors.push({ repo: 'skills', issue: `\`${dir}\`: SKILL.md has no H1 heading` });
  if (!descEn) errors.push({ repo: 'skills', issue: `\`${dir}\`: frontmatter "description" missing or empty` });
  if (!Array.isArray(mdTags) || mdTags.length === 0) errors.push({ repo: 'skills', issue: `\`${dir}\`: frontmatter metadata.tags missing — used for filter UI` });
  if (mdStatus === 'skeleton') errors.push({ repo: 'skills', issue: `\`${dir}\`: metadata.status="skeleton" — content is incomplete` });
  if (droppedMcps.length) errors.push({ repo: 'skills', issue: `\`${dir}\`: metadata.related_mcps references unknown slug(s): ${droppedMcps.join(', ')}` });

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

console.error('[3/3] Writing outputs ...');

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

writeFileSync(join(OUT_DIR, 'new-skill-entries.yaml'), skillOut, 'utf-8');

const byRepo = new Map();
for (const e of errors) {
  if (!byRepo.has(e.repo)) byRepo.set(e.repo, []);
  byRepo.get(e.repo).push(e);
}

const reportLines = [
  '# Open-source skill audit report',
  '',
  `Generated: ${new Date().toISOString()}`,
  `Total issues: ${errors.length} across ${byRepo.size} repo(s)`,
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

console.error(`  ✅ ${skillEntries.length} skill entries → scripts/sync-gallery/_generated/new-skill-entries.yaml`);
console.error(`  📋 ${errors.length} repo issues → scripts/sync-gallery/_generated/repo-audit-report.md`);
console.error('\n═══════════════════════════════════════════════════');
console.error(' Done — review drafts, then append to data/skills.yaml');
console.error('═══════════════════════════════════════════════════');
