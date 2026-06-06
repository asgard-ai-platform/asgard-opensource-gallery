# Installable Packs — Slice 4 Implementation Plan (emba onboarding)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Onboard `emba-famulus` as the gallery's second installable pack — the simplest end-to-end validation (skills-only, no setup, 0 MCP) — by adding its 13 skills to the catalogue and the pack entry, then surfacing the install/use-case experience from the committed sidecars.

**Architecture:** Three coordinated, **prereq-first** changes across three repos. **(PR-1)** upstream emba's 13 `SKILL.md` (with their `examples/`+`references/`) into the central `asgard-ai-platform/skills` repo so `sync-skill-content.mjs` ingests them like the other 300+. **(PR-2)** align the `asgard-ai-platform/emba-famulus` repo to the slice-2 extractor contract (a `## 安裝` install section, a `docs/USE-CASES.md`) so `sync-pack-content.mjs` produces a usable entry; manual clone is the primary install (emba ships no `marketplace.json`, by decision). **(gallery PR)** add 13 `skills.yaml` entries + the emba `plugins.yaml` `kind: pack` entry, re-run both sync scripts to commit the sidecars, and un-`fixme`/fix the skills-only e2e (publisher = **core**, not community).

**Tech Stack:** Astro 5 (static), YAML data + Ajv (`scripts/validate.mjs`), the slice-2 sync extractors (`scripts/sync-gallery/sync-skill-content.mjs`, `sync-pack-content.mjs`, both `gh`-authenticated), Playwright e2e (`e2e/`). No new gallery dependencies.

**Source spec:** `docs/superpowers/specs/2026-06-05-installable-packs-experience-design.md` — §1 (problem), §10 (resolved open items: route A, extractor-fit, publisher=Core), §11.4 (slice-4 scope). The spec was corrected on this branch (`9e4177b`) before this plan.

**Verified facts (from the live repos, 2026-06-06):**
- emba repo: `asgard-ai-platform/emba-famulus` (org-owned ⇒ **Core** publisher tier; `@shyuan`/Chris Yuan is only the `plugin.json` author).
- 13 skills under `skills/<name>/SKILL.md`, each with `examples/`+`references/` markdown (no executable scripts ⇒ `has_script: false`). Slugs: `biz-corporate-governance, biz-crm-strategy, biz-erm, biz-innovation-management, biz-management-accounting, biz-net-zero-transition, biz-sme-management, fin-m-and-a, grad-habitual-domain, ops-digital-transformation, ops-leadership-styles, ops-org-behavior, ops-talent-strategy`.
- None collide with existing central-repo dirs (checked: 404) or `skills.yaml` slugs.
- No `.env.example` ⇒ setup status `none`. No `marketplace.json`. README install section is `## 快速開始`/`### 方式 A/B/C` (extractor needs `## 安裝`/`### <harness>`); no `docs/USE-CASES.md` (extractor needs it).
- `sync-skill-content.mjs` lists dirs from the central repo, writes `skill-content.json` for every dir, and enriches `skills.yaml` `description.en` when the SKILL.md frontmatter is longer — so a short seed `description.en` is fine; it gets replaced on sync.

**Testing reality:** This repo has no unit-test runner for `src/`/data; gates are `npm run validate` (Ajv schema + cross-refs), `npm run build` (Astro compile + page count), and `npx playwright test` against the preview server. The two cross-repo PRs are content/doc changes verified by the extractor output, not by unit tests.

---

## Scope decisions (read before starting)

1. **Prereq-first ordering (user-chosen).** Phase A (PR-1) and Phase B (PR-2) land and **merge** before Phase C's sync step (Task 7) runs — the sync scripts read the central repo and the aligned emba repo over the network. Phase C's data-entry tasks (5, 6) and the e2e edit (8) can be authored before the merges, but **do not run the sync until A+B are merged**.
2. **`description.en` is a seed.** Each new `skills.yaml` entry ships a concise English description; `sync-skill-content.mjs` overwrites it with the richer SKILL.md frontmatter on the first sync (matches every existing entry). `description.zh` stays a short template (matches existing entries like `電商技能：… 分析與應用。`).
3. **Publisher = Core.** emba's owner-derived tier is `core`. The slice-3 e2e `fixme` asserting `data-publisher="community"` is changed to `core`; the community path stays unvalidated until a genuinely community-owned pack lands.
4. **Manual clone is the primary install.** PR-2's `## 安裝` section leads with a `### Claude Code` git-clone tab; the marketplace one-liner is a `>` note (pending listing). No `marketplace.json` is added.
5. **use-case `skills`/`mcp_servers` use pack-local names.** Per `parseUseCases`, `docs/USE-CASES.md` references emba's local skill names (`biz-management-accounting`, …), not gallery `skill-` slugs. `mcp_servers` are empty everywhere (0 MCP).
6. **Gallery slug = `skill-` + central-repo dir name.** e.g. central `biz-corporate-governance/` ⇒ `skill-biz-corporate-governance`.

---

## File / change map

| Repo | File | Change |
|---|---|---|
| `asgard-ai-platform/skills` | `<13 dirs>/**` | Create — copy emba's 13 skill dirs (SKILL.md + examples + references) |
| `asgard-ai-platform/emba-famulus` | `README.md` | Modify — replace `## 快速開始` install block with `## 安裝` + `### Claude Code` (+ Codex) harness subsections |
| `asgard-ai-platform/emba-famulus` | `docs/USE-CASES.md` | Create — 6 use cases (`### N.M`) derived from the 6 `workflows/*.md`, in `parseUseCases` format |
| gallery (this repo) | `data/skills.yaml` | Modify — add 13 skill entries |
| gallery | `data/plugins.yaml` | Modify — add `emba-famulus` `kind: pack` entry |
| gallery | `data/skill-content.json` | Regenerate — `sync-skill-content.mjs` (after PR-1 merges) |
| gallery | `data/pack-content.json` | Regenerate — `sync-pack-content.mjs` (after PR-2 merges) |
| gallery | `e2e/plugins-packs.spec.ts` | Modify — un-`fixme` skills-only test, publisher `community`→`core` |

---

## Phase A — Prereq PR-1: upstream 13 skills to the central repo

### Task 1: Copy the 13 skill dirs into `asgard-ai-platform/skills` and open a PR

**Files:** 13 new dirs in the `skills` repo (each `SKILL.md` + `examples/` + `references/`).

- [ ] **Step 1: Clone both repos into a scratch dir**

```bash
cd /tmp
gh repo clone asgard-ai-platform/emba-famulus emba-src -- --depth=1
gh repo clone asgard-ai-platform/skills skills-pr
cd skills-pr && git checkout -b add-emba-13-skills
```

- [ ] **Step 2: Copy the 13 skill dirs verbatim**

```bash
for d in biz-corporate-governance biz-crm-strategy biz-erm biz-innovation-management \
         biz-management-accounting biz-net-zero-transition biz-sme-management fin-m-and-a \
         grad-habitual-domain ops-digital-transformation ops-leadership-styles \
         ops-org-behavior ops-talent-strategy; do
  cp -R "/tmp/emba-src/skills/$d" "./$d"
done
git add -A
git status --short | head -20   # expect ~93 new files across 13 dirs
```

- [ ] **Step 3: Confirm no path collisions with existing central-repo dirs**

Run: `git status --short | grep -c '^A'` and visually confirm all paths are under the 13 new dirs (no `M` modifications to existing skills). Expected: only additions.

- [ ] **Step 4: Commit and open the PR**

```bash
git commit -m "feat: add 13 EMBA-specific skills (from emba-famulus pack)

Upstreams the EMBA Famulus pack's own skills so the Yggdrasil gallery can
sync their bodies from the canonical skills repo (gallery slug skill-<dir>).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
gh pr create --repo asgard-ai-platform/skills \
  --title "Add 13 EMBA-specific skills (emba-famulus)" \
  --body "Upstreams emba-famulus's 13 supplementary skills (management accounting, family business, habitual domain, M&A, ERM, net-zero, leadership, OB, talent, DX, CRM, innovation, corporate governance) so the gallery can sync them (gallery slug = skill-<dir>). Prereq for asgard-opensource-gallery installable-packs slice 4."
```

- [ ] **Step 5: Merge** (after review). Phase C Task 7 depends on this being on `main` of the `skills` repo.

---

## Phase B — Prereq PR-2: align the emba repo to the extractor contract

### Task 2: Rewrite the emba README install section + add `docs/USE-CASES.md`

**Files (in a `emba-famulus` branch):**
- Modify: `README.md` (the `## 快速開始` block, current lines ~22–48)
- Create: `docs/USE-CASES.md`

- [ ] **Step 1: Branch the emba repo**

```bash
cd /tmp/emba-src && git fetch && git checkout main && git pull
git checkout -b align-gallery-extractor
```

- [ ] **Step 2: Replace the `## 快速開始` install block with a `## 安裝` section**

In `README.md`, replace the block that starts at `## 快速開始` and its `### 方式 A/B/C` subsections with the following. The extractor keys on `## 安裝`/`## Install` then one tab per `### <harness>`; the FIRST fenced block is the command, `>` lines become notes. `方式 C`（Asgard skills 生態說明）is NOT an install method — move it to a separate non-`## 安裝` heading so it is not parsed as a tab.

````markdown
## 安裝

### Claude Code

```bash
# 手動 clone（marketplace 上架前的主要安裝方式）
git clone https://github.com/asgard-ai-platform/emba-famulus.git ~/.claude/plugins/emba-famulus

# 在 Claude Code 內驗證安裝
/plugins
```

> Marketplace 上架後可改用一行指令：`/plugin install asgard-ai-platform/emba-famulus`。

### Codex CLI / App

```bash
# 手動 clone 到 Codex plugin 目錄
git clone https://github.com/asgard-ai-platform/emba-famulus.git ~/.codex/plugins/emba-famulus
```

> 本套件附 `.codex-plugin/plugin.json`，clone 後 Codex 會自動載入。

## 搭配 Asgard skills 生態（建議）

本 plugin 大量依賴 Asgard 上游 skills。Asgard skills repo 是原料庫，請透過 Marketplace 安裝已打包的 Asgard plugin：

```bash
/plugin install asgard-ai-platform/skills
```
````

> **Verify before commit:** confirm the Codex plugin dir from this repo's own `README.md` 目錄結構 / `.codex-plugin/` docs. If the path differs from `~/.codex/plugins/emba-famulus`, use the documented one; if Codex install is genuinely undocumented, delete the `### Codex CLI / App` subsection (leave Claude Code as the single tab) rather than ship a wrong path.

- [ ] **Step 3: Create `docs/USE-CASES.md` from the 6 workflows**

The 6 `workflows/*.md` map to 6 use cases. `parseUseCases` needs `### N.M <title>` headings with `**情境：**`, a `**Prompt 範例：**` fence, `**會用到的 skills：**` backtick list, and `**注意：**`. Create `docs/USE-CASES.md`:

````markdown
# EMBA Famulus — 使用情境

> 給 Yggdrasil gallery 萃取的使用情境。每個情境對應一個作業場景 workflow。

### 1.1 個案分析（Harvard-style Case Analysis）

**情境：** 把冗長的策略／組織／行銷／財管個案拆解成可分析的問題，套用商管框架，產出結構化決策建議書。

**Prompt 範例：**

```
我有一份哈佛個案（內容如下），請用習慣領域與組織行為框架拆解決策盲點，並產出約 4000 字的結構化分析與建議。
```

**會用到的 skills：** `grad-habitual-domain`, `ops-org-behavior`, `biz-corporate-governance`

**注意：** 個案分析請以提供的個案內容為準，避免引用未提供的外部數據。

### 1.2 ESG／永續報告書

**情境：** 依 GRI／SASB／TCFD／IFRS S2 撰寫永續報告書，或永續課程的期末報告。

**Prompt 範例：**

```
幫我擬一份符合 TCFD 與 ISSB S2 的淨零轉型章節，含碳盤查範疇（Scope 1/2/3）與 SBTi 目標設定。
```

**會用到的 skills：** `biz-net-zero-transition`, `biz-erm`

**注意：** 碳費與法規以台灣現行規定為準，引用前請再確認當年度門檻。

### 1.3 高管簡報（Executive Pitch）

**情境：** 面對董事會／投資人／CEO 論壇的高管簡報與演講稿。

**Prompt 範例：**

```
把這份併購提案整理成 20 頁高管簡報大綱與演講稿，重點放在綜效與交易結構。
```

**會用到的 skills：** `fin-m-and-a`, `biz-innovation-management`

**注意：** 高管簡報重結論先行，避免學術式鋪陳。

### 1.4 期末產業分析報告

**情境：** 宏觀／中觀／微觀三層產業分析，加上公司定位與投資／策略建議。

**Prompt 範例：**

```
分析台灣 CRM／CDP 產業，做出市場結構、競爭定位與三年策略建議，並附財務模型假設。
```

**會用到的 skills：** `biz-crm-strategy`, `ops-digital-transformation`, `biz-sme-management`

**注意：** 定量假設請標註來源與推估方式。

### 1.5 畢業論文（質性研究）

**情境：** 個案研究／紮根理論／行動研究等質性方法的學位論文。

**Prompt 範例：**

```
我的論文用單一個案質性方法研究家族企業接班，幫我擬定研究架構與訪談大綱。
```

**會用到的 skills：** `biz-sme-management`, `ops-talent-strategy`, `biz-corporate-governance`

**注意：** 質性論文需交代資料蒐集方式與信效度處理。

### 1.6 畢業論文（量化研究）

**情境：** 問卷調查／SEM／多變量統計的量化學位論文。

**Prompt 範例：**

```
幫我把「領導風格對組織承諾」的量化論文設計成問卷構面與假設，並建議統計方法。
```

**會用到的 skills：** `ops-leadership-styles`, `ops-org-behavior`, `biz-management-accounting`

**注意：** 假設檢定請說明變項操作型定義與量表來源。
````

- [ ] **Step 4: Commit and open the PR**

```bash
cd /tmp/emba-src
git add README.md docs/USE-CASES.md
git commit -m "docs: align install section + add USE-CASES.md for gallery extraction

Renames the README install block to ## 安裝 with per-harness ### subsections
(manual clone primary; marketplace one-liner noted as pending) and adds
docs/USE-CASES.md so the Yggdrasil gallery's sync-pack-content extractor
produces install tabs + use cases.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
gh pr create --repo asgard-ai-platform/emba-famulus \
  --title "Align README install + add USE-CASES.md for gallery extraction" \
  --body "Prereq for asgard-opensource-gallery installable-packs slice 4: makes the README install section and use cases machine-extractable. Manual clone is the primary install (no marketplace.json by decision)."
```

- [ ] **Step 5: Merge** (after review). Phase C Task 7's `sync-pack-content.mjs` depends on this being on `main`.

---

## Phase C — Gallery PR (this repo, branch `installable-packs-slice-4`)

### Task 3: Add the 13 skill entries to `data/skills.yaml`

**Files:**
- Modify: `data/skills.yaml` (append a new commented section at the end of the `skills:` list)

- [ ] **Step 1: Append the 13 entries**

Match the existing entry shape (`slug, name{en,zh}, description{en,zh}, status, category, skill_type, region, github, tags, maintainer`). Append at the end of the `skills:` array:

```yaml
  # ============================================================
  # EMBA Skills (13) — from the emba-famulus pack
  # ============================================================
  - slug: skill-biz-corporate-governance
    name:
      en: "Corporate Governance"
      zh: "公司治理"
    description:
      en: "Board composition, three lines of defense, audit/compensation/nomination committee operations, independent-director governance, IPO governance upgrade, and family-business professionalization for Taiwan listed-company practice."
      zh: "EMBA 技能：公司治理框架與實務應用（董事會組成、三道防線、委員會運作、IPO 治理補強、家族企業法人化）。"
    status: released
    category: methodology
    skill_type: methodology
    region: taiwan
    github: https://github.com/asgard-ai-platform/skills/blob/main/biz-corporate-governance/SKILL.md
    tags: [corporate-governance, board, independent-director, ipo, family-business, emba]
    maintainer: asgard-ai-platform

  - slug: skill-biz-crm-strategy
    name:
      en: "CRM Strategy"
      zh: "顧客關係管理策略"
    description:
      en: "Integrated CRM strategy across six pillars: customer segmentation (RFM/CLV), journey orchestration, CDP stack, loyalty design, B2B key-account management, and CRM governance."
      zh: "EMBA 技能：顧客關係管理策略框架與實務應用（客戶分級、旅程編排、CDP、忠誠方案、大客戶經營）。"
    status: released
    category: crm
    skill_type: methodology
    region: taiwan
    github: https://github.com/asgard-ai-platform/skills/blob/main/biz-crm-strategy/SKILL.md
    tags: [crm, customer-strategy, clv, rfm, cdp, emba]
    maintainer: asgard-ai-platform

  - slug: skill-biz-erm
    name:
      en: "Enterprise Risk Management"
      zh: "企業風險管理"
    description:
      en: "ERM framework integrating COSO ERM 2017, ISO 31000, the three-lines model, risk appetite, risk heatmaps, and key risk indicators into a governance playbook."
      zh: "EMBA 技能：企業風險管理框架與實務應用（COSO ERM、ISO 31000、三道防線、風險胃納、KRI）。"
    status: released
    category: methodology
    skill_type: methodology
    region: taiwan
    github: https://github.com/asgard-ai-platform/skills/blob/main/biz-erm/SKILL.md
    tags: [erm, risk-management, coso, iso-31000, governance, emba]
    maintainer: asgard-ai-platform

  - slug: skill-biz-innovation-management
    name:
      en: "Innovation Management"
      zh: "創新管理"
    description:
      en: "Corporate innovation governance integrating Stage-Gate, 3 Horizons, innovation portfolios, open innovation, corporate venture capital, innovation KPIs, and intrapreneurship."
      zh: "EMBA 技能：創新管理框架與實務應用（Stage-Gate、3 Horizons、開放式創新、CVC、內部創業）。"
    status: released
    category: methodology
    skill_type: methodology
    region: taiwan
    github: https://github.com/asgard-ai-platform/skills/blob/main/biz-innovation-management/SKILL.md
    tags: [innovation-management, stage-gate, 3-horizons, open-innovation, cvc, emba]
    maintainer: asgard-ai-platform

  - slug: skill-biz-management-accounting
    name:
      en: "Management Accounting"
      zh: "管理會計"
    description:
      en: "Management accounting toolkit for internal decision support: ABC costing, variance analysis, transfer pricing, and responsibility accounting."
      zh: "EMBA 技能：管理會計框架與實務應用（ABC 作業成本、差異分析、內部轉撥計價、責任中心）。"
    status: released
    category: finance
    skill_type: methodology
    region: taiwan
    github: https://github.com/asgard-ai-platform/skills/blob/main/biz-management-accounting/SKILL.md
    tags: [management-accounting, abc-costing, variance-analysis, transfer-pricing, emba]
    maintainer: asgard-ai-platform

  - slug: skill-biz-net-zero-transition
    name:
      en: "Net-Zero Transition"
      zh: "淨零轉型"
    description:
      en: "Net-zero transition playbook: GHG inventory (ISO 14064-1, GHG Protocol), SBTi targets, TCFD/ISSB disclosure, Taiwan carbon fee, decarbonization roadmap, and supply-chain carbon."
      zh: "EMBA 技能：淨零轉型框架與實務應用（碳盤查、SBTi、TCFD/ISSB、碳費、減碳路徑、供應鏈碳）。"
    status: released
    category: methodology
    skill_type: methodology
    region: taiwan
    github: https://github.com/asgard-ai-platform/skills/blob/main/biz-net-zero-transition/SKILL.md
    tags: [net-zero, carbon, ghg-protocol, sbti, tcfd, taiwan, emba]
    maintainer: asgard-ai-platform

  - slug: skill-biz-sme-management
    name:
      en: "SME & Family Business Management"
      zh: "中小企業與家族企業管理"
    description:
      en: "SME and family-business management for Taiwan: resource-constrained decision-making, family governance (three circles), four-layer succession, and professionalization."
      zh: "EMBA 技能：中小企業與家族企業管理框架與實務應用（資源有限決策、家族治理、傳承規劃、專業化）。"
    status: released
    category: methodology
    skill_type: methodology
    region: taiwan
    github: https://github.com/asgard-ai-platform/skills/blob/main/biz-sme-management/SKILL.md
    tags: [sme, family-business, succession, family-governance, taiwan, emba]
    maintainer: asgard-ai-platform

  - slug: skill-fin-m-and-a
    name:
      en: "M&A Integration"
      zh: "併購整合"
    description:
      en: "M&A playbook across eight modules: strategic rationale, target screening, due diligence, valuation bridge, synergy analysis, deal structuring, SPA clauses, and post-merger integration."
      zh: "EMBA 技能：併購整合框架與實務應用（策略動機、盡職調查、估值橋、綜效、交易結構、SPA、PMI）。"
    status: released
    category: finance
    skill_type: methodology
    region: taiwan
    github: https://github.com/asgard-ai-platform/skills/blob/main/fin-m-and-a/SKILL.md
    tags: [m-and-a, due-diligence, valuation-bridge, synergy, pmi, emba]
    maintainer: asgard-ai-platform

  - slug: skill-grad-habitual-domain
    name:
      en: "Habitual Domain Theory"
      zh: "習慣領域理論"
    description:
      en: "Habitual Domain (HD) theory by P.L. Yu (游伯龍): four domains, eight hypotheses, the seven-layer decision structure, and nine HD-expansion tools for decision blind spots and cognitive inertia."
      zh: "EMBA 技能：習慣領域理論（游伯龍）框架與應用（四領域、八大通性、七層決策、九大擴展工具）。"
    status: released
    category: theory
    skill_type: theory
    region: taiwan
    github: https://github.com/asgard-ai-platform/skills/blob/main/grad-habitual-domain/SKILL.md
    tags: [habitual-domain, pl-yu, decision-theory, innovation-thinking, emba]
    maintainer: asgard-ai-platform

  - slug: skill-ops-digital-transformation
    name:
      en: "Digital Transformation"
      zh: "數位轉型"
    description:
      en: "Digital-transformation execution playbook: maturity assessment, transformation roadmap, operating-model redesign, PMO governance, data/AI platforms, and change management."
      zh: "EMBA 技能：數位轉型框架與實務應用（成熟度評估、轉型路徑、營運模式、PMO 治理、資料/AI 平台、變革管理）。"
    status: released
    category: methodology
    skill_type: methodology
    region: taiwan
    github: https://github.com/asgard-ai-platform/skills/blob/main/ops-digital-transformation/SKILL.md
    tags: [digital-transformation, dx, operating-model, pmo, change-management, emba]
    maintainer: asgard-ai-platform

  - slug: skill-ops-leadership-styles
    name:
      en: "Leadership Styles"
      zh: "領導風格"
    description:
      en: "Leadership-style decision framework combining transformational, transactional, servant, situational, and authentic leadership into a situation-based decision tree."
      zh: "EMBA 技能：領導風格框架與實務應用（轉型、交易、僕人、情境、真誠領導的情境決策樹）。"
    status: released
    category: methodology
    skill_type: methodology
    region: taiwan
    github: https://github.com/asgard-ai-platform/skills/blob/main/ops-leadership-styles/SKILL.md
    tags: [leadership, transformational, servant-leadership, situational-leadership, emba]
    maintainer: asgard-ai-platform

  - slug: skill-ops-org-behavior
    name:
      en: "Organizational Behavior"
      zh: "組織行為"
    description:
      en: "Organizational-behavior diagnostic toolkit across three layers: individual motivation (Maslow/Herzberg/SDT), team dynamics (Tuckman), and organizational culture (Schein, Hofstede)."
      zh: "EMBA 技能：組織行為框架與實務應用（個人動機、團隊動力、組織文化、跨文化管理）。"
    status: released
    category: methodology
    skill_type: methodology
    region: taiwan
    github: https://github.com/asgard-ai-platform/skills/blob/main/ops-org-behavior/SKILL.md
    tags: [org-behavior, motivation, tuckman, schein, hofstede, emba]
    maintainer: asgard-ai-platform

  - slug: skill-ops-talent-strategy
    name:
      en: "Talent Strategy"
      zh: "人才策略"
    description:
      en: "Strategic talent-management toolkit integrating the 9-box grid (performance x potential), succession planning, competency models, and talent review into one operational flow."
      zh: "EMBA 技能：人才策略框架與實務應用（9-box、繼任規劃、職能模型、人才盤點）。"
    status: released
    category: methodology
    skill_type: methodology
    region: taiwan
    github: https://github.com/asgard-ai-platform/skills/blob/main/ops-talent-strategy/SKILL.md
    tags: [talent, succession, 9-box, competency, hr-strategy, emba]
    maintainer: asgard-ai-platform
```

- [ ] **Step 2: Validate (schema only — emba plugin not added yet)**

Run: `npm run validate`
Expected: `✅ All checks passed!`. (13 new unique `skill-…` slugs, all matching `^skill-[a-z0-9-]+$`; each carries the required `slug/name/description/status/category/skill_type`.)

- [ ] **Step 3: Commit**

```bash
git add data/skills.yaml
git commit -m "feat(packs): add 13 EMBA skills to the catalogue (emba-famulus)"
```

---

### Task 4: Add the `emba-famulus` pack entry to `data/plugins.yaml`

**Files:**
- Modify: `data/plugins.yaml` (add after the `tw-ecommerce-majordomo` entry, the other `kind: pack`)

- [ ] **Step 1: Insert the emba entry**

Insert immediately after the `tw-ecommerce-majordomo` block (ends at its `skills: [...]` line, before `- slug: brand-media-pr`):

```yaml
  - slug: emba-famulus
    kind: pack
    name:
      en: "EMBA Famulus"
      zh: "EMBA 學伴"
    description:
      en: "A skills-only coding-agent pack for Taiwan EMBA students: 13 EMBA-specific skills (management accounting, family business, habitual domain, M&A, ERM, net-zero transition, and more) plus 6 assignment-scenario workflows. Install and use — no setup required."
      zh: "給台灣 EMBA 學員的純技能 coding agent 套件：13 個 EMBA 專屬 skill（管理會計、家族企業、習慣領域、M&A、ERM、淨零轉型等）加 6 個作業場景 workflow。安裝即用，免設定。"
    scenario:
      en: "For Taiwan EMBA students completing case analyses, term reports, and theses — install into Claude Code / Codex and ask it to apply business frameworks to your assignment, no credentials needed."
      zh: "適合台灣 EMBA 學員完成個案分析、期末報告與論文——安裝進 Claude Code／Codex，直接請它用商管框架解你的作業，無需任何金鑰。"
    github: https://github.com/asgard-ai-platform/emba-famulus
    mcp_servers: []
    skills: [skill-biz-corporate-governance, skill-biz-crm-strategy, skill-biz-erm, skill-biz-innovation-management, skill-biz-management-accounting, skill-biz-net-zero-transition, skill-biz-sme-management, skill-fin-m-and-a, skill-grad-habitual-domain, skill-ops-digital-transformation, skill-ops-leadership-styles, skill-ops-org-behavior, skill-ops-talent-strategy]
```

- [ ] **Step 2: Validate cross-references**

Run: `npm run validate`
Expected: `✅ All checks passed!`. The cross-ref check resolves all 13 `skills:` against Task 3's entries; `mcp_servers: []` needs no resolution; `kind: pack` matches the schema enum.

- [ ] **Step 3: Build — confirm new pages + graceful no-content render**

Run: `npm run build`
Expected: build completes; page count is the prior build **+14** (13 skill detail pages + 1 `plugins/emba-famulus/`). No errors. (`PackDetail` renders with `content === undefined` for now — install panel shows "No install command published yet"; the next task's sync fills it.)

- [ ] **Step 4: Commit**

```bash
git add data/plugins.yaml
git commit -m "feat(packs): add emba-famulus pack entry (kind:pack, skills-only)"
```

---

### Task 5: Verify the card + detail render the skills-only / Core paths (pre-sync)

**Files:** none (verification only — these paths don't need the sidecars).

- [ ] **Step 1: Build + preview, grep the emba card markup**

```bash
npm run build && npm run preview &
sleep 2
curl -s http://localhost:4321/plugins/ | grep -o 'data-publisher="core"\|Skills only\|/plugins/emba-famulus/' | sort -u
kill %1
```
Expected: matches for `/plugins/emba-famulus/`, `data-publisher="core"`, and `Skills only` (emba card: `getPublisherTier('…/asgard-ai-platform/…') === 'core'`; `mcpCount === 0 ⇒ skillsOnly`). If `core` is missing, confirm the `github` URL owner in Task 4.

- [ ] **Step 2: No commit** (verification gate only).

---

### Task 6: Un-`fixme` and fix the skills-only e2e (publisher → core)

**Files:**
- Modify: `e2e/plugins-packs.spec.ts:45-55`

- [ ] **Step 1: Replace the `fixme` test**

Replace the comment + `test.fixme(...)` block (currently lines 45–55) with:

```ts
  // emba-famulus is the live skills-only pack (slice 4). It is org-owned, so its
  // publisher tier is core; the community path stays unvalidated until a
  // genuinely community-owned pack lands.
  test('skills-only pack shows "Skills only" and no MCP count', async ({ page }) => {
    await page.goto(`${BASE}/plugins/`);
    const emba = page.locator('a[href="/plugins/emba-famulus/"]');
    await expect(emba.getByText('Skills only')).toBeVisible();
    await expect(emba.getByText('MCP')).toHaveCount(0);
    await expect(emba.locator('[data-publisher="core"]')).toBeVisible();
  });
```

- [ ] **Step 2: Run the spec**

```bash
npm run build && npm run preview &
sleep 2
npx playwright test e2e/plugins-packs.spec.ts
kill %1
```
Expected: all tests pass (the previously-`fixme`'d case now runs green; no `fixme` remains in the file).

- [ ] **Step 3: Commit**

```bash
git add e2e/plugins-packs.spec.ts
git commit -m "test(packs): activate skills-only e2e for emba (publisher=core)"
```

---

### Task 7: Regenerate the sidecars (REQUIRES PR-1 + PR-2 merged)

**Files:**
- Regenerate: `data/skill-content.json`, `data/pack-content.json`, and possibly `data/skills.yaml` (`description.en` enrichment)

> **Gate:** Do not start until Task 1 (PR-1) and Task 2 (PR-2) are merged to their repos' `main`. Both sync scripts use `gh api` over the network and read those merged states. Confirm `gh auth status` is authenticated first.

- [ ] **Step 1: Sync skill content (pulls the 13 new bodies + enriches descriptions)**

Run: `node scripts/sync-gallery/sync-skill-content.mjs`
Expected: log shows the 13 new dirs processed (`biz-corporate-governance … ✅`, etc.), `skill-content.json` rewritten, and `skills.yaml — descriptions enriched` (the 13 seed `description.en` are replaced by the richer SKILL.md frontmatter).

- [ ] **Step 2: Sync pack content (produces the emba entry)**

Run: `node scripts/sync-gallery/sync-pack-content.mjs`
Expected: log shows `emba-famulus` processed with `≥1 install tab(s), setup=none, ≥1 use case(s)`. `pack-content.json` now has both `tw-ecommerce-majordomo` and `emba-famulus`. Verify:

```bash
node -e "const d=require('./data/pack-content.json'); const e=d['emba-famulus']; console.log('install:',e.install.length,'setup:',e.setup.status,'use_cases:',e.use_cases.length)"
```
Expected: `install: ≥1  setup: none  use_cases: 6`. If `install: 0`, PR-2's README `## 安裝` section didn't match — recheck the heading/subsection format.

- [ ] **Step 3: Validate + build + full e2e**

```bash
npm run validate          # ✅ All checks passed!
npm run build             # prior+14 pages, no errors
npm run preview &
sleep 2
npx playwright test       # pack-detail.spec.ts + plugins-packs.spec.ts + rest green
kill %1
```

- [ ] **Step 4: Manual smoke at `/plugins/emba-famulus/`**

Confirm: hero badges (`PACK` + `Core` + `✓ No setup`), the install split-hero with a Claude Code clone command + copy button, the `✓ No setup required` setup block (status `none`), use-cases (6) **above** "What's inside", "What's inside" shows `Skills only` with no MCP area, **no** dependency graph (0 MCP ⇒ no edges), and the source section (version 0.1.0, MIT). Collection pages unchanged.

- [ ] **Step 5: Commit the sidecars**

```bash
git add data/skill-content.json data/pack-content.json data/skills.yaml
git commit -m "chore(packs): sync skill + pack content for emba-famulus"
```

---

### Task 8: Open the gallery PR

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin installable-packs-slice-4
gh pr create --title "Installable Packs — Slice 4 (emba-famulus onboarding)" \
  --body "$(cat <<'EOF'
Onboards emba-famulus as the gallery's second installable pack (skills-only, no setup, 0 MCP) — the first end-to-end pack validation.

- 13 EMBA skills added to data/skills.yaml (bodies synced from the central skills repo; see prereq PR asgard-ai-platform/skills).
- emba-famulus pack entry (kind: pack) in data/plugins.yaml.
- skill-content.json + pack-content.json regenerated.
- Skills-only e2e activated; publisher asserted as core (org-owned repo).
- Spec §1/§10/§11.4 corrected (publisher=Core, skills route A, extractor-fit) in 9e4177b.

Prereqs (merge first): asgard-ai-platform/skills (13 SKILL.md), asgard-ai-platform/emba-famulus (install section + USE-CASES.md).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Final verification checklist

- [ ] PR-1 (`skills` repo) and PR-2 (`emba-famulus` repo) merged before the gallery sidecar sync.
- [ ] `npm run validate` → `✅ All checks passed!` (13 new skills, emba cross-refs resolve).
- [ ] `npm run build` → prior+14 pages, no errors.
- [ ] `npx playwright test` → green; **no `test.fixme` remains** in `e2e/plugins-packs.spec.ts`.
- [ ] `data/pack-content.json` has an `emba-famulus` key with `setup.status === 'none'`, `use_cases.length === 6`, `install.length ≥ 1`.
- [ ] Manual smoke `/plugins/emba-famulus/`: PACK + Core + No-setup badges, clone install command, use-cases-before-inside, Skills only, no graph.

## Out of scope (later)

- emba `marketplace.json` / true one-command `/plugin install` (deferred by decision; manual clone is primary).
- Community publisher-path validation (needs a genuinely community-owned pack).
- `content_maturity` per-skill full/skeleton marking (carried over from slice 3).
- De-duplicating the 13 skills between `emba-famulus` and the central `skills` repo (the central repo is canonical for gallery sync; emba keeps its own copies for standalone install).
- Phase 2 (`/packs` route, nav, homepage stat, contribute-a-pack template) — spec §12.
