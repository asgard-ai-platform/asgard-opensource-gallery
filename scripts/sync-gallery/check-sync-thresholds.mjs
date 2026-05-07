#!/usr/bin/env node
/**
 * check-sync-thresholds.mjs
 *
 * Run after sync-mcp-content.mjs + sync-skill-content.mjs. Fails the job if
 * the resulting JSON outputs cover less than 80 percent of the YAML entries
 * that should have been synced. Catches silent gh-api failures (token
 * expiry mid-run) before a content-deleting PR is created.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';

const ROOT = resolve(new URL('.', import.meta.url).pathname, '../..');
const FLOOR = 0.8;

export function evaluateThresholds({ expectedMcps, actualMcpKeys, expectedSkills, actualSkillKeys, floor }) {
  const failures = [];
  const mcpExpected = expectedMcps.length;
  const mcpActual = expectedMcps.filter(s => actualMcpKeys.includes(s)).length;
  if (mcpExpected > 0 && mcpActual / mcpExpected < floor) {
    failures.push(`mcp-content.json: ${mcpActual} of ${mcpExpected} expected entries (< ${Math.round(floor * 100)}%)`);
  }
  const skillExpected = expectedSkills.length;
  const skillActual = expectedSkills.filter(s => actualSkillKeys.includes(`skill-${s}`)).length;
  if (skillExpected > 0 && skillActual / skillExpected < floor) {
    failures.push(`skill-content.json: ${skillActual} of ${skillExpected} expected entries (< ${Math.round(floor * 100)}%)`);
  }
  return { ok: failures.length === 0, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = join(ROOT, 'data');
  const mcps = yaml.load(readFileSync(join(dataDir, 'mcp-servers.yaml'), 'utf-8'));
  const skills = yaml.load(readFileSync(join(dataDir, 'skills.yaml'), 'utf-8'));
  const mcpContent = JSON.parse(readFileSync(join(dataDir, 'mcp-content.json'), 'utf-8'));
  const skillContent = JSON.parse(readFileSync(join(dataDir, 'skill-content.json'), 'utf-8'));

  const expectedMcps = mcps.servers.filter(s => s.status === 'released').map(s => s.slug);
  const expectedSkills = skills.skills.map(s => s.slug.replace(/^skill-/, ''));

  const result = evaluateThresholds({
    expectedMcps,
    actualMcpKeys: Object.keys(mcpContent),
    expectedSkills,
    actualSkillKeys: Object.keys(skillContent),
    floor: FLOOR,
  });

  if (!result.ok) {
    console.error('Sync threshold check FAILED:');
    for (const f of result.failures) console.error(`  - ${f}`);
    console.error('\nLikely cause: gh api silently failing mid-run (token expired or rate-limited).');
    process.exit(1);
  }
  console.log(`Sync threshold check OK: ${expectedMcps.length} MCPs, ${expectedSkills.length} skills.`);
}
