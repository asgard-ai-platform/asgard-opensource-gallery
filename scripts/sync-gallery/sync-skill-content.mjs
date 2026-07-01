#!/usr/bin/env node
/**
 * sync-skill-content.mjs
 * Fetches SKILL.md from each skill directory via GitHub API
 * and extracts structured sections into data/skill-content.json.
 *
 * Also surgically updates data/skills.yaml description.en fields with richer
 * descriptions from SKILL.md frontmatter (preserving YAML formatting).
 *
 * Usage: node scripts/sync-gallery/sync-skill-content.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';

const ORG = 'asgard-ai-platform';
const REPO = 'skills';
const ROOT = resolve(new URL('.', import.meta.url).pathname, '../..');
const DATA_DIR = join(ROOT, 'data');
const SKILLS_YAML = join(DATA_DIR, 'skills.yaml');
const OUTPUT_JSON = join(DATA_DIR, 'skill-content.json');

// ── Helpers ──────────────────────────────────────────────────────

function ghFetchFile(path) {
  try {
    const result = execFileSync(
      'gh',
      ['api', `repos/${ORG}/${REPO}/contents/${path}`, '--jq', '.content'],
      { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    return Buffer.from(result, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

function ghListDirs() {
  const result = execFileSync(
    'gh',
    [
      'api',
      `repos/${ORG}/${REPO}/git/trees/main`,
      '--jq',
      '[.tree[] | select(.type == "tree") | .path | select(test("^[a-z]"))]',
    ],
    { encoding: 'utf-8', timeout: 15000 }
  );
  return JSON.parse(result).filter(d => !['eval', 'tools'].includes(d)).sort();
}

function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return { meta: {}, body: '' };
  try {
    const meta = yaml.load(match[1]);
    const body = content.slice(match[0].length).trim();
    return { meta, body };
  } catch {
    return { meta: {}, body: content };
  }
}

function extractSections(body) {
  const sections = [];
  const lines = body.split('\n');
  let currentTitle = null;
  let currentLines = [];

  const flush = () => {
    if (currentTitle) {
      sections.push({ title: currentTitle, body: currentLines.join('\n').trim() });
    }
  };

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      flush();
      currentTitle = h2Match[1].trim();
      currentLines = [];
    } else if (currentTitle) {
      currentLines.push(line);
    }
  }
  flush();
  return sections;
}

function sectionKey(title) {
  const t = title.toLowerCase();
  if (t.includes('overview')) return 'overview';
  if (t === 'when to use') return 'when_to_use';
  if (t === 'when not to use') return 'when_not_to_use';
  if (/^(framework|algorithm|methodology|method)$/.test(t)) return 'framework';
  if (t.includes('output format') || t === 'output') return 'output_format';
  if (t.includes('gotcha') || t.includes('caveats') || t.includes('pitfalls')) return 'gotchas';
  if (t.includes('example')) return 'examples';
  if (t.includes('reference')) return 'references';
  if (t.includes('assumption')) return 'assumptions';
  return t.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/**
 * Surgically update description.en values in YAML text.
 */
function updateYamlDescriptions(yamlText, updates) {
  const lines = yamlText.split('\n');
  const result = [];
  let i = 0;
  let updated = 0;

  while (i < lines.length) {
    const slugMatch = lines[i].match(/^(\s+(?:-\s+)?)slug:\s*(.+)$/);
    if (slugMatch) {
      const slug = slugMatch[2].trim();
      const update = updates.get(slug);
      result.push(lines[i]);
      i++;

      if (update) {
        let foundDesc = false;
        while (i < lines.length) {
          if (/^\s+-\s+slug:/.test(lines[i]) || /^(?:  )?#/.test(lines[i]) && !foundDesc) {
            break;
          }
          if (/^\s+description:\s*$/.test(lines[i])) {
            foundDesc = true;
            result.push(lines[i]);
            i++;
            if (i < lines.length) {
              const enMatch = lines[i].match(/^(\s+)en:\s*/);
              if (enMatch) {
                const indent = enMatch[1];
                const escaped = update.newDescEn.replace(/"/g, '\\"');
                result.push(`${indent}en: "${escaped}"`);
                i++;
                updated++;
                continue;
              }
            }
            continue;
          }
          result.push(lines[i]);
          i++;
        }
      }
      continue;
    }
    result.push(lines[i]);
    i++;
  }

  console.log(`     ${updated} description.en fields updated`);
  return result.join('\n');
}

/**
 * Build the skill-content map + queued description updates. Pure/testable — the
 * directory list, fetcher and previous on-disk content are injected.
 *
 * A skill dir whose SKILL.md fetch returns null carries over its last-good
 * content from `prevContent` rather than being dropped, so a transient gh-api
 * failure cannot auto-commit the deletion of a skill's detail-page content.
 * Order-preserving so packs whose canonical sections are not first (e.g. the
 * EMBA packs lead with 定位/何時使用) render in document order.
 */
export function buildSkillContent({ dirs, fetchFn, yamlSkills = new Map(), prevContent = {} }) {
  const content = {};
  const descriptionUpdates = new Map();
  const stats = { processed: 0, carried: 0, skipped: 0 };

  for (const dir of dirs) {
    const slug = `skill-${dir}`;
    const raw = fetchFn(dir);
    if (!raw) {
      if (prevContent[slug]) { content[slug] = prevContent[slug]; stats.carried++; }
      else { stats.skipped++; }
      continue;
    }

    const { meta, body } = parseFrontmatter(raw);
    const sections = extractSections(body);
    content[slug] = {
      sections: sections.map((s) => ({ key: sectionKey(s.title), title: s.title, body: s.body })),
    };

    const yamlEntry = yamlSkills.get(dir);
    if (yamlEntry && meta.description) {
      const currentDesc = yamlEntry.description?.en || '';
      if (meta.description.length > currentDesc.length + 20) {
        descriptionUpdates.set(slug, { newDescEn: meta.description });
      }
    }

    stats.processed++;
  }

  return { content, descriptionUpdates, stats };
}

// ── Main ─────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  console.log('═══════════════════════════════════════════════════');
  console.log(' Sync Skill Content → data/skill-content.json');
  console.log('═══════════════════════════════════════════════════\n');

  console.log('[1/3] Listing skill directories from GitHub API ...');
  const dirs = ghListDirs();
  console.log(`  Found ${dirs.length} skill directories\n`);

  console.log('[2/3] Loading skills.yaml ...');
  const yamlText = readFileSync(SKILLS_YAML, 'utf-8');
  const yamlData = yaml.load(yamlText);
  const yamlSkills = new Map();
  for (const s of yamlData.skills) {
    yamlSkills.set(s.slug.replace(/^skill-/, ''), s);
  }

  // Last-good content so a transient fetch failure carries over rather than
  // deleting an entry (see buildSkillContent). A corrupt file must not crash
  // the sync — fall back to empty.
  let prevContent = {};
  if (existsSync(OUTPUT_JSON)) {
    try {
      prevContent = JSON.parse(readFileSync(OUTPUT_JSON, 'utf-8'));
    } catch {
      console.warn(`  ⚠ existing ${OUTPUT_JSON} is unparseable; starting from empty`);
    }
  }

  console.log('[3/3] Fetching SKILL.md files ...');
  const { content: skillContent, descriptionUpdates, stats } = buildSkillContent({
    dirs,
    fetchFn: (dir) => ghFetchFile(`${dir}/SKILL.md`),
    yamlSkills,
    prevContent,
  });

  console.log(`\nWriting outputs ...`);
  writeFileSync(OUTPUT_JSON, JSON.stringify(skillContent, null, 2), 'utf-8');
  console.log(`  ✅ skill-content.json — ${stats.processed} processed, ${stats.carried} carried over, ${stats.skipped} skipped`);

  if (descriptionUpdates.size > 0) {
    const updatedYaml = updateYamlDescriptions(yamlText, descriptionUpdates);
    writeFileSync(SKILLS_YAML, updatedYaml, 'utf-8');
    console.log(`  ✅ skills.yaml — descriptions enriched (format preserved)`);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(' Done');
  console.log('═══════════════════════════════════════════════════');
}
