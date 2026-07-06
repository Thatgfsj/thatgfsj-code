# Changelog

All notable changes to **Thatgfsj Code** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [2.2.3 / 产品 0.4.0] - 2026-07-06  - 双版本号: npm 走 2.2.x,产品显示 0.4.0

> 这个项目现在有**两套版本号**,互不干涉:
>
> | 位置 | 版本 | 含义 |
> |---|---|---|
> | `package.json` `"version"` | `2.2.3` | npm 包版本,每次发布 +0.0.1,正常递增 |
> | `src/cmd/index.tsx` `.version(...)` | `0.4.0` | **产品版本**,`gfcode --version` 看到的,反映代码栈的实质 |
>
> 这样做的原因:产品版本稳定在 `0.4.0` (代表"v1.0.4 Ink 源码栈"),用户看到
> 这个版本号就知道是稳定的 1.0.4 架构;npm 版本继续 2.x 系列,方便
> `^2.0.0` 用户平滑升级,不被 1.x 的版本号打断。

### 改动
- `package.json` `version`: `2.2.2` → `2.2.3`
- `src/cmd/index.tsx` `.version('2.2.2')` → `.version('0.4.0')`
- **源码**:`src/` 全部文件**逐字照搬** v1.0.4 npm tarball (Ink + React 全屏
  REPL + per-provider `LLMProvider` + 完整 `StreamChunk` enum + 真实 agent loop)
- **CHANGELOG.md**:重写为双版本号说明

### 修复的两个用户报告 bug (来自 v2.x 时代)
- **"AI 回答跳到顶部"**:v2.x 用 `process.stdout.write(chunk)` 直接写
  terminal,长文本没有 `\n` 时光标停在行末,终端自动换行触发滚动
  → 用户感知为"跳到顶部"。本产品版本基于 v1.0.4 Ink 渲染栈,viewport 由
  Ink 自己管理,问题不复存在。
- **"工具调用中断"**:v2.x 的 `extractToolCalls` 是 `return undefined` 的
  占位,`delta.tool_calls` 在 SSE 解析时被 `extractChunkText` 丢弃,agent
  loop 的工具分支永远进不去。本产品版本的 `LLMService.chatStream` +
  `OpenAIProvider` / `AnthropicProvider` / `GeminiProvider` 完整实现三
  个 provider 的 tool_call 流式解析,工具真正能跑。

### npm 清理记录
本会话期间 unpublish 了 (<72h 可 unpublish 的部分):
- `1.0.4`、`1.0.5`、`2.0.0`、`2.1.0`、`2.1.1`、`2.1.2`、`2.1.3`、`2.1.4`、
  `2.2.0`、`2.2.1`、`2.2.2`
- npm 上剩余 `0.2.1` ~ `1.0.3` (35 个老版本,>72h 不能 unpublish) +
  本次发布的 `2.2.3`

### 安装
- `npm i -g thatgfsj-code` → 默认拉 `2.2.3` (= 产品 `0.4.0`)
- `npm i -g thatgfsj-code@^2.0.0` → 兼容
- `gfcode --version` → 输出 `0.4.0`