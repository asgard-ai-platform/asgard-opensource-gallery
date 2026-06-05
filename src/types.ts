export interface BilingualText {
  en: string;
  zh: string;
}

export interface McpServer {
  slug: string;
  name: BilingualText;
  description: BilingualText;
  status: 'released' | 'coming-soon' | 'planned';
  category: string;
  region: 'global' | 'taiwan' | 'sea' | 'japan';
  github: string;
  tools_count?: number;
  tags?: string[];
  upgrade_to?: string;
  plugins?: string[];
  api_docs?: string;
  icon?: string;
  maintainer?: string;
}

export interface Skill {
  slug: string;
  name: BilingualText;
  description: BilingualText;
  status: 'released' | 'coming-soon' | 'planned';
  category: string;
  skill_type: 'industry' | 'methodology' | 'theory' | 'algorithm';
  region?: 'global' | 'taiwan' | 'sea' | 'japan';
  github?: string;
  requires_mcp?: string[];
  has_script?: boolean;
  tags?: string[];
  upgrade_to?: string;
  plugins?: string[];
  icon?: string;
  maintainer?: string;
}

export interface PlugIn {
  slug: string;
  /** Always set on values from data-loader.getPlugIns() (raw YAML may omit it → defaults to 'collection'). */
  kind: 'collection' | 'pack';
  name: BilingualText;
  description: BilingualText;
  scenario: BilingualText;
  upgrade_to?: string;
  upgrade_description?: BilingualText;
  mcp_servers: string[];
  skills: string[];
  github?: string;
  icon?: string;
}

export type Status = McpServer['status'];
export type SkillType = Skill['skill_type'];
export type Region = McpServer['region'];

export const STATUS_ORDER: Record<Status, number> = {
  released: 0,
  'coming-soon': 1,
  planned: 2,
};

export const CATEGORIES = [
  'ecommerce', 'payment', 'analytics', 'communication', 'data',
  'crm', 'restaurant', 'gov', 'marketing', 'finance',
  'manufacturing', 'ops', 'customer-service', 'media',
  'methodology', 'theory', 'algorithm',
] as const;

export const REGIONS: Region[] = ['global', 'taiwan', 'sea', 'japan'];

export const SKILL_TYPES: SkillType[] = ['industry', 'methodology', 'theory', 'algorithm'];
