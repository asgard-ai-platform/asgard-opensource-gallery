#!/usr/bin/env python3
"""
generate-skills-yaml.py
讀取 extract-skills-metadata.py 產出的 JSON，產生完整 skills.yaml。

用法:
  python3 reference/generate-skills-yaml.py /tmp/skills-data.json data/skills.yaml

完整流程:
  1. git clone --depth 1 https://github.com/asgard-ai-platform/skills.git /tmp/skills-repo
  2. python3 reference/extract-skills-metadata.py /tmp/skills-repo /tmp/skills-data.json
  3. python3 reference/generate-skills-yaml.py /tmp/skills-data.json data/skills.yaml
"""
import json
import re
import sys

# ---------------------------------------------------------------------------
# Mappings (與 gallery schema 對齊)
# ---------------------------------------------------------------------------
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
PREFIX_REGION = {"tw": "taiwan"}
PREFIX_SECTION = {
    "ecom": "E-Commerce Industry Skills",
    "fin": "Finance Industry Skills",
    "mfg": "Manufacturing Industry Skills",
    "cs": "Customer Service Industry Skills",
    "pr": "PR & Media Industry Skills",
    "mkt": "Marketing Industry Skills",
    "tw": "Taiwan-Specific Industry Skills",
    "xborder": "Cross-Border Industry Skills",
    "biz": "Business Methodology Skills",
    "data": "Data & Analytics Methodology Skills",
    "meta": "Meta / Thinking Framework Skills",
    "ops": "Operations Methodology Skills",
    "stat": "Statistics Methodology Skills",
    "tech": "Technology Methodology Skills",
    "ux": "UX Methodology Skills",
    "econ": "Economics Theory Skills",
    "grad": "Graduate Research Theory Skills",
    "hum": "Humanities Theory Skills",
    "law": "Legal Theory Skills",
    "soc": "Social Science Theory Skills",
    "algo": "Algorithm Skills",
}
PREFIX_ORDER = [
    "ecom", "fin", "mfg", "cs", "pr", "mkt", "tw", "xborder",
    "biz", "data", "meta", "ops", "stat", "tech", "ux",
    "econ", "grad", "hum", "law", "soc",
    "algo",
]
ZH_PREFIX = {
    "ecom": "電商", "fin": "金融", "mfg": "製造", "cs": "客服",
    "pr": "公關媒體", "mkt": "行銷", "tw": "台灣產業", "xborder": "跨境電商",
    "biz": "商業方法論", "data": "數據分析", "meta": "思維框架", "ops": "營運方法論",
    "stat": "統計方法論", "tech": "技術方法論", "ux": "使用者體驗",
    "econ": "經濟學", "grad": "學術研究", "hum": "人文",
    "law": "法律", "soc": "社會科學", "algo": "演算法",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def truncate_desc(desc: str, max_len: int = 200) -> str:
    if not desc:
        return ""
    m = re.match(r"^([^.!?]+[.!?])", desc)
    if m and len(m.group(1)) <= max_len:
        return m.group(1).strip()
    if len(desc) <= max_len:
        return desc.strip()
    return desc[:max_len].rsplit(" ", 1)[0].strip() + "."


def escape_yaml(s: str) -> str:
    return s.replace('"', '\\"')


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    input_path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/skills-data.json"
    output_path = sys.argv[2] if len(sys.argv) > 2 else "data/skills.yaml"

    with open(input_path) as f:
        skills = json.load(f)

    lines = ["skills:"]

    for prefix in PREFIX_ORDER:
        group = [s for s in skills if s["prefix"] == prefix]
        if not group:
            continue

        section = PREFIX_SECTION.get(prefix, prefix)
        lines.append("  # ============================================================")
        lines.append(f"  # {section} ({len(group)})")
        lines.append("  # ============================================================")

        for s in group:
            slug = f"skill-{s['slug']}"
            name = s["name"]
            desc_en = truncate_desc(s["description_en"])
            zh_cat = ZH_PREFIX.get(prefix, "技能")
            desc_zh = f"{zh_cat}技能：{name} 分析與應用。"

            skill_type = PREFIX_SKILL_TYPE.get(prefix, "methodology")
            category = PREFIX_CATEGORY.get(prefix, "methodology")
            region = PREFIX_REGION.get(prefix, "global")

            tags_str = ", ".join(s["tags"][:4]) if s["tags"] else prefix
            github_url = f"https://github.com/asgard-ai-platform/skills/tree/main/{s['slug']}"

            lines.append(f"  - slug: {slug}")
            lines.append(f'    name: "{escape_yaml(name)}"')
            lines.append(f"    description:")
            lines.append(f'      en: "{escape_yaml(desc_en)}"')
            lines.append(f'      zh: "{escape_yaml(desc_zh)}"')
            lines.append(f"    status: released")
            lines.append(f"    category: {category}")
            lines.append(f"    skill_type: {skill_type}")
            lines.append(f"    region: {region}")
            lines.append(f"    github: {github_url}")
            lines.append(f"    tags: [{tags_str}]")
            if s["has_script"]:
                lines.append(f"    has_script: true")
            lines.append(f"    maintainer: asgard-ai-platform")
            lines.append("")

    output = "\n".join(lines)
    with open(output_path, "w") as f:
        f.write(output)

    print(f"Generated {len(skills)} skill entries → {output_path}")


if __name__ == "__main__":
    main()
