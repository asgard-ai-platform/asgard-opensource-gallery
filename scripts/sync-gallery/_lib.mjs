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
