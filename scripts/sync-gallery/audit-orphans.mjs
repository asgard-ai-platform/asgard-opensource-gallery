#!/usr/bin/env node
/**
 * audit-orphans.mjs
 *
 * Detect YAML entries pointing at upstream that no longer exists. Findings
 * are appended to scripts/sync-gallery/_generated/repo-audit-report.md
 * under "asgard-opensource-gallery" (for missing MCP repos) or "skills"
 * (for missing skill directories), since the YAML is the side that needs
 * fixing.
 *
 * IMPORTANT (P1 fix from review): only HTTP 404 is treated as orphan.
 * Any other gh-api failure (5xx / network / token scope) is logged and
 * the repo is skipped — otherwise a brief GitHub outage would generate
 * orphan findings for every released MCP. If more than ERROR_RATIO_LIMIT
 * of MCP lookups error out, the script aborts to avoid mass false
 * positives. The skills-tree fetch follows the same rule: if the tree
 * fetch fails, skip the skill orphan check entirely (don't flag every
 * skill).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { ghJSON, ghRepoLookup, appendGroup } from './_lib.mjs';

const ORG = 'asgard-ai-platform';
const ROOT = resolve(new URL('.', import.meta.url).pathname, '../..');
const REPORT_PATH = join(ROOT, 'scripts/sync-gallery/_generated/repo-audit-report.md');

const ERROR_RATIO_LIMIT = 0.2;

/**
 * @param {object} params
 * @param {Array} params.mcps - parsed mcp-servers.yaml `servers` list
 * @param {Array} params.skills - parsed skills.yaml `skills` list
 * @param {(slug: string) => Promise<{status:'exists'|'missing'|'error', repo?:object, message?:string}>} params.repoLookup
 * @param {Set<string> | null} params.skillDirs - Set of dir names from the skills repo, or null when fetch failed
 */
export async function findOrphans({ mcps, skills, repoLookup, skillDirs }) {
  const galleryGroup = [];
  const skillGroup = [];
  const transientErrors = [];

  let releasedChecked = 0;
  for (const m of mcps) {
    if (m.status !== 'released') continue;
    releasedChecked++;
    const r = await repoLookup(m.slug);
    if (r.status === 'error') {
      transientErrors.push({ slug: m.slug, message: r.message || '' });
      continue;
    }
    const isMissing =
      r.status === 'missing' ||
      (r.status === 'exists' && r.repo && r.repo.private === true);
    if (isMissing) {
      galleryGroup.push(
        `Orphan YAML entry: \`${m.slug}\` is marked released but the upstream repo no longer exists or is private`,
      );
    }
  }

  if (
    releasedChecked > 0 &&
    transientErrors.length / releasedChecked > ERROR_RATIO_LIMIT
  ) {
    const sample = transientErrors
      .slice(0, 3)
      .map(e => `${e.slug}: ${(e.message || '').split('\n')[0]}`)
      .join('; ');
    throw new Error(
      `audit-orphans: ${transientErrors.length}/${releasedChecked} mcp lookups errored — aborting to avoid mass false-positive orphan reports. Sample: ${sample}`,
    );
  }
  for (const e of transientErrors) {
    console.error(
      `audit-orphans: skipping ${e.slug} (transient gh api error: ${(e.message || '').split('\n')[0]})`,
    );
  }

  // Skills are checked regardless of YAML status (skills.yaml dir <-> repo
  // dir is 1:1, even for coming-soon / planned). If the tree fetch failed
  // upstream, skillDirs is null — skip the loop rather than flag every
  // skill as an orphan.
  if (skillDirs === null) {
    console.error(
      'audit-orphans: skill-tree fetch failed; skipping skill orphan check',
    );
  } else {
    for (const s of skills) {
      const dir = s.slug.replace(/^skill-/, '');
      if (!skillDirs.has(dir)) {
        skillGroup.push(
          `Orphan YAML entry: skill \`${s.slug}\` references directory \`${dir}\` which is no longer in the skills repo`,
        );
      }
    }
  }

  return { 'asgard-opensource-gallery': galleryGroup, skills: skillGroup };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = join(ROOT, 'data');
  const mcps = yaml.load(readFileSync(join(dataDir, 'mcp-servers.yaml'), 'utf-8')).servers;
  const skills = yaml.load(readFileSync(join(dataDir, 'skills.yaml'), 'utf-8')).skills;

  const tree = ghJSON(
    `repos/${ORG}/skills/git/trees/main`,
    '[.tree[] | select(.type == "tree") | .path]',
  );
  const skillDirs = tree === null ? null : new Set(tree);

  const findings = await findOrphans({
    mcps,
    skills,
    repoLookup: async (slug) => ghRepoLookup(ORG, slug),
    skillDirs,
  });

  appendGroup(REPORT_PATH, 'asgard-opensource-gallery', findings['asgard-opensource-gallery']);
  appendGroup(REPORT_PATH, 'skills', findings.skills);

  const total = findings['asgard-opensource-gallery'].length + findings.skills.length;
  console.log(`audit-orphans: ${total} finding(s) appended to ${REPORT_PATH}`);
}
