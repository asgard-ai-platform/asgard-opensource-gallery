import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const SCHEMA_DIR = path.join(ROOT, 'schemas');

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

let errors = 0;

function fail(msg) {
  console.error(`  ❌ ${msg}`);
  errors++;
}

function pass(msg) {
  console.log(`  ✅ ${msg}`);
}

function loadYaml(file) {
  const content = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8');
  return yaml.load(content);
}

function loadSchema(file) {
  const content = fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf-8');
  return JSON.parse(content);
}

function validateSchema(data, schemaFile, label) {
  const schema = loadSchema(schemaFile);
  const validate = ajv.compile(schema);
  if (validate(data)) {
    pass(`${label}: schema valid`);
  } else {
    for (const err of validate.errors) {
      fail(`${label}: ${err.instancePath} ${err.message}`);
    }
  }
}

function validateUniqueSlugs(items, label) {
  const slugs = new Set();
  let hasDupes = false;
  for (const item of items) {
    if (slugs.has(item.slug)) {
      fail(`${label}: duplicate slug "${item.slug}"`);
      hasDupes = true;
    }
    slugs.add(item.slug);
  }
  if (!hasDupes) pass(`${label}: all slugs unique`);
}

function validateRefs(items, validSlugs, field, label) {
  for (const item of items) {
    const refs = item[field] || [];
    for (const ref of refs) {
      if (!validSlugs.has(ref)) {
        fail(`${label}: ${item.slug}.${field} references unknown slug "${ref}"`);
      }
    }
  }
}

function validateIcons(items, label) {
  for (const item of items) {
    if (item.icon) {
      const iconPath = path.join(ROOT, 'public', 'icons', item.icon);
      if (!fs.existsSync(iconPath)) {
        fail(`${label}: ${item.slug} references icon "${item.icon}" but file not found at public/icons/${item.icon}`);
      }
    }
  }
}

// --- Main ---
console.log('Validating YAML data...\n');

const mcpData = loadYaml('mcp-servers.yaml');
const skillData = loadYaml('skills.yaml');
const pluginData = loadYaml('plugins.yaml');

console.log('Schema validation:');
validateSchema(mcpData, 'mcp-server.schema.json', 'mcp-servers');
validateSchema(skillData, 'skill.schema.json', 'skills');
validateSchema(pluginData, 'plugin.schema.json', 'plugins');

console.log('\nSlug uniqueness:');
validateUniqueSlugs(mcpData.servers, 'mcp-servers');
validateUniqueSlugs(skillData.skills, 'skills');
validateUniqueSlugs(pluginData.plugins, 'plugins');

const mcpSlugs = new Set(mcpData.servers.map((s) => s.slug));
const skillSlugs = new Set(skillData.skills.map((s) => s.slug));
const pluginSlugs = new Set(pluginData.plugins.map((p) => p.slug));

console.log('\nCross-references:');
validateRefs(mcpData.servers, pluginSlugs, 'plugins', 'mcp-servers');
validateRefs(skillData.skills, mcpSlugs, 'requires_mcp', 'skills');
validateRefs(skillData.skills, pluginSlugs, 'plugins', 'skills');
validateRefs(pluginData.plugins, mcpSlugs, 'mcp_servers', 'plugins');
validateRefs(pluginData.plugins, skillSlugs, 'skills', 'plugins');
if (errors === 0) pass('all cross-references valid');

console.log('\nIcon files:');
validateIcons(mcpData.servers, 'mcp-servers');
validateIcons(skillData.skills, 'skills');
validateIcons(pluginData.plugins, 'plugins');
if (errors === 0) pass('all icons valid (or none referenced)');

console.log(`\n${errors === 0 ? '✅ All checks passed!' : `❌ ${errors} error(s) found.`}`);
process.exit(errors > 0 ? 1 : 0);
