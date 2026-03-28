import yaml from 'js-yaml';
import fs from 'node:fs';
import path from 'node:path';
import type { McpServer, Skill, Bundle } from '../types';
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

export function getBundles(): Bundle[] {
  const data = loadYaml<{ bundles: Bundle[] }>('bundles.yaml');
  return data.bundles;
}

export function getMcpBySlug(slug: string): McpServer | undefined {
  return getMcpServers().find((s) => s.slug === slug);
}

export function getSkillBySlug(slug: string): Skill | undefined {
  return getSkills().find((s) => s.slug === slug);
}

export function getBundleBySlug(slug: string): Bundle | undefined {
  return getBundles().find((b) => b.slug === slug);
}
