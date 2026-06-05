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

export function getPlugIns(): PlugIn[] {
  const data = loadYaml<{ plugins: PlugIn[] }>('plugins.yaml');
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

/**
 * Derive publisher trust tier from the repo owner in a github URL.
 * Owner github.com/asgard-ai-platform → "core"; any other owner → "community".
 * Returns null when there is no github URL (e.g. collections).
 */
export function getPublisherTier(github?: string): 'core' | 'community' | null {
  if (!github) return null;
  const m = github.match(/github\.com\/([^/]+)/i);
  if (!m) return null;
  return m[1].toLowerCase() === 'asgard-ai-platform' ? 'core' : 'community';
}

export interface SkillContent {
  overview?: string;
  when_to_use?: string;
  when_not_to_use?: string;
  framework?: string;
  output_format?: string;
  gotchas?: string;
  examples?: string;
  references?: string;
  assumptions?: string;
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
