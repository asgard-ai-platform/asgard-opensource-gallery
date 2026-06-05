#!/usr/bin/env node
/**
 * sync-pack-content.mjs
 * For each installable pack (data/plugins.yaml entries with kind: pack), fetches
 * the pack repo's manifests (.claude-plugin/plugin.json, marketplace.json,
 * .env.example, docs/USE-CASES.md, README.md) and extracts a structured entry
 * into data/pack-content.json (committed sidecar, read at deploy with no network).
 *
 * Runs at SYNC time, not deploy time. Degrades gracefully per repo:
 * a fetch failure keeps the last-good entry rather than aborting the sync.
 *
 * Usage: node scripts/sync-gallery/sync-pack-content.mjs
 */
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { ghFetchFile } from './_lib.mjs';

const ROOT = resolve(new URL('.', import.meta.url).pathname, '../..');
const DATA_DIR = join(ROOT, 'data');
const PLUGINS_YAML = join(DATA_DIR, 'plugins.yaml');
const OUTPUT_JSON = join(DATA_DIR, 'pack-content.json');

// ── Pure parsers ─────────────────────────────────────────────────

/** Parse `{owner, repo}` from a github URL; null if it isn't one. */
export function parseRepo(githubUrl) {
  const m = (githubUrl || '').match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
}

/** Extract the fields we keep from `.claude-plugin/plugin.json`. */
export function parsePluginManifest(json) {
  if (!json) return null;
  const mcpServers =
    json.mcpServers && typeof json.mcpServers === 'object'
      ? Object.entries(json.mcpServers).map(([name, cfg]) => ({
          name,
          env_keys: Object.keys((cfg && cfg.env) || {}),
        }))
      : [];
  return {
    name: json.name,
    version: json.version,
    license: json.license,
    homepage: json.homepage,
    repository: typeof json.repository === 'string' ? json.repository : json.repository?.url,
    author: json.author,
    keywords: Array.isArray(json.keywords) ? json.keywords : [],
    skills_dir: typeof json.skills === 'string' ? json.skills : undefined,
    mcp_servers: mcpServers,
  };
}

/** Extract `{name, source}` from `marketplace.json` (first plugin entry). */
export function parseMarketplace(json) {
  if (!json) return null;
  const plugin = Array.isArray(json.plugins) ? json.plugins[0] : null;
  return { name: json.name, source: (plugin && plugin.source) || './' };
}

/** Build the `source` provenance block from the plugin manifest + marketplace. */
export function buildSourceBlock(plugin, marketplace, repo) {
  const base = `https://github.com/${repo.owner}/${repo.repo}/blob/HEAD`;
  const block = {
    version: plugin?.version,
    license: plugin?.license,
    repository: plugin?.repository || `https://github.com/${repo.owner}/${repo.repo}`,
    homepage: plugin?.homepage,
    keywords: plugin?.keywords || [],
    manifest_urls: [
      `${base}/.claude-plugin/plugin.json`,
      `${base}/.claude-plugin/marketplace.json`,
    ],
  };
  if (marketplace) block.marketplace = { name: marketplace.name, source: marketplace.source };
  return block;
}
