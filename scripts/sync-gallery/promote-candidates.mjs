#!/usr/bin/env node
/**
 * promote-candidates.mjs
 *
 * Runs as the first step of the sync workflow. For each `coming-soon` MCP
 * whose slug-named package now exists on pypi.org, surgically edit
 * data/mcp-servers.yaml to flip the status to `released`.
 *
 * The downstream sync scripts (sync-mcp-content.mjs etc.) then see the
 * newly-promoted entries and fetch their READMEs in the same run, so the
 * resulting create-pull-request PR contains:
 *   - status flips in mcp-servers.yaml
 *   - first-time README content for the promoted MCPs in mcp-content.json
 *
 * The audit workflow's promotion-candidate detection (audit-pypi.mjs) is
 * intentionally kept as a redundant daily notifier on the gallery repo's
 * tracking issue.
 *
 * 5xx / network error from pypi.org is silent (no false-positive promote
 * during PyPI outages). 404 means the package is not yet published —
 * stays in coming-soon until next run.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { isOurPackage } from './_lib.mjs';

const ROOT = resolve(new URL('.', import.meta.url).pathname, '../..');
const MCP_YAML = join(ROOT, 'data/mcp-servers.yaml');

async function fetchPypi(name) {
  try {
    const r = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, {
      headers: { 'User-Agent': 'yggdrasil-sync/1.0' },
    });
    if (r.status >= 200 && r.status < 300) {
      return { status: r.status, body: await r.json() };
    }
    return { status: r.status };
  } catch {
    return { status: 0 };
  }
}

/**
 * Identify `coming-soon` entries whose slug-named package is on PyPI.
 * @param {object} params
 * @param {Array<{slug:string, status:string}>} params.mcps
 * @param {(name:string) => Promise<{status:number, body?:any}>} params.fetchPypiFn
 * @returns {Promise<Array<{slug:string, version:string}>>}
 */
export async function findPromotions({ mcps, fetchPypiFn }) {
  const promotions = [];
  for (const mcp of mcps) {
    if (mcp.status !== 'coming-soon') continue;
    const r = await fetchPypiFn(mcp.slug);
    if (r.status !== 200) continue;
    // Reject third-party packages that happen to share our slug name. Only
    // count PyPI entries whose metadata URL points back at our org/repo.
    // Without this guard we would auto-promote name-squatted packages.
    if (!isOurPackage(r.body?.info, mcp.slug)) continue;
    promotions.push({
      slug: mcp.slug,
      version: r.body?.info?.version || 'unknown',
    });
  }
  return promotions;
}

/**
 * Surgically rewrite YAML text: for each promotion, find the entry whose
 * slug matches and change its `status: coming-soon` line to
 * `status: released`. Preserves all surrounding formatting (comments,
 * indentation, blank lines) — does NOT round-trip through yaml.dump.
 *
 * If a slug is not in the YAML, that promotion is silently a no-op.
 * If an entry already has `status: released`, no change.
 */
export function applyPromotions(yamlText, promotions) {
  if (promotions.length === 0) return yamlText;
  const slugSet = new Set(promotions.map(p => p.slug));
  const lines = yamlText.split('\n');
  let inTargetEntry = false;

  for (let i = 0; i < lines.length; i++) {
    const slugMatch = lines[i].match(/^\s+(?:-\s+)?slug:\s*(\S+)/);
    if (slugMatch) {
      inTargetEntry = slugSet.has(slugMatch[1]);
      continue;
    }
    if (!inTargetEntry) continue;
    const statusMatch = lines[i].match(/^(\s+)status:\s*coming-soon\s*$/);
    if (statusMatch) {
      lines[i] = `${statusMatch[1]}status: released`;
      inTargetEntry = false; // entry handled
    }
  }
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const yamlText = readFileSync(MCP_YAML, 'utf-8');
  const data = yaml.load(yamlText);
  const promotions = await findPromotions({
    mcps: data.servers,
    fetchPypiFn: fetchPypi,
  });

  if (promotions.length === 0) {
    console.log('promote-candidates: no candidates found');
    process.exit(0);
  }

  const updated = applyPromotions(yamlText, promotions);
  writeFileSync(MCP_YAML, updated, 'utf-8');
  console.log(`promote-candidates: promoted ${promotions.length} entry(ies) from coming-soon to released:`);
  for (const p of promotions) {
    console.log(`  - ${p.slug} (PyPI ${p.version})`);
  }
}
