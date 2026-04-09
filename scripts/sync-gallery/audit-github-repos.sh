#!/usr/bin/env bash
# ============================================================
# audit-github-repos.sh
# 比對 GitHub org 上的 MCP/Skills repo 與 YAML 資料的差異
#
# 用法:
#   ./reference/audit-github-repos.sh
#
# 需求: gh CLI (已登入), yq 或 python3+pyyaml
# ============================================================
set -euo pipefail

ORG="asgard-ai-platform"
DATA_DIR="data"

echo "========================================"
echo " Asgard GitHub ↔ YAML Audit"
echo "========================================"

# --- 1. 取得 GitHub org 上所有 MCP repo ---
echo -e "\n[1/4] Fetching MCP repos from GitHub org: $ORG ..."
gh repo list "$ORG" --limit 200 --json name,isPrivate \
  --jq '.[] | select(.name | startswith("mcp-")) | select(.name != "mcp-template") | "\(.name)\t\(if .isPrivate then "private" else "public" end)"' \
  | sort > /tmp/github-mcp-repos.tsv

PUBLIC_REPOS=$(grep 'public' /tmp/github-mcp-repos.tsv | cut -f1)
PRIVATE_REPOS=$(grep 'private' /tmp/github-mcp-repos.tsv | cut -f1)

echo "  Public MCP repos:  $(echo "$PUBLIC_REPOS" | wc -l | tr -d ' ')"
echo "  Private MCP repos: $(echo "$PRIVATE_REPOS" | wc -l | tr -d ' ')"

echo -e "\n  Public repos:"
echo "$PUBLIC_REPOS" | sed 's/^/    ✅ /'
echo -e "\n  Private repos:"
echo "$PRIVATE_REPOS" | sed 's/^/    🔒 /'

# --- 2. 取得 YAML 中的 MCP slugs ---
echo -e "\n[2/4] Reading MCP slugs from $DATA_DIR/mcp-servers.yaml ..."
YAML_MCP_SLUGS=$(grep '  - slug:' "$DATA_DIR/mcp-servers.yaml" | sed 's/.*slug: //' | sort)
YAML_MCP_COUNT=$(echo "$YAML_MCP_SLUGS" | wc -l | tr -d ' ')
echo "  YAML MCP entries: $YAML_MCP_COUNT"

# --- 3. 比對差異 ---
echo -e "\n[3/4] Cross-referencing..."

echo -e "\n  Public repos MISSING from YAML (should add):"
MISSING=0
for repo in $PUBLIC_REPOS; do
  if ! echo "$YAML_MCP_SLUGS" | grep -q "^${repo}$"; then
    echo "    ➕ $repo"
    MISSING=$((MISSING + 1))
  fi
done
[ "$MISSING" -eq 0 ] && echo "    (none)"

echo -e "\n  Public repos IN YAML but wrong status (should be released):"
WRONG_STATUS=0
for repo in $PUBLIC_REPOS; do
  if echo "$YAML_MCP_SLUGS" | grep -q "^${repo}$"; then
    STATUS=$(python3 -c "
import yaml
data = yaml.safe_load(open('$DATA_DIR/mcp-servers.yaml'))
for s in data['servers']:
    if s['slug'] == '$repo':
        print(s['status'])
        break
")
    if [ "$STATUS" != "released" ]; then
      echo "    ⚠️  $repo (currently: $STATUS)"
      WRONG_STATUS=$((WRONG_STATUS + 1))
    fi
  fi
done
[ "$WRONG_STATUS" -eq 0 ] && echo "    (none - all correct)"

echo -e "\n  YAML entries with NO repo on GitHub:"
NO_REPO=0
ALL_GITHUB_REPOS=$(cut -f1 /tmp/github-mcp-repos.tsv)
for slug in $YAML_MCP_SLUGS; do
  if ! echo "$ALL_GITHUB_REPOS" | grep -q "^${slug}$"; then
    NO_REPO=$((NO_REPO + 1))
  fi
done
echo "    $NO_REPO entries have no corresponding GitHub repo (planned/aspirational)"

# --- 4. Skills repo audit ---
echo -e "\n[4/4] Auditing skills repo..."
SKILLS_REPO_COUNT=$(gh api "repos/$ORG/skills/git/trees/main" \
  --jq '[.tree[] | select(.type == "tree") | select(.path != ".claude" and .path != "tools" and .path != "eval") | .path] | length')
YAML_SKILL_COUNT=$(grep '  - slug:' "$DATA_DIR/skills.yaml" | wc -l | tr -d ' ')

echo "  Skills repo directories: $SKILLS_REPO_COUNT"
echo "  Skills YAML entries:     $YAML_SKILL_COUNT"

if [ "$SKILLS_REPO_COUNT" -ne "$YAML_SKILL_COUNT" ]; then
  echo "  ⚠️  MISMATCH — run extract + generate scripts to reconcile"
else
  echo "  ✅ Counts match"
fi

# --- Summary ---
echo -e "\n========================================"
echo " Summary"
echo "========================================"
echo "  MCP: $YAML_MCP_COUNT YAML entries, $(echo "$PUBLIC_REPOS" | wc -l | tr -d ' ') public repos"
echo "  Skills: $YAML_SKILL_COUNT YAML entries, $SKILLS_REPO_COUNT repo dirs"
echo "  Missing from YAML: $MISSING"
echo "  Wrong status: $WRONG_STATUS"
echo "  No GitHub repo: $NO_REPO"

rm -f /tmp/github-mcp-repos.tsv
