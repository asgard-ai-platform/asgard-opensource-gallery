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

/** Map a harness heading label to a stable slug for the install tab. */
export function harnessSlug(label) {
  const map = {
    'claude code': 'claude-code',
    'codex cli / app': 'codex',
    cursor: 'cursor',
    'antigravity cli (agy)': 'antigravity',
    opencode: 'opencode',
    'factory droid': 'factory-droid',
  };
  const key = label.trim().toLowerCase();
  if (map[key]) return map[key];
  return key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function finalizeInstall(cur) {
  const notes = cur.notes.join(' ').trim();
  const entry = {
    harness: harnessSlug(cur.label),
    label: cur.label,
    command: cur.code.join('\n').trim(),
    source: 'README.md#安裝',
  };
  if (notes) entry.notes = notes;
  return entry;
}

/**
 * Parse the README "## 安裝" (or "## Install") section into one install tab per
 * "### <harness>" subsection. The tab's `command` is the content of that
 * subsection's FIRST fenced code block; any other prose (including `>` notes)
 * becomes `notes`. Returns [] when there is no install section.
 */
export function parseInstallSection(readme) {
  if (!readme) return [];
  const lines = readme.split('\n');
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (start < 0 && /^##\s+(安裝|Install)(?:\s|$)/.test(lines[i])) {
      start = i + 1;
      continue;
    }
    if (start >= 0 && /^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (start < 0) return [];

  const entries = [];
  let cur = null;
  let inCode = false;
  let codeDone = false;
  for (const line of lines.slice(start, end)) {
    if (/^###\s+/.test(line) && !inCode) {
      if (cur) entries.push(finalizeInstall(cur));
      cur = { label: line.replace(/^###\s+/, '').trim(), code: [], notes: [] };
      codeDone = false;
      continue;
    }
    if (!cur) continue;
    if (/^\s*```/.test(line)) {
      if (!inCode) inCode = true;
      else {
        inCode = false;
        codeDone = true; // only the first fenced block is the command
      }
      continue;
    }
    if (inCode) {
      if (!codeDone) cur.code.push(line);
      continue;
    }
    const txt = line.replace(/^>\s?/, '').trim();
    if (txt) cur.notes.push(txt);
  }
  if (cur) entries.push(finalizeInstall(cur));
  return entries;
}

/** Parse one `KEY=value   # comment` line into an env var record. */
function parseVarLine(name, rest) {
  const hash = rest.indexOf('#');
  const rawVal = (hash >= 0 ? rest.slice(0, hash) : rest).trim();
  const comment = hash >= 0 ? rest.slice(hash + 1).trim() : '';
  const v = { name, source: '.env.example' };
  if (rawVal) v.default = rawVal;
  if (comment) v.description = comment;
  if (!rawVal) v.required_when = 'always'; // no shipped default ⇒ user must fill it
  return v;
}

/** Turn a block of `# ...` header comment lines into a group skeleton, or null
 *  if the block is not a provider group (it must carry a `#   MCP:`/`MCPs:` line). */
function headerToGroup(headerLines) {
  const stripped = headerLines.map((l) => l.replace(/^#\s?/, '').trimEnd());
  const mcpLine = stripped.find((l) => /^MCPs?:/.test(l.trim()));
  if (!mcpLine) return null;
  const serviceLine = stripped.find((l) => l.includes('—'));
  const service = serviceLine ? serviceLine.split('—')[0].trim() : stripped[0].trim();
  const mcpsRaw = mcpLine.trim().replace(/^MCPs?:/, '').trim();
  const isPrivate = /PRIVATE/i.test(mcpsRaw);
  const mcpSlugs = mcpsRaw
    .replace(/\(.*?\)/g, '') // drop "(PRIVATE …)" note before splitting
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const group = { service, vars: [] };
  if (mcpSlugs.length === 1) group.mcp_slug = mcpSlugs[0];
  if (isPrivate) group.private = true;
  return group;
}

/**
 * Parse a pack `.env.example` into provider-grouped credentials. Groups are
 * delimited by `# ----` divider lines wrapping a comment header; the header's
 * `#   MCP(s):` line is the signal that a block is a real provider group (so the
 * file's top `# ====` banner is ignored). `default_mode` is taken from any
 * `*_ENV` var that ships a default.
 */
export function parseEnvExample(text) {
  if (!text) return [];
  const lines = text.split('\n');
  const groups = [];
  let header = [];
  let current = null;
  const isDivider = (l) => /^#\s*-{5,}\s*$/.test(l);
  for (const line of lines) {
    if (isDivider(line)) {
      if (header.length) {
        const g = headerToGroup(header);
        if (g) {
          groups.push(g);
          current = g;
        } else {
          current = null;
        }
        header = [];
      }
      continue;
    }
    if (/^\s*#/.test(line)) {
      header.push(line);
      continue;
    }
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && current) current.vars.push(parseVarLine(m[1], m[2]));
  }
  for (const g of groups) {
    const envVar = g.vars.find((v) => /_ENV$/.test(v.name) && v.default);
    if (envVar) g.default_mode = envVar.default;
  }
  return groups;
}

/** Classify the pack's setup burden into the 3 spec states (none/sandbox-ready/keys-required). */
export function classifySetupStatus(envGroups, mcpCount) {
  const vars = envGroups.flatMap((g) => g.vars);
  if (vars.length === 0) return 'none';
  const hasSandbox =
    envGroups.some((g) => g.default_mode) ||
    vars.some((v) => v.default && /^(stage|test|sandbox|dev|development|false)$/i.test(v.default));
  return hasSandbox ? 'sandbox-ready' : 'keys-required';
}

/** Build the `setup` block: status + a machine-generated summary + the groups. */
export function buildSetup(envGroups, mcpCount) {
  const status = classifySetupStatus(envGroups, mcpCount);
  const summary =
    status === 'none'
      ? 'No credentials required — install and use.'
      : status === 'sandbox-ready'
        ? `${mcpCount} MCP servers; sandbox/test defaults work out of the box — add provider keys only for the services you actually use.`
        : `${mcpCount} MCP servers; each needs real provider credentials before use.`;
  return { status, summary, env_groups: envGroups };
}

/** Pull the bare tokens out of every `backtick` span on a line. */
function backtickTokens(line) {
  return (line.match(/`([^`]+)`/g) || []).map((s) => s.replace(/`/g, ''));
}

/**
 * Parse `docs/USE-CASES.md` into scenarios. Each `### N.M <title>` heading is one
 * use case; its body carries `**情境：**`, a `**Prompt 範例：**` fenced block,
 * `**會用到的 skills：**` / `**會用到的 MCPs：**` backtick lists, and `**注意：**`.
 * skills/mcp_servers are kept as the pack-local names exactly as written.
 */
export function parseUseCases(md) {
  if (!md) return [];
  const lines = md.split('\n');
  const cases = [];
  let cur = null;
  let inFence = false;
  let promptLines = null; // non-null while collecting the prompt fence body

  const pushCur = () => {
    if (cur) cases.push(cur);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h3 = line.match(/^###\s+\d+\.\d+\s+(.+)$/);
    if (h3 && !inFence) {
      pushCur();
      cur = { title: h3[1].trim(), skills: [], mcp_servers: [] };
      promptLines = null;
      continue;
    }
    if (!cur) continue;

    if (/^\s*```/.test(line)) {
      if (!inFence && promptLines) {
        inFence = true; // opening the prompt fence
      } else if (inFence) {
        inFence = false;
        cur.prompt = promptLines.join('\n').trim();
        promptLines = null;
      }
      continue;
    }
    if (inFence) {
      promptLines.push(line);
      continue;
    }

    const field = line.match(/^\*\*(.+?)[:：]\*\*\s*(.*)$/);
    if (field) {
      const label = field[1].trim();
      const value = field[2].trim();
      if (/情境/.test(label)) cur.scenario = value;
      else if (/Prompt/i.test(label)) promptLines = []; // next fence is the prompt
      else if (/skills/i.test(label)) cur.skills = backtickTokens(line);
      else if (/MCP/i.test(label)) cur.mcp_servers = backtickTokens(line);
      else if (/注意/.test(label)) cur.caveats = value;
    }
  }
  pushCur();
  return cases;
}

/**
 * Assemble one pack's `PackContent` entry from already-fetched raw sources.
 * Pure: the `main()` shell does the fetching, this does the shaping (so it is
 * unit-testable end-to-end against fixtures). `content_maturity` is intentionally
 * omitted in this slice (populated in Slice 3 — see the slice-2 plan §Scope).
 *
 * @param {object} s
 * @param {{owner:string,repo:string}} s.repo
 * @param {object|null} s.pluginManifest  parsed plugin.json
 * @param {object|null} s.marketplace     parsed marketplace.json
 * @param {string|null} s.readme          raw README.md text
 * @param {string|null} s.envExample      raw .env.example text
 * @param {string|null} s.useCases        raw docs/USE-CASES.md text
 * @param {number} s.mcpCount             mcp_servers.length from plugins.yaml
 */
export function assemblePackContent(s) {
  const envGroups = parseEnvExample(s.envExample);
  return {
    install: parseInstallSection(s.readme),
    setup: buildSetup(envGroups, s.mcpCount),
    use_cases: parseUseCases(s.useCases),
    source: buildSourceBlock(s.pluginManifest, s.marketplace, s.repo),
  };
}

// ── I/O shell ────────────────────────────────────────────────────

/** Normalize CRLF → LF so the line-based parsers work on Windows-committed files. */
const normalizeText = (s) => (s == null ? s : s.replace(/\r\n?/g, '\n'));

/** Fetch + JSON-parse a file from a repo; null on any fetch/parse failure. */
function ghJSONFile(repo, filePath) {
  const raw = ghFetchFile(repo.owner, repo.repo, filePath);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  console.log('═══════════════════════════════════════════════════');
  console.log(' Sync Pack Content → data/pack-content.json');
  console.log('═══════════════════════════════════════════════════\n');

  const pluginsYaml = yaml.load(readFileSync(PLUGINS_YAML, 'utf-8'));
  const packs = (pluginsYaml.plugins || []).filter((p) => p.kind === 'pack');
  console.log(`[1/2] ${packs.length} pack(s) marked kind: pack in plugins.yaml\n`);

  // Prior committed entries, consulted per-pack for keep-last-good on a fetch
  // failure. `out` is rebuilt fresh (only currently-declared packs) so a pack
  // removed from plugins.yaml does not leave an orphaned entry behind.
  const prior = existsSync(OUTPUT_JSON) ? JSON.parse(readFileSync(OUTPUT_JSON, 'utf-8')) : {};
  const out = {};
  let extracted = 0;
  let kept = 0;
  let skipped = 0;

  for (const pack of packs) {
    process.stdout.write(`  ${pack.slug} ... `);
    const repo = parseRepo(pack.github);
    if (!repo) {
      console.log('⏭  no github URL');
      skipped++;
      continue;
    }
    const pluginRaw = ghJSONFile(repo, '.claude-plugin/plugin.json');
    if (!pluginRaw) {
      if (prior[pack.slug]) {
        out[pack.slug] = prior[pack.slug];
        console.log('⚠  plugin.json unreachable — keeping last-good entry');
        kept++;
      } else {
        console.log('⚠  plugin.json unreachable — skipped (no prior entry)');
        skipped++;
      }
      continue;
    }
    const marketplaceRaw =
      ghJSONFile(repo, '.claude-plugin/marketplace.json') || ghJSONFile(repo, 'marketplace.json');
    const readme = normalizeText(ghFetchFile(repo.owner, repo.repo, 'README.md'));
    const envExample = normalizeText(ghFetchFile(repo.owner, repo.repo, '.env.example'));
    const useCases = normalizeText(ghFetchFile(repo.owner, repo.repo, 'docs/USE-CASES.md'));

    out[pack.slug] = assemblePackContent({
      repo,
      pluginManifest: parsePluginManifest(pluginRaw),
      marketplace: parseMarketplace(marketplaceRaw),
      readme,
      envExample,
      useCases,
      mcpCount: Array.isArray(pack.mcp_servers) ? pack.mcp_servers.length : 0,
    });
    const c = out[pack.slug];
    console.log(
      `✅ ${c.install.length} install tab(s), setup=${c.setup.status}, ${c.use_cases.length} use case(s)`,
    );
    extracted++;
  }

  // Total wipeout guard: fail BEFORE writing so a transient total outage cannot
  // overwrite a good committed file with {} (mirrors check-sync-thresholds' intent).
  if (packs.length > 0 && Object.keys(out).length === 0) {
    console.error('::error::pack-content.json is empty despite packs being declared');
    process.exit(1);
  }

  console.log(`\n[2/2] Writing pack-content.json ...`);
  writeFileSync(OUTPUT_JSON, JSON.stringify(out, null, 2) + '\n', 'utf-8');
  console.log(`  ✅ ${extracted} extracted, ${kept} kept-last-good, ${skipped} skipped\n`);

  console.log('═══════════════════════════════════════════════════');
  console.log(' Done');
  console.log('═══════════════════════════════════════════════════');
}
