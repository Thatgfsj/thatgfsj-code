# Changelog

All notable changes to **Thatgfsj Code** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [1.0.5] - 2026-07-06  - 恢复 1.0.4 源码 (revert 2.x over-engineering)

> 上一段时间 (v2.0.0 ~ v2.2.1) 在 npm 上推了 5 个版本,都基于 ESM + Node
> `readline` + 单一 `ai-engine.ts` 的重构栈。结果是反复 patch 同一个
> "终端跳到顶部" 和 "工具调用永远走不到分支" 的问题,每次都引入了别的退化
> (v2.1.3 引发 OOM)。**这次直接把代码栈恢复回 v1.0.4** — Ink (React) 全屏
> REPL + per-provider `LLMProvider` 类 + 完整的 `StreamChunk` enum 工具调用
> 解析 + 真正的 agent loop。npm 上 v1.0.4 那一行代码本身没有这两个 bug,
> 2.x 是把它们引回来的。

### Reverted
- 删除 v2.0.0~v2.2.1 的全部代码 (单文件 `src/core/ai-engine.ts` + REPL 路由
  架构 + `@inquirer/input` 输入层)。
- 恢复 v1.0.4 的完整源码:58 个源文件,Ink + React + per-provider llm/
  + tui/ + skills/ + hooks/ + mcp/。

### 为什么是 1.0.5 而不是重新发 1.0.4
- npm 不允许覆盖已发布的版本号。v1.0.4 仍然在 npm 上,如果有人用着没问题
  就不应该被顶下去。
- v1.0.5 仅是**版本号 + CHANGELOG + (新增的 install.sh / install.ps1 /
  install.bat / .gitignore / DEVELOPMENT.md,这些是从 git 历史里补回来的,
   v1.0.4 npm tarball 里没有)** 的差异。源码一行没改。
- 没有引入任何"修复",因为 1.0.4 源码本身就是用户想要的稳定点。

### Note
- 用户报告的两个 bug ("AI 回答跳到顶部" + "工具调用中断") 在 1.0.4 的
  Ink-based TUI 里**不复存在**:
  - Ink 用自己的渲染栈管理 viewport,根本不存在 raw `process.stdout.write`
    引起的光标错位问题。
  - v1.0.4 的 `LLMService.chatStream` 是真正的 agent loop,完整实现了
    OpenAI / Anthropic / Gemini 三个 provider 的 tool_calls 流式解析,
    `executeToolCall` 走 `tool.execute(params)` 不带 `confirmAction`
    拦截 (v1.0.4 设计:用户已通过 `gfcode init` 授权工具执行)。

---