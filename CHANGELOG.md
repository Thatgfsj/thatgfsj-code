# Changelog

All notable changes to **Thatgfsj Code** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [3.4.0] - 2026-09-20  - 全面测试与维护（成熟 CLI 实践对标）

> 本轮为维护版本：三个子代理分别对标成熟 CLI 工程实践（MiniMax mcode）、执行完整验证（build/tsc/242 用例/63 项冒烟/e2e/依赖审计）、逐项核实遗留技术债后统一修复。

### Security

- **shell 只读快速通道加固**（堵住三个免确认绕过）：引号感知分段（`echo "a && b"` 不再被伪切分）；`env`/`sudo`/`nohup`/`xargs` 等包装前缀永不走免确认且危险模式匹配解包后的内层命令（`env rm -rf /` 现被硬拦）；`K=V cmd $K` 环境变量伪装形状直接剥夺免确认；`find` 的 `-delete/-exec/-execdir/-ok` 等写/执行参数不再视为只读。
- **browser DNS rebinding 防护**：open 动作解析主机名并对每个解析结果复查内网/环回规则——公网域名解析到 127.0.0.1/169.254.x 无法再绕过 SSRF 防护。
- **apply_patch 写入原子化**：写入前记录回滚日志（原字节或"不存在"），失败按倒序完整回滚并报告"已回滚、无文件变更"——不再留下部分应用的半套改动。

### Removed

- 死代码清理：HookManager（建好未接线，整体移除）、ChatList（Static 渲染已废弃，测试改为走真实渲染路径）、`Header` 未用导入、skills `autoActivate` 无调用方法、StatusBar 的 SessionStats 死契约（ctx/↑↓/节省 ¥ 分支不可达）、`metadata.maxDuration` 声明（全库无消费方）、headless 路径重复的 `session.persist()`。
- 仓库卫生：移除误提交的 `m.role+'`、`setTimeout(r` 畸形文件与 `build.log`；`.gitignore` 增加 `tmp-*`。
- dev 依赖：`npm audit fix`（vitest 4.1.11，修复 @vitest/mocker GHSA-82fw-gwwq-j7x9，仅影响开发环境）。

### Added

- **工程化（mcode verify 思想的最小落地）**：`npm run verify` 一条命令跑全部质量门禁（build + 242 用例 + 63 项冒烟断言），prepublishOnly 与本地、CI 同源；新增 GitHub Actions（ubuntu + windows × node 20/22）与 dependabot（npm + actions，周检）。
- crash 日志轮转：`~/.thatgfsj/last-error.log` 超过 200KB 自动清空重建，不再无限增长。

### Fixed

- README 与实现对齐：shell 工具描述改为"只读免确认"（原文"每次确认"与分级审批矛盾）；apply_patch 特性描述补"写入失败自动回滚"。

## [3.3.0] - 2026-09-20  - 取精华 MiniMax mcode：补齐三个结构性缺口

> 基于 3 个子代理对 mcode（MiniMax-AI/minimax-code，MIT）与本项目的双向调查与差异分析（66.8 万行 vs 1.4 万行），按"用户价值 × 实现成本"落地 P0 项。思想采纳、代码重写，无逐字移植。

### Added

- **流式回答改为"整段实时渲染"**（mcode 稳定尾块思想的 React 化）：正在生成的回答作为一整块 Markdown 在工作区实时重渲染（200ms 节流 + 尾部裁剪），按工作区宽度折行；此前每个 200ms 批量是独立一行，中文流被糊成左侧一条窄窄的碎行（用户黑盒报告：输出只在左侧）。回合结束才固化为完整消息，工具行前后文本保持时序。
- **/help 直达**：`/help` 此前不在命令表、也无别名映射，回车后被当聊天发给模型（用户感知为"没反应"）。已入命令表（输入即弹补全）；未知 `/xxx` 命令现在提示"未知命令"，不再静默发给模型。
- **工具调用完整入会话**（此前最大结构性缺口：agent 循环的工具消息只活在局部变量里，跨 turn 模型完全失忆上一轮读过/改过什么，重复劳动 + token 翻倍）：`chatStream` 新增 `onMessage` 镜像，assistant tool_calls 与每个 tool result 同步写入 session；`/resume` 恢复时以 `⎿ name: 摘要` 行呈现工具维度；既有压缩器的"工具组原子性"从此有真实对象。
- **调用前上下文检查**（mcode beforeLlmCall 的落点思想）：`beforeRound` 钩子在**每轮** provider 调用前估算（系统装配 + 全历史），超过 `窗口 − max(16k 预留, maxTokens+2k)` 即先行压缩——旧逻辑只在 turn 末用上一轮 usage 判断，单个工具密集 turn 中途撞窗会硬 400。
- **runaway-guard 软提醒**（思想采纳自 mcode runaway-guard）：同一工具调用（含参数指纹）一轮内重复达 3 次即注入 `[SYSTEM REMINDER]` 要求换方法/换工具/问用户——软纠正不硬停，合法重试不受影响。

### Fixed

- **agent 循环响应中断**：循环顶部与每个工具执行前检查 abort 信号；工具组执行中取消时，未执行的调用补 `[cancelled by user]` 结果占位（API 要求每个 tool_call 都有 result，否则下一请求 400）。esc 现在真正立即停下，而不是"界面停了、后台跑完 10 轮"。
- 会话组装入口统一过 `sanitizeLoadedMessages`（崩溃残留的悬空工具对不再引发 provider 400）。

## [3.2.2] - 2026-09-20  - 视口渲染重构：发送黑屏根治 + 8 路对抗审查修复

### Fixed

- **发送文本后黑屏（黑盒报告根因链）**：Ink 7.1 在 Windows 上当帧行数 == 终端行数时，每次帧内容变化都会整屏清除（\x1b[2J，含备用缓冲区重绘）；此前帧高恰好等于终端行数，流式期间 200ms 一次全屏闪黑。现在帧高恒为 rows-1，实测发送全程零整屏清除（ConPTY e2e 断言）。
- **备用缓冲区恢复**：改用 Ink 原生 `render(..., { alternateScreen: true })`（signal-exit 兜底）——旧手写 `?1049h/1049l` 在渲染崩溃 `process.exit(1)` 路径下不执行，用户终端会被留在备用屏花屏。
- **对话改为行数预算视口窗口**：备用缓冲区没有回滚区，历史必须渲染在帧内。`src/tui/window.ts` 从尾部按估算行高累加组窗，裁剪按回绕宽度迭代（长中文单行/超长回答实测不再撑爆）；流式新输出不再把用户的翻页位置拽回尾部（翻页可穿越流式存活）。
- **底部区行数从猜测改为实测**：UserInput 上报真实行数（多行粘贴渲染窗口 5 行封顶、补全弹层 5 条封顶）；权限确认框 diff 预览 12 行封顶；模型选择/配置向导/模型设置全屏化——全部堵住"底部撑爆帧"的黑屏路径。
- **markdown 渲染其实从未生效**：`marked.use({renderer: TerminalRenderer 实例})` 在 marked ≥5 必抛 `renderer 'o' does not exist`，旧代码 catch 后静默回退原始文本（用户看到的回答一直带 # 和 ```）。现在用方法 shim 桥接（只暴露 marked 认识的方法名，调用时同步 parser/options），标题/列表/表格/代码块按工作区宽度真渲染。
- **快速打字乱序**（对抗实测：同 tick 两键 "abcd"→"dcba"）：value+cursor 合并为单 state 函数式更新，同一 stdin 块的多个键事件不再穿过过期闭包。
- **emoji 劈裂**：←/→/退格/删除按码点步进（代理对不再被劈成孤立乱码发给模型）；粘贴 CRLF 归一为 \n。
- **esc 语义拆分**：有输入内容时 esc 只清空（不再顺手中止正在进行的回复）；空输入 esc 才取消/退翻页。
- **流式词边界冲刷的幽灵词融合**（对抗实测 "say alpha"+工具调用+"beta" → 显示 "alphabeta"）：提交工具行前强制排空扣留文本，时序恢复正确；CJK 增加切分点，中文流式不再 500 字一跳。
- **浏览器工具**（v3.2.1 回归修复 + SSRF）：重启后 makePage 闭包捕获已死浏览器导致重试必败；launchError 一次失败永久投毒；launch 失败被误诊为"未安装 Chromium"；重试失败错误信息附带代理设置指引；SSRF 堵住尾点 FQDN（`127.0.0.1.`）与 `::ffff:` 十六进制序列化两条绕过。
- 长会话内存：会话/流式列表不再无限增长（/new、压缩清理）。

### Changed

- 窄终端（<100 列）时计划面板回落到工作区下方，行数计入预算。
- README/CHANGELOG 与实现对齐（移除已删除的"底部状态栏统计"描述）。

## [3.2.1] - 2026-09-20  - 三区布局/翻页/光标输入/浏览器代理重试/全宽回答

### Added

- 三区布局：左侧工作区 + 右侧信息列（计划在上、上下文容量在下，1s 实时刷新）+ 底部全宽输入；首页不放面板。
- 上下文容量面板：↑输入/↓输出（万格式）、分类占比、平均缓存命中率；无金额。
- 键盘契约：空输入 ↑/↓ 翻页（滚轮等效），非空 ↑/↓ 移光标，←→ 移光标，ctrl+a/e/u 行首/行尾/清行，真实光标模型。
- 会话级翻页模式（── 翻页 ── 头）。

### Fixed

- 回答挤成 80 列窄条（marked-terminal 默认 width）。
- 流式按词边界冲刷（英文单词不再被劈开跨行）。
- browser：代理透传（Chromium 不读系统代理）、实例存活校验、导航失败换新页重试。
- 上下文估算：session 的 system 消息不再重复计入消息桶。
- 删除每轮静态统计行（含"节省 ¥"金额线）。

## [3.2.0] - 2026-09-20  - 右侧上下文面板 + 聊天视图 items 崩溃修复

### Fixed

- **聊天视图 "Cannot read properties of undefined (reading 'items')"**：PlanStore 原型方法被裸引用传入 useSyncExternalStore 导致 this 丢失（ESM 严格模式），箭头字段绑定修复；新增聊天分支挂载测试与 React ErrorBoundary（落盘 ~/.thatgfsj/last-error.log）。

### Added

- 右侧上下文容量面板（opencode 风格）：已用/窗口、分类占比、缓存命中率。

## [3.0.19] - 2026-09-20  - 五域审查修复：安全/网络/缓存/稳定性

### Fixed

- **fetch failed 诊断与网络加固**（用户报告 DeepSeek 持续 fetch failed）：根因为本地代理 TUN 隧道间歇抖动，Node fetch 不走系统代理且真因藏在 error.cause。现在：错误信息透出底层原因码（如 fetch failed (ECONNRESET)）；网络层错误自动重试（2 次指数退避，4xx/5xx 不重试）；支持 HTTPS_PROXY/HTTP_PROXY 环境变量走代理（THATGFSJ_NO_PROXY=1 强制直连）。
- **browser SSRF 防护**（安全审查）：open 动作拦截环回/私网/链路本地/ULA 地址与内网机器名，协议白名单 http/https。
- **Anthropic 缓存前缀修复**：[TOOL_REPAIR] 不再上提到顶层 system（此前导致缓存每轮全失效），改在原位置内联 [system note]；1h TTL 补 extended-cache-ttl beta header。Gemini 同步内联。
- **/resume 前缀丢失**：非空屏恢复会话时前 min(N,M) 条历史静默丢失（Static 计数不归零），改用 listEpoch 强制重建。
- shell 危险命令黑名单支持 &&/||/;/| /换行切段检测；配置与会话文件原子写（防写一半损坏）；config 嵌套键深合并；sanitize 悬空调用级联删除；MCP stdin error 防崩；排队消息不再互相覆盖；模型设置面板不再吞权限确认框；必填参数校验 fallback 到 inputSchema；安装失败可重跑再问。
- SiliconFlow 目录补 DeepSeek-V3.2；文档口径全面对齐（README/ROADMAP/DEVELOPMENT/install 脚本 Node≥20.19 校验）。

## [3.0.18] - 2026-09-19  - 彻底修复流式文本被输入框盖章污染

### Fixed

- **流式回复中穿插输入框残骸**（3.0.15 回归的根因）：此前流式文本经手动 stdout.write 写入滚动缓冲，但 Ink 不知道光标已被移动——下次重绘输入框时按旧位置回退光标，把输入框的旧帧（┏━━┓ 框）整段盖进流式文字中间。现在彻底废弃手动写入，所有内容（流式文本按 200ms 批量、工具行、token 芯片、统计行、品牌头）一律作为 **Static 条目**提交——Static 由 Ink 管理光标、每条只渲染一次永不重绘，从机制上消灭了帧互相污染的可能。实时帧只剩 spinner+输入框，行数恒定。

## [3.0.17] - 2026-09-19  - 模型设置对话框渲染修复

### Fixed

- **分隔线折行断成两截**（用户截图）：分隔线长度正好等于内容区宽度时会被终端的延迟换行列顶断（出现『── ──』碎片）。现缩短 2 列安全边距并强制截断，永不折行。
- **对话框底部被裁切**：/models 全屏覆盖层显式使用列布局居中，对话框不再溢出屏幕。

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