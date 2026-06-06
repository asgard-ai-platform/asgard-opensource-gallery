# Installable Packs — Experience-First Design Spec

**Date:** 2026-06-05
**Status:** Design approved (pending user review), implementation not started
**Scope:** Yggdrasil gallery (`vault.asgard-ai.com`) — how to present and onboard "installable packs" alongside existing "curated collections".

---

## 1. Problem

Two real, one-command-installable repos have appeared that don't fit the gallery's existing model:

| | `tw-ecommerce-majordomo` | `emba-famulus` |
|---|---|---|
| Contents | 29 skills + 12 MCP servers | 13 skills + 0 MCP |
| Publisher | Core (`asgard-ai-platform`) | Core (`asgard-ai-platform`; authored by @shyuan / Chris Yuan) — see §10 |
| Setup after install | Needs ECPay/NewebPay/etc. credentials (env vars), but sandbox/default modes work first | None — skills only, install and use |
| Nature | **Installable package** (own repo, `.claude-plugin/plugin.json`, `marketplace.json`, multi-harness manifests, version, docs site) | Same |

The gallery's existing 10 `PlugIn` entries are **curated collections** — editorial recipes ("for Taiwan e-commerce ops, use these MCPs + skills"). They have no repo of their own, are not one-command installable, and several map to a commercial Asgard product via `upgrade_to`. The site's README/home defines PlugIn as "MCP+SKILL combos mapping to Asgard commercial products" — so dropping an installable, 0-MCP pack in as a "PlugIn" makes that definition false.

`tw-ecommerce-majordomo` is **already** in `data/plugins.yaml` masquerading as a collection (it has a `github` field) — a distinct entry from the existing `tw-ecommerce-ops` collection. `emba-famulus` is not yet added (its 13 skills are not in `data/skills.yaml` or the central `skills` repo).

> **Branch note:** the `majordomo` entry and the `github` schema/type/detail-page support are the groundwork commit on this same branch (`9baa24d`), committed after this spec (`c891ddc`). Reviewing `c891ddc` in isolation will *not* show them — read the branch HEAD. This spec assumes that groundwork is present.

## 2. Core principle

**The gallery is a handoff surface, not a runtime.** Its job is exactly three things:

1. Help the user **find** the right pack.
2. Hand them the **exact install command** (per their agent/harness).
3. Tell them **what they still need to prepare** after install (credentials / nothing).

Then it sends them back to their own terminal/agent. The site must never imply "try it live here" — it cannot show a pack running.

## 3. Decisions

### 3.1 Architecture (locked — from prior design round)

- **`kind` discriminator** on the plugin entity: `collection | pack`, default `collection`. Old 10 entries untouched; only `majordomo`/`emba` get `kind: pack`. The default is **not** applied via JSON Schema (Ajv in `validate.mjs` does not write defaults, and adding `"default"` to the enum would not back-fill the 10 kind-less entries); instead `kind` is an **optional** schema field and the **data loader** coalesces it — `kind = p.kind ?? 'collection'` — so components and pages never receive `undefined`.
- **One `/plugins` route, split into two in-page sections.** No new top-level `/packs` route yet. No fourth data entity.
- **Publisher tier derived from GitHub owner** — `github.com/asgard-ai-platform/*` ⇒ Core, else Community. Zero schema field for trust.
- **Dependency graph gated on `hasDepEdges` AND a node-count limit.** `hasDepEdges` (not `mcp_count > 0`): `requires_mcp` is a **Skill** field, so it means `∃ s ∈ pack.skills, m ∈ pack.mcp_servers : m ∈ s.requires_mcp` (matches how `PlugInGraph.astro` computes edges). But edges alone aren't enough: the current bipartite SVG is sized `height = max(mcp,skill) × 60 + 80` in a fixed 600-wide viewBox, so a large pack (majordomo = 12 MCP × 29 skills) becomes an ~1800px-tall mess of crossing lines with clipped labels. So **also gate on size**: only render the graph when `mcp_count + skill_count ≤ GRAPH_NODE_LIMIT` (currently 12 — comfortably covers every existing collection, excludes majordomo). Above the limit, omit the graph; the grouped "What's inside" (§5.2 ④) carries the contents. (Quick size gate shipped in slice 1's `plugins/[slug].astro`; the grouped-list replacement is slice 3.)
- **Phase 2** (`/packs` route + nav + homepage stat + contribute template) only at threshold: pack count ≥ 5–6, OR packs gain their own discovery dimensions (install method / author type / framework), OR analytics show users landing specifically to install.

### 3.2 Experience (this round)

The experience surfaced four gaps the architecture round under-specified. These are the heart of this spec:

1. **Setup state** is the first-class signal (bigger than counts). 3 states:
   - ✓ **No setup** — install and use (emba).
   - ◐ **Sandbox-ready** — install now, sandbox/default modes work; add provider keys only for real services (majordomo).
   - ● **Keys required** — no sandbox path; red state. None today.
2. **Install command** is the one core artifact the gallery must hand over.
3. **Use cases** ("what can I ask it") rank **before** the contents inventory.
4. **Handoff** is honest *and* constructive — a copyable self-test prompt, not an empty disclaimer.

## 4. Personas & journey

| Persona | Wants | Success |
|---|---|---|
| E-commerce operator (majordomo) | A ready capability for their payments/logistics | Pack installed in their Claude Code/Cursor; asks "對帳上週 ECPay 交易" |
| EMBA student (emba) | Help with case analysis / thesis | Installed, asks "用波特五力分析這產業" |
| Browser | See what exists | Understands pack vs collection |

```
 DISCOVER        JUDGE              COPY INSTALL      SET UP (optional)     USE
 find the pack → is this for me? →  get exact cmd →   what else to prep →   run in own agent
 /plugins list   detail split-hero  install panel     credentials/sandbox   terminal/Claude Code
 setup signal    use cases                                                  ── it runs ──
 ├──────────────── GALLERY OWNS THIS ──────────────────┤  HANDOFF        site can't show │
```

Gallery responsibility ends when the user holds (a) the exact command and (b) a clear list of what to prepare.

## 5. Screen specs

### 5.1 `/plugins` list (two sections)

```
═ Installable Packs (2) ═══════════════      ═ Curated Collections (10) ═══════
┌ majordomo ───────────────┐ ┌ emba ───────────────┐    collection cards:
│ [PACK] [🛡 Core]          │ │ [PACK] [🛡 Core]     │    - no Install button
│ Taiwan E-Commerce Majordomo│ │ EMBA Famulus        │    - CTA = Explore recipe
│ 金流/物流/發票/通路 全鏈   │ │ 商管思維隨身助理      │    - counts may stay prominent
│ ◐ Sandbox-ready  ← HERO   │ │ ✓ No setup  ← HERO   │
│ 可問:對帳·上架momo        │ │ 可問:波特五力分析     │
│ [ Install → ]             │ │ [ Install → ]        │
│ 29 skills·12 MCP ← muted  │ │ 13 skills · Skills-only│  ← never "0 MCP"
└───────────────────────────┘ └──────────────────────┘
```

Pack card hierarchy (top → bottom): `PACK` chip + Core/Community badge + **setup state** → title → scenario → **use-case teaser** → `Install →` CTA → counts (muted; `Skills only` when 0 MCP). Setup state and use-case fit are the primary axes; counts are secondary.

Collection card: keeps recipe framing, no install affordance, CTA `Explore recipe`.

### 5.2 Pack detail (split-hero, top → bottom)

```
┌───────────────────────────────────────────────────────────────────┐
│ [PACK] [🛡 Core] [◐ Sandbox-ready]                                 │
│ Taiwan E-Commerce Majordomo / 台灣電商總管                         │
│ 一行擴充你的 coding agent：台灣電商金流/物流/發票/通路全鏈          │
│ ┌─ LEFT: judge ─────────────┐ ┌─ RIGHT: act ────────────────────┐ │
│ │ You can ask it:           │ │ Install                         │ │
│ │ · 對帳 ECPay 這週交易      │ │ [Claude Code][Cursor][Codex][…] │ │
│ │ · 設 momo 上架流程         │ │ /plugin marketplace add …   📋  │ │
│ │ · 試算 7-11 取貨運費       │ │ ⚠ Run in your own terminal      │ │
│ └───────────────────────────┘ └─────────────────────────────────┘ │
├── ② SETUP (collapsible) — sandbox-ready; add provider keys for real │
│      services. Grouped by provider (ECPay / NewebPay / SF / …).     │
├── ③ WHAT YOU CAN ASK IT — use cases BEFORE inventory                │
│      scenario → sample prompt → skills/MCP used → caveats           │
├── ④ WHAT'S INSIDE — 29 skills · 12 MCP (maturity: 3 full/26 skel.) │
│      [expand skills ▾][expand MCP ▾]  ← secondary, collapsed        │
├── ⑤ DEPENDENCY GRAPH — only if hasDepEdges AND ≤ GRAPH_NODE_LIMIT   │
├── ⑥ SOURCE — GitHub, version, license, author, raw manifests       │
└── HANDOFF note (footer): copy → runs in your agent, not here        │
```

**emba variant:** ② becomes a positive `✓ No setup required` block; ④ shows `Skills only` with no empty MCP area; ⑤ omitted.

Mobile: the split-hero stacks (judge above act).

### 5.3 Setup / credentials presentation (non-scary)

- Lead with the state word, not "blocked". For majordomo: **Sandbox-ready**.
- Microcopy: "Fill only the services you plan to use. A missing env var disables that one MCP, not the whole pack."
- Group env vars by **provider/MCP**, in collapsible accordions. Defaults shown as defaults (e.g. `ECPAY_ENV=stage`), not as missing work.
- Mark real-production secrets distinctly (merchant IDs, hash keys, tokens, passwords).
- Sandbox-first hints; note any provider needing private access (91APP/Cyberbiz).
- Actions: `Copy group template` · `Copy full .env.example` · `View provider docs`.
- emba: no credential section; positive "No setup required" block.

### 5.4 Handoff as relay (not just a disclaimer)

The install panel's next-step shows a **copyable self-test prompt** so the handoff is a relay, not a dead end:

- majordomo → "列出你現在可用的 tw-ecom 技能" (confirms install)
- emba → "用波特五力幫我分析 <某產業>" (works immediately, no setup)

The handoff microcopy appears at most twice: once in the install panel (where the copy happens) and once in the footer source/handoff line. Do not repeat it enough to feel scary.

## 6. Install UX & sync-time extraction

- **Tabs per harness**: Claude Code first; Codex/agent if the install path actually supports it; generic/manual MCP-compatible; local clone only if docs support it. One copyable command per tab + a short "what this does".
- Next-step link changes by setup state: No setup → "ask your agent"; Sandbox-ready → "try sandbox, then add keys"; Keys required → "fill required keys".
- **Extraction runs at sync time, not deploy time.** Critically, `pack-content.json` is a **committed** sidecar refreshed by the existing sync workflow (`scripts/sync-gallery/` + `.github/workflows/sync-content.yml`), exactly like `skill-content.json` / `mcp-content.json` today. The Cloudflare Pages deploy build (`npm run build`) reads the committed JSON and makes **no external network calls** — so a GitHub outage or a moved repo can never block a deploy; it only makes a sync run fail, which is reviewable before merge. The extractor must degrade gracefully per repo (skip/keep-last-good on fetch failure, log which packs were skipped) rather than abort the whole sync.
- A new extractor script (under `scripts/sync-gallery/`) fetches from each pack repo and emits the sidecar:
  - `.claude-plugin/plugin.json` → name/version/author/repository/license/keywords/skills/mcpServers
  - `.claude-plugin/marketplace.json` (or `marketplace.json`) → marketplace install name/source
  - `mcp.json` / `.mcp.json` → MCP config / env fallback
  - `.env.example` → comments, provider grouping, defaults, required/optional hints
  - `docs/USE-CASES.md` → scenario / prompt / skills / MCPs / caveats

## 7. Data model (two layers — do NOT bloat plugins.yaml)

Reuse the existing sidecar pattern (`skill-content.json`, `mcp-content.json`):

**`data/plugins.yaml`** (hand-edited, PR-reviewable) — identity only:
- `kind: pack` (or default `collection`)
- existing: `slug, name, description, scenario, github, mcp_servers, skills`
- publisher needs **no** field (derived from `github` owner)

**`data/pack-content.json`** (sync-extracted, machine-generated, **committed**, keyed by slug — read statically at deploy, see §6) — the experience payload:
```
{
  "<slug>": {
    "install":  [{ "harness", "label", "command", "source", "notes" }],
    "setup":    { "status": "none|sandbox-ready|keys-required",
                  "summary",
                  "env_groups": [{ "service", "mcp_slug?", "default_mode?", "docs_url?",
                                   "vars": [{ "name", "required_when?", "default?", "description?", "source" }] }] },
    "use_cases": [{ "title", "scenario", "prompt", "skills", "mcp_servers", "caveats?", "maturity?" }],
    "content_maturity": { "<skill_slug>": "full|skeleton|unknown" },
    "source":   { "version", "license", "repository", "homepage", "keywords", "manifest_urls" }
  }
}
```
Derived view-model (computed in the loader, not stored): `skill_count, mcp_count, skills_only, has_mcp, hasDepEdges, publisher_tier`.

## 8. Reverse-derived schema changes

`schemas/plugin.schema.json` (`additionalProperties:false`, so declare each; all optional → old 10 untouched):
- `kind: { enum: ["collection","pack"] }`

That is the **only** new YAML/schema field. Everything else (install/setup/use_cases/maturity/source/publisher) lives in the build-extracted sidecar or is derived — keeping `plugins.yaml` reviewable.

`src/types.ts`: add `kind?: 'collection' | 'pack'` to `PlugIn`; add a `PackContent` interface mirroring the sidecar.

## 9. Guardrails (the "do not" list)

- Do **not** make MCP count the readiness signal — setup state is.
- Do **not** put contents before use cases on pack detail.
- Do **not** render "0 MCP" — say "Skills only".
- Do **not** give collections an install affordance.
- Do **not** imply the gallery can run a pack.

## 10. Prerequisites & open items

- **emba's 13 skills must exist in `data/skills.yaml`** before emba can be added (else `validate.mjs` cross-ref fails). **Resolved (slice 4): route A — upstream the 13 `SKILL.md` to the central `skills` repo**, then existing `sync-gallery` tooling ingests them. Route A over B (self-contained `github` → emba's own `SKILL.md`) because `sync-skill-content.mjs` is hardcoded to fetch bodies from `asgard-ai-platform/skills` (its `ORG`/`REPO` constants); a `github` pointing elsewhere would leave the skill with no synced body unless the sync tool is extended. Central-repo upstreaming keeps the 13 consistent with the other 300+ skills and matches emba's own `plugin.json` framing ("補充 Asgard 上游 skills"). Gallery slugs follow the existing `skill-<dir>` convention (central `biz-corporate-governance/SKILL.md` → `skill-biz-corporate-governance`).
- **emba's repo must be aligned to the slice-2 extractor contract** before its `pack-content.json` is usable. As published, emba's README install section is `## 快速開始` / `### 方式 A/B/C` (the extractor keys on `## 安裝` / `## Install` → `### <harness>`) and it has no `docs/USE-CASES.md` (it has `workflows/*.md`) — so the extractor yields empty install tabs and empty use-cases. Slice-4 prereq PR to emba: rename the install section to `## 安裝` with `### Claude Code` / `### Codex CLI / App` / manual-clone subsections, and add `docs/USE-CASES.md` derived from the 6 workflows in the `parseUseCases` format. **Manual clone is the primary install** — emba ships no `marketplace.json` (decided out of scope), so the marketplace `/plugin install` path stays pending; the gallery surfaces the clone command as the working path.
- **Publisher tier:** emba's repo lives under `asgard-ai-platform`, so the owner-derived tier (§3.1) is **Core**, not Community. The §1 table's original `@shyuan`/Community framing was a pre-discovery guess; @shyuan (Chris Yuan) is the `plugin.json` author, but the org owns the repo. The Community publisher path stays unvalidated until a genuinely community-owned pack lands. The slice-3 e2e `fixme` asserting `data-publisher="community"` is updated to `core` in slice 4.
- ~~A sync-time extractor for `pack-content.json` must be written~~ — **done in slice 2** (`scripts/sync-gallery/sync-pack-content.mjs`); it already iterates every `kind: pack` entry, so emba is picked up once added.
- `content_maturity` honesty: majordomo shows 3 full / 26 skeleton today (gallery synced central-repo skeletons); surface this rather than implying all 29 are ready.

## 11. Suggested implementation slices

1. **Schema + types + list split + pack card (taxonomy-only)** — `kind` field, loader default coalescing (§3.1), `/plugins` two sections, pack vs collection card (taxonomy badges + counts only), `Skills only` rendering. No filtering: unlike `/mcp` and `/skills`, the `/plugins` page has no `FilterBar` and 12 entries in two labelled sections don't warrant one (revisit if the list grows). **This slice is groundwork and does not ship to production on its own** — it labels packs but cannot yet install them; it ships together with slices 2–3, which add the install/setup experience.
2. **pack-content.json extractor** — build script over the two repos' manifests.
3. **Pack detail split-hero** — install tabs, setup accordions, use-cases-before-contents, `hasDepEdges` graph gate, handoff/self-test.
4. **emba onboarding** — the simplest end-to-end validation (no setup, 0 MCP, skills-only). Three coordinated, prereq-first changes: **(PR-1)** upstream the 13 `SKILL.md` to the central `skills` repo (§10 route A); **(PR-2)** align the emba repo to the extractor contract (§10: `## 安裝` install section, `docs/USE-CASES.md`, manual-clone primary); **(gallery PR)** add 13 `skills.yaml` entries + the emba `plugins.yaml` `kind: pack` entry, re-run `sync-skill-content` + `sync-pack-content` to commit the sidecars, un-`fixme` the skills-only e2e and switch its publisher assertion to `core`, and apply the §1/§10 corrections above.

## 12. Phase 2 (deferred)

`/packs` + `/packs/[slug]` route, Header nav entry, StatsBar 4th stat, homepage pack preview, contribute-a-pack template. Trigger at the threshold in §3.1.
