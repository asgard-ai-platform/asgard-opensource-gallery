/**
 * _lib.mjs — Shared helpers for sync-gallery cron scripts.
 *
 * The legacy scripts (sync-mcp-content.mjs, sync-skill-content.mjs)
 * intentionally do not import this — they predate this lib. The newer
 * cron-only scripts (audit-pypi.mjs, audit-orphans.mjs, promote-candidates.mjs,
 * discover-new-mcps.mjs, discover-new-skills.mjs) use it.
 *
 * Uses execFileSync (argv array) rather than execSync (shell string) so
 * interpolated repo / path / slug values cannot inject shell commands.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';

export function decodeBase64Content(b64) {
  return Buffer.from(b64.replace(/\s+/g, ''), 'base64').toString('utf-8');
}

/**
 * Fetch a file's decoded text content from a GitHub repo via `gh api`.
 * @returns {string|null} File body, or null on any error (404, network,
 *   rate limit, auth failure, or path resolves to a directory listing
 *   rather than a file).
 */
export function ghFetchFile(org, repo, path) {
  try {
    const b64 = execFileSync(
      'gh',
      ['api', `repos/${org}/${repo}/contents/${path}`, '--jq', '.content'],
      { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    return decodeBase64Content(b64);
  } catch {
    return null;
  }
}

/**
 * Call `gh api <apiPath>` and JSON-parse the result.
 * @param {string|null} jq Optional `--jq` filter; omit / null for raw JSON.
 * @returns {*|null} Parsed value, or null on any error (network, non-2xx,
 *   parse failure, timeout).
 */
export function ghJSON(apiPath, jq = null) {
  try {
    const args = ['api', apiPath];
    if (jq) args.push('--jq', jq);
    const result = execFileSync('gh', args, {
      encoding: 'utf-8',
      timeout: 20000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return JSON.parse(result);
  } catch {
    return null;
  }
}

/**
 * Classify a `gh api` failure (its stderr text) into one of:
 *   - `{ status: 'missing' }`           — definitive HTTP 404
 *   - `{ status: 'error', message }`    — anything else (5xx, auth, network, parse fail)
 *
 * Pure helper exposed for unit testing; the live caller is `ghRepoLookup`.
 */
export function classifyGhError(stderr) {
  if (/HTTP\s+404\b/i.test(stderr)) {
    return { status: 'missing' };
  }
  return { status: 'error', message: (stderr || '').trim() };
}

/**
 * Look up a GitHub repo via `gh api repos/<org>/<slug>`. Distinguishes a
 * definitive 404 (the repo is missing) from any other failure (transient
 * GitHub flake, token auth issue, etc.) so callers do not turn an outage
 * into mass false orphan findings.
 *
 * @returns one of:
 *   - `{ status: 'exists', repo }`     — 2xx, parsed JSON body in `repo`
 *   - `{ status: 'missing' }`          — definitive HTTP 404
 *   - `{ status: 'error', message }`   — anything else; caller decides whether to abort or skip
 */
export function ghRepoLookup(org, slug) {
  try {
    const result = execFileSync(
      'gh',
      ['api', `repos/${org}/${slug}`],
      { encoding: 'utf-8', timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    return { status: 'exists', repo: JSON.parse(result) };
  } catch (err) {
    const stderr = err && err.stderr ? err.stderr.toString() : '';
    return classifyGhError(stderr || (err && err.message) || '');
  }
}

/**
 * List every repo under an org, paginated. Each item is `{name, isPrivate}`.
 *
 * Loops `GET /orgs/<org>/repos?per_page=100&page=N` until a page returns
 * fewer than 100 items, walking the entire org without a fixed cap. A null
 * (gh failure) at any page throws — silent truncation would let real repos
 * slip past discovery in a partial-outage scenario.
 *
 * @param {object} [opts]
 * @param {(page:number) => any[]|null} [opts.fetchPageFn]
 *   Page fetcher for tests. Defaults to live `gh api`.
 * @returns {Array<{name:string, isPrivate:boolean}>}
 */
export function ghListOrgRepos(org, { fetchPageFn } = {}) {
  const fetch = fetchPageFn || ((page) => ghJSON(`orgs/${org}/repos?per_page=100&page=${page}`));
  const results = [];
  let page = 1;
  while (true) {
    const json = fetch(page);
    if (json === null) throw new Error(`ghListOrgRepos: page ${page} failed (gh api returned null)`);
    if (!Array.isArray(json)) throw new Error(`ghListOrgRepos: page ${page} returned non-array (${typeof json})`);
    if (json.length === 0) break;
    for (const r of json) results.push({ name: r.name, isPrivate: r.private });
    if (json.length < 100) break;
    page++;
  }
  return results;
}

/**
 * Tri-state visibility lookup. Returns `'private' | 'public' | 'unknown'`.
 * `'unknown'` covers any gh failure (network, auth, transient outage,
 * missing repo). Callers pick their own fail direction.
 */
export function ghRepoVisibility(org, slug, { fetchFn } = {}) {
  const fetch = fetchFn || (() => ghJSON(`repos/${org}/${slug}`, '.private'));
  const v = fetch();
  if (v === true) return 'private';
  if (v === false) return 'public';
  return 'unknown';
}

/**
 * Boolean form of ghRepoVisibility that **fails CLOSED**: unknown is
 * treated as private. Use for *gate* questions ("should this entry
 * be eligible for promotion?") where a lookup blip must not let a
 * private repo slip through.
 *
 * Callers that need fail-OPEN semantics ("audit unless definitely
 * private") should use `ghRepoVisibility` directly and branch on
 * `=== 'private'`.
 */
export function ghIsRepoPrivate(org, slug, { fetchFn } = {}) {
  return ghRepoVisibility(org, slug, { fetchFn }) !== 'public';
}

/**
 * Decide whether a PyPI metadata object (`body.info` from
 * `pypi.org/pypi/<name>/json`) describes a package owned by the Asgard
 * org. Looks at `info.home_page` and every value of `info.project_urls`
 * for any URL containing `github.com/asgard-ai-platform/<slug>`
 * (case-insensitive).
 *
 * Defends against name collision / squatting: PyPI is a global namespace
 * and anyone can register a name like `mcp-google-ads` first. Without
 * this check, a third-party package matching one of our gallery slugs
 * would be mis-detected as ours, leading to false promotion candidates
 * and incorrect auto-promotes.
 *
 * @param {object|null} info  the `body.info` object from pypi.org JSON
 * @param {string} slug       the gallery YAML slug (e.g. `mcp-shopline`)
 * @returns {boolean}
 */
export function isOurPackage(info, slug) {
  if (!info || !slug) return false;
  const urls = [];
  if (typeof info.home_page === 'string') urls.push(info.home_page);
  if (info.project_urls && typeof info.project_urls === 'object') {
    for (const v of Object.values(info.project_urls)) {
      if (typeof v === 'string') urls.push(v);
    }
  }
  const wantRepo = slug.toLowerCase();
  // Validate the real hostname + owner/repo path segments (not a substring
  // match) so a squatter's `https://evil.example/github.com/asgard-ai-platform/<slug>`
  // cannot masquerade as ours. Mirrors parseRepo / getPublisherTier.
  return urls.some(u => {
    let parsed;
    try { parsed = new URL(u); } catch { return false; }
    const host = parsed.hostname.toLowerCase();
    if (host !== 'github.com' && !host.endsWith('.github.com')) return false;
    const [owner, repo] = parsed.pathname.split('/').filter(Boolean);
    return owner?.toLowerCase() === 'asgard-ai-platform'
      && repo?.toLowerCase().replace(/\.git$/, '') === wantRepo;
  });
}

/**
 * Append `lines` (plain bullet text, no leading `- `) under the H2 group
 * `## ${groupName}` in the markdown file at `reportPath`.
 *
 * Behaviour:
 *  - No-op if `lines` is empty.
 *  - If the file does not exist or does not contain `## ${groupName}`,
 *    appends a new H2 block (with leading blank line) to the file.
 *  - If the group already exists, inserts the new bullets after the
 *    existing bullets but before the next `## ` header (or end-of-file).
 *
 * **Format contract (must be honoured by every writer to the same file):**
 * group blocks are written as `\n## <name>\n\n- bullet\n- bullet\n` —
 * exactly one blank line between header and the bullet list. The update
 * regex relies on this exact shape; a single `\n` between header and
 * bullets would silently fall through to the append-new-group path and
 * produce a duplicate H2 section.
 */
export function appendGroup(reportPath, groupName, lines) {
  if (lines.length === 0) return;
  const existing = existsSync(reportPath) ? readFileSync(reportPath, 'utf-8') : '';
  const groupHeader = `## ${groupName}`;
  const headerPresent =
    existing.startsWith(`${groupHeader}\n`) ||
    existing.includes(`\n${groupHeader}\n`);

  if (headerPresent) {
    const escaped = groupHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const updated = existing.replace(
      new RegExp(`(${escaped}\\n\\n[\\s\\S]*?)(?=\\n##\\s+|$)`),
      (block) => block.trimEnd() + '\n' + lines.map(l => `- ${l}`).join('\n') + '\n',
    );
    writeFileSync(reportPath, updated, 'utf-8');
  } else {
    const block = `\n${groupHeader}\n\n${lines.map(l => `- ${l}`).join('\n')}\n`;
    appendFileSync(reportPath, block, 'utf-8');
  }
}

// ── README / gallery-field text helpers ───────────────────────────
// Shared by discover-new-mcps.mjs and refresh-boilerplate-descriptions.mjs,
// which derive gallery name/description from repo READMEs. Kept here (not
// duplicated per script) so a change to the `# MCP <ServiceName>` convention
// or the card-rendering rules is made in exactly one place.

/** First `# H1` line of a markdown body, trimmed; '' if none. */
export function extractH1(body) {
  const m = (body || '').match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

// Treat an H1 as a placeholder when it's literally the slug (with or without
// the `mcp-` prefix). Repos sometimes ship `# mcp-foo-bar` as their H1, which
// then surfaces as the gallery title — caller should fall back to slugToTitle.
export function isPlaceholderH1(h1, slug) {
  if (!h1) return true;
  const norm = h1.toLowerCase().trim();
  return norm === slug.toLowerCase() || norm === slug.replace(/^mcp-/, '').toLowerCase();
}

/** Intro paragraph(s) between the H1 and the first H2, minus badge/lang/rule lines. */
export function extractIntro(readme) {
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

/** `mcp-foo-bar` → `Foo Bar`. Title-cases each word; no acronym awareness. */
export function slugToTitle(slug) {
  return slug.replace(/^mcp-/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Escape a value for embedding in a YAML double-quoted scalar. */
export function escapeStr(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Flatten inline markdown to plain text — gallery name/description fields are
 * rendered verbatim on the cards (no markdown pass), so raw `[label](url)` /
 * `**bold**` would show up literally (the original mcp-heimdall bug).
 */
export function stripMarkdownInline(text) {
  return (text || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')        // images dropped
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')     // links → label
    .replace(/\*\*([^*]+)\*\*/g, '$1')           // bold
    .replace(/\*([^*]+)\*/g, '$1')               // italic
    .replace(/`([^`]+)`/g, '$1');                // inline code
}
