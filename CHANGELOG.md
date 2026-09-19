# Changelog

All notable changes to **Thatgfsj Code** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [3.0.6] - 2026-09-19  - opencode 风格 TUI 重设计

### Changed

- **TUI 视觉语言对齐 opencode**：新增语义色主题模块（`src/tui/theme.ts`，暖橙 accent + 灰阶），
  全面替换硬编码颜色。具体变化：
  - 消息流去框线化：用户消息 `❯` 暗色标记，助手消息 `⏺` 强调色圆点 + Markdown 正文，
    不再有 "You"/"AI" 标题块
  - 工具调用改单行 `⎿ shell(npm test)` 延续行样式 + 2 行结果摘要（错误红色），
    取代原来的整块面板
  - 头部一行化：`◆ gfcode v3.0.6` + 缓存命中率/节省 chips + 细分隔线；
    provider/model 移至底部状态条
  - 输入框改圆角边框 + `❯` 前缀 + 空态占位文案 + 底部快捷键提示条
  - Thinking 改 braille 动画 spinner + 已用时秒数
  - 权限确认对话框、欢迎屏、消息排队提示同步换新配色
- 新增 9 个组件渲染测试（ink-testing-library）。

### Fixed

- **工具参数校验**（真实测试发现）：模型调用 file write 漏传 `content` 时，
  此前会静默写入空文件并报成功，模型得不到反馈导致连续重试同一坏调用。
  现在执行前校验必填参数，缺失即返回 `[PARAM_ERROR]` 修复消息，模型下一轮自我修正。
- `npm publish` 需要 2FA OTP / granular token（账号策略），发布流程文档已注明。

## [3.0.5] - 2026-09-19  - 对齐主流 CLI：MCP / 会话持久化 / Headless / 权限管线

> 从本版本起，`gfcode --version`、TUI Header、欢迎屏统一从 `package.json`
> 读取（此前四处硬编码、三个口径并存），"产品版本"双轨制退役，
> 以 CHANGELOG 的版本对照表为准。

### Added

- **MCP 修活并接入**：stdio 客户端接入 App 启动流程（`~/.thatgfsj/mcp.json`，
  兼容 `mcpServers` 键名）；工具以 `mcp__server__tool` 命名注册（旧 `server:tool`
  命名会被三家 API 以 400 拒绝）；`/mcp` 显示真实连接状态；子进程随 CLI 退出清理。
- **会话持久化 + /resume**：每轮结束自动保存到 `~/.thatgfsj/sessions/`（保留最近
  20 个）；`/resume` 列表选择恢复；恢复时校验并修复悬空 tool_calls，杜绝 400。
- **Headless 模式**：`gfcode "任务" --json` 输出行分隔 JSON 事件
  （start/text/tool_calls/usage/result），人读输出全部改道 stderr；退出码可判断成败。
- **权限确认管线**：写/执行类工具调用（shell、git 写操作、文件写入/删除）默认
  请求确认；TUI 弹出确认框独占键盘输入（y / a 本会话全允许 / n，60 秒超时自动拒绝）；
  文件写入展示逐行 diff（超长截断）；`--yolo` / `/yolo` 跳过。
- **上下文自动压缩**：超过阈值按"完整工具调用块"原子压缩（此前按条数切割会切断
  tool_calls/result 配对导致后续请求 400）；`/new` 保留系统提示；`/compact` 走同一原子路径。
- **/yolo、/resume、/ttl 即时生效、/model 热切换**（此前 /model 只写配置文件需重启）。
- **工程化**：`files: ["dist"]` + `prepublishOnly`（修复发布的包缺 dist 不可用）；
  `engines: >=20.19`；repository/bugs/homepage 字段；71 个 vitest 单测。

### Fixed

- **gemini**：API key 从 URL query 移至 `x-goog-api-key` header；工具结果改用
  functionResponse 语义回传（此前压成纯文本，多轮工具链断裂）；多条 system 消息
  全部拼接进 systemInstruction（此前只取第一条）；流式补齐 usageMetadata。
- **anthropic**：消息级 `cache_control` 是非法字段（400 风险），改挂到 content block。
- **openai**：非流式请求补 `response.ok` 检查；流式加 120s 空闲看门狗（此前流卡死永久挂起）。
- **三家 provider 全部支持 AbortSignal**：取消对话现在真正中止 HTTP 请求，不再白烧 token。
- **git 工具命令注入**：`git commit -m "${message}"` 等拼接全部改为 execFile 参数数组。
- **search 工具 Windows 可用**：不再 shell 出 Unix `grep`（CMD 下必失败），改纯 JS 扫描，
  同时消除 pattern 注入面。
- **shell 工具确认逻辑**：旧白名单锚定可绕过，改为每次执行前确认（危险命令黑名单仍硬拦截）。
- **NWT ID 复用覆盖**：`nextId = 文件数+1` 在 archive 后会复用 ID 覆盖旧事件，
  改为取最大 ID 递增。
- **工具结果显示**：TUI 工具面板此前永远显示 "(see tool result above)"，
  现在 tool_calls chunk 携带逐工具结果。
- **Windows 编码**：chcp 65001 用 `require()` 写在 ESM 里被 try/catch 静默吞掉、
  从未执行过——改为顶层 import，且仅在交互 TTY 执行（headless/CI 不再白起子进程）。
- **依赖瘦身**：移除未使用的 `playwright`（每个用户白下几十 MB）、`ora`、`inquirer`、
  `readline`（npm 废弃占位尸包，改用 `node:readline`）。

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