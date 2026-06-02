#!/usr/bin/env node
/**
 * audit-pypi.mjs
 *
 * Two passes over `data/mcp-servers.yaml`:
 *
 * 1. For each `released` MCP — fetch `pyproject.toml` + `LICENSE` and verify
 *    required packaging metadata, then ping pypi.org to verify publish status.
 *    Findings appended under each `mcp-*` group in the audit report.
 *
 * 2. For each `coming-soon` MCP — query pypi.org by slug. If the package is
 *    now published, emit a "candidate for promotion" line under the
 *    `asgard-opensource-gallery` group so a human can flip the status to
 *    `released` via PR. (PyPI publish is the release gate; README
 *    conformance is tracked by the per-mcp-repo issues but does NOT gate.)
 *
 * Other statuses (`planned`, etc.) are skipped.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { parse as parseToml } from 'smol-toml';
import { ghFetchFile, appendGroup, isOurPackage, ghIsRepoPrivate, ghRepoVisibility } from './_lib.mjs';

const ORG = 'asgard-ai-platform';
const ROOT = resolve(new URL('.', import.meta.url).pathname, '../..');
const REPORT_PATH = join(ROOT, 'scripts/sync-gallery/_generated/repo-audit-report.md');

const REQUIRED_PROJECT_FIELDS = [
  'name', 'version', 'description', 'readme',
  'requires-python', 'license', 'authors', 'classifiers',
];

// Concrete example value per required field, appended to the finding so a
// maintainer sees exactly what line to add under [project].
const FIELD_EXAMPLE = {
  name: 'name = "mcp-<service>"',
  version: 'version = "0.1.0"',
  description: 'description = "<one-line summary>"',
  readme: 'readme = "README.md"',
  'requires-python': 'requires-python = ">=3.10"',
  license: 'license = "MIT"',
  authors: 'authors = [{ name = "Asgard AI Platform" }]',
  classifiers: 'classifiers = ["Programming Language :: Python :: 3"]',
};

export function checkPyproject(text, hasLicenseFile) {
  const findings = [];
  let parsed;
  try {
    parsed = parseToml(text);
  } catch {
    findings.push('pyproject.toml is not valid TOML');
    return findings;
  }

  const project = parsed.project || {};
  for (const field of REQUIRED_PROJECT_FIELDS) {
    const v = project[field];
    if (v === undefined || v === null || v === '') {
      findings.push(`pyproject.toml [project] missing required field '${field}' — add e.g. \`${FIELD_EXAMPLE[field]}\``);
    }
  }

  const buildSystem = parsed['build-system'] || {};
  if (!buildSystem['build-backend']) {
    findings.push('pyproject.toml [build-system] missing build-backend — add e.g. `build-backend = "hatchling.build"`');
  }

  if (!hasLicenseFile) {
    findings.push('LICENSE file missing at repo root — add a `LICENSE` file (MIT) at the repo root');
  }

  return findings;
}

export function checkPypiPublish(name, localVersion, response) {
  const findings = [];
  if (response.status === 404) {
    findings.push(`Package \`${name}\` is not published on PyPI`);
    return findings;
  }
  if (response.status !== 200) {
    // 5xx, network error, etc — silent (no finding) per spec.
    return findings;
  }
  const info = response.body?.info || {};
  if (info.version && info.version !== localVersion) {
    findings.push(`pyproject.toml version ${localVersion} does not match latest PyPI release ${info.version}`);
  }
  if (info.description_content_type && info.description_content_type !== 'text/markdown') {
    findings.push(`PyPI description_content_type is '${info.description_content_type}' — README will not render correctly (expected 'text/markdown')`);
  }
  return findings;
}

async function fetchPypi(name) {
  try {
    const r = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, {
      headers: { 'User-Agent': 'yggdrasil-audit/1.0' },
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
 * For each `coming-soon` MCP entry, check whether a PyPI package matching the
 * gallery slug now exists. If so, emit a one-line "candidate for promotion"
 * suggestion. Only HTTP 200 from pypi.org counts as a candidate — 404 (not
 * yet published) and 5xx (transient) both stay quiet.
 *
 * @param {object} params
 * @param {Array<{slug:string, status:string}>} params.mcps
 * @param {(name:string) => Promise<{status:number, body?:any}>} params.fetchPypiFn
 */
export async function findPromotionCandidates({ mcps, fetchPypiFn, isPrivateFn = () => false }) {
  const candidates = [];
  for (const mcp of mcps) {
    if (mcp.status !== 'coming-soon') continue;
    if (isPrivateFn(mcp.slug)) continue;
    const r = await fetchPypiFn(mcp.slug);
    if (r.status !== 200) continue;
    // Reject third-party packages that happen to share our slug. Only count
    // PyPI metadata that points back at github.com/asgard-ai-platform/<slug>.
    if (!isOurPackage(r.body?.info, mcp.slug)) continue;
    const version = r.body?.info?.version || 'unknown';
    candidates.push(
      `Candidate for promotion: \`${mcp.slug}\` is published on PyPI (latest: ${version}) — flip \`status\` from \`coming-soon\` to \`released\``,
    );
  }
  return candidates;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const dataDir = join(ROOT, 'data');
  const mcps = yaml.load(readFileSync(join(dataDir, 'mcp-servers.yaml'), 'utf-8')).servers;
  let totalFindings = 0;

  // Pass 1: every PUBLIC mcp repo (any status) — pyproject/LICENSE
  // conformance. The PyPI publish-drift sub-check is released-only.
  for (const mcp of mcps) {
    // Process only repos we can confirm are public. 'private' is skipped
    // by design; 'unknown' (missing repo / transient gh failure) is also
    // skipped so an outage can't mass-emit false "missing file" findings —
    // the next scheduled run picks it back up.
    if (ghRepoVisibility(ORG, mcp.slug) !== 'public') continue;
    const slug = mcp.slug;
    const findings = [];

    const tomlText = ghFetchFile(ORG, slug, 'pyproject.toml');
    if (!tomlText) {
      findings.push('pyproject.toml missing at repo root');
    } else {
      const license = ghFetchFile(ORG, slug, 'LICENSE');
      findings.push(...checkPyproject(tomlText, license !== null));

      // PyPI publish-drift only applies to released MCPs — a coming-soon
      // repo legitimately has no PyPI release yet, so skip to avoid noise.
      if (mcp.status === 'released') {
        try {
          const parsed = parseToml(tomlText);
          const name = parsed.project?.name;
          const version = parsed.project?.version;
          if (name && version) {
            const pypi = await fetchPypi(name);
            findings.push(...checkPypiPublish(name, version, pypi));
          }
        } catch {
          // Already reported as invalid TOML.
        }
      }
    }

    appendGroup(REPORT_PATH, slug, findings);
    totalFindings += findings.length;
  }

  // Pass 2: coming-soon MCPs — emit promotion candidates if now on PyPI.
  const candidates = await findPromotionCandidates({
    mcps,
    fetchPypiFn: fetchPypi,
    isPrivateFn: (slug) => ghIsRepoPrivate(ORG, slug),
  });
  if (candidates.length > 0) {
    appendGroup(REPORT_PATH, 'asgard-opensource-gallery', candidates);
  }

  console.log(
    `audit-pypi: ${totalFindings} finding(s) and ${candidates.length} promotion candidate(s) appended to ${REPORT_PATH}`,
  );
}
