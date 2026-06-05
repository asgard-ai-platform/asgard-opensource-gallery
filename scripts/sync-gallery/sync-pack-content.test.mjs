import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseRepo,
  parsePluginManifest,
  parseMarketplace,
  buildSourceBlock,
} from './sync-pack-content.mjs';

const FIX = new URL('./_fixtures/', import.meta.url).pathname;
const readFix = (name) => readFileSync(join(FIX, name), 'utf-8');
const pluginJson = JSON.parse(readFix('pack-majordomo-plugin.json'));
const marketplaceJson = JSON.parse(readFix('pack-majordomo-marketplace.json'));

// ── parseRepo ──
test('parseRepo: owner/repo from https URL', () => {
  assert.deepEqual(parseRepo('https://github.com/asgard-ai-platform/tw-ecommerce-majordomo'), {
    owner: 'asgard-ai-platform',
    repo: 'tw-ecommerce-majordomo',
  });
});
test('parseRepo: strips trailing .git', () => {
  assert.deepEqual(parseRepo('https://github.com/foo/bar.git'), { owner: 'foo', repo: 'bar' });
});
test('parseRepo: non-github → null', () => {
  assert.equal(parseRepo('https://example.com/x'), null);
  assert.equal(parseRepo(undefined), null);
});

// ── parsePluginManifest ──
test('parsePluginManifest: core fields', () => {
  const p = parsePluginManifest(pluginJson);
  assert.equal(p.name, 'tw-ecommerce-majordomo');
  assert.equal(p.version, '0.1.0');
  assert.equal(p.license, 'MIT');
  assert.equal(p.repository, 'https://github.com/asgard-ai-platform/tw-ecommerce-majordomo');
  assert.equal(p.skills_dir, './skills/');
  assert.deepEqual(p.keywords, ['taiwan', 'ecommerce', 'skills', 'mcp', 'ecpay', 'newebpay']);
});
test('parsePluginManifest: mcpServers → names + env_keys', () => {
  const p = parsePluginManifest(pluginJson);
  assert.deepEqual(p.mcp_servers.map((m) => m.name), ['ecpay', 'sf-express', '91app']);
  assert.deepEqual(p.mcp_servers[0].env_keys, ['ECPAY_ENV', 'ECPAY_MERCHANT_ID', 'ECPAY_HASH_KEY']);
});
test('parsePluginManifest: null in → null out', () => {
  assert.equal(parsePluginManifest(null), null);
});

// ── parseMarketplace ──
test('parseMarketplace: name + first plugin source', () => {
  assert.deepEqual(parseMarketplace(marketplaceJson), {
    name: 'tw-ecommerce-majordomo',
    source: './',
  });
});
test('parseMarketplace: null in → null out', () => {
  assert.equal(parseMarketplace(null), null);
});

// ── buildSourceBlock ──
test('buildSourceBlock: provenance from manifest + marketplace', () => {
  const repo = { owner: 'asgard-ai-platform', repo: 'tw-ecommerce-majordomo' };
  const block = buildSourceBlock(parsePluginManifest(pluginJson), parseMarketplace(marketplaceJson), repo);
  assert.equal(block.version, '0.1.0');
  assert.equal(block.license, 'MIT');
  assert.equal(block.homepage, 'https://github.com/asgard-ai-platform/tw-ecommerce-majordomo');
  assert.equal(
    block.manifest_urls[0],
    'https://github.com/asgard-ai-platform/tw-ecommerce-majordomo/blob/HEAD/.claude-plugin/plugin.json',
  );
  assert.equal(block.marketplace.name, 'tw-ecommerce-majordomo');
  assert.equal(block.marketplace.source, './');
});
