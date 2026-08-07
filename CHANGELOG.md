# Changelog

All notable changes to **Thatgfsj Code** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [3.0.0 / 产品 0.5.0] - 2026-08-08  - Reasonix 风格 Prompt Caching 架构

> **重大版本变更**：流式协议 `AsyncGenerator<string>` → `AsyncGenerator<StreamChunk>`。
> 自定义依赖 `LLMService.chatStream` / `App.streamResponse` 的下游代码需要适配。
>
> 参考：DeepSeek-Reasonix (esengine/DeepSeek-Reasonix) 的"不可变前缀 + 追加日志 + 易变草稿"三支柱。

### Added
- **M1 — 流式协议重构**：干掉 `@@TOOL@@` 哨兵字符串；`StreamChunk` 升级为结构化 union（text / tool_calls / thinking / usage）。
- **M2 — Anthropic prompt cache**：`system` 改为 block 数组，最后一块挂 `cache_control: { type: 'ephemeral' }`；工具列表最后一个也挂 marker；新增 `anthropic-beta: prompt-caching-2024-07-31` header；修「第二条 system 消息被丢弃」bug。
- **M3 — 缓存统计与 UI**：`CacheStatsStore` 持久化到 `~/.thatgfsj/cache-stats.json`；TUI Header 显示 `⚡ 命中率 87%`；新增 `/cache` 命令显示 24h 命中率曲线。
- **M4 — 高级特性**：`VolatileScratch` 隔离 thinking；Tool-call Repair（append `[TOOL_REPAIR]` 而非修改既有消息）；`smartModel.shouldDowngrade` 智能路由；`Config.cache` 字段 + InitWizard 两步缓存配置。
- **OpenAI provider 缓存友好**：`stableStringify` 保证 JSON 字节级稳定；流末尾 yield `{ type: 'usage' }` chunk。
- **28 个 vitest 单元测试**（`tests/cache/`）。

### Changed
- `SessionManager.autoCompact` 不再 mutate messages，改为通过 `onSuggestNewSession` 回调通知用户调 `/new`。Reasonix 原则：超长开新会话，保护上游缓存前缀。
- `system prompt` 片段顺序调整：NWT history 和 Date 移到末尾（易变区），前 6 段是 Immutable Prefix。
- `LLMService.fromConfig` 接收 `Config.cache` 透传给 provider。

## [2.2.7 / 产品 0.4.4] - 2026-07-06  - 烟囱测试驱动的 anti-pollution 过滤收紧

> 双版本号方案:
>
> | 位置 | 版本 | 含义 |
> |---|---|---|
> | `package.json` `"version"` | `2.2.7` | npm 包版本,正常递增 (+0.0.1) |
> | `src/cmd/index.tsx` `.version(...)` | `0.4.4` | **产品版本** (`gfcode --version` 看到的) |

### Fixed

**Pollution 过滤误杀正常对话** — v2.2.4 引入的 anti-pollution 过滤
(`SessionManager.looksPolluted`) 有两条过宽的模式:

- `/\u5df2\u4e2d\u65ad[^\n]{0,40}/` — 把所有包含"已中断"字样的中文
  都当污染,包括 `我看到这个进程已中断了` 这种合法对话
- `/response (was )?truncated/i` — 把所有提到"response truncated"的句子
  都当污染,包括用户问 `Why was the response truncated last time?`

烟囱测试 `tests/smoke-pollution.mjs` 直接捕获了这两个误杀。

### 修复策略 — 两层模式分级

```
STRONG (always drop):
  [已中断]              必有方括号,模型原样输出
  [interrupted]         English 等价

WEAK (drop only when ALL gates pass):
  ^...\[已中断\]       行首标记 (带可选 markdown 装饰)
  ^...\[interrupted\]   行首标记
  \bresponse (was )?(truncated|cut off|interrupted)\b
  \boutput (was )?(truncated|cut off|interrupted)\b

  + 消息长度 < 200 字符 (截断的响应通常较短)
  + 不以 ? 结尾 (疑问句是用户讨论过往行为)
  + 不包含 "last time" / "earlier" / "before" / "previously" / "yesterday"
    (时间副词表明用户在回顾过去,不是污染)
```

### Smoke 测试新增

- `tests/smoke-thinking.mjs` — 28 个用例覆盖 `splitThinking` / `compressThinking`
  所有边缘情况 (空输入、多 delimiter、Chinese/English 混合、tag 跨行)
- `tests/smoke-tool.mjs` — 18 个用例覆盖 ToolCall 渲染路径 (空结果、
  pending、截断计数、错误、超长单行)
- `tests/smoke-pollution.mjs` — 17 个用例覆盖 anti-pollution 过滤的
  drop / keep 双向场景

### Test summary (本 patch 后)
```
thinking:   28 / 28 pass
tool:       18 / 18 pass
pollution:  17 / 17 pass
total:      63 / 63 pass
```

---

## [2.2.6 / 产品 0.4.3] - 2026-07-06  - 修复工具结果不显示

> 双版本号方案:
>
> | 位置 | 版本 | 含义 |
> |---|---|---|
> | `package.json` `"version"` | `2.2.6` | npm 包版本,正常递增 (+0.0.1) |
> | `src/cmd/index.tsx` `.version(...)` | `0.4.3` | **产品版本** (`gfcode --version` 看到的) |

### Fixed

**Bug: 工具调用结果不显示** — 在 1.0.4 源码栈下用户报告"⚙ shell date" 这条
命令发起后,**结果完全看不到**,只看到 AI 后续的文字回复 ("好嘞，那我给你
演示一组工具——并行调用"). 模型明明看到了工具结果 (因为它的后续回复引用了
结果),但 UI 上不显示结果文本。

通过代码 review + 单测复现,定位到三个潜在原因,全部修复:

1. **`src/tui/components/ToolCall.tsx`** — `tool.result ? ... : null` 用 truthy
   判断,**空字符串结果被当 falsy 跳过渲染**。改成 `tool.result !== undefined ? ... : null`。
   同样修复: `wrap="truncate"` 在 Ink 里会把超长行**静默切掉不显示**,
   改成 `wrap="wrap"` 让长行自动换行。还把 `result.truncated` 的指示从
   模糊的 `"..."` 改成 `(+N more lines)` 显示实际被截掉的行数。
2. **加 ⏳ pending 指示器** — 工具调用发起到结果返回之间的中间状态,
   之前没有视觉反馈,看起来像是"卡住了"。现在显示 `⏳ running...`
3. **`src/tui/hooks/useChat.ts`** — 流结束 push 到 messages 时,assemble
   一个 `[tool: name → result]` 摘要附加到 assistant 的 content 里。
   这是 belt-and-suspenders 兜底: 即使 Ink 的 `<ToolCall/>` 渲染路径
   因为任何边缘 case 失败 (例如太长的输出 wrap 问题),用户依然能在
   AI 的文字回复里看到工具结果。

### 仍然不修的 (但要意识到)
- 用户的 paste 里还有另一条命令 `echo "=== 当前时间 ===" && date && echo
  "=== 系统信息 ===" && system` — 这里 `system` 不是合法命令,
  会返回错误。这不是代码 bug,是用户/模型自己写的命令有问题。本次 patch
  不修改这个。

### 不在本次范围
- Anthropic / Gemini provider 的 `delta.tool_calls` 流式解析 (仍是 TODO)
- 工具输入参数命名前缀 (`command` vs `cmd` 不一致) — 下次 patch

---

## [2.2.5 / 产品 0.4.2] - 2026-07-06  - 压缩 <think> 思考块 (类似 opencode)

> 双版本号方案:
>
> | 位置 | 版本 | 含义 |
> |---|---|---|
> | `package.json` `"version"` | `2.2.5` | npm 包版本,正常递增 (+0.0.1) |
> | `src/cmd/index.tsx` `.version(...)` | `0.4.2` | **产品版本** (`gfcode --version` 看到的) |

### Fixed

**Bug: 思考过程太长,刷屏** — 在 1.0.4 源码栈下,即使是"非推理"模型
(Qwen / DeepSeek-V3 chat / Kimi 等) 也会在回复里发整段 `<think>...</think>`
块,经常是几十行内部独白。这块内容对用户来说没有可读价值,只
是噪音 — 用户在 v2.2.4 的会话日志里能看到这问题特别严重。

参考 opencode 的做法 (`packages/opencode/src/session/prompt.ts:244`
里的 `<think>[\s\S]*?<\/think>` 正则),引入压缩模式:

- 新文件 `src/utils/thinking.ts`,导出三个 helper:
  - `splitThinking(content)` — 把 `<think>...` / `<reasoning>...</reasoning>` /
    `[THINK]...[/THINK]` 三种块格式剥离开,返回 `{thinking, conclusion,
    thinkingLines, thinkingHint}`。
  - `summarizeThinking(split)` — 输出 `💭 thought for N lines: <first hint>`
    单行摘要。
  - `compressThinking(content, showThinking)` — `showThinking=false` 时把
    思考块压成一行 + 结论;`showThinking=true` 时原样返回。
- 三个调用点全部接入压缩:
  - `src/cmd/index.tsx`: 流式阶段**不**实时打印 AI 文字 (避免半个 <think>
    块被切到屏幕上),流结束后用 `splitThinking + summarizeThinking` 输出
    一行摘要 + 结论。**持久化时只保存结论**,让 history 不被思考块撑大。
  - `src/app/index.ts:runPrompt`: 持久化前 `compressThinking(fullResponse,
    showThinking)`。
  - `src/tui/hooks/useChat.ts`: 同上,持久化 + 显示内容都走压缩。

### Added

- **CLI flag `--show-thinking`**: 在命令行下开启完整思考块显示 (调试用)
- **`App.showThinking` 字段**: 默认 `false`,可通过 REPL 命令切换
- **REPL 命令 `/thinking on|off`** (中文别名 `/思考`): 在 Ink TUI 模式下
  切换思考块显示

### 设计选择

为什么不沿用 opencode 的"协议级分离 reasoning"?
- opencode 把 reasoning 当成单独的 stream part 处理 (`MessageV2.ReasoningPart`),
  那需要模型支持 reasoning API (Anthropic extended thinking / OpenAI o1-style)。
- 我们用的多数 provider (Qwen / DeepSeek / Kimi) 把 reasoning 直接当作
  content 的一部分输出,所以必须在**显示层**做正则剥离。

为什么不实时 (mid-stream) 压缩?
- 流式 chunk 是任意切分的,`<think>` 标签可能跨 chunk。实时检测需要
  state machine,延迟和边界处理都很脆弱。
- 流结束后压缩更可靠,而且不影响用户对结论的实时阅读(用户其实只在乎结论)。

### 不在本次范围
- `/thinking` 命令目前是全局开关,不支持 per-message 切换
- 没有提供"展开"按钮 — 用户要看完整内容只能 `--show-thinking` 跑一遍
- 持久化时去掉了 thinking 内容,这意味着**重放历史时也看不到完整思考**;
  这是有意为之 (context window 优先),如需调试可以 `app.showThinking = true` 后
  重新发起对话
- Anthropic / Gemini SSE tool_call 流式解析 仍是 TODO

---