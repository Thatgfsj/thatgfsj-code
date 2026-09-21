# Development Guide

> 本文档对应 v3.0.18 的实际代码结构。旧版（v0.x–v2.x，`src/core/ai-engine` /
> `src/repl` 架构）的开发文档已废弃。

## 版本号策略（必须遵守）

**每次发版 patch 位 +1（数值 +0.01）：`3.5.0 → 3.5.1 → 3.5.2 → … → 3.5.20`。**

- 无论是修 bug、新功能还是重构，一律 +0.01，**不做 minor 跳版**
  （3.5.0 → 3.6.0 是错误示范；3.6.0 已废弃，内容由 3.5.2 取代）。
- 发版命令：`npm version 3.5.N --no-git-tag-version`，tag 用 `v3.5.N`。
- bump 前确认上一版本号：`npm view thatgfsj-code version`。

## 环境要求

- Node.js >= 20.19（ink 7 / react 19 / vitest 4 的要求）
- npm >= 10

## 常用命令

```bash
npm install          # 安装依赖
npm run build        # tsc 编译到 dist/
npm test             # vitest 单测（tests/**/*.test.ts）
npm run smoke        # build + 4 个端到端 smoke 脚本（依赖 dist）
npm run dev          # build 并启动 CLI
npm link             # 全局注册 thatgfsj / gfcode 命令
npm publish          # 触发 prepublishOnly（build + test）后发布
```

## 目录结构

```
src/
├── cmd/index.tsx   # CLI 入口：交互 / 单次 prompt / --json headless / init
├── app/index.ts    # App 单例：组装依赖、权限决策（requestConfirmation）、
│                   #   reloadModel / applyTtl / MCP 接线 / streamResponse
├── version.ts      # 版本单一来源（运行时读 package.json）
├── config/         # ConfigManager + 15 个 Provider 目录（providers.ts）
├── llm/            # LLMService（agent loop）+ openai/anthropic/gemini 三协议
├── cache/          # Prompt caching：stableStringify、断点、smartModel TTL、统计
├── session/        # SessionManager（持久化/restore/自动压缩）+ compactor（原子组）
├── tools/          # Tool 接口 + file/shell/git/search/browser/nwt 实现
├── skills/         # 16 个内置 Skills（ts 提示词）
├── tui/            # Ink 组件（app.tsx 组合 useChat/useCommands）
├── mcp/client.ts   # MCP stdio 客户端 + MCPServerManager
├── setup/          # browser-setup.ts：首次运行浏览器引导
├── hooks/          # HookManager（事件点尚未接入主流程）
├── prompts/        # 系统提示分段构建（immutable prefix + volatile tail）
└── utils/          # diff、thinking 压缩、stableStringify、project context
```

## 一条消息的完整数据流

```
UserInput (tui/components/UserInput.tsx)
  → app.tsx onSubmit → useCommands（斜杠命令）或 useChat.processStream
    → App.streamResponse（注入 AbortSignal、采集 usage）
      → LLMService.chatStream（agent loop，最多 10 轮）
        → provider.chatStream（openai/anthropic/gemini SSE 解析）
        → 遇 tool_calls：确认（App.requestConfirmation）→ 执行 → [TOOL_REPAIR] 追加 → 下一轮
    → useChat setState → ChatList / Markdown / ToolCall 渲染
  → 每轮结束 app.session.persist() 落盘
```

## 权限管线

- 决策集中在 `App.requestConfirmation`：`permissionMode === 'accept'`（--yolo / /yolo）
  直接放行；有 `confirmHandler`（TUI 确认框 / 单次模式 readline）就问；都没有
  （headless）拒绝并提示。
- 各工具自行在正确的动作上调用：
  - `shell`：每次执行前 `ctx.confirmAction`
  - `git`：仅写操作（commit/push/pull/checkout/add）确认
  - `file`：写走 `ctx.confirmEdit`（带 diff 预览），删除走 `ctx.confirmAction`
- TUI 侧确认框（ConfirmPrompt）渲染期间独占键盘输入，与 UserInput 互斥。

## 常见修改场景

**加一个 Provider**：`src/config/providers.ts` 加条目（选 format: openai/anthropic/gemini）
→ init 向导的 Provider 列表读同一 catalog，自动带上。

**加一个工具**：实现 `Tool` 接口（`src/tools/types.ts`）→ `src/tools/index.ts`
注册 → 系统提示的 Tools 段自动包含。危险动作记得接 `ctx.confirmAction/confirmEdit`。

**加一个斜杠命令**：`useCommands.ts` 加分支；需要异步（如热切换）就返回
`action`，由 `app.tsx onSubmit` 处理。

**改 LLM 请求体**：注意三家协议不同——请求构造在各 provider 的 `buildRequest`；
流式解析在 `chatStream`。改完跑 `npm run smoke`（有协议级回归测试）。

## 缓存前缀纪律（重要）

Anthropic 断点 + DeepSeek 自动前缀缓存都依赖**请求前缀字节稳定**：

- 历史消息只追加，不改写；工具失败用追加 `[TOOL_REPAIR]` 消息表达
- 压缩只在超过阈值时发生一次（compactor 原子组），不要在每轮插入内容
- TTL 会话内粘滞（`/ttl` 显式修改除外）；`reloadModel` 会重置 TTL

## 发布检查单

1. `npm test` 全绿
2. `npm run smoke` 全过
3. 更新 `CHANGELOG.md`
4. bump `package.json` version + `npm install --package-lock-only` 同步 lock
5. `npm pack --dry-run` 确认 tarball 含 `dist/` 且不含 `src/`
6. `git push origin main`
7. （仅分支整理时，顺序不能反）先 `gh repo edit Thatgfsj/thatgfsj-code --default-branch main`
   把默认分支切到 main，**再**删除 origin/master、origin/clean-main；
   删前用 `git log main..master --oneline` 确认无未合并内容
8. `npm publish`（prepublishOnly 自动 build + test）
9. `npm view thatgfsj-code version` 复核

## 测试

- `tests/cache|session|tools|mcp/**/*.test.ts`：vitest 单测（纯逻辑 + tmpdir，无网络）
- `tests/smoke-*.mjs`：依赖 `dist/` 的端到端冒烟（先 `npm run build`）
