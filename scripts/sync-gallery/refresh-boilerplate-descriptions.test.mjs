import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isBoilerplateName,
  isBoilerplateDescEn,
  isBoilerplateDescZh,
  buildRefreshes,
  applyFieldUpdates,
} from './refresh-boilerplate-descriptions.mjs';

// ── Boilerplate detection ─────────────────────────────────────────

test('isBoilerplateName: template names are boilerplate', () => {
  assert.equal(isBoilerplateName('MCP Server Template'), true);
  assert.equal(isBoilerplateName('MCP Server 範本'), true);
});

test('isBoilerplateName: curated names are not boilerplate', () => {
  assert.equal(isBoilerplateName('SHOPLINE'), false);
  assert.equal(isBoilerplateName('Heimdall'), false);
});

test('isBoilerplateDescEn: mcp-template repo description is boilerplate', () => {
  const tpl = 'A reusable template for building [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) servers that expose AI-callable tools. Part of the [Asgard AI Platform](https://github.com/asgard-ai-platform) open-source ecosystem.';
  assert.equal(isBoilerplateDescEn(tpl, 'MCP Server Template'), true);
});

test('isBoilerplateDescEn: generic discovery fallback "MCP Server for <name>." is boilerplate', () => {
  assert.equal(isBoilerplateDescEn('MCP Server for Plurk.', 'Plurk'), true);
});

test('isBoilerplateDescEn: curated description starting with "MCP Server for" is not boilerplate', () => {
  const curated = 'MCP Server for Shopline e-commerce platform — 143 AI-callable tools (75 read + 68 write) covering orders, products, inventory, customers, promotions, and more.';
  assert.equal(isBoilerplateDescEn(curated, 'Shopline'), false);
});

test('isBoilerplateDescZh: discovery zh template is boilerplate', () => {
  assert.equal(isBoilerplateDescZh('MCP Server 範本 MCP Server，提供 AI 代理透過自然語言存取相關資料與功能。'), true);
  assert.equal(isBoilerplateDescZh('Plurk MCP Server，提供 AI 代理透過自然語言存取相關資料與功能。'), true);
});

test('isBoilerplateDescZh: curated zh description is not boilerplate', () => {
  assert.equal(isBoilerplateDescZh('藍新金流 NewebPay MCP Server，為 AI 代理提供金流整合與交易管理功能。'), false);
});

// ── buildRefreshes ────────────────────────────────────────────────

const HEIMDALL_README_EN = `# MCP Heimdall

[![PyPI version](https://img.shields.io/pypi/v/mcp-heimdall.svg)](https://pypi.org/project/mcp-heimdall/)

[繁體中文](README.zh-TW.md)

An MCP (Model Context Protocol) server that exposes **read-only** tools for [Asgard](https://example.com)'s content management platform.

## What This Does

26 tools.
`;

const HEIMDALL_README_ZH = `# MCP Heimdall

[English](README.md)

**Heimdall** — Asgard 內容管理平台的 MCP (Model Context Protocol) 伺服器，提供只讀工具。

## 功能

26 個工具。
`;

const TEMPLATE_ENTRY = {
  slug: 'mcp-heimdall',
  name: { en: 'MCP Server Template', zh: 'MCP Server 範本' },
  description: {
    en: 'A reusable template for building [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) servers that expose AI-callable tools. Part of the [Asgard AI Platform](https://github.com/asgard-ai-platform) open-source ecosystem.',
    zh: 'MCP Server 範本 MCP Server，提供 AI 代理透過自然語言存取相關資料與功能。',
  },
  status: 'released',
};

test('buildRefreshes: fully-boilerplate released entry gets all four fields from READMEs', () => {
  const { updates, findings } = buildRefreshes({
    servers: [TEMPLATE_ENTRY],
    fetchReadmeFn: () => HEIMDALL_README_EN,
    fetchReadmeZhFn: () => HEIMDALL_README_ZH,
  });
  assert.equal(findings.length, 0);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], {
    slug: 'mcp-heimdall',
    fields: {
      nameEn: 'Heimdall',
      nameZh: 'Heimdall',
      descEn: "An MCP (Model Context Protocol) server that exposes read-only tools for Asgard's content management platform.",
      descZh: 'Heimdall — Asgard 內容管理平台的 MCP (Model Context Protocol) 伺服器，提供只讀工具。',
    },
  });
});

test('buildRefreshes: only boilerplate fields are refreshed, curated fields untouched', () => {
  const entry = {
    slug: 'mcp-591',
    name: { en: '591 Rental', zh: '591 租屋' },
    description: {
      en: 'MCP Server for 591 rental listings — search and compare rentals.',
      zh: '591 Rental MCP Server，提供 AI 代理透過自然語言存取相關資料與功能。',
    },
    status: 'released',
  };
  const { updates, findings } = buildRefreshes({
    servers: [entry],
    fetchReadmeFn: () => HEIMDALL_README_EN,
    fetchReadmeZhFn: () => HEIMDALL_README_ZH,
  });
  assert.equal(findings.length, 0);
  assert.equal(updates.length, 1);
  assert.deepEqual(Object.keys(updates[0].fields), ['descZh']);
});

test('buildRefreshes: non-released entries are skipped', () => {
  const { updates, findings } = buildRefreshes({
    servers: [{ ...TEMPLATE_ENTRY, status: 'coming-soon' }],
    fetchReadmeFn: () => HEIMDALL_README_EN,
    fetchReadmeZhFn: () => HEIMDALL_README_ZH,
  });
  assert.equal(updates.length, 0);
  assert.equal(findings.length, 0);
});

test('buildRefreshes: entries with no boilerplate fields are skipped without fetching', () => {
  let fetched = 0;
  const { updates } = buildRefreshes({
    servers: [{
      slug: 'mcp-shopline',
      name: { en: 'Shopline Commerce', zh: 'Shopline 電商平台' },
      description: { en: 'MCP Server for Shopline e-commerce platform — 143 tools.', zh: 'Shopline 電商平台 MCP Server — 143 個工具。' },
      status: 'released',
    }],
    fetchReadmeFn: () => { fetched++; return HEIMDALL_README_EN; },
    fetchReadmeZhFn: () => { fetched++; return HEIMDALL_README_ZH; },
  });
  assert.equal(updates.length, 0);
  assert.equal(fetched, 0);
});

test('buildRefreshes: a name equal to the title-cased slug is re-checked but left as-is when the README agrees', () => {
  let fetched = 0;
  const { updates, findings } = buildRefreshes({
    servers: [{
      slug: 'mcp-shopline',
      name: { en: 'Shopline', zh: 'Shopline 電商平台' },
      description: { en: 'MCP Server for Shopline e-commerce platform — 143 tools.', zh: 'Shopline 電商平台 MCP Server — 143 個工具。' },
      status: 'released',
    }],
    fetchReadmeFn: () => { fetched++; return '# MCP Shopline\n\nA Shopline MCP server.\n'; },
    fetchReadmeZhFn: () => { fetched++; return null; },
  });
  assert.equal(updates.length, 0);
  assert.equal(findings.length, 0);
  assert.equal(fetched, 1); // en README re-derived; zh not needed
});

test('buildRefreshes: a title-cased-slug acronym name is recased from the README H1 (Uof → UOF)', () => {
  const { updates, findings } = buildRefreshes({
    servers: [{
      slug: 'mcp-uof',
      name: { en: 'Uof', zh: 'Uof' },
      description: { en: 'UOF platform MCP server.', zh: 'UOF 平台 MCP Server。' },
      status: 'released',
    }],
    fetchReadmeFn: () => '# MCP UOF\n\nUOF platform MCP server.\n',
    fetchReadmeZhFn: () => '# MCP UOF\n\nUOF 平台 MCP Server。\n',
  });
  assert.equal(findings.length, 0);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].fields, { nameEn: 'UOF', nameZh: 'UOF' });
});

test('buildRefreshes: a title-cased-slug name is never clobbered into a different word', () => {
  const { updates, findings } = buildRefreshes({
    servers: [{
      slug: 'mcp-threads',
      name: { en: 'Threads', zh: 'Threads' },
      description: { en: 'Threads MCP server.', zh: 'Threads MCP Server。' },
      status: 'released',
    }],
    fetchReadmeFn: () => '# MCP Meta Threads\n\nThreads MCP server.\n',
    fetchReadmeZhFn: () => '# MCP Meta Threads\n\nThreads MCP Server。\n',
  });
  assert.equal(updates.length, 0);
  assert.equal(findings.length, 0);
});

test('buildRefreshes: missing zh README leaves zh fields boilerplate and emits findings', () => {
  const { updates, findings } = buildRefreshes({
    servers: [TEMPLATE_ENTRY],
    fetchReadmeFn: () => HEIMDALL_README_EN,
    fetchReadmeZhFn: () => null,
  });
  assert.equal(updates.length, 1);
  assert.deepEqual(Object.keys(updates[0].fields), ['nameEn', 'descEn']);
  assert.equal(findings.length, 2);
  assert.equal(findings[0].repo, 'mcp-heimdall');
});

test('buildRefreshes: missing en README emits finding and no update', () => {
  const { updates, findings } = buildRefreshes({
    servers: [TEMPLATE_ENTRY],
    fetchReadmeFn: () => null,
    fetchReadmeZhFn: () => HEIMDALL_README_ZH,
  });
  assert.equal(updates.length, 0);
  assert.equal(findings.length, 1);
  assert.match(findings[0].issue, /README\.md missing/);
});

test('buildRefreshes: placeholder slug H1 falls back to title-cased slug', () => {
  const readme = `# mcp-heimdall

A real description paragraph.

## Usage
`;
  const { updates } = buildRefreshes({
    servers: [TEMPLATE_ENTRY],
    fetchReadmeFn: () => readme,
    fetchReadmeZhFn: () => null,
  });
  assert.equal(updates[0].fields.nameEn, 'Heimdall');
});

// ── applyFieldUpdates ─────────────────────────────────────────────

const YAML_TEXT = `servers:
  - slug: mcp-heimdall
    name:
      en: "MCP Server Template"
      zh: "MCP Server 範本"
    description:
      en: "A reusable template."
      zh: "MCP Server 範本 MCP Server，提供 AI 代理透過自然語言存取相關資料與功能。"
    status: released
    category: data
    region: global
    github: https://github.com/asgard-ai-platform/mcp-heimdall
    tags: ["data", "global", "heimdall"]
    maintainer: asgard-ai-platform

  - slug: mcp-plurk
    name:
      en: "Plurk"
      zh: "Plurk"
    description:
      en: "A minimal Plurk MCP server."
      zh: "Plurk MCP Server，提供 AI 代理透過自然語言存取相關資料與功能。"
    status: coming-soon
`;

test('applyFieldUpdates: rewrites only the targeted fields of the targeted entry', () => {
  const updated = applyFieldUpdates(YAML_TEXT, [{
    slug: 'mcp-heimdall',
    fields: {
      nameEn: 'Heimdall',
      descZh: 'Heimdall — Asgard 內容管理平台的 MCP 伺服器，提供只讀工具。',
    },
  }]);
  assert.match(updated, /^ {6}en: "Heimdall"$/m);
  assert.match(updated, /^ {6}zh: "Heimdall — Asgard 內容管理平台的 MCP 伺服器，提供只讀工具。"$/m);
  // untouched fields and the other entry stay verbatim
  assert.match(updated, /^ {6}zh: "MCP Server 範本"$/m);
  assert.match(updated, /^ {6}en: "A reusable template\."$/m);
  assert.ok(updated.includes('zh: "Plurk MCP Server，提供 AI 代理透過自然語言存取相關資料與功能。"'));
  assert.ok(updated.includes('status: released'));
  assert.ok(updated.includes('status: coming-soon'));
});

test('applyFieldUpdates: name/description en lines are not confused with each other', () => {
  const updated = applyFieldUpdates(YAML_TEXT, [{
    slug: 'mcp-heimdall',
    fields: { descEn: 'Read-only MCP server for Asgard CMS.' },
  }]);
  assert.match(updated, /^ {6}en: "MCP Server Template"$/m);
  assert.match(updated, /^ {6}en: "Read-only MCP server for Asgard CMS\."$/m);
});

test('applyFieldUpdates: double quotes in values are escaped', () => {
  const updated = applyFieldUpdates(YAML_TEXT, [{
    slug: 'mcp-heimdall',
    fields: { descEn: 'Tools for "Asgard" platform.' },
  }]);
  assert.ok(updated.includes('en: "Tools for \\"Asgard\\" platform."'));
});

test('applyFieldUpdates: no updates returns input unchanged', () => {
  assert.equal(applyFieldUpdates(YAML_TEXT, []), YAML_TEXT);
});
