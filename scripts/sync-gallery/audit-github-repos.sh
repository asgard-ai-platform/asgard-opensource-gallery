#!/usr/bin/env bash
# audit-github-repos.sh — Compare GitHub repos vs YAML data
# Checks: repo existence, status, tools_count from README, skills count
set -euo pipefail

ORG="asgard-ai-platform"
DATA_DIR="$(cd "$(dirname "$0")/../.." && pwd)/data"

echo "============================================================"
echo " Yggdrasil Gallery — GitHub Audit"
echo "============================================================"
echo ""

# ── 1. MCP Repos ────────────────────────────────────────────────
echo "[1/5] Fetching MCP repos from GitHub org: $ORG ..."
PUBLIC_REPOS=$(gh repo list "$ORG" --limit 200 --json name,isPrivate \
  --jq '.[] | select(.name | startswith("mcp-")) | select(.isPrivate == false) | select(.name != "mcp-template") | .name' | sort)
PRIVATE_REPOS=$(gh repo list "$ORG" --limit 200 --json name,isPrivate \
  --jq '.[] | select(.name | startswith("mcp-")) | select(.isPrivate == true) | select(.name != "mcp-template") | .name' | sort)

PUBLIC_COUNT=$(echo "$PUBLIC_REPOS" | grep -c . || true)
PRIVATE_COUNT=$(echo "$PRIVATE_REPOS" | grep -c . || true)
echo "  Public MCP repos:  $PUBLIC_COUNT"
echo "  Private MCP repos: $PRIVATE_COUNT"
echo ""

# ── 2. YAML status check ────────────────────────────────────────
echo "[2/5] Cross-referencing MCP YAML ..."
YAML_SLUGS=$(python3 -c "
import yaml
with open('$DATA_DIR/mcp-servers.yaml') as f:
    data = yaml.safe_load(f)
for s in data['servers']:
    print(s['slug'], s['status'], s.get('tools_count', ''))
")

YAML_TOTAL=$(echo "$YAML_SLUGS" | wc -l | tr -d ' ')
YAML_RELEASED=$(echo "$YAML_SLUGS" | grep -c 'released' || true)
echo "  YAML entries: $YAML_TOTAL total, $YAML_RELEASED released"

# Check public repos not marked released
ISSUES=0
while IFS= read -r repo; do
  STATUS=$(echo "$YAML_SLUGS" | grep "^$repo " | awk '{print $2}')
  if [ -z "$STATUS" ]; then
    echo "  ⚠️  PUBLIC repo $repo is NOT in YAML (should add)"
    ISSUES=$((ISSUES + 1))
  elif [ "$STATUS" != "released" ]; then
    echo "  ⚠️  PUBLIC repo $repo is in YAML but status=$STATUS (should be released)"
    ISSUES=$((ISSUES + 1))
  fi
done <<< "$PUBLIC_REPOS"

if [ $ISSUES -eq 0 ]; then
  echo "  ✅ All public repos correctly marked as released"
fi
echo ""

# ── 3. Tools count from README ───────────────────────────────────
echo "[3/5] Checking tools_count from READMEs ..."
TOOLS_ISSUES=0
while IFS= read -r repo; do
  YAML_LINE=$(echo "$YAML_SLUGS" | grep "^$repo ")
  YAML_TC=$(echo "$YAML_LINE" | awk '{print $3}')

  # Fetch README and extract tools count
  README=$(gh api "repos/$ORG/$repo/contents/README.md" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null || echo "")
  if [ -z "$README" ]; then
    echo "  ⚠️  $repo: cannot fetch README"
    continue
  fi

  # Try multiple patterns to extract tools count
  # Pattern 1: "N AI-callable tools"
  README_TC=$(echo "$README" | grep -oE '[0-9]+ AI-callable tools' | head -1 | grep -oE '[0-9]+' || true)
  # Pattern 2: "N tools" in feature bullet
  if [ -z "$README_TC" ]; then
    README_TC=$(echo "$README" | grep -oE '\*\*[0-9]+ [a-zA-Z-]* ?tools\*\*' | head -1 | grep -oE '[0-9]+' || true)
  fi
  # Pattern 3: "N MCP tools"
  if [ -z "$README_TC" ]; then
    README_TC=$(echo "$README" | grep -oE '[0-9]+ MCP tools' | head -1 | grep -oE '[0-9]+' || true)
  fi
  # Pattern 4: count tool rows in "Available Tools" table (| `tool_name` |)
  if [ -z "$README_TC" ]; then
    TOOLS_SECTION=$(echo "$README" | sed -n '/## Available Tools/,/^## /p')
    if [ -n "$TOOLS_SECTION" ]; then
      README_TC=$(echo "$TOOLS_SECTION" | grep -cE '^\| `[a-z]+_[a-z_]+`' || true)
      [ "$README_TC" -eq 0 ] && README_TC=""
    fi
  fi

  if [ -z "$README_TC" ]; then
    echo "  ℹ️  $repo: could not parse tools count from README (YAML=$YAML_TC)"
  elif [ "$README_TC" != "$YAML_TC" ]; then
    echo "  ⚠️  $repo: tools_count mismatch — README=$README_TC, YAML=$YAML_TC"
    TOOLS_ISSUES=$((TOOLS_ISSUES + 1))
  else
    echo "  ✅ $repo: tools_count=$YAML_TC matches"
  fi
done <<< "$PUBLIC_REPOS"

if [ $TOOLS_ISSUES -eq 0 ]; then
  echo "  ✅ All tools_count values match"
fi
echo ""

# ── 4. Skills repo ───────────────────────────────────────────────
echo "[4/5] Auditing skills repo ..."
SKILL_DIRS=$(gh api "repos/$ORG/skills/git/trees/main" \
  --jq '[.tree[] | select(.type == "tree") | .path | select(test("^[a-z]"))] | length')
SKILL_YAML=$(python3 -c "
import yaml
with open('$DATA_DIR/skills.yaml') as f:
    data = yaml.safe_load(f)
print(len(data['skills']))
")

echo "  Skills repo directories: $SKILL_DIRS"
echo "  Skills YAML entries:     $SKILL_YAML"

if [ "$SKILL_DIRS" = "$SKILL_YAML" ]; then
  echo "  ✅ Counts match"
else
  echo "  ⚠️  Count mismatch! Checking diff..."
  # Get all skill dirs from GitHub
  gh api "repos/$ORG/skills/git/trees/main" \
    --jq '.tree[] | select(.type == "tree") | .path | select(test("^[a-z]"))' | sort > /tmp/gh-skill-dirs.txt

  # Get all skill slugs from YAML (strip skill- prefix)
  python3 -c "
import yaml
with open('$DATA_DIR/skills.yaml') as f:
    data = yaml.safe_load(f)
for s in sorted(data['skills'], key=lambda x: x['slug']):
    print(s['slug'].removeprefix('skill-'))
" | sort > /tmp/yaml-skill-dirs.txt

  NEW=$(comm -23 /tmp/gh-skill-dirs.txt /tmp/yaml-skill-dirs.txt)
  REMOVED=$(comm -13 /tmp/gh-skill-dirs.txt /tmp/yaml-skill-dirs.txt)

  if [ -n "$NEW" ]; then
    echo "  New skills in GitHub (not in YAML):"
    echo "$NEW" | sed 's/^/    + /'
  fi
  if [ -n "$REMOVED" ]; then
    echo "  In YAML but not in GitHub:"
    echo "$REMOVED" | sed 's/^/    - /'
  fi
fi
echo ""

# ── 5. Skills metadata check ────────────────────────────────────
echo "[5/5] Checking skills metadata (SKILL.md) for changes ..."
# Clone skills repo shallowly to check SKILL.md frontmatter
SKILLS_TMPDIR=$(mktemp -d)
echo "  Cloning skills repo (shallow) ..."
git clone --depth 1 --quiet "https://github.com/$ORG/skills.git" "$SKILLS_TMPDIR" 2>/dev/null

SKILL_META_ISSUES=0
python3 - "$SKILLS_TMPDIR" "$DATA_DIR/skills.yaml" <<'PYEOF'
import sys, os, re, yaml

skills_dir = sys.argv[1]
yaml_path = sys.argv[2]

with open(yaml_path) as f:
    data = yaml.safe_load(f)

yaml_skills = {}
for s in data['skills']:
    dir_name = s['slug'].removeprefix('skill-')
    yaml_skills[dir_name] = s

issues = 0

# Check each skill directory
for entry in sorted(os.listdir(skills_dir)):
    skill_path = os.path.join(skills_dir, entry)
    if not os.path.isdir(skill_path) or entry.startswith('.') or entry in ('eval', 'tools'):
        continue

    skill_md = os.path.join(skill_path, 'SKILL.md')
    if not os.path.exists(skill_md):
        continue

    with open(skill_md, 'r', encoding='utf-8') as f:
        content = f.read()

    # Parse frontmatter
    fm_match = re.match(r'^---\s*\n(.*?)\n---', content, re.DOTALL)
    if not fm_match:
        continue

    try:
        fm = yaml.safe_load(fm_match.group(1))
    except:
        continue

    # Extract name from H1
    body = content[fm_match.end():]
    h1_match = re.search(r'^#\s+(.+)$', body, re.MULTILINE)
    repo_name = h1_match.group(1).strip() if h1_match else entry

    # Check has_script
    has_script = os.path.isdir(os.path.join(skill_path, 'scripts'))

    # Compare with YAML
    yaml_entry = yaml_skills.get(entry)
    if not yaml_entry:
        print(f"  ⚠️  {entry}: in skills repo but NOT in YAML")
        issues += 1
        continue

    # Check name mismatch
    if yaml_entry['name']['en'] != repo_name:
        print(f"  ⚠️  {entry}: name mismatch — repo='{repo_name}', yaml='{yaml_entry['name']['en']}'")
        issues += 1

    # Check has_script mismatch
    yaml_has_script = yaml_entry.get('has_script', False)
    if has_script != yaml_has_script:
        print(f"  ⚠️  {entry}: has_script mismatch — repo={has_script}, yaml={yaml_has_script}")
        issues += 1

    # Check description from frontmatter
    fm_desc = fm.get('description', '')
    if isinstance(fm_desc, str) and fm_desc:
        yaml_desc = yaml_entry['description']['en']
        # Only flag if descriptions are completely different (first 50 chars)
        if fm_desc[:50] != yaml_desc[:50]:
            print(f"  ℹ️  {entry}: description may have changed (check manually)")

if issues == 0:
    print("  ✅ All skills metadata matches")

sys.exit(0)
PYEOF

# Cleanup
rm -rf "$SKILLS_TMPDIR"
echo ""

echo "============================================================"
echo " Audit complete"
echo "============================================================"
