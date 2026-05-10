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

// ── Task 4.5: extended alias coverage ──

// Tools variants
test('sectionKey: "Tools (27 Total)" → available_tools', () => {
  assert.equal(sectionKey('Tools (27 Total)'), 'available_tools');
});
test('sectionKey: "Available Tools (143)" → available_tools', () => {
  assert.equal(sectionKey('Available Tools (143)'), 'available_tools');
});
test('sectionKey: "Tool Reference" / "工具參考" → available_tools', () => {
  assert.equal(sectionKey('Tool Reference'), 'available_tools');
  assert.equal(sectionKey('工具參考'), 'available_tools');
});
test('sectionKey: "Tools Reference" / "工具一覽" → available_tools', () => {
  assert.equal(sectionKey('Tools Reference'), 'available_tools');
  assert.equal(sectionKey('工具一覽'), 'available_tools');
});
test('sectionKey: "工具清單" / "工具列表" → available_tools', () => {
  assert.equal(sectionKey('工具清單'), 'available_tools');
  assert.equal(sectionKey('工具列表'), 'available_tools');
});
test('sectionKey: "工具清單 (143 個)" / "工具列表 (27 個)" → available_tools', () => {
  assert.equal(sectionKey('工具清單 (143 個)'), 'available_tools');
  assert.equal(sectionKey('工具列表 (27 個)'), 'available_tools');
});
test('sectionKey: "可用工具 (143)" → available_tools', () => {
  assert.equal(sectionKey('可用工具 (143)'), 'available_tools');
});
test('sectionKey: "Tool 列表共 4 個" (mixed-language) → available_tools', () => {
  assert.equal(sectionKey('Tool 列表共 4 個'), 'available_tools');
});
test('sectionKey: "Toolkit" does NOT match available_tools (boundary check)', () => {
  assert.notEqual(sectionKey('Toolkit'), 'available_tools');
});

// Short-form zh aliases
test('sectionKey: "特色" → features', () => {
  assert.equal(sectionKey('特色'), 'features');
});
test('sectionKey: "Usage" / "使用方式" → usage', () => {
  assert.equal(sectionKey('Usage'), 'usage');
  assert.equal(sectionKey('使用方式'), 'usage');
});
test('sectionKey: "Testing" / "測試" → testing', () => {
  assert.equal(sectionKey('Testing'), 'testing');
  assert.equal(sectionKey('測試'), 'testing');
});
test('sectionKey: "Architecture" / "架構" → architecture', () => {
  assert.equal(sectionKey('Architecture'), 'architecture');
  assert.equal(sectionKey('架構'), 'architecture');
});
test('sectionKey: "Data Source" / "資料來源" → data_source', () => {
  assert.equal(sectionKey('Data Source'), 'data_source');
  assert.equal(sectionKey('Data Sources'), 'data_source');
  assert.equal(sectionKey('資料來源'), 'data_source');
});
test('sectionKey: "Part of the Asgard Ecosystem" / "Asgard 生態系" → part_of_the_asgard_ecosystem', () => {
  assert.equal(sectionKey('Part of the Asgard Ecosystem'), 'part_of_the_asgard_ecosystem');
  assert.equal(sectionKey('Asgard 生態系'), 'part_of_the_asgard_ecosystem');
});
test('sectionKey: "Prerequisites" / "前置條件" / "前置需求" → prerequisites', () => {
  assert.equal(sectionKey('Prerequisites'), 'prerequisites');
  assert.equal(sectionKey('前置條件'), 'prerequisites');
  assert.equal(sectionKey('前置需求'), 'prerequisites');
});
test('sectionKey: "Requirements" / "環境需求" → requirements', () => {
  assert.equal(sectionKey('Requirements'), 'requirements');
  assert.equal(sectionKey('環境需求'), 'requirements');
});
test('sectionKey: "Overview" / "概述" → overview', () => {
  assert.equal(sectionKey('Overview'), 'overview');
  assert.equal(sectionKey('概述'), 'overview');
});
test('sectionKey: "Categories" / "資料分類" → categories', () => {
  assert.equal(sectionKey('Categories'), 'categories');
  assert.equal(sectionKey('資料分類'), 'categories');
});
test('sectionKey: "Roadmap" / "開發計畫" → roadmap', () => {
  assert.equal(sectionKey('開發計畫'), 'roadmap');
});
test('sectionKey: "Example Usage" / "使用範例" → usage_examples', () => {
  assert.equal(sectionKey('Example Usage'), 'usage_examples');
  assert.equal(sectionKey('使用範例'), 'usage_examples');
});

// ── Task 4.5b: additional translation pairs ──
test('sectionKey: "Prerequisites" / "先決條件" → prerequisites', () => {
  assert.equal(sectionKey('Prerequisites'), 'prerequisites');
  assert.equal(sectionKey('先決條件'), 'prerequisites');
});
test('sectionKey: "Error Codes Reference" / "錯誤代碼參考" → error_codes_reference', () => {
  assert.equal(sectionKey('Error Codes Reference'), 'error_codes_reference');
  assert.equal(sectionKey('錯誤代碼參考'), 'error_codes_reference');
});
test('sectionKey: "Item Code Reference" / "品項代碼參考" → itemcode_reference', () => {
  assert.equal(sectionKey('Item Code Reference'), 'itemcode_reference');
  assert.equal(sectionKey('ItemCode Reference'), 'itemcode_reference');
  assert.equal(sectionKey('品項代碼參考'), 'itemcode_reference');
});
test('sectionKey: "Publishing to PyPI" / "發布至 PyPI" → publishing_to_pypi', () => {
  assert.equal(sectionKey('Publishing to PyPI'), 'publishing_to_pypi');
  assert.equal(sectionKey('發布至 PyPI'), 'publishing_to_pypi');
});
