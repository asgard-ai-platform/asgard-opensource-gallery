/**
 * _lib.mjs — Shared helpers for sync-gallery cron scripts.
 *
 * Existing scripts (sync-mcp-content.mjs, sync-skill-content.mjs,
 * generate-new-entries.mjs) intentionally do not import this — they
 * stay as-is per the spec. This lib is for the new cron-only scripts.
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
