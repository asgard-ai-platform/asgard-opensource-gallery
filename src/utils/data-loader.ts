import yaml from 'js-yaml';
import fs from 'node:fs';
import path from 'node:path';
import type { McpServer, Skill, PlugIn } from '../types';
import { STATUS_ORDER as statusOrder } from '../types';

const DATA_DIR = path.join(process.cwd(), 'data');

function loadYaml<T>(filename: string): T {
  const content = fs.readFileSync(path.join(DATA_DIR, filename), 'utf-8');
  return yaml.load(content) as T;
}

function sortByStatus<T extends { status: string; slug: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const statusDiff = (statusOrder[a.status as keyof typeof statusOrder] ?? 99)
      - (statusOrder[b.status as keyof typeof statusOrder] ?? 99);
    if (statusDiff !== 0) return statusDiff;
    return a.slug.localeCompare(b.slug);
  });
}

export function getMcpServers(): McpServer[] {
  const data = loadYaml<{ servers: McpServer[] }>('mcp-servers.yaml');
  return sortByStatus(data.servers);
}

export function getSkills(): Skill[] {
  const data = loadYaml<{ skills: Skill[] }>('skills.yaml');
  return sortByStatus(data.skills);
}

// Raw YAML plugin entries may omit `kind`; getPlugIns() fills the default so the
// rest of the app always receives a concrete PlugIn.kind.
type RawPlugIn = Omit<PlugIn, 'kind'> & { kind?: PlugIn['kind'] };

export function getPlugIns(): PlugIn[] {
  const data = loadYaml<{ plugins: RawPlugIn[] }>('plugins.yaml');
  return data.plugins.map((p) => ({ ...p, kind: p.kind ?? 'collection' }));
}

export function getMcpBySlug(slug: string): McpServer | undefined {
  return getMcpServers().find((s) => s.slug === slug);
}

export function getSkillBySlug(slug: string): Skill | undefined {
  return getSkills().find((s) => s.slug === slug);
}

export function getPlugInBySlug(slug: string): PlugIn | undefined {
  return getPlugIns().find((p) => p.slug === slug);
}

/** GitHub org whose repos count as first-party ("core") packs. */
const CORE_PUBLISHER = 'asgard-ai-platform';

/**
 * Derive publisher trust tier from the repo owner in a github URL.
 * Owner github.com/asgard-ai-platform → "core"; any other owner → "community".
 * Returns null when there is no github URL (e.g. collections) or it is not a
 * real github.com host. Validated via `new URL()` (not a substring match) so a
 * path-segment look-alike like `https://evil.example/github.com/asgard-ai-platform`
 * cannot spoof the "core" tier.
 */
export function getPublisherTier(github?: string): 'core' | 'community' | null {
  if (!github) return null;
  let host: string;
  let owner: string | undefined;
  try {
    const u = new URL(github);
    host = u.hostname.toLowerCase();
    owner = u.pathname.split('/').filter(Boolean)[0];
  } catch {
    return null;
  }
  if (host !== 'github.com' && !host.endsWith('.github.com')) return null;
  if (!owner) return null;
  return owner.toLowerCase() === CORE_PUBLISHER ? 'core' : 'community';
}

export interface SkillContent {
  /** SKILL.md H2 sections in document order. `key` is a slug for known sections
   *  (overview/framework/gotchas/…) used for iconed styling; `title` is the
   *  original heading, shown verbatim for any non-standard section. */
  sections?: { key: string; title: string; body: string }[];
}

let _skillContentCache: Record<string, SkillContent> | null = null;

export function getSkillContent(): Record<string, SkillContent> {
  if (_skillContentCache) return _skillContentCache;
  const filePath = path.join(DATA_DIR, 'skill-content.json');
  if (!fs.existsSync(filePath)) return {};
  _skillContentCache = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return _skillContentCache!;
}

export function getSkillContentBySlug(slug: string): SkillContent | undefined {
  return getSkillContent()[slug];
}

export interface McpContent {
  intro: { en: string; zh?: string };
  sections: {
    en: Record<string, string>;
    zh: Record<string, string>;
  };
}

let _mcpContentCache: Record<string, McpContent> | null = null;

export function getMcpContent(): Record<string, McpContent> {
  if (_mcpContentCache) return _mcpContentCache;
  const filePath = path.join(DATA_DIR, 'mcp-content.json');
  if (!fs.existsSync(filePath)) return {};
  _mcpContentCache = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return _mcpContentCache!;
}

export function getMcpContentBySlug(slug: string): McpContent | undefined {
  return getMcpContent()[slug];
}

/** One harness's install tab, parsed from the pack README's install section. */
export interface PackInstall {
  harness: string;
  label: string;
  command: string;
  source: string;
  notes?: string;
}

/** A single credential the user may need to set, parsed from `.env.example`. */
export interface PackEnvVar {
  name: string;
  required_when?: string;
  default?: string;
  description?: string;
  source: string;
}

/** Credentials grouped by provider/MCP, from `.env.example` divider blocks. */
export interface PackEnvGroup {
  service: string;
  mcp_slug?: string;
  default_mode?: string;
  docs_url?: string;
  private?: boolean;
  vars: PackEnvVar[];
}

export interface PackSetup {
  status: 'none' | 'sandbox-ready' | 'keys-required';
  summary: string;
  env_groups: PackEnvGroup[];
}

/** One scenario from `docs/USE-CASES.md`. skills/mcp_servers are the pack-local
 *  names exactly as written in the doc (not gallery slugs). */
export interface PackUseCase {
  title: string;
  scenario?: string;
  prompt?: string;
  skills: string[];
  mcp_servers: string[];
  caveats?: string;
  maturity?: string;
}

export interface PackSource {
  version?: string;
  license?: string;
  repository?: string;
  homepage?: string;
  keywords: string[];
  manifest_urls: string[];
  marketplace?: { name?: string; source?: string };
}

/** The sync-extracted, committed sidecar entry for one pack (`data/pack-content.json`),
 *  keyed by gallery plugin slug. content_maturity is optional and not yet populated by the
 *  extractor (deferred — needs a per-SKILL.md pass; see the slice plans). */
export interface PackContent {
  install: PackInstall[];
  setup: PackSetup;
  use_cases: PackUseCase[];
  content_maturity?: Record<string, 'full' | 'skeleton' | 'unknown'>;
  source: PackSource;
}

let _packContentCache: Record<string, PackContent> | null = null;

export function getPackContent(): Record<string, PackContent> {
  if (_packContentCache) return _packContentCache;
  const filePath = path.join(DATA_DIR, 'pack-content.json');
  if (!fs.existsSync(filePath)) return {};
  _packContentCache = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return _packContentCache!;
}

export function getPackContentBySlug(slug: string): PackContent | undefined {
  return getPackContent()[slug];
}

/** Derived, non-stored view-model for a pack (spec §7). Computed from the
 *  plugin entry + the skills catalogue; never persisted in the sidecar. */
export interface PackView {
  skill_count: number;
  mcp_count: number;
  skills_only: boolean;
  has_mcp: boolean;
  /** True iff some pack skill's requires_mcp names an MCP that is also in the pack. */
  hasDepEdges: boolean;
  publisher_tier: 'core' | 'community' | null;
}

export function getPackView(plugin: PlugIn): PackView {
  const mcpCount = plugin.mcp_servers.length;
  const skillCount = plugin.skills.length;
  const skillSet = new Set(plugin.skills);
  const mcpSet = new Set(plugin.mcp_servers);
  const allSkills = getSkills();
  const hasDepEdges = allSkills.some(
    (s) => skillSet.has(s.slug) && (s.requires_mcp ?? []).some((m) => mcpSet.has(m)),
  );
  return {
    skill_count: skillCount,
    mcp_count: mcpCount,
    skills_only: mcpCount === 0,
    has_mcp: mcpCount > 0,
    hasDepEdges,
    publisher_tier: getPublisherTier(plugin.github),
  };
}
