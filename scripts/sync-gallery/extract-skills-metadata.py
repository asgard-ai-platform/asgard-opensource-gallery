#!/usr/bin/env python3
"""
extract-skills-metadata.py
從 skills repo 的 SKILL.md 前置資料中提取 metadata，輸出 JSON 供後續產生 YAML。

用法:
  1. git clone --depth 1 https://github.com/asgard-ai-platform/skills.git /tmp/skills-repo
  2. python3 reference/extract-skills-metadata.py /tmp/skills-repo
  3. 產出 /tmp/skills-data.json
"""
import os
import sys
import yaml
import re
import json

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SKIP_DIRS = {".claude", "tools", "eval", ".git", ".github"}

PREFIX_SKILL_TYPE = {
    "algo": "algorithm", "biz": "methodology", "cs": "industry",
    "data": "methodology", "ecom": "industry", "econ": "theory",
    "fin": "industry", "grad": "theory", "hum": "theory",
    "law": "industry", "meta": "methodology", "mfg": "industry",
    "mkt": "industry", "ops": "methodology", "pr": "industry",
    "soc": "theory", "stat": "methodology", "tech": "methodology",
    "tw": "industry", "ux": "methodology", "xborder": "industry",
}

PREFIX_CATEGORY = {
    "algo": "algorithm", "biz": "methodology", "cs": "customer-service",
    "data": "analytics", "ecom": "ecommerce", "econ": "theory",
    "fin": "finance", "grad": "theory", "hum": "theory",
    "law": "theory", "meta": "methodology", "mfg": "manufacturing",
    "mkt": "marketing", "ops": "ops", "pr": "media",
    "soc": "theory", "stat": "analytics", "tech": "methodology",
    "tw": "data", "ux": "methodology", "xborder": "ecommerce",
}

ACRONYMS = {
    "ai", "api", "ab", "bm25", "cpk", "doe", "fmea", "spc", "cf", "mf",
    "elo", "var", "eoq", "lda", "ner", "gsp", "vcg", "ctr", "seo", "ux",
    "dcf", "bsc", "stp", "toc", "4p", "7p", "cac", "ltv", "okr", "swot",
    "capm", "sem", "pls", "hlm", "did", "tam", "utaut", "tpack", "tpb",
    "emh", "elm", "ant", "cas", "cct", "sdt", "rbv", "kbv",
    "tce", "oli", "irac", "gdpr", "pdpa", "oee", "tpm", "eda", "sql",
    "rfm", "nps", "csat", "sla", "kpi", "roi", "raci", "pdca", "dmaic",
    "smed", "pestel", "pestle", "pca", "tsne", "umap", "svm", "knn",
    "xgboost", "bert", "lstm", "garch", "arima", "dbscan",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def slug_to_name(slug: str) -> str:
    """algo-ad-bidding → Ad Bidding"""
    prefix = slug.split("-")[0]
    rest = slug[len(prefix) + 1:]
    words = rest.split("-")
    return " ".join(w.upper() if w.lower() in ACRONYMS else w.capitalize() for w in words)


def parse_frontmatter(path: str) -> dict | None:
    try:
        with open(path) as f:
            content = f.read()
        m = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
        return yaml.safe_load(m.group(1)) if m else None
    except Exception:
        return None


def get_h1(path: str) -> str | None:
    try:
        with open(path) as f:
            content = f.read()
        m = re.search(r"^# (.+)$", content, re.MULTILINE)
        return m.group(1).strip() if m else None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    skills_dir = sys.argv[1] if len(sys.argv) > 1 else "/tmp/skills-repo"
    output_path = sys.argv[2] if len(sys.argv) > 2 else "/tmp/skills-data.json"

    if not os.path.isdir(skills_dir):
        print(f"Error: {skills_dir} not found. Clone the skills repo first:")
        print(f"  git clone --depth 1 https://github.com/asgard-ai-platform/skills.git {skills_dir}")
        sys.exit(1)

    results = []
    for d in sorted(os.listdir(skills_dir)):
        if d in SKIP_DIRS or not os.path.isdir(os.path.join(skills_dir, d)):
            continue
        skill_md = os.path.join(skills_dir, d, "SKILL.md")
        if not os.path.exists(skill_md):
            continue

        meta = parse_frontmatter(skill_md)
        h1 = get_h1(skill_md)
        prefix = d.split("-")[0]
        has_script = os.path.isdir(os.path.join(skills_dir, d, "scripts"))

        results.append({
            "slug": d,
            "name": h1 or slug_to_name(d),
            "description_en": meta.get("description", "") if meta else "",
            "skill_type": PREFIX_SKILL_TYPE.get(prefix, "methodology"),
            "category": PREFIX_CATEGORY.get(prefix, "methodology"),
            "tags": meta.get("metadata", {}).get("tags", []) if meta else [],
            "wp_category": meta.get("metadata", {}).get("category", "") if meta else "",
            "has_script": has_script,
            "prefix": prefix,
        })

    # --- Report ---
    prefixes: dict[str, int] = {}
    for r in results:
        prefixes[r["prefix"]] = prefixes.get(r["prefix"], 0) + 1

    print(f"Total skills: {len(results)}")
    print(f"\nPrefix counts:")
    for p, c in sorted(prefixes.items(), key=lambda x: -x[1]):
        print(f"  {p}: {c}")
    print(f"\nSkills with scripts: {sum(1 for r in results if r['has_script'])}")

    with open(output_path, "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\nSaved → {output_path}")


if __name__ == "__main__":
    main()
