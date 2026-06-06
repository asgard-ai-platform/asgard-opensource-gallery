# Installable Packs — Slice 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the installable-pack **experience** — the pack detail page (split-hero: judge on the left, install on the right; setup/credentials; use-cases-before-contents; what's-inside; gated dependency graph; source) plus enriched pack **cards** (setup-state hero + use-case teaser + Install CTA) — by consuming the committed `data/pack-content.json` sidecar produced in Slice 2.

**Architecture:** `plugins/[slug].astro` branches on `plugin.kind`: a **pack** renders the new `PackDetail.astro`; a **collection** keeps today's recipe layout untouched. A small loader helper `getPackView()` computes the derived view-model (counts, `skills_only`, `hasDepEdges`). The pack experience is composed of focused components: `SetupStateBadge.astro` (a pill mirroring `StatusBadge`), `PackInstallPanel.astro` (the only client-JS component — harness tabs + copy-to-clipboard + handoff microcopy), and `PackDetail.astro` (hero + split + sections, using native `<details>` for the collapsible setup/use-case blocks so they need no JS). `PlugInCard.astro` gains a pack branch that reads the same sidecar for the setup badge + first-use-case teaser.

**Tech Stack:** Astro 5 (static), TypeScript, Tailwind CSS 3, the repo's `lang-en`/`lang-zh` i18n spans, Playwright e2e (`e2e/`). No new dependencies; client JS follows the repo's `init()` + `astro:after-swap` pattern (as in `FilterBar.astro` / `ecosystem.astro`).

**Source spec:** `docs/superpowers/specs/2026-06-05-installable-packs-experience-design.md` — screens §5.1–5.4, install UX §6, guardrails §9.

**Testing reality (read before starting):** This repo has **no unit-test runner for `src/`** (only `node --test scripts/sync-gallery/*.test.mjs` and Playwright `e2e/`). So per-task gates are `npm run build` (TypeScript/Astro compile) and a Playwright spec run against the preview server. Pure helpers in `data-loader.ts` are verified through rendered output, matching repo convention. The data this slice renders already exists and is committed (`data/pack-content.json` for `tw-ecommerce-majordomo`).

---

## Scope decisions (read before starting)

1. **`content_maturity` stays deferred.** The Slice-2 extractor does not populate it, and surfacing per-skill full/skeleton status needs a separate extractor pass (29 `SKILL.md` fetches). Slice 3's "What's inside" (§5.2 ④) therefore shows the grouped skills/MCP inventory **without** the maturity column. Maturity is a follow-up. (Listed in Out of scope.)
2. **The self-test handoff prompt (§5.4) is generic, component-derived, not from data.** `pack-content.json` carries no per-pack self-test string. `PackInstallPanel.astro` renders a generic bilingual "list what this pack can do now" prompt plus a next-step line keyed by `setup.status` (§6). This is honest for any pack and needs no new data.
3. **Collapsible blocks use native `<details>`/`<summary>`** — zero JS, accessible by default. The **only** custom client JS in this slice is the install panel's tab-switch + copy button.
4. **Collections are untouched.** `plugins/[slug].astro` branches on `kind`; the existing collection layout (MCP/SKILL card sections + graph + upgrade CTA) is preserved verbatim for `kind: 'collection'`. The `hasDepEdges` graph gate (§5.2 ⑤) is added on the **pack** branch only.
5. **Cards read the sidecar directly.** `PlugInCard.astro` calls `getPackContentBySlug(plugin.slug)` for packs (cached loader; cheap). No prop threading from `index.astro`.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/utils/data-loader.ts` | modify | Add `PackView` interface + `getPackView(plugin)` — derived view-model (`skill_count`, `mcp_count`, `skills_only`, `has_mcp`, `hasDepEdges`, `publisher_tier`) |
| `src/components/SetupStateBadge.astro` | create | The setup-state pill (`none` / `sandbox-ready` / `keys-required`), mirroring `StatusBadge.astro` |
| `src/components/PackInstallPanel.astro` | create | Install harness tabs + copyable command + handoff self-test; the only client-JS component |
| `src/components/PackDetail.astro` | create | The whole pack page body: hero, split-hero, ② setup, ③ use-cases, ④ what's inside, ⑤ graph (gated), ⑥ source, handoff footer |
| `src/pages/plugins/[slug].astro` | modify | Branch on `kind`: pack → `PackDetail`; collection → existing layout (unchanged) |
| `src/components/PlugInCard.astro` | modify | Pack branch: setup-state badge + use-case teaser + `Install →` CTA; collections unchanged |
| `e2e/pack-detail.spec.ts` | create | Playwright coverage: detail split-hero, install tabs, copy button, setup, use-cases-before-contents, graph gate, source; card enrichment |

---

## Reference: the data this slice renders

`getPackContentBySlug('tw-ecommerce-majordomo')` returns a `PackContent` (defined in `src/utils/data-loader.ts`):

```ts
interface PackContent {
  install: { harness: string; label: string; command: string; source: string; notes?: string }[];
  setup: {
    status: 'none' | 'sandbox-ready' | 'keys-required';
    summary: string;
    env_groups: {
      service: string; mcp_slug?: string; default_mode?: string; docs_url?: string; private?: boolean;
      vars: { name: string; required_when?: string; default?: string; description?: string; source: string }[];
    }[];
  };
  use_cases: { title: string; scenario?: string; prompt?: string; skills: string[]; mcp_servers: string[]; caveats?: string; maturity?: string }[];
  content_maturity?: Record<string, 'full' | 'skeleton' | 'unknown'>;
  source: { version?: string; license?: string; repository?: string; homepage?: string; keywords: string[]; manifest_urls: string[]; marketplace?: { name?: string; source?: string } };
}
```

For majordomo today: `install` has 6 tabs (`claude-code` first), `setup.status === 'sandbox-ready'` with 11 `env_groups`, 34 `use_cases`, `source.version === '0.1.0'`.

---

## Task 1: Loader — `getPackView()` derived view-model

**Files:**
- Modify: `src/utils/data-loader.ts` (append after `getPackContentBySlug`, the current end of file)

- [ ] **Step 1: Append the `PackView` interface and `getPackView` helper**

`hasDepEdges` means "at least one of the pack's skills `requires_mcp` an MCP that is also in the pack" — matching how `PlugInGraph.astro` computes edges (`src/components/PlugInGraph.astro:11-21`). Append to the end of `src/utils/data-loader.ts`:

```ts
/** Derived, non-stored view-model for a pack (spec §7). Computed from the
 *  plugin entry + the skills catalogue; never persisted in the sidecar. */
export interface PackView {
  skill_count: number;
  mcp_count: number;
  skills_only: boolean;
  has_mcp: boolean;
  /** True iff some pack skill's requires_mcp names an MCP that is also in the pack. */
  hasDepEdges: boolean;
  publisher_tier: 'core' | 'community' | null;
}

export function getPackView(plugin: PlugIn): PackView {
  const mcpCount = plugin.mcp_servers.length;
  const skillCount = plugin.skills.length;
  const skillSet = new Set(plugin.skills);
  const mcpSet = new Set(plugin.mcp_servers);
  const allSkills = getSkills();
  const hasDepEdges = allSkills.some(
    (s) => skillSet.has(s.slug) && (s.requires_mcp ?? []).some((m) => mcpSet.has(m)),
  );
  return {
    skill_count: skillCount,
    mcp_count: mcpCount,
    skills_only: mcpCount === 0,
    has_mcp: mcpCount > 0,
    hasDepEdges,
    publisher_tier: getPublisherTier(plugin.github),
  };
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: build completes (`[build] 408 page(s) built`), no TypeScript errors. Nothing calls `getPackView` yet, so the page count is unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/utils/data-loader.ts
git commit -m "feat(packs): getPackView derived view-model (counts, hasDepEdges)"
```

---

## Task 2: `SetupStateBadge.astro`

**Files:**
- Create: `src/components/SetupStateBadge.astro`

This mirrors `StatusBadge.astro` (`src/components/StatusBadge.astro`): a small rounded pill with a colour per state and bilingual `lang-en`/`lang-zh` labels. States map green/yellow/gray-red per spec §3.2: `none` ✓ (green), `sandbox-ready` ◐ (yellow), `keys-required` ● (red).

- [ ] **Step 1: Create the component**

Create `src/components/SetupStateBadge.astro`:

```astro
---
interface Props {
  status: 'none' | 'sandbox-ready' | 'keys-required';
}

const { status } = Astro.props;

const styles: Record<Props['status'], string> = {
  none: 'bg-gradient-to-r from-green-500 to-emerald-500 text-black',
  'sandbox-ready': 'bg-amber-500 text-black',
  'keys-required': 'bg-gradient-to-r from-red-500 to-rose-500 text-white',
};

const mark: Record<Props['status'], string> = {
  none: '✓',
  'sandbox-ready': '◐',
  'keys-required': '●',
};

const labelEn: Record<Props['status'], string> = {
  none: 'No setup',
  'sandbox-ready': 'Sandbox-ready',
  'keys-required': 'Keys required',
};

const labelZh: Record<Props['status'], string> = {
  none: '免設定',
  'sandbox-ready': 'Sandbox 可試',
  'keys-required': '需金鑰',
};
---

<span
  class={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${styles[status]}`}
  data-setup={status}
>
  <span aria-hidden="true">{mark[status]}</span>
  <span class="lang-en">{labelEn[status]}</span><span class="lang-zh">{labelZh[status]}</span>
</span>
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: build completes, no errors. Nothing renders it yet; page count unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/components/SetupStateBadge.astro
git commit -m "feat(packs): SetupStateBadge pill (none/sandbox-ready/keys-required)"
```

---

## Task 3: `PackInstallPanel.astro` (tabs + copy + handoff)

**Files:**
- Create: `src/components/PackInstallPanel.astro`

This is the right side of the split-hero (§5.2) and the only client-JS in the slice. It shows one tab per `install[]` entry (Claude Code first, as the data is already ordered), the selected tab's copyable command, a per-tab note, a "runs in your own terminal, not here" handoff line, a next-step line keyed by `setup.status` (§6), and a copyable generic self-test prompt (§5.4). Tab switching + copy use the repo's `init()` + `astro:after-swap` pattern (`src/components/FilterBar.astro:147`, `src/pages/ecosystem.astro:874`); state via a `.active` class and `data-harness` attributes (no IDs, so multiple panels are safe).

- [ ] **Step 1: Create the component**

Create `src/components/PackInstallPanel.astro`:

```astro
---
import type { PackInstall } from '../utils/data-loader';

interface Props {
  install: PackInstall[];
  status: 'none' | 'sandbox-ready' | 'keys-required';
}

const { install, status } = Astro.props;

// Next-step microcopy keyed by setup state (spec §6).
const nextStepEn: Record<Props['status'], string> = {
  none: 'No setup needed — just ask your agent.',
  'sandbox-ready': 'Works in sandbox/default mode now; add provider keys for live services.',
  'keys-required': 'Fill the required keys below, then ask your agent.',
};
const nextStepZh: Record<Props['status'], string> = {
  none: '無需設定 — 直接問你的 agent。',
  'sandbox-ready': '現在就能用 sandbox／預設模式；要串真實服務再填 provider 金鑰。',
  'keys-required': '先填下方必填金鑰，再問你的 agent。',
};

// Generic self-test prompt — works for any pack, no per-pack data needed (§5.4).
const selfTestEn = 'List what this pack lets you do now, with one example task.';
const selfTestZh = '列出這個套件現在能幫我做的事，並給我一個範例任務。';
---

<div class="pack-install glass-card rounded-xl p-5">
  <p class="text-sm font-semibold text-foreground mb-3">
    <span class="lang-en">Install</span><span class="lang-zh">安裝</span>
  </p>

  {install.length === 0 ? (
    <p class="text-sm text-muted-foreground">
      <span class="lang-en">No install command published yet — see the repository.</span>
      <span class="lang-zh">尚未提供安裝指令 — 請見原始碼倉庫。</span>
    </p>
  ) : (
    <>
      <div class="flex flex-wrap gap-1.5 mb-3" role="tablist">
        {install.map((tab, i) => (
          <button
            type="button"
            class={`install-tab text-xs px-2.5 py-1 rounded-md border transition-colors ${i === 0 ? 'active bg-primary/15 text-primary border-primary/30' : 'bg-accent text-muted-foreground border-border'}`}
            data-harness={tab.harness}
            role="tab"
            aria-selected={i === 0 ? 'true' : 'false'}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {install.map((tab, i) => (
        <div class={`install-panel ${i === 0 ? '' : 'hidden'}`} data-harness={tab.harness} role="tabpanel">
          <div class="relative">
            <pre class="text-xs bg-background/60 border border-border rounded-lg p-3 pr-12 overflow-x-auto"><code>{tab.command}</code></pre>
            <button
              type="button"
              class="copy-btn absolute top-2 right-2 text-[10px] px-2 py-1 rounded bg-accent text-muted-foreground border border-border hover:text-primary hover:border-primary/40 transition-colors"
              data-copy={tab.command}
            >
              <span class="copy-label lang-en">Copy</span><span class="copy-label lang-zh">複製</span>
            </button>
          </div>
          {tab.notes && (
            <p class="mt-2 text-xs text-muted-foreground">{tab.notes}</p>
          )}
        </div>
      ))}

      <p class="mt-3 text-xs text-amber-400/90 flex items-start gap-1.5">
        <span aria-hidden="true">⚠</span>
        <span>
          <span class="lang-en">Run this in your own terminal/agent — the gallery can't run it here.</span>
          <span class="lang-zh">在你自己的終端／agent 執行 — 此處無法代為執行。</span>
        </span>
      </p>

      <p class="mt-2 text-xs text-muted-foreground">
        <span class="lang-en">{nextStepEn[status]}</span><span class="lang-zh">{nextStepZh[status]}</span>
      </p>

      <div class="mt-3 border-t border-border pt-3">
        <p class="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
          <span class="lang-en">Self-test prompt</span><span class="lang-zh">自我測試提示</span>
        </p>
        <div class="relative">
          <pre class="text-xs bg-background/60 border border-border rounded-lg p-3 pr-12 whitespace-pre-wrap"><code class="lang-en">{selfTestEn}</code><code class="lang-zh">{selfTestZh}</code></pre>
          <button
            type="button"
            class="copy-btn absolute top-2 right-2 text-[10px] px-2 py-1 rounded bg-accent text-muted-foreground border border-border hover:text-primary hover:border-primary/40 transition-colors"
            data-copy-self="1"
          >
            <span class="copy-label lang-en">Copy</span><span class="copy-label lang-zh">複製</span>
          </button>
        </div>
      </div>
    </>
  )}
</div>

<script>
  function initPackInstall() {
    document.querySelectorAll('.pack-install').forEach((root) => {
      const tabs = root.querySelectorAll<HTMLButtonElement>('.install-tab');
      const panels = root.querySelectorAll<HTMLElement>('.install-panel');
      tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
          const h = tab.dataset.harness;
          tabs.forEach((t) => {
            const on = t.dataset.harness === h;
            t.classList.toggle('active', on);
            t.classList.toggle('bg-primary/15', on);
            t.classList.toggle('text-primary', on);
            t.classList.toggle('border-primary/30', on);
            t.classList.toggle('bg-accent', !on);
            t.classList.toggle('text-muted-foreground', !on);
            t.classList.toggle('border-border', !on);
            t.setAttribute('aria-selected', on ? 'true' : 'false');
          });
          panels.forEach((p) => p.classList.toggle('hidden', p.dataset.harness !== h));
        });
      });

      root.querySelectorAll<HTMLButtonElement>('.copy-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          let text = btn.dataset.copy;
          if (btn.dataset.copySelf) {
            // copy the prompt for the currently-active language
            const lang = document.documentElement.getAttribute('data-lang') || 'en';
            const code = btn.parentElement?.querySelector<HTMLElement>(`code.lang-${lang}`);
            text = code?.textContent || '';
          }
          if (!text) return;
          try {
            await navigator.clipboard.writeText(text);
            const labels = btn.querySelectorAll<HTMLElement>('.copy-label');
            labels.forEach((l) => { l.textContent = l.classList.contains('lang-zh') ? '已複製' : 'Copied'; });
            // idempotent restore — safe under rapid double-clicks (no per-element state)
            setTimeout(() => labels.forEach((l) => { l.textContent = l.classList.contains('lang-zh') ? '複製' : 'Copy'; }), 1500);
          } catch {
            /* clipboard blocked (e.g. insecure context) — no-op */
          }
        });
      });
    });
  }
  initPackInstall();
  document.addEventListener('astro:after-swap', initPackInstall);
</script>
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: build completes, no TypeScript/Astro errors. Nothing renders it yet; page count unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/components/PackInstallPanel.astro
git commit -m "feat(packs): PackInstallPanel — harness tabs, copy, handoff self-test"
```

---

## Task 4: `PackDetail.astro` (the pack page body)

**Files:**
- Create: `src/components/PackDetail.astro`

Assembles the whole pack experience per §5.2 top-to-bottom. Uses `SetupStateBadge` + `PackInstallPanel`, native `<details>` for the collapsible ② setup and ③ use-case blocks, reuses `PlugInGraph` for ⑤ (gated on `hasDepEdges && nodes ≤ GRAPH_NODE_LIMIT`), and lists ④ "What's inside" as compact grouped name lists (not full cards — secondary, collapsed in `<details>`). Guardrails (§9): never "0 MCP" (say "Skills only"); use-cases before contents; honest handoff.

- [ ] **Step 1: Create the component**

Create `src/components/PackDetail.astro`:

```astro
---
import type { McpServer, Skill, PlugIn } from '../types';
import type { PackContent, PackView } from '../utils/data-loader';
import SetupStateBadge from './SetupStateBadge.astro';
import PackInstallPanel from './PackInstallPanel.astro';
import PlugInGraph from './PlugInGraph.astro';

interface Props {
  plugin: PlugIn;
  content: PackContent | undefined;
  view: PackView;
  mcps: McpServer[];
  skills: Skill[];
}

const { plugin, content, view, mcps, skills } = Astro.props;

const status = content?.setup.status ?? 'none';
const install = content?.install ?? [];
const useCases = content?.use_cases ?? [];
const envGroups = content?.setup.env_groups ?? [];
const source = content?.source;
const publisher = view.publisher_tier;

// ⑤ graph: only when there are real edges AND the bipartite SVG stays legible.
const GRAPH_NODE_LIMIT = 12;
const showGraph = view.hasDepEdges && view.mcp_count + view.skill_count <= GRAPH_NODE_LIMIT;

// ③/left-hero teasers: first few use cases.
const teaserCases = useCases.slice(0, 3);
---

<div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
  <!-- Hero -->
  <div class="flex flex-wrap items-center gap-2 mb-3">
    <span class="rounded-full bg-primary/15 text-primary text-[10px] font-semibold px-2 py-0.5 border border-primary/30">PACK</span>
    {publisher && (
      <span
        class={`rounded-full text-[10px] font-semibold px-2 py-0.5 border ${publisher === 'core' ? 'bg-primary/15 text-primary border-primary/30' : 'bg-accent text-muted-foreground border-border'}`}
        data-publisher={publisher}
      >
        <span class="lang-en">{publisher === 'core' ? 'Core' : 'Community'}</span><span class="lang-zh">{publisher === 'core' ? '官方' : '社群'}</span>
      </span>
    )}
    <SetupStateBadge status={status} />
  </div>

  <h1 class="text-3xl font-bold mb-2 text-gradient name-bilingual">
    <span class="name-en">{plugin.name.en}</span>
    <span class="name-zh">{plugin.name.zh}</span>
  </h1>
  <p class="text-muted-foreground mb-8 max-w-3xl lang-en">{plugin.scenario.en}</p>
  <p class="text-muted-foreground mb-8 max-w-3xl lang-zh">{plugin.scenario.zh}</p>

  <!-- Split hero: judge (left) / act (right). Stacks on mobile. -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-12">
    <div class="glass-card rounded-xl p-5">
      <p class="text-sm font-semibold text-foreground mb-3">
        <span class="lang-en">You can ask it</span><span class="lang-zh">你可以問它</span>
      </p>
      {teaserCases.length > 0 ? (
        <ul class="space-y-2">
          {teaserCases.map((uc) => (
            <li class="text-sm text-muted-foreground flex gap-2">
              <span class="text-primary" aria-hidden="true">·</span>
              <span>{uc.title}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p class="text-sm text-muted-foreground">
          <span class="lang-en">See the use cases below.</span><span class="lang-zh">請見下方使用情境。</span>
        </p>
      )}
    </div>
    <PackInstallPanel install={install} status={status} />
  </div>

  <!-- ② Setup -->
  <section class="mb-12">
    <h2 class="text-xl font-bold text-foreground mb-4">
      <span class="lang-en">Setup</span><span class="lang-zh">設定</span>
    </h2>
    {status === 'none' ? (
      <div class="glass-card rounded-xl p-5 border-green-500/20">
        <p class="text-sm text-foreground font-medium">
          <span class="lang-en">✓ No setup required — install and use.</span>
          <span class="lang-zh">✓ 無需設定 — 安裝即用。</span>
        </p>
      </div>
    ) : (
      <div class="space-y-3">
        {content?.setup.summary && (
          <p class="text-sm text-muted-foreground">{content.setup.summary}</p>
        )}
        <p class="text-xs text-muted-foreground">
          <span class="lang-en">Fill only the services you plan to use — a missing variable disables that one MCP, not the whole pack.</span>
          <span class="lang-zh">只填你要用的服務 — 缺少變數只會停用該 MCP，不影響整個套件。</span>
        </p>
        {envGroups.map((g) => (
          <details class="glass-card rounded-xl overflow-hidden">
            <summary class="cursor-pointer select-none px-4 py-3 text-sm font-medium text-foreground flex items-center gap-2">
              <span>{g.service}</span>
              {g.default_mode && (
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-accent text-muted-foreground border border-border">{g.default_mode}</span>
              )}
              {g.private && (
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                  <span class="lang-en">private access</span><span class="lang-zh">需私有存取</span>
                </span>
              )}
            </summary>
            <div class="px-4 pb-4 space-y-1.5">
              {g.vars.map((v) => (
                <div class="text-xs flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <code class="text-foreground">{v.name}</code>
                  {v.default ? (
                    <span class="text-muted-foreground">= {v.default}</span>
                  ) : v.required_when === 'conditional' ? (
                    <span class="text-amber-400/80"><span class="lang-en">conditional</span><span class="lang-zh">視情況</span></span>
                  ) : (
                    <span class="text-red-400/80"><span class="lang-en">required</span><span class="lang-zh">必填</span></span>
                  )}
                  {v.description && <span class="text-muted-foreground/70">— {v.description}</span>}
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    )}
  </section>

  <!-- ③ What you can ask it (use cases BEFORE inventory) -->
  {useCases.length > 0 && (
    <section class="mb-12">
      <h2 class="text-xl font-bold text-foreground mb-4">
        <span class="lang-en">What you can ask it</span><span class="lang-zh">你可以請它做什麼</span>
        <span class="text-sm font-normal text-muted-foreground">({useCases.length})</span>
      </h2>
      <div class="space-y-2">
        {useCases.map((uc) => (
          <details class="glass-card rounded-xl overflow-hidden">
            <summary class="cursor-pointer select-none px-4 py-3 text-sm font-medium text-foreground">{uc.title}</summary>
            <div class="px-4 pb-4 space-y-3 text-sm">
              {uc.scenario && <p class="text-muted-foreground">{uc.scenario}</p>}
              {uc.prompt && (
                <pre class="text-xs bg-background/60 border border-border rounded-lg p-3 overflow-x-auto whitespace-pre-wrap"><code>{uc.prompt}</code></pre>
              )}
              {(uc.skills.length > 0 || uc.mcp_servers.length > 0) && (
                <div class="flex flex-wrap gap-1.5">
                  {uc.skills.map((s) => <span class="text-[10px] px-1.5 py-0.5 rounded bg-accent text-muted-foreground border border-border">{s}</span>)}
                  {uc.mcp_servers.map((m) => <span class="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary/80 border border-primary/20">{m}</span>)}
                </div>
              )}
              {uc.caveats && (
                <p class="text-xs text-amber-400/80">⚠ {uc.caveats}</p>
              )}
            </div>
          </details>
        ))}
      </div>
    </section>
  )}

  <!-- ④ What's inside (secondary, collapsed) -->
  <section class="mb-12">
    <details class="glass-card rounded-xl overflow-hidden">
      <summary class="cursor-pointer select-none px-4 py-3 text-sm font-medium text-foreground">
        <span class="lang-en">What's inside</span><span class="lang-zh">內容物</span>
        <span class="text-muted-foreground">
          — {view.skill_count} <span class="lang-en">skills</span><span class="lang-zh">技能</span>
          {view.has_mcp ? (
            <span>· {view.mcp_count} MCP</span>
          ) : (
            <span> · <span class="lang-en">Skills only</span><span class="lang-zh">純技能</span></span>
          )}
        </span>
      </summary>
      <div class="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <p class="text-xs uppercase tracking-wide text-muted-foreground mb-2">SKILLs ({skills.length})</p>
          <ul class="space-y-1">
            {skills.map((s) => (
              <li class="text-xs"><a href={`/skills/${s.slug}/`} class="text-muted-foreground hover:text-primary transition-colors">{s.name.en}</a></li>
            ))}
          </ul>
        </div>
        {view.has_mcp && (
          <div>
            <p class="text-xs uppercase tracking-wide text-muted-foreground mb-2">MCP ({mcps.length})</p>
            <ul class="space-y-1">
              {mcps.map((m) => (
                <li class="text-xs"><a href={`/mcp/${m.slug}/`} class="text-muted-foreground hover:text-primary transition-colors">{m.name.en}</a></li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  </section>

  <!-- ⑤ Dependency graph (gated) -->
  {showGraph && (
    <section class="mb-12">
      <h2 class="text-xl font-bold mb-4 text-foreground">
        <span class="lang-en">Dependency Graph</span><span class="lang-zh">依賴關係圖</span>
      </h2>
      <div class="glass-card rounded-xl p-6">
        <PlugInGraph mcpServers={mcps} skills={skills} />
      </div>
    </section>
  )}

  <!-- ⑥ Source -->
  {source && (
    <section class="mb-8">
      <h2 class="text-xl font-bold mb-4 text-foreground">
        <span class="lang-en">Source</span><span class="lang-zh">來源</span>
      </h2>
      <div class="glass-card rounded-xl p-5 text-sm space-y-2">
        <div class="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
          {source.version && <span><span class="lang-en">Version</span><span class="lang-zh">版本</span> {source.version}</span>}
          {source.license && <span><span class="lang-en">License</span><span class="lang-zh">授權</span> {source.license}</span>}
        </div>
        <div class="flex flex-wrap gap-3 pt-1">
          {plugin.github && <a href={plugin.github} target="_blank" rel="noopener" class="text-primary hover:underline">GitHub</a>}
          {source.manifest_urls.map((u) => (
            <a href={u} target="_blank" rel="noopener" class="text-muted-foreground hover:text-primary">{u.split('/').pop()}</a>
          ))}
        </div>
      </div>
    </section>
  )}

  <!-- Handoff footer -->
  <p class="text-xs text-muted-foreground border-t border-border pt-4">
    <span class="lang-en">Copy the command above and run it in your own agent — the gallery hands off here; it can't run the pack for you.</span>
    <span class="lang-zh">複製上方指令並在你自己的 agent 執行 — 畫廊在此交棒，無法代為執行此套件。</span>
  </p>
</div>
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: build completes, no errors. Still not wired into a page; page count unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/components/PackDetail.astro
git commit -m "feat(packs): PackDetail body — split-hero, setup, use-cases, inside, graph, source"
```

---

## Task 5: Branch `plugins/[slug].astro` on kind

**Files:**
- Modify: `src/pages/plugins/[slug].astro`

Render `PackDetail` for packs; keep the existing collection layout verbatim for collections. The collection branch keeps today's `GRAPH_NODE_LIMIT` behaviour; the pack branch's graph gate lives inside `PackDetail`.

- [ ] **Step 1: Add imports + pack branch**

In `src/pages/plugins/[slug].astro`, update the frontmatter imports (currently lines 1-9) to add the pack pieces. Change the import block to:

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import McpCard from '../../components/McpCard.astro';
import SkillCard from '../../components/SkillCard.astro';
import CardGrid from '../../components/CardGrid.astro';
import PlugInGraph from '../../components/PlugInGraph.astro';
import PackDetail from '../../components/PackDetail.astro';
import { getPlugIns, getMcpServers, getSkills, getPackContentBySlug, getPackView } from '../../utils/data-loader';
import { getUpgradeLink } from '../../utils/upgrade-link';
import type { PlugIn } from '../../types';

export function getStaticPaths() {
  const plugins = getPlugIns();
  return plugins.map((plugin) => ({
    params: { slug: plugin.slug },
    props: { plugin },
  }));
}

const { plugin } = Astro.props as { plugin: PlugIn };
const allMcp = getMcpServers();
const allSkills = getSkills();

const pluginMcps = allMcp.filter((m) => plugin.mcp_servers.includes(m.slug));
const pluginSkills = allSkills.filter((s) => plugin.skills.includes(s.slug));
const upgradeLink = plugin.upgrade_to ? getUpgradeLink(plugin.upgrade_to) : null;

const isPack = plugin.kind === 'pack';
const packContent = isPack ? getPackContentBySlug(plugin.slug) : undefined;
const packView = isPack ? getPackView(plugin) : null;

// The bipartite dependency graph only stays legible for small plugins; large packs
// (e.g. majordomo's 12 MCP x 29 skills) collapse into unreadable crossing lines and
// an 1800px-tall SVG. Skip it past a node-count threshold (collection branch).
const GRAPH_NODE_LIMIT = 12;
const showGraph = pluginMcps.length + pluginSkills.length <= GRAPH_NODE_LIMIT;
---
```

- [ ] **Step 2: Wrap the body in the pack/collection branch**

Replace the `<BaseLayout ...>` opening through the closing `</BaseLayout>` (currently lines 35-137) so the pack branch renders `PackDetail` and the collection branch keeps the existing markup. The collection markup below is **the exact current body** — do not change it; only wrap it in the `{!isPack && (...)}` / `{isPack && (...)}` branches:

```astro
<BaseLayout title={plugin.name.en} description={plugin.description.en}>
  {isPack && packView && (
    <PackDetail plugin={plugin} content={packContent} view={packView} mcps={pluginMcps} skills={pluginSkills} />
  )}

  {!isPack && (
    <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 class="text-3xl font-bold mb-3 text-gradient name-bilingual">
        <span class="name-en">{plugin.name.en}</span>
        <span class="name-zh">{plugin.name.zh}</span>
      </h1>
      <p class="text-muted-foreground mb-4 lang-en">{plugin.scenario.en}</p>
      <p class="text-muted-foreground mb-4 lang-zh">{plugin.scenario.zh}</p>

      {plugin.github && (
        <section class="flex flex-wrap gap-4 mb-8">
          <a href={plugin.github} target="_blank" rel="noopener" class="inline-flex items-center gap-2 px-4 py-2 glass-card rounded-lg text-sm text-foreground hover:border-primary/40 transition-colors">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            GitHub
          </a>
        </section>
      )}

      <section class="mb-12">
        <div class="flex items-center gap-3 mb-6">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500/20 to-cyan-500/20 border border-border flex items-center justify-center">
            <svg class="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
            </svg>
          </div>
          <h2 class="text-xl font-bold text-foreground">
            <span class="lang-en">MCP Servers</span><span class="lang-zh">MCP 伺服器</span> ({pluginMcps.length})
          </h2>
        </div>
        <CardGrid>
          {pluginMcps.map((m) => <McpCard server={m} />)}
        </CardGrid>
      </section>

      <section class="mb-12">
        <div class="flex items-center gap-3 mb-6">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-border flex items-center justify-center">
            <svg class="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <h2 class="text-xl font-bold text-foreground">
            <span class="lang-en">SKILLs</span><span class="lang-zh">技能</span> ({pluginSkills.length})
          </h2>
        </div>
        <CardGrid>
          {pluginSkills.map((s) => <SkillCard skill={s} />)}
        </CardGrid>
      </section>

      {showGraph && (
        <section class="mb-12">
          <h2 class="text-xl font-bold mb-6 text-foreground">
            <span class="lang-en">Dependency Graph</span><span class="lang-zh">依賴關係圖</span>
          </h2>
          <div class="glass-card rounded-xl p-6">
            <PlugInGraph mcpServers={pluginMcps} skills={pluginSkills} />
          </div>
        </section>
      )}

      {plugin.upgrade_to && (
        <section class="relative overflow-hidden bg-gradient-to-r from-green-500/10 via-cyan-500/10 to-green-500/10 border border-primary/20 rounded-xl p-8 text-center">
          <div class="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-3xl"></div>
          <div class="relative">
            <h2 class="text-2xl font-bold text-primary mb-3">
              <span class="lang-en">Upgrade to</span><span class="lang-zh">升級至</span> {plugin.upgrade_to}
            </h2>
            {plugin.upgrade_description && (
              <div>
                <p class="text-muted-foreground mb-2 lang-en">{plugin.upgrade_description.en}</p>
                <p class="text-muted-foreground mb-2 lang-zh">{plugin.upgrade_description.zh}</p>
              </div>
            )}
            <p class="text-sm text-muted-foreground lang-en">
              Get enterprise-grade features, SLAs, and dedicated support.
            </p>
            <p class="text-sm text-muted-foreground lang-zh">
              取得企業級功能、SLA 與專屬支援。
            </p>
            {upgradeLink && (
              <a
                href={upgradeLink.href}
                target="_blank"
                rel="noopener"
                class="mt-6 inline-block btn-gradient px-6 py-3 rounded-lg text-sm font-semibold"
              >
                {upgradeLink.hasDedicatedPage ? (
                  <>
                    <span class="lang-en">Learn More About {plugin.upgrade_to} &rarr;</span><span class="lang-zh">了解 {plugin.upgrade_to} &rarr;</span>
                  </>
                ) : (
                  <>
                    <span class="lang-en">View Asgard Products &rarr;</span><span class="lang-zh">查看 Asgard 產品 &rarr;</span>
                  </>
                )}
              </a>
            )}
          </div>
        </section>
      )}
    </div>
  )}
</BaseLayout>
```

- [ ] **Step 3: Build and smoke-check the pages**

Run: `npm run build`
Expected: build completes with the **same page count** as before (408 — this adds no routes, only changes the pack detail body). No errors.

- [ ] **Step 4: Manually verify the majordomo page renders the pack experience**

Run:
```bash
npm run build && npm run preview &
sleep 2
curl -s http://localhost:4321/plugins/tw-ecommerce-majordomo/ | grep -c 'pack-install\|You can ask it\|install-tab'
kill %1
```
Expected: a non-zero count (the pack install panel + "You can ask it" hero rendered). If zero, the branch didn't take — confirm `plugin.kind === 'pack'` for majordomo in `data/plugins.yaml`.

- [ ] **Step 5: Commit**

```bash
git add "src/pages/plugins/[slug].astro"
git commit -m "feat(packs): render PackDetail for kind:pack; collections unchanged"
```

---

## Task 6: Enrich `PlugInCard.astro` for packs

**Files:**
- Modify: `src/components/PlugInCard.astro`

Per §5.1, the pack card adds: the **setup-state** badge (in the header, next to PACK/publisher), a **use-case teaser** line (first use case), and an **`Install →`** CTA. Counts move to muted/secondary. Collections render exactly as today. The card reads `getPackContentBySlug(plugin.slug)` for the status + teaser. The CTA is a styled `<span>` (not a nested `<a>` — the whole card is already an anchor).

- [ ] **Step 1: Rewrite `PlugInCard.astro`**

Replace the entire contents of `src/components/PlugInCard.astro` with:

```astro
---
import type { PlugIn } from '../types';
import { getPublisherTier, getPackContentBySlug } from '../utils/data-loader';
import SetupStateBadge from './SetupStateBadge.astro';

interface Props {
  plugin: PlugIn;
}

const { plugin } = Astro.props;
// kind is normalised to 'collection' | 'pack' by data-loader.getPlugIns().
const kind = plugin.kind;
const isPack = kind === 'pack';
const publisher = isPack ? getPublisherTier(plugin.github) : null;
const mcpCount = plugin.mcp_servers.length;
const skillCount = plugin.skills.length;
const skillsOnly = mcpCount === 0;

const content = isPack ? getPackContentBySlug(plugin.slug) : undefined;
const setupStatus = content?.setup.status;
const teaser = content?.use_cases?.[0]?.title;
---

<a href={`/plugins/${plugin.slug}/`} class="card-link group border-border" data-kind={kind}>
  <div class="card-header from-blue-600 to-cyan-900">
    <div class="absolute inset-0 bg-gradient-to-t from-card via-transparent to-transparent"></div>
    {isPack && (
      <div class="absolute top-3 right-3 z-10 flex flex-wrap items-center justify-end gap-1.5">
        <span class="rounded-full bg-primary/15 text-primary text-[10px] font-semibold px-2 py-0.5 border border-primary/30">PACK</span>
        {publisher && (
          <span
            class={`rounded-full text-[10px] font-semibold px-2 py-0.5 border ${
              publisher === 'core'
                ? 'bg-primary/15 text-primary border-primary/30'
                : 'bg-accent text-muted-foreground border-border'
            }`}
            data-publisher={publisher}
          >
            <span class="lang-en">{publisher === 'core' ? 'Core' : 'Community'}</span>
            <span class="lang-zh">{publisher === 'core' ? '官方' : '社群'}</span>
          </span>
        )}
        {setupStatus && <SetupStateBadge status={setupStatus} />}
      </div>
    )}
    <div class="relative z-10">
      <div class="card-icon-letter">{plugin.name.en.charAt(0)}</div>
    </div>
  </div>

  <div class="relative p-5">
    <h3 class="font-semibold text-foreground text-lg group-hover:text-primary transition-colors name-bilingual">
      <span class="name-en">{plugin.name.en}</span>
      <span class="name-zh">{plugin.name.zh}</span>
    </h3>
    <p class="card-desc lang-en">{plugin.scenario.en}</p>
    <p class="card-desc lang-zh">{plugin.scenario.zh}</p>

    {isPack && teaser && (
      <p class="mt-3 text-xs text-muted-foreground/90 line-clamp-1">
        <span class="text-primary" aria-hidden="true">▸ </span>{teaser}
      </p>
    )}

    {isPack && (
      <span class="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary group-hover:gap-1.5 transition-all">
        <span class="lang-en">Install</span><span class="lang-zh">安裝</span> &rarr;
      </span>
    )}

    <div class={`mt-4 flex items-center gap-4 text-xs text-muted-foreground ${isPack ? 'opacity-70' : ''}`}>
      {skillsOnly ? (
        <span class="card-badge"><span class="lang-en">Skills only</span><span class="lang-zh">純技能</span></span>
      ) : (
        <span class="card-badge">
          {mcpCount} <span class="lang-en">MCPs</span><span class="lang-zh">個 MCP</span>
        </span>
      )}
      <span class="card-badge">
        {skillCount} <span class="lang-en">SKILLs</span><span class="lang-zh">個技能</span>
      </span>
    </div>
  </div>

  {plugin.upgrade_to && (
    <div class="px-5 pb-4 text-xs text-primary/70 font-medium">
      &rarr; {plugin.upgrade_to}
    </div>
  )}
</a>
```

- [ ] **Step 2: Build and verify the cards render**

Run: `npm run build`
Expected: build completes, page count unchanged (408). No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/PlugInCard.astro
git commit -m "feat(packs): pack card shows setup state, use-case teaser, Install CTA"
```

---

## Task 7: e2e coverage

**Files:**
- Create: `e2e/pack-detail.spec.ts`

Mirrors the style of `e2e/plugins-packs.spec.ts` (Playwright, `BASE = 'http://localhost:4321'`). Covers the detail experience and the card enrichment against the live majordomo data.

- [ ] **Step 1: Write the spec**

Create `e2e/pack-detail.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:4321';
const PACK = `${BASE}/plugins/tw-ecommerce-majordomo/`;

test.describe('Pack detail — majordomo', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('hero shows PACK + Core + Sandbox-ready badges', async ({ page }) => {
    await page.goto(PACK);
    await expect(page.getByText('PACK', { exact: true }).first()).toBeVisible();
    await expect(page.locator('[data-publisher="core"]').first()).toBeVisible();
    await expect(page.locator('[data-setup="sandbox-ready"]').first()).toBeVisible();
  });

  test('install panel: Claude Code tab active first, command visible', async ({ page }) => {
    await page.goto(PACK);
    const panel = page.locator('.pack-install');
    await expect(panel).toBeVisible();
    const firstTab = panel.locator('.install-tab').first();
    await expect(firstTab).toHaveClass(/active/);
    await expect(panel.locator('.install-panel:not(.hidden) code')).toContainText('/plugin install');
  });

  test('install tabs switch on click', async ({ page }) => {
    await page.goto(PACK);
    const panel = page.locator('.pack-install');
    await panel.locator('.install-tab[data-harness="cursor"]').click();
    await expect(panel.locator('.install-panel[data-harness="cursor"]')).not.toHaveClass(/hidden/);
    await expect(panel.locator('.install-panel[data-harness="claude-code"]')).toHaveClass(/hidden/);
  });

  test('copy buttons exist in the install panel', async ({ page }) => {
    await page.goto(PACK);
    expect(await page.locator('.pack-install .copy-btn').count()).toBeGreaterThan(0);
  });

  test('use cases appear before "What\'s inside" in the DOM', async ({ page }) => {
    await page.goto(PACK);
    const order = await page.evaluate(() => {
      const uc = document.evaluate("//h2[contains(., 'What you can ask it') or contains(., '你可以請它做什麼')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      const inside = document.evaluate("//summary[contains(., \"What's inside\") or contains(., '內容物')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      if (!uc || !inside) return 0;
      return uc.compareDocumentPosition(inside) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1;
    });
    expect(order).toBe(1);
  });

  test('setup section lists provider groups (ECPay)', async ({ page }) => {
    await page.goto(PACK);
    await expect(page.getByText('ECPay 綠界').first()).toBeVisible();
  });

  test('dependency graph is omitted for the 41-node pack', async ({ page }) => {
    await page.goto(PACK);
    await expect(page.getByRole('heading', { name: /Dependency Graph|依賴關係圖/ })).toHaveCount(0);
  });

  test('source section links to GitHub + manifests', async ({ page }) => {
    await page.goto(PACK);
    await expect(page.getByRole('link', { name: 'GitHub' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'plugin.json' })).toBeVisible();
  });
});

test.describe('Pack card enrichment — /plugins list', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('majordomo card shows setup state + Install CTA', async ({ page }) => {
    await page.goto(`${BASE}/plugins/`);
    const card = page.locator('a[href="/plugins/tw-ecommerce-majordomo/"]');
    await expect(card.locator('[data-setup="sandbox-ready"]')).toBeVisible();
    await expect(card.getByText('Install', { exact: false }).first()).toBeVisible();
  });
});
```

- [ ] **Step 2: Build, start preview, run the spec**

Run:
```bash
npm run build
npm run preview &
npx playwright test e2e/pack-detail.spec.ts
kill %1
```
Expected: all tests pass. If the preview server is already running on :4321, skip the `npm run preview &` / `kill %1` lines. If the copy-button test fails because clipboard is blocked, note that the spec only asserts the buttons **exist** (it does not invoke clipboard), so it should pass regardless.

- [ ] **Step 3: Run the full e2e suite (no regressions)**

Run: `npx playwright test`
Expected: the existing suites (including `e2e/plugins-packs.spec.ts`) still pass plus the new file. The `test.fixme` skills-only case in `plugins-packs.spec.ts` stays skipped (it activates in Slice 4).

- [ ] **Step 4: Commit**

```bash
git add e2e/pack-detail.spec.ts
git commit -m "test(packs): e2e for pack detail experience + card enrichment"
```

---

## Final verification

- [ ] `npm run build` → 408 pages, no errors (this slice adds no routes)
- [ ] `npm run validate` → `✅ All checks passed!` (unchanged — no data/schema change)
- [ ] `npx playwright test` → green (new `pack-detail.spec.ts` + existing suites; 1 `fixme` skipped)
- [ ] Manual smoke at `/plugins/tw-ecommerce-majordomo/`: hero badges (PACK/Core/Sandbox-ready), split-hero with install tabs that switch + copy, setup accordions with conditional/required/default markers, use-cases **above** "What's inside", **no** dependency graph (41 nodes), source links. Collection pages (e.g. `/plugins/tw-ecommerce-ops/`) look exactly as before.

## Out of scope (later slices / follow-ups)

- **`content_maturity`** (full/skeleton per skill in §5.2 ④) — needs a separate extractor pass over each `SKILL.md`; "What's inside" here shows the inventory without it. Follow-up.
- **emba-famulus** onboarding (the `none`/`Skills only`/`community` pack) → **Slice 4**. This slice's `SetupStateBadge` `none` branch, the `PackDetail` `status === 'none'` setup block, and the card `Skills only` path are all implemented and will activate when emba lands; Slice 4 un-`fixme`s the skills-only e2e in `plugins-packs.spec.ts`.
- **Per-provider `docs_url`** links in the setup accordion (`PackEnvGroup.docs_url` exists in the type but the extractor does not populate it yet) — render when the extractor provides it.
- **§5.3 copy-template actions** ("Copy group template", "Copy full `.env.example`", "View provider docs"). The sidecar stores the **parsed** `env_groups`, not the raw `.env.example`, and `docs_url` is unpopulated — so these affordances need either a reconstructed template or extra extractor fields. The setup accordion here shows what to fill (names, defaults, required/conditional) without the one-click template. Follow-up.
- **Phase 2** (`/packs` route, nav entry, homepage stat, contribute template) — spec §12, deferred at the count threshold.
```
