# tw-ecommerce-majordomo

> 一個 plugin 把 29 個 skills 和 12 個 MCP servers 一次塞進你的 coding agent。

## 前置需求

- 對應的 agent harness
- [`uv`](https://docs.astral.sh/uv/)

## 安裝

### Claude Code

```bash
# 註冊本 plugin 的 marketplace
/plugin marketplace add asgard-ai-platform/tw-ecommerce-majordomo

# 安裝
/plugin install tw-ecommerce-majordomo@tw-ecommerce-majordomo
```

### Codex CLI / App

```bash
# CLI
/plugins
# 搜尋 "tw-ecommerce-majordomo" → Install
```

或在 Codex App 的 Plugins 頁面搜尋安裝。

### Cursor

```bash
cursor plugin add asgard-ai-platform/tw-ecommerce-majordomo
```

> Cursor plugin 目前不會自動註冊 MCP servers — 把 [`mcp.json`](mcp.json) 的 `mcpServers` 區塊複製進 `~/.cursor/mcp.json`。

### Antigravity CLI (agy)

```bash
git clone https://github.com/asgard-ai-platform/tw-ecommerce-majordomo \
  .agents/plugins/tw-ecommerce-majordomo
```

### OpenCode

在 `opencode.json`（global 或 project）加入：

```json
{
  "plugin": ["tw-ecommerce-majordomo@git+https://github.com/asgard-ai-platform/tw-ecommerce-majordomo.git"]
}
```

### Factory Droid

```bash
droid plugin marketplace add https://github.com/asgard-ai-platform/tw-ecommerce-majordomo
droid plugin install tw-ecommerce-majordomo@tw-ecommerce-majordomo
```

## 設定 MCP 憑證

1. 把 `.env.example` 複製成 `.env`
