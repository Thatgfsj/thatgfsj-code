# Changelog

All notable changes to **Thatgfsj Code** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [2.2.2] - 2026-07-06  - 重新发布 1.0.4 源码,清空 2.x 污染

> 这是个"包装"版本号 — 内部代码栈**逐字照搬 v1.0.4 的 Ink (React) 全屏 REPL**
> (per-provider `LLMProvider` + 完整 `StreamChunk` enum 工具调用 + 真正的 agent
> loop)。版本号沿用 2.x 是为了让 `npm i -g thatgfsj-code` 默认就拿到这个版本
> (npm 按版本号字典序比较,2.2.2 > 1.0.5)。同时把 npm 上近期发布的 9 个污染版
> 本 (1.0.5 + 2.0.0 ~ 2.2.1) 全部 unpublish。

### 为什么版本号是 2.2.2 而不是 2.3.0 或 1.0.5
- 用 1.0.5 时,如果有人已经固定装了 `thatgfsj-code@2.x` (例如通过
  `package.json` 写 `"thatgfsj-code": "^2.0.0"`),npm 会拒绝升级到 1.0.5。
- 用 2.3.0 / 2.2.2 都行,选 2.2.2 是**接续**之前 2.x 的版本号,语义上让
  升级路径看起来平滑 ("2.2.0 → 2.2.2 修复了几个严重 bug")。
- 内部代码与 1.0.4 npm tarball 完全相同,**没有任何源码变更**。

### 修复的两个用户报告 bug (来自 v2.x)
- **"AI 回答跳到顶部"**:v2.x 用 `process.stdout.write(chunk)` 直接写
  terminal,长文本没有 `\n` 时光标停在行末,终端自动换行触发滚动
  → 用户感知为"跳到顶部"。v1.0.4 Ink 渲染栈自己管理 viewport,问题不复存在。
- **"工具调用中断"**:v2.x 的 `extractToolCalls` 是 `return undefined` 的
  占位实现,`delta.tool_calls` 在 SSE 解析时被 `extractChunkText` 丢弃,
  agent loop 的工具分支永远进不去。v1.0.4 的 `LLMService.chatStream` +
  `OpenAIProvider` / `AnthropicProvider` / `GeminiProvider` 完整实现了三
  个 provider 的 tool_call 流式解析,工具真正能跑。

### 仓库清理
- **npm unpublish**:1.0.5 + 2.0.0 ~ 2.2.1 (9 个版本全部 < 72h,可直接 unpublish)
  - 1.0.4 是用户原本期望的稳定版本,需要保留
  - 0.2.x ~ 0.9.x 是更早的稳定版本,保留(>72h,npm 政策不允许 unpublish)
- **GitHub**:旧 main 上 v2.x 的所有 commit 保留在历史里(reflog 也能访问),
  新 HEAD 是这个 commit。tag `v2.2.2` 标记这次发布。
- **dist-tags**:发布后 `npm view thatgfsj-code dist-tags` 应返回 `{ latest: '2.2.2' }`。

### Note
- 这个版本不是个"修复",而是**把代码栈退回 1.0.4**。CHANGELOG 这么写是为了
  让以后看历史的人能搞清楚"为什么版本号跳到 2.2.2 但内容跟 1.0.4 一字不差"。
- 安装命令: `npm i -g thatgfsj-code` → 自动拿到 2.2.2 (= 1.0.4 源码)

---

## [1.0.5] - 2026-07-06  - 之前发布的 1.0.4 源码包装版本 (已 unpublish)
## [2.0.0 ~ 2.2.1] - 2026-07-06  - 全部 unpublish (ESM + readline 单文件架构,有上述两个 bug)