# Changelog

All notable changes to **Thatgfsj Code** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [2.2.4 / 产品 0.4.1] - 2026-07-06  - 修三个 v2.2.3 暴露的实际 bug

> 双版本号方案:
>
> | 位置 | 版本 | 含义 |
> |---|---|---|
> | `package.json` `"version"` | `2.2.4` | npm 包版本,正常递增 (+0.0.1) |
> | `src/cmd/index.tsx` `.version(...)` | `0.4.1` | **产品版本** (`gfcode --version` 看到的) |

### Fixed

**Bug 1: 终端中文乱码** — `chcp 65001` 调用被一个空的 `try/catch`
吞掉了,而且 `process.stdout` 没设默认编码,Windows 上中文输出照样走
GBK 编码。修复:

- `src/cmd/index.tsx` 顶部 `chcp 65001` 加上 `>NUL` (避免污染 stdout)
- `process.stdout.setDefaultEncoding('utf8')` + `process.stderr.setDefaultEncoding('utf8')`
  在 import 之前强制执行,无论 `chcp` 成不成功都走 UTF-8。

**Bug 2: `[已中断]` 污染循环 (这个最严重)** — 在 v2.2.3 的会话日志
里能看到这个 bug 反复触发。原因有两个:

1. `src/tui/hooks/useChat.ts` 在 abort 时**字面上**给 assistant 消息
   加了 `'\n\n[已中断]'` 后缀然后持久化 (`app.session.addMessage(...)`)。
   下一轮 LLM 看到这条历史,把 `[已中断]` 当成上下文的一部分复读回
   来,形成自反馈循环。

2. `src/session/index.ts` 没有 anti-pollution 过滤器,v2.1.0 的 `looksPolluted`
   没移植到 1.0.4 这条线。

修复:

- 端口 v2.1.0 的 `SessionManager.addMessageSafe()` + `looksPolluted()` +
  `getDroppedCount()` 到 `src/session/index.ts`。Pollution 模式覆盖:
  `/^\s*\[已中断\]/m`, `/已中断[^\\n]{0,40}/`, `/response truncated/i`,
  `/output cut off/i`, `/\[interrupted\]/i`。
- `src/cmd/index.tsx`、`src/app/index.ts:runPrompt`、`src/tui/hooks/useChat.ts`
  三个调用点全部改成 `addMessageSafe`,abort 时不持久化 (wasAborted 守卫)。
- `useChat.ts` 的 `'\n\n[已中断]'` 后缀删除 — 之前那个后缀**就是**
  触发污染循环的源头。

**Bug 3: 工具输出和 AI 文字混在一起** — v2.2.3 的渲染器 (`src/cmd/index.tsx`)
打印 `@@TOOL@@{...}` 标记时,工具输出前后的视觉边界缺失,长工具输出
(注册表 dump、目录列表) 直接 bleed 进下一轮 AI 消息,屏幕读起来像
拼贴画。

修复 (`src/cmd/index.tsx`):

- 工具调用前一行空行 + `─` 分隔线 (`⚙ name: args` 后)
- 工具输出加 `│` 缩进,**截断到 20 行** (超出显示 `... (N more lines truncated)`)
- 工具结果后再加一道 `─` 分隔线
- AI 文字 (普通 chunk) 统一加 `│` 缩进,与工具输出视觉一致
- "Thinking..." 清除行从 40 个空格扩到 80 个空格 (防止长 indicator 残留)

### 不在本次范围 (留给后续 patch)
- Anthropic / Gemini provider 的 `delta.tool_calls` 流式解析
  (1.0.4 已经有 `LLMService` agent loop,但 `extractChunkText` 在两个
  provider 上仍只解 text delta)
- MCP 客户端健康检查 (`this.process?.connected` → `this.process?.stdin?.writable`)
- Ink TUI 的 streaming 状态在 abort 时偶尔闪烁
  (看到 `[已中断]` 的根本原因已修,视觉残影是次要问题)

### Note
- 本 patch 是 "修复 1.0.4 源码栈的实际问题",**不是引入新功能**。
- npm `latest` 应当指向 `2.2.4`。