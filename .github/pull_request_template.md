## Listing Request / 上架申請

**Project Type / 專案類型:** MCP Server / SKILL

**GitHub Repository URL:**
<!-- Link to your public repo -->

**Checklist / 檢查清單:**
- [ ] Repository is public with an open-source license (MIT, Apache 2.0, etc.)
- [ ] README includes setup instructions and usage examples
- [ ] YAML entry added to `data/mcp-servers.yaml` or `data/skills.yaml`
- [ ] `slug` follows naming convention (`mcp-{service}` or `skill-{domain}-{task}`)
- [ ] `name` includes both `en` and `zh` fields
- [ ] `description` includes both `en` and `zh` fields
- [ ] `maintainer` is set to your GitHub org or handle
- [ ] Ran `npm run validate` locally and all checks passed

**YAML Entry Preview:**
<!-- Paste the YAML entry you added below -->
```yaml

```

---

### YAML Templates / 模板

<details>
<summary>MCP Server Template</summary>

```yaml
- slug: mcp-your-service
  name:
    en: "Your Service"
    zh: "你的服務名稱"
  description:
    en: "MCP Server for Your Service, enabling ... through AI agents."
    zh: "Your Service MCP Server，支援透過 AI 代理進行..."
  status: released
  category: ecommerce
  region: global
  github: https://github.com/your-org/mcp-your-service
  tools_count: 5
  tags: [your, tags]
  maintainer: your-github-handle
```
</details>

<details>
<summary>SKILL Template</summary>

```yaml
- slug: skill-your-domain-task
  name:
    en: "Your SKILL Name"
    zh: "你的技能名稱"
  description:
    en: "What this SKILL does."
    zh: "這個技能做什麼。"
  status: released
  category: methodology
  skill_type: methodology
  region: global
  github: https://github.com/your-org/skills/tree/main/your-skill
  tags: [your, tags]
  maintainer: your-github-handle
```
</details>
