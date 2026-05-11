#!/usr/bin/env node
/**
 * check-sync-thresholds.mjs
 *
 * Run after sync-mcp-content.mjs + sync-skill-content.mjs. Fails the job if
 * the resulting JSON outputs cover less than 80 percent of the YAML entries
 * that should have been synced. Catches silent gh-api failures (token
 * expiry mid-run) before a content-deleting PR is created.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';

const ROOT = resolve(new URL('.', import.meta.url).pathname, '../..');
export const FLOOR = 0.8;

/**
 * Compare expected vs actual identifier sets and return a failure list when
 * any side falls below FLOOR coverage. Pure function — no IO.
 *
 * Both sides should use the same identifier shape (e.g. both pass full slugs
 * including any `skill-` prefix). The CLI block below normalises the YAML
 * side before calling.
 */
export function evaluateThresholds({ expectedMcps, actualMcpKeys, expectedSkills, actualSkillKeys }) {
  const failures = [];
  const mcpSet = new Set(actualMcpKeys);
  const skillSet = new Set(actualSkillKeys);

  const mcpExpected = expectedMcps.length;
  const mcpActual = expectedMcps.filter(s => mcpSet.has(s)).length;
  if (mcpExpected > 0 && mcpActual / mcpExpected < FLOOR) {
    failures.push(`mcp-content.json: ${mcpActual} of ${mcpExpected} expected entries (< ${Math.round(FLOOR * 100)}%)`);
  }

  const skillExpected = expectedSkills.length;
  const skillActual = expectedSkills.filter(s => skillSet.has(s)).length;
  if (skillExpected > 0 && skillActual / skillExpected < FLOOR) {
    failures.push(`skill-content.json: ${skillActual} of ${skillExpected} expected entries (< ${Math.round(FLOOR * 100)}%)`);
  }

  return { ok: failures.length === 0, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const dataDir = join(ROOT, 'data');
  const mcps = yaml.load(readFileSync(join(dataDir, 'mcp-servers.yaml'), 'utf-8'));
  const skills = yaml.load(readFileSync(join(dataDir, 'skills.yaml'), 'utf-8'));
  const mcpContent = JSON.parse(readFileSync(join(dataDir, 'mcp-content.json'), 'utf-8'));
  const skillContent = JSON.parse(readFileSync(join(dataDir, 'skill-content.json'), 'utf-8'));

  const expectedMcps = mcps.servers.filter(s => s.status === 'released').map(s => s.slug);
  const expectedSkills = skills.skills.map(s => s.slug); // full slug, e.g. `skill-foo`

  const result = evaluateThresholds({
    expectedMcps,
    actualMcpKeys: Object.keys(mcpContent),
    expectedSkills,
    actualSkillKeys: Object.keys(skillContent),
  });

  if (!result.ok) {
    console.error('Sync threshold check FAILED:');
    for (const f of result.failures) console.error(`  - ${f}`);
    console.error('\nLikely cause: gh api silently failing mid-run (token expired or rate-limited).');
    process.exit(1);
  }
  console.log(`Sync threshold check OK: ${expectedMcps.length} MCPs, ${expectedSkills.length} skills.`);
}
