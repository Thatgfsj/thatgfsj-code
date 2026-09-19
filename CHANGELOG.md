# Changelog

All notable changes to **Thatgfsj Code** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [3.0.16] - 2026-09-19  - 修复流式输出与实时帧互相盖章

### Fixed

- **流式文本与 Header/StatusBar 互相穿插**（3.0.15 回归）：追加式写入与实时帧混排时，帧内的 Header/StatusBar 每次重绘都被盖进滚动缓冲，用户看到标题碎片穿插在回复文字之间。聊天模式下 Header 只在进入时打印一次，状态栏改为每轮结束打印一行统计摘要（ctx 占比/输入/输出/节省），实时帧只保留 spinner+输入框（恒定行数）。
- 首屏 splash 保留状态栏与版本行（无流式写入，安全）。

## [3.0.15] - 2026-09-19  - 滚动修复（追加式渲染）+ 工具执行预发射 + /browser

### Fixed

- **流式期间滚轮无法上滚**：流式文本/工具块不再走 React 整帧重绘，改为直接写入终端滚动缓冲（追加式、永不移重绘区），实时帧恒定 ≤8 行（spinner+输入框+状态栏）——流式期间随时可上滚查看历史。
- **工具执行即反馈**：执行前先渲染 `⎿ name(args) ⟳` 待执行行，结果到达后补结果行，长耗时工具（browser/shell）不再静默空等。
- **browser 工具增强**：launchError 缓存可自愈（安装后立即生效）；AbortSignal 穿透到页面操作（取消即中断）；`⎿` 标签适配 browser search/open/close。
- **/browser 命令**：查看内置 Chromium 安装状态与就绪情况，首跑选了 N 也能随时补装。

## [3.0.14] - 2026-09-19  - 浏览器策略调整：仅用内置 Chromium

### Changed

- 按用户要求，browser 工具改为**只使用内置 Chromium**，不再探测/启动用户自己的 Edge/Chrome；首次运行的安装选项即下载内置 Chromium（约 195MB）。

## [3.0.13] - 2026-09-19  - 本机浏览器（Playwright）+ token 统计 + 85% 自动压缩

### Added

- **browser 工具**：AI 通过 Playwright 驱动本机 Edge/Chrome（headless）搜索网页（bing/baidu）和打开 URL 读正文。零 API key、走本机网络；playwright-core 按需加载，浏览器懒启动、随进程退出清理。
- **首次运行引导**：交互模式下询问是否启用浏览器服务——优先检测本机 Edge/Chrome（命中即零下载），都没有才提供下载内置 Chromium（约 130MB），选择持久化不再重复询问。
- **每条消息显示 token**：助手消息显示真实 completion tokens（跨轮累计），用户消息显示启发式估算（CJK 感知）。
- **底部会话统计面板**：ctx 已用/窗口(占比变色，≥85% 红色) · ↑输入 ↓输出 tokens · 缓存节省。
- **85% 自动压缩**：上一轮 prompt tokens 达到模型上下文窗口 85% 时自动压缩历史（保持工具调用块完整）；窗口可按模型在 /models → w 中设置（默认 128k）。
- **历史展示策略回退**：消息列表回归 Static 打印（历史永久保留在终端滚动缓冲、可自由上滚查看，不再折叠）；仅在超过模型窗口 85% 时才压缩进上下文。

## [3.0.12] - 2026-09-19  - 首屏品牌修正

### Changed

- 首屏大 logo 由 GFCODE 改为 THATGFSJ（ANSI Shadow 字形，THAT 暗 / GFSJ 亮双色调，67 列宽）。
- 终端窗口标题定为 Thatgfsj（区分于应用内 THATGFSJ 品牌头）。

## [3.0.11] - 2026-09-19  - 品牌统一 + 聊天输入框全宽

### Changed

- 应用内头部品牌改为 THATGFSJ（与终端窗口标题一致，此前一处 gfcode 一处 THATGFSJ 口径混乱）。
- 聊天模式输入框占满终端全宽（此前限宽 100 列，右侧大片空白），快捷键提示行学
  opencode 左右分列（左：enter 发送/esc 取消，右：/help、/models、ctrl+c）。
- 首屏 splash 输入框保持居中定宽，提示行右对齐到输入框宽度。

## [3.0.10] - 2026-09-19  - 黑盒测试修复：非 TTY 环境友好拒绝

### Fixed

- **管道环境启动 TUI 崩溃**（黑盒测试发现）：`gfcode`（无参数）在非 TTY 的
  stdin（脚本/CI 管道）下，Ink 的 useInput 需要 raw mode 而直接抛出堆栈。
  现在检测后给出友好提示"需要交互式终端（TTY），脚本化调用请用 --json"
  并以退出码 1 退出。

## [3.0.9] - 2026-09-19  - 全屏修复：消息视口化 + 用户报告问题

> 由用户实测反馈驱动：3.0.8 全屏模式下回复"闪一下就消失"、窗口放大布局不变、
> logo 字形错误、窗口标题缺失。

### Fixed

- **全屏模式消息消失**（关键）：消息列表此前使用 Ink `<Static>`（打印一次即脱离
  渲染树），而全屏布局的帧高是整个终端——每次重绘整帧被擦除重建时，刚打印的
  Static 消息被一并擦掉（回复闪现后消失）。改为**受管视口**：按行数估算切片渲染
  最近消息（与 opencode 同思路），旧消息折叠提示"已折叠较早的 N 条消息"。
- **窗口缩放布局不变**：Ink 在 resize 时只重放旧帧，React 不重渲——补上
  resize 监听强制重算行列。
- **logo 字形错误**（手拼成了"GEOE"）：改用 figlet ANSI Shadow 生成的标准字形，
  "gf" 灰 / "code" 亮双色调，与 opencode 品牌页一致。
- **终端窗口/标签页标题**：启动时设置为 THATGFSJ。
- **会话页对齐 opencode 真机截图**：用户消息改为左侧强调条块样式；助手回复为
  `▪ Build · 模型名` 暗色标签 + 正文。

## [3.0.8] - 2026-09-19  - 全屏 opencode 风格 + 模型设置面板

### Added

- **全屏化 TUI**：交互模式进入终端交替屏幕缓冲（exit 恢复原终端），首屏为居中
  块状 logo（gf 灰 / code 亮的双色调，仿 opencode）；对话开始后消息区占满视口、
  输入框钉在底部；右下角常驻版本号。
- **模型设置面板 `/models`**（别名 `/模型设置`）：
  - `a` 添加自定义模型（任意 model id，持久化到 config.json）
  - `c` 按模型设置上下文长度（当前模型即时生效到会话压缩阈值）
  - `t` 思考强度循环 off → low → medium → high
  - `d` 删除自定义模型；↑↓ 选择，esc 关闭
- **思考强度参数接入**：`thinking ≠ off` 时 OpenAI 兼容层发送
  `reasoning_effort` + `enable_thinking: true`（SiliconFlow/Qwen3.5 系列实测生效，
  `off` 不发送任何参数保证兼容性）；新增 `-t, --thinking <level>` CLI 参数。
- 输入框改 opencode 式左侧强调竖条 + 双行信息（Build · 模型 · thinking 标签）
  + 底部快捷键提示行。
- 各平台推荐模型目录更新至 2026-09 现行版本。

## [3.0.7] - 2026-09-19  - 真实环境实测修复（SiliconFlow/Qwen）

> 本版由硅基流动 + Qwen3.5-35B-A3B 的端到端实测驱动：工具调用闭环、
> 权限拒绝路径、缓存命中、会话落盘均在线上验证通过。

### Fixed

- **中段 system 消息被严格服务商 400**（实测发现）：权限拒绝后追加的
  `[TOOL_REPAIR]` system 消息会导致 SiliconFlow/Qwen 系列报
  `"System message must be at the beginning"`（code 20015），agent 循环中断。
  OpenAI 协议层现在把首条之后的 system 消息降级为带 `[system note]`
  前缀的 user 消息（语义等价，全平台可接受）。Anthropic/Gemini 层本就
  上提 system，不受影响。新增 4 个 wire 格式单测。
- **headless `--json` result 事件前导空行**：Qwen 输出开头的空行会污染
  下游 `jq` 解析，result.content 现在 trim。

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