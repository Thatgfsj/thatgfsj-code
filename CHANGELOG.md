# Changelog

All notable changes to **Thatgfsj Code** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/) and the project adheres to
[Semantic Versioning](https://semver.org/).

> **版本号策略（维护者须知）**：每次发版一律 **patch 位 +1（数值 +0.01）**，
> 如 3.5.0 → 3.5.1 → 3.5.2 → … → 3.5.20。不做 minor 跳版（3.5.0 → 3.6.0
> 是错误示范，3.6.0 已废弃并由 3.5.2 取代，内容完全一致）。
> 详见 `DEVELOPMENT.md` 的 Versioning 一节。

## [3.5.5] - 2026-09-22 - 六域实测修复（TUI 真终端 / 密钥面 / 静默失败家族）

> 五路子代理七域覆盖（node-pty 真终端 123 断言、真实模型开箱量化）。上轮 12 项声称 10 项确认、2 项部分；本轮修新发现问题约 14 项。282 → 294 用例。

### Fixed

**静默失败家族（如实告知）**
- **openai/anthropic/gemini 三协议的"半截流"假成功**：3.5.3 的"零有效帧"守卫漏了两种形态——`choices: []`/无 candidates 的 200 响应，以及"有有效帧但没有 finish 帧"的中途截断流。三 provider 现跟踪 finish（finish_reason / message_stop / finishReason），缺失即抛出明确提供方错误；`chat()` 空 choices 同样拒绝
- **只读家目录 → 会话静默不落盘**：persist 失败改为每进程警告一次（"本会话将无法用 -c 恢复"）
- **只读项目目录 → .nwt 每次启动谎报"已建立"**：init 结果现在被检查，失败如实报告
- **USERPROFILE 指向不存在目录**：静默建树并回落内置模型改为显式警告
- **install.ps1 BOM 自断安装链**：PS5.1 的 `Set-Content -Encoding UTF8` 写出带 BOM 的 config.json，gfc 拒收——装机向导刚配的 key 被静默丢弃；改为 BOM-less UTF-8 写入
- **install.sh pull 失败 rm -rf 整个安装目录**（连带用户 .nwt/ 时间线与本地改动）：改为保留现有安装并提示重试
- **cache-stats 损坏静默归零**：现警告损坏原因，并在下一次 record 时重写干净文件
- **`gfc mcp` 路径下损坏 mcp.json 警告重复 3 次**：每进程只警告一次
- **429 RA 截断无说明**：Retry-After 超 30s 上限时明确提示"已按 30s 等待"

**模型管理与配置**
- **ollama keyless 断链修复**：LLMService.hasApiKey 只看空字符串直接抛错，keyless 设计实为死代码；现识别 keyless provider 正常发请求
- **legacy 顶层 apiKey 迁移**：手改 provider 时旧 key 会以新 provider 身份发出（串 key）；迁移现在显式警告"若刚手动改过 provider 请重配"
- **非法 provider 清 key**：`provider: 42` 回退 siliconflow 时不再带着旧顶层 apiKey 真连云端（警告 + 清除）
- **useBuiltin 布尔化**：`"yes"` 等任意 truthy 字符串曾劫持全部请求；load 期清洗为布尔并警告
- **start 事件显示有效 provider/model**：useBuiltin 强制回退时 headless 不再被原 config 值蒙在鼓里；[builtin] 提示改按真实回退条件判定
- **custom_openai 默认模型**追平自家 catalog（gpt-4o-mini → gpt-5.4-mini）

**上下文与工具**
- **preCall 漏兜**：压缩无戏时静默放行超限请求改为明确警告（含数值与建议）；**触发线增加 60% 窗口下限**（3k 小窗口下触发线曾为负，每轮重压缩毁缓存）
- **nwt 输出上限**：唯一无回流量上限的入口（实测单次 618K 字符直上 wire）现按 8000 字符截断并提示缩小范围
- **nwt auto-chain 防脏文件**：auto-chain 前校验最高编号文件可解析且非自身（防悬挂 parent 与自引用）
- **[TOOL_REPAIR] 通道上线**：4 处修复系统消息补 mirror，session 模式下模型自修复信号不再丢失
- **get_context_remaining 超窗显式化**：不再把百分比封顶在 100%，超出量直接显示
- **checkpoint 文本质量**：目标行双连字符（"- - task"）修复；主题退化为 "various topics" 时回退取合并摘要中的主题
- **DANGEROUS_PATTERNS 补 Windows**：shutdown、taskkill /f、rd/rmdir /s、reg add/delete/import、cipher /w、wevtutil cl（此前 Unix 视角，--yolo 下 `shutdown /s` 会被真实执行）

### Added

- `--json` tool_calls 事件透传 runaway `notes` 字段（此前守卫在 headless 完全不可观测）
- `--json` start 事件显示**有效** provider/model（useBuiltin 回退时不再显示 config 原值），新增 `builtin: true` 标志
- config 无 key 但显式配置时的提示与真实回退条件一致（不再自相矛盾）
- `custom_gemini` provider（Gemini 格式中转出口）+ gemini 网络错误点名中转配置

### Docs

- DEVELOPMENT 补"已知限制"（硬链接栅栏盲区、MODEL 环境变量、openai 缓存开关无效应、4B 写任务下限等）与目录树勘误（删 src/hooks、补 plan/）
- README Provider 数 15 → 16；docs/API_KEY_GUIDE 修正 MiniMax 节错挂 Kimi 模型的说明

## [3.5.4] - 2026-09-22 - 第四轮实测修复（补 CHANGELOG 条目）

> 补记：3.5.4 发布时遗漏了 CHANGELOG 条目，此处补上（内容与当时 commit 一致）。

### Fixed

- **MCP 挂死（P0）**：单 prompt 路径不释放 MCP server，子进程 stdio 管道让事件循环永不排空——headless 成功输出 result 后进程挂死（240s 强杀）。finally 中 disconnectAll；e2e 用常驻 mock server 验证正常退出
- **apply_patch 工作区栅栏（P0）**：file 工具拒绝的同一越界写经 `*** Add File: ../outside.txt` 直通；且 resolve() 不感知软链接。全部计划路径在确认前做 realpath（最深现存祖先）校验；file.ts 栅栏同步升级
- **4B 写任务适配（部分有效）**：工具说明补调用格式示例；模板碎片泄漏注入纠正 note（上轮实测条件过窄未触发过）；write 失败后同轮禁 delete（数据保护，防"删除+空写"假成功改名任务）
- **轮末压缩先于持久化**：磁盘 session 保留压缩后历史，-c 不再续接未压缩版本
- **条数压缩 wire 可见**：preCall 采纳 session 已压缩历史；preserveRecent 从窗口推导（含 setMaxMessages 热改路径）
- **zai-org/GLM-5.3 入窗口表**（SiliconFlow 目录 1M 模型此前按 128k 提前压缩）
- **custom_gemini 中转出口** + gemini fetch failed 错误点名配置原因
- **429 尊重 Retry-After**（≤30s 等待重试一次）
- **REMINDER 移至工具结果之后**（不再打断 assistant(tool_calls)↔tool 配对）
- **catch 路径 result 统一 aborted:true**；损坏 mcp.json 警告

### Tests

- 290 → 294（patch 工作区栅栏 4 用例 + MCP 挂死 e2e 3 断言）

## [3.5.3] - 2026-09-21 - 三路子代理测试修复

> 三路隔离沙箱子代理（约 290 次工具调用，mock LLM 精确驱动）汇总：patch 工具链与会话持久化质量最高；本轮修复其发现的全部重要问题。282 → 290 用例。

### Fixed

- **patch 回滚失败如实上报（最重要）**：多文件 patch 的回滚循环中"恢复已存在文件"本身失败时，旧实现静默中断整个回滚并谎称 "ROLLED BACK (no files changed)"（金丝雀文件残留在磁盘）。现逐项独立恢复、失败项逐一列进错误消息（"Rollback PARTIALLY FAILED — these paths may still hold patched content: …"）
- **200 + 垃圾响应体不再假成功**：openai/anthropic/gemini 三个 provider 的流解析此前把无法解析的行全部静默吞掉——HTTP 200 + 非 SSE 垃圾 body 会走到"空回复 = 成功"（result success:true、content:""、退出码 0）。现在三个 provider 都跟踪有效 SSE 帧计数，零有效帧即抛出明确的提供方错误，走熔断与失败契约
- **工具抛异常计入 stats.failed**：计划期 EBUSY 等裸异常此前不计入失败统计（监控显示 failed=0），熔断也感知不到；现与软失败同样计数
- **file 工具工作区边界**：write/delete/mkdir 此前接受任意绝对路径；现限制在项目目录内（经 ctx.workingDirectory 注入），越界返回 [WORKSPACE] 错误并指引 shell 逃生门；read/list/exists 保持不限制（读外部包属正常调研）。测试/直调不传 workingDirectory 时边界不生效（向后兼容）
- **cache-stats 并发丢账**："启动快照 + 整文件回写、最后写者胜"在 3 进程并发下丢 67% 的轮次。record() 现在持有 wx 独占创建自旋锁（含陈旧锁抢占与 Windows unlink EPERM 重试）重读磁盘最新值再累加；stats 文件改原子写。单进程逐 token 精确的既有行为不变
- **`-c` 会话回退**：最新会话文件损坏时不再整体放弃并误报"目录为空"——按最新优先遍历前 10 个，取第一个可解析的，并在恢复提示中注明跳过了几个损坏文件；全部损坏才报错（报错如实）
- **崩溃零进度缓解**：agent 循环每轮工具结果完整镜像后回调持久化（onRoundComplete → session.persist），强杀最多丢当前一轮；失败任务（500/429/断连）的 catch 路径同样落盘，`-c` 可续接（加载期 sanitize 自愈兜底悬空工具对）
- **`--json` result 增加 `aborted: true` 顶层标志**：消费方无需解析 stats 即可识别熔断/中止
- **file read 大文件按行对齐截断**（此前硬切字符会把行切成半行，诱导模型去"修复"残缺尾行）；**file delete 对目录**给出明确指引而非裸 EPERM

## [3.5.2] - 2026-09-21 - 上下文计算维护（专项调查驱动）

> 发布说明：本版本内容与已废弃的 3.6.0 完全一致——那次误用了 minor 跳版，
> 按项目版本号策略（每版 +0.01）改发 3.5.2。专项调查确认 12 个问题
> （1 P0 / 5 P1 / 6 P2）：token 级自动压缩实为死代码、估算三处口径互相
> 掩盖、窗口默认值两头错。本轮统一修复。271 → 282 用例。

### Fixed

- **token 级自动压缩复活（P0）**：压缩器的"消息条数闸门"曾让两个 token 触发器全部空转——50 条消息配 8k 工具截断永远够不到 108k 触发线；触发后 compact() 又因不足 50 条拒绝压缩，请求原样发往小窗口模型直接 400。现在 `compact({tokenPressure:true})` 越过条数闸门，真实值 ≥85% 与估算超线两条路径都能真正压缩
- **估算口径统一（P1-6）**：preCall 此前双计系统提示（breakdown + 历史里的 system 消息各算一次）、estimateBreakdown 漏计 tool-instructions 段（~1178 token）、英文低估 1.3x——三错互相掩盖出 -12% 的"碰巧准"。现公式唯一：`currentContextEstimate()` = 全部 breakdown 段 + 历史消息（system 由 breakdown 代表，不重复计）
- **estimateTokens 重校准（P2-7）**：实测 Qwen 中文 ≈0.6 token/字、英文 ≈3.0 字符/token；旧参数（1.0/字、4.0 字符/token）分别高估 1.66x / 低估 1.3x。新参数 0.75/字、3.4 字符/token，落在实测值的安全侧
- **`/new`、`/resume`、`-c` 后计数重置（P1-2）**：sessionStats 此前永不重置，新会话的侧栏、/status、get_context_remaining 显示旧会话的用量，模型基于错误"剩余上下文"决策
- **窗口默认值有据可依（P1-4）**：新增 `MODEL_CONTEXT_WINDOWS` 元数据表——内置 Qwen3.5-4B 真实 262,144（原按 128k 显示偏大约 2 倍）、step-1-8k/step-2-16k/doubao 32k/256k、1M 窗口旗舰档；未知模型仍回退 128k
- **Anthropic 窗口占用口径（P1-5）**：Anthropic 的 prompt_tokens 不含缓存 token，作为"当前上下文大小"使 85% 压缩在长缓存会话里几乎永不触发；现按 wire 格式补加 cache_read/creation

### Added

- **`currentContextEstimate()`**：当前请求大小的唯一实时估算，get_context_remaining 与 TUI 侧栏共用（此前首轮报 `0/128,000 (0%)`、回合中滞后数千 token，且 TUI 首轮前后两套公式跳变 ~104%）
- **压缩后复核**：token 压缩后重新估算，仍超触发线时明确提示 /new（此前压完不管，小窗口模型照样 400）

### Changed

- `/models` 对话框上下文 chip 回退到**全局**消息窗口（此前显示当前模型的 per-model 覆盖值，串台）
- SessionManager 构造器对消息窗口做 5..1000 夹紧（此前只有 setMaxMessages 夹，手改 `contextLength: 0` 直接生效）
- 删除两套无调用方的死代码估算实现（`shouldAutoCompact`、Compactor.estimateTokens），估算口径全库唯一

### Tests

- 271 → 282：估算边界（中/英文）、tokenPressure 语义、窗口元数据表、构造器夹紧四组回归

## [3.5.1] - 2026-09-21 - 二轮实测修复（补丁）

> 二轮沙箱实测：15 条 3.5.0 声称中 13 条属实；本轮修复余下 4 项 + 2 个小瑕疵。

### Fixed

- **GBK 解码真正生效**：v3.5.0 的"严格 UTF-8 先行"在 936 控制台上仍产出乱码——GBK 中文（如"系统找不到指定的文件"）的字节序列恰好也是合法 UTF-8，严格解码"成功"地解出了垃圾。现改为**控制台代码页解码先行**（`chcp` 探测，936→GBK 等），仅当结果含替换符时才回退 UTF-8（覆盖 node 等自产 UTF-8 的子进程）
- **shell 失败回执不再混入 Node 的 mojibake**：`error.message` 里是 Node 按 UTF-8 二次解码的 stderr（锟斤拷来源），现改为自建 `Command failed (exit N): <命令>` 头 + 我方按代码页解码的输出
- **`--json` 失败契约统一**：连接失败/提供方异常路径此前只发裸 `error` 事件，headless 消费方要写两套失败处理——现在 catch 路径同样补发 `result success:false`（含 error 与 stats）+ 退出码 1
- **`result.stats` 全路径携带**：正常完成、信号中断、熔断、耗尽轮次四条 return 路径都带 loopStats（此前只有熔断/耗尽有，成功的 result 没有 stats 字段）
- **`file.content` 必收回撤到运行时**：schema 级必填误伤了 read/exists（4B 模型给它们也塞 `content:""`，导致连续 [PARAM_ERROR] 空转）；校验改回 execute 内仅对 `action=write` 生效，0 字节写入的防线不变
- **`gfc usage` 计数自洽**：此前读的键名不存在（显示 requests: 0 配非零 token）；改读 `totalRequests/totalReadTokens/totalInputTokens/totalOutputTokens`，旧统计文件缺 requests 字段时从 history 推断

### Added

- **runaway 提醒对 headless 可见**：守卫触发时提醒文本挂到 tool_calls 事件的 `notes` 字段（此前只注入模型消息，--json 事件流里完全看不到守卫是否工作）

## [3.5.0] - 2026-09-21 - 诚实失败与 headless 契约修复（沙箱实测驱动）

> 本轮修复全部来自一次隔离沙箱实测（对照 opencode）：写文件整条链路静默失败、被拒任务烧光 10 轮 token 仍报成功、`-m` 一次性参数永久污染配置等。254 → 265 用例。

### Fixed

- **写文件静默失败链路（P0）**：`file` 工具的 `content` 改为 write 必填（schema + 运行时双重校验，缺失即返回 PARAM_ERROR 修复信号而非写 0 字节文件）；成功写入返回字节数（`File written: x (N bytes)`）；读取空文件返回 `(empty file, 0 bytes)` 而非空串，模型从此能拿到"文件是空的"关键信号；工具空输出统一兜底为 `(no output)`，杜绝 `content: undefined` 的 tool 消息
- **失败熔断 + 诚实 result（P0）**：agent 循环新增连续失败熔断——连续 4 轮全部工具调用失败/被拒即终止（此前一个被拒任务会烧满 10 轮约 5 万 token）；循环提前终止或耗尽轮次时返回 `[AGENT_ABORTED]`；`--json` 的 `result` 事件携带 `stats: {rounds, toolCalls, denied, failed, abortedReason}`，任务未完成时 `success:false` 且退出码为 1（此前永远 success:true，调用方完全无法察觉失败）
- **`-m`/`-t` 一次性参数不再持久化**：单次任务模式经内存生效（`config.setTransient`），不再改写 config.json（此前 `gfc -m fake/model` 会永久改掉默认模型并关闭内置共享模式，污染后续所有会话）；交互启动（无 prompt）保持原有持久化行为
- **`-t ultra` 不再糊脸堆栈**：非法值在 action 内干净报错并退出 1（原先 option 解析函数 throw 冒泡成 uncaughtException + 完整 Node 堆栈）
- **中文 Windows 下 shell 输出乱码**：子进程输出改按原始字节接收，严格 UTF-8 失败后按 `chcp` 活动代码页解码（GBK/936 等），最后兜底 latin1——stderr 的 GBK 字节不再变成替换符污染模型上下文与 TUI/--json 显示
- **系统提示告知 OS/shell**：Environment 段新增 OS 版本与 shell 类型，Windows 下明确提示用 dir/type 而非 ls/cat（此前模型第一轮 `ls -la` 必然失败浪费一轮）
- **`init` 非 TTY 友好拒绝**：与主程序一致的 TTY 守卫（此前管道下渲染半截向导挂住）
- **no-key 报错点名模型**：`-m` 指定的模型不可用时，报错明示"该模型来自 -m 参数"（此前报"未配置 API Key"绝口不提真正变量）

### Added

- **`gfc models`**：列出当前服务商、模型、key 状态与目录
- **`gfc usage`**：累计 token 与 prompt 缓存命中统计
- **`gfc mcp`**：MCP 服务器连接状态（src/mcp 此前完全没有 CLI 入口）
- **`-c / --continue`**：恢复最近一次会话
- **`--json` start 事件携带 `session` id**，脚本消费方可关联续接；result 前新增 `text_final` 聚合事件（此前 text 按 token 碎片输出且无完成信号）
- **`.nwt/` 首建提示与退出开关**：首次在项目内自动建立过程记忆时打印一行说明并建议加入 .gitignore；`config.json` 设 `"nwt": false` 可完全关闭
- **错拼子命令拦截**：`gfc inti`/`gfc modles` 等给出"你是想执行 gfc init 吗"的干净提示（此前未知首词被原样发给 LLM 烧掉一轮）
- 内置共享模型下不再每轮打印 `cache: 0.0% hit`（该模型不启用缓存），改为一次性说明；`--yolo` 帮助文案改为如实描述分级审批（只读命令本就免确认）

### Tests

- 254 → 265：新增空写拒绝/字节数/空文件信号（file）、熔断与 loopStats（agent loop，mock provider）、transient 配置（-m 不落盘）三组回归

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