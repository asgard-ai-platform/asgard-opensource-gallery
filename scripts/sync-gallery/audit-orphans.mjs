#!/usr/bin/env node
/**
 * audit-orphans.mjs
 *
 * Detect YAML entries pointing at upstream that no longer exists. Findings
 * are appended to scripts/sync-gallery/_generated/repo-audit-report.md
 * under "asgard-opensource-gallery" (for missing MCP repos) or "skills"
 * (for missing skill directories), since the YAML is the side that needs
 * fixing.
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { ghJSON } from './_lib.mjs';

const ORG = 'asgard-ai-platform';
const ROOT = resolve(new URL('.', import.meta.url).pathname, '../..');
const REPORT_PATH = join(ROOT, 'scripts/sync-gallery/_generated/repo-audit-report.md');

export async function findOrphans({ mcps, skills, repoExists, skillDirExists }) {
  const galleryGroup = [];
  const skillGroup = [];

  for (const m of mcps) {
    if (m.status !== 'released') continue;
    if (!(await repoExists(m.slug))) {
      galleryGroup.push(`Orphan YAML entry: \`${m.slug}\` is marked released but the upstream repo no longer exists or is private`);
    }
  }

  for (const s of skills) {
    const dir = s.slug.replace(/^skill-/, '');
    if (!(await skillDirExists(dir))) {
      skillGroup.push(`Orphan YAML entry: skill \`${s.slug}\` references directory \`${dir}\` which is no longer in the skills repo`);
    }
  }

  return { 'asgard-opensource-gallery': galleryGroup, skills: skillGroup };
}

export function appendGroup(reportPath, groupName, lines) {
  if (lines.length === 0) return;
  const existing = existsSync(reportPath) ? readFileSync(reportPath, 'utf-8') : '';
  const groupHeader = `## ${groupName}`;
  if (existing.includes(`\n${groupHeader}\n`) || existing.startsWith(`${groupHeader}\n`)) {
    const updated = existing.replace(
      new RegExp(`(${groupHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n\\n[\\s\\S]*?)(?=\\n##\\s+|$)`),
      (block) => block.trimEnd() + '\n' + lines.map(l => `- ${l}`).join('\n') + '\n',
    );
    writeFileSync(reportPath, updated, 'utf-8');
  } else {
    const block = `\n${groupHeader}\n\n${lines.map(l => `- ${l}`).join('\n')}\n`;
    appendFileSync(reportPath, block, 'utf-8');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = join(ROOT, 'data');
  const mcps = yaml.load(readFileSync(join(dataDir, 'mcp-servers.yaml'), 'utf-8')).servers;
  const skills = yaml.load(readFileSync(join(dataDir, 'skills.yaml'), 'utf-8')).skills;

  const skillDirs = new Set(
    ghJSON(`repos/${ORG}/skills/git/trees/main`, '[.tree[] | select(.type == "tree") | .path]') || [],
  );

  const findings = await findOrphans({
    mcps,
    skills,
    repoExists: async (slug) => {
      const r = ghJSON(`repos/${ORG}/${slug}`);
      return r !== null && r.private === false;
    },
    skillDirExists: async (dir) => skillDirs.has(dir),
  });

  appendGroup(REPORT_PATH, 'asgard-opensource-gallery', findings['asgard-opensource-gallery']);
  appendGroup(REPORT_PATH, 'skills', findings.skills);

  const total = findings['asgard-opensource-gallery'].length + findings.skills.length;
  console.log(`audit-orphans: ${total} finding(s) appended to ${REPORT_PATH}`);
}
