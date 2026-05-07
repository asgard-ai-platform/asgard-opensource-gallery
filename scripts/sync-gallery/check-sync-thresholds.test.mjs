import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateThresholds } from './check-sync-thresholds.mjs';

test('passes at 100 percent coverage', () => {
  const r = evaluateThresholds({
    expectedMcps: ['a', 'b', 'c'],
    actualMcpKeys: ['a', 'b', 'c'],
    expectedSkills: ['x', 'y'],
    actualSkillKeys: ['skill-x', 'skill-y'],
    floor: 0.8,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.failures, []);
});

test('passes at exactly the floor', () => {
  const r = evaluateThresholds({
    expectedMcps: ['a', 'b', 'c', 'd', 'e'],
    actualMcpKeys: ['a', 'b', 'c', 'd'], // 80%
    expectedSkills: ['x'],
    actualSkillKeys: ['skill-x'],
    floor: 0.8,
  });
  assert.equal(r.ok, true);
});

test('fails when MCP coverage is below floor', () => {
  const r = evaluateThresholds({
    expectedMcps: ['a', 'b', 'c', 'd', 'e'],
    actualMcpKeys: ['a', 'b'], // 40%
    expectedSkills: ['x'],
    actualSkillKeys: ['skill-x'],
    floor: 0.8,
  });
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /mcp-content\.json: 2 of 5/);
});

test('fails when skill coverage is below floor', () => {
  const r = evaluateThresholds({
    expectedMcps: ['a'],
    actualMcpKeys: ['a'],
    expectedSkills: ['x', 'y', 'z', 'w', 'v'],
    actualSkillKeys: ['skill-x'], // 20%
    floor: 0.8,
  });
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /skill-content\.json: 1 of 5/);
});

test('zero expected items is a vacuous pass', () => {
  const r = evaluateThresholds({
    expectedMcps: [],
    actualMcpKeys: [],
    expectedSkills: [],
    actualSkillKeys: [],
    floor: 0.8,
  });
  assert.equal(r.ok, true);
});
