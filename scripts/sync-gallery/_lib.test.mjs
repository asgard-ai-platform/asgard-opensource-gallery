import test from 'node:test';
import assert from 'node:assert/strict';
import { ghFetchFile, ghJSON, decodeBase64Content } from './_lib.mjs';

test('decodeBase64Content decodes base64 to utf-8', () => {
  assert.equal(decodeBase64Content('aGVsbG8='), 'hello');
});

test('decodeBase64Content tolerates whitespace in input', () => {
  assert.equal(decodeBase64Content('aGVs\nbG8='), 'hello');
});

test('exports ghFetchFile and ghJSON functions', () => {
  assert.equal(typeof ghFetchFile, 'function');
  assert.equal(typeof ghJSON, 'function');
});
