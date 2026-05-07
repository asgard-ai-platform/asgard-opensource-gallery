#!/usr/bin/env node
/**
 * audit-pypi.mjs
 *
 * For each released MCP repo, fetch pyproject.toml + LICENSE and verify
 * required packaging metadata, then ping pypi.org to verify publish status.
 * Findings are appended under each `mcp-*` group in the audit report.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { parse as parseToml } from 'smol-toml';
import { ghFetchFile, appendGroup } from './_lib.mjs';

const ORG = 'asgard-ai-platform';
const ROOT = resolve(new URL('.', import.meta.url).pathname, '../..');
const REPORT_PATH = join(ROOT, 'scripts/sync-gallery/_generated/repo-audit-report.md');

const REQUIRED_PROJECT_FIELDS = [
  'name', 'version', 'description', 'readme',
  'requires-python', 'license', 'authors', 'classifiers',
];

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
      findings.push(`pyproject.toml [project] missing required field '${field}'`);
    }
  }

  const buildSystem = parsed['build-system'] || {};
  if (!buildSystem['build-backend']) {
    findings.push('pyproject.toml [build-system] missing build-backend');
  }

  if (!hasLicenseFile) {
    findings.push('LICENSE file missing at repo root');
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
    findings.push(`pyproject.toml version ${localVersion} ahead of latest PyPI release ${info.version}`);
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = join(ROOT, 'data');
  const mcps = yaml.load(readFileSync(join(dataDir, 'mcp-servers.yaml'), 'utf-8')).servers;
  let totalFindings = 0;

  for (const mcp of mcps) {
    if (mcp.status !== 'released') continue;
    const slug = mcp.slug;
    const findings = [];

    const tomlText = ghFetchFile(ORG, slug, 'pyproject.toml');
    if (!tomlText) {
      findings.push('pyproject.toml missing at repo root');
    } else {
      const license = ghFetchFile(ORG, slug, 'LICENSE');
      findings.push(...checkPyproject(tomlText, license !== null));

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

    appendGroup(REPORT_PATH, slug, findings);
    totalFindings += findings.length;
  }

  console.log(`audit-pypi: ${totalFindings} finding(s) appended to ${REPORT_PATH}`);
}
