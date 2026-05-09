import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionKey } from './sync-mcp-content.mjs';

// ── Tools (N) regex (en) ──
test('sectionKey: "Tools" → available_tools', () => {
  assert.equal(sectionKey('Tools'), 'available_tools');
});
test('sectionKey: "Tools (4)" → available_tools', () => {
  assert.equal(sectionKey('Tools (4)'), 'available_tools');
});
test('sectionKey: "Tools (143)" → available_tools', () => {
  assert.equal(sectionKey('Tools (143)'), 'available_tools');
});
test('sectionKey: "Tools(4)" (no space) → available_tools', () => {
  assert.equal(sectionKey('Tools(4)'), 'available_tools');
});
test('sectionKey: "Available Tools" → available_tools', () => {
  assert.equal(sectionKey('Available Tools'), 'available_tools');
});

// ── Tools (N) regex (zh) ──
test('sectionKey: "工具" → available_tools', () => {
  assert.equal(sectionKey('工具'), 'available_tools');
});
test('sectionKey: "工具 (4)" → available_tools', () => {
  assert.equal(sectionKey('工具 (4)'), 'available_tools');
});
test('sectionKey: "工具 (143)" → available_tools', () => {
  assert.equal(sectionKey('工具 (143)'), 'available_tools');
});
test('sectionKey: "可用工具" → available_tools', () => {
  assert.equal(sectionKey('可用工具'), 'available_tools');
});

// ── en/zh canonical pairing ──
test('sectionKey: "Features" / "功能特色" both → features', () => {
  assert.equal(sectionKey('Features'), 'features');
  assert.equal(sectionKey('功能特色'), 'features');
});
test('sectionKey: "Quick Start" / "快速開始" both → quick_start', () => {
  assert.equal(sectionKey('Quick Start'), 'quick_start');
  assert.equal(sectionKey('快速開始'), 'quick_start');
});
test('sectionKey: "API Reference" / "API 參考" both → api_reference', () => {
  assert.equal(sectionKey('API Reference'), 'api_reference');
  assert.equal(sectionKey('API 參考'), 'api_reference');
});
test('sectionKey: "Development" / "開發" both → development', () => {
  assert.equal(sectionKey('Development'), 'development');
  assert.equal(sectionKey('開發'), 'development');
});
test('sectionKey: "License" / "授權" both → license', () => {
  assert.equal(sectionKey('License'), 'license');
  assert.equal(sectionKey('授權'), 'license');
});
test('sectionKey: "Contributing" / "貢獻" both → contributing', () => {
  assert.equal(sectionKey('Contributing'), 'contributing');
  assert.equal(sectionKey('貢獻'), 'contributing');
});

// ── Long-tail aliases ──
test('sectionKey: "Important Write Tools" / "重要寫入工具" → important_write_tools', () => {
  assert.equal(sectionKey('Important Write Tools'), 'important_write_tools');
  assert.equal(sectionKey('重要寫入工具'), 'important_write_tools');
});
test('sectionKey: "Project Structure" / "專案結構" → project_structure', () => {
  assert.equal(sectionKey('Project Structure'), 'project_structure');
  assert.equal(sectionKey('專案結構'), 'project_structure');
});
test('sectionKey: "API Constraints" / "API 限制" → api_constraints', () => {
  assert.equal(sectionKey('API Constraints'), 'api_constraints');
  assert.equal(sectionKey('API 限制'), 'api_constraints');
});

// ── Unicode-safe slugify fallback ──
test('sectionKey: unknown CJK heading falls back to CJK slug, not empty', () => {
  // "自訂段落" = "Custom Section" — not in alias table
  assert.equal(sectionKey('自訂段落'), '自訂段落');
});
test('sectionKey: unknown ASCII heading slugifies to lowercase_underscore', () => {
  assert.equal(sectionKey('Some New Heading'), 'some_new_heading');
});
test('sectionKey: punctuation in unknown heading is stripped', () => {
  assert.equal(sectionKey('Foo & Bar!'), 'foo_bar');
});
test('sectionKey: empty string → empty string', () => {
  assert.equal(sectionKey(''), '');
});
test('sectionKey: whitespace-only heading → empty string', () => {
  assert.equal(sectionKey('   '), '');
});
