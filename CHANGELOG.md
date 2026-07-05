# Changelog

All notable changes to **Thatgfsj Code** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned
- 实现真实的 provider 工具调用解析（OpenAI `delta.tool_calls`、Anthropic
  `tool_use` block、Gemini `functionCall`），让已注册的 Tool 真正参与 Agent Loop
- `install.sh` / `install.ps1` 默认分支自适应（`master` ↔ `main`）
- 移除 README 中失效的 `git.io/thatgfsj` 短链，全部改回 `raw.githubusercontent.com`
- MCP 客户端 `this.process?.connected` → `this.process?.stdin?.writable`

---

## [0.3.1] - 2026-07-06

### Added
- **「已保存的模型」作为 `/model` 主视图**：0.2.x 进 `/model` 先列内置模型，
  这版改为先列 `~/.thatgfsj/models.json` 里**已经保存的模型**（显示 id +
  `ctx` + `thinking` + `note/provider`），与 1.0.4 的 `ModelSelector` 行为
  对齐。内置 provider 模型列表作为辅助信息保留在底部。
- **`+ 添加新模型` 向导**：在 `/model` 选 `a` / `add` / `+` 启动完整向导：
  1. **步骤 1/6: 选择 provider**（10 个：8 个内置 + `custom_openai` + `custom_anthropic`）
  2. **步骤 2/6: 输入 API Key**（custom_* 可选跳过）
  3. **步骤 3/6: 输入 baseUrl**（仅 custom_*；要求 `https://.../v1` 形式）
  4. **步骤 4/6: 输入模型 id**
  5. **步骤 5/6: 上下文长度 (MiB)**（默认 8；常见 8 / 32 / 128 / 200）
  6. **步骤 6/6: 思考强度**（`none` / `low` / `medium` / `high` / `max`，默认 `none`）
  完成后：写入 `~/.thatgfsj/models.json`，同步切换到新模型（更新
  `AIEngine` + `~/.thatgfsj/config.json`），并把 `[system: model ... added]`
  注入 `SessionManager`，让 LLM 下一轮看到。
- **`/edit` 修改已保存模型**：1.0.4 时代就期望的能力，本次补齐：
  - `/edit` 列出全部已保存模型，输入编号或完整 id 进入
  - `/edit 1` / `/edit Qwen3-32B` 直接跳到对应模型
  - 修改 `ctx` / `thinking` / `note`，空回车保留旧值，`-` 清空字段
- **`/provider` 支持自定义 provider**：
  - 新增 `custom_openai`（OpenAI 兼容中转站）与 `custom_anthropic`
    （Anthropic 兼容中转站）两项
  - 选中后立刻提示输入 baseUrl，跳过内置的 `envKey` 校验
  - 自动跟进 `/model` 让你顺便挑 / 添加一个模型
- **`SavedModel` 类型导出**（`src/repl/loop.ts`）：
  ```ts
  interface SavedModel {
    id: string;
    addedAt?: number;
    ctx?: number;          // 上下文长度，单位 MiB
    thinking?: 'none' | 'low' | 'medium' | 'high' | 'max';
    note?: string;         // 备注（如 provider id、quant 说明等）
  }
  ```
- **6 个新单元测试**（`tests/unit-wizard.test.js`）：覆盖 v0.2.x → v0.3.x
  history 形状的透明迁移、`appendSavedModel` 大小写不敏感去重 + canonical
  casing 保留、`replaceSavedModel` 单条更新、`SavedModel` 形状 JSON 往返。

### Fixed
- **appendSavedModel casing**：之前大小写不一致的同一模型会被当成两条；
  现在若已经存了 `Qwen3-32B`，再次输入 `qwen3-32b` 仍然只保留 `Qwen3-32B`
  （原始拼写规范）。

> ⚠️ 上游 npm 上 `0.3.0` 已经被 1.0.4 时代占用过，因此本次发布使用 `0.3.1`，
> 仅是 patch 编号变化，feature 内容就是上面这份。

---

## [0.2.3] - 2026-07-06

### Added
- **中文命令别名**：1.0.4 老版本支持的 `/模型`、`/提供商`、`/提供商切换`、
  `/帮助`、`/退出`、`/清除`、`/清屏`、`/历史`、`/工具`、`/上下文`、
  `/模型列表` 现在都被识别。同时支持全角斜杠 `／模型`。详见
  `src/repl/loop.ts::handleCommand`。
- **`/model`「当前」标记**：即使当前模型不在内置列表里（老配置 / 自定义 id），
  `/model` 现在会在顶部显示一行 `⮕ 当前 (非内置): <id>`，并保留内置 / 历史
  列表中的 `✓` 标记逻辑。
- **3 个新单元测试**（`tests/unit-config.test.js`）：验证 0.2.3 的
  `ConfigManager` 行为契约（不再有 silent fallback 警告、从 `CUSTOM_BASE_URL`
  / `OPENAI_API_KEY` 派生 baseUrl、识别 8 个 provider name）。

### Fixed
- **legacy provider 名称崩溃**：0.2.2 的 `ConfigManager.resolveProvider` 对
  任何不在白名单的 provider（如 1.0.4 的 `custom_openai`）会强行 overwrite
  成 `siliconflow` 并打印 `Unknown provider: custom_openai, falling back to
  siliconflow` 警告，结果用户的 `MiniMax-M3` 等真实配置被悄悄丢掉，下一个
  AI 请求直接撞上 401。0.2.3 改为：
  - 保留用户的 provider id 不动。
  - 从 `CUSTOM_BASE_URL` / `BASE_URL` 环境变量派生 baseUrl，如果都没有则
    退到 `https://api.openai.com/v1`。
  - API Key 从 `OPENAI_API_KEY` / `CUSTOM_API_KEY` / config 里取。
  - 不再打「Unknown provider」警告。
- **空 prompt / 引号包裹 prompt**：`REPLInput.prompt()` 收到被意外粘贴成
  `""` 或 `''` 的内容时，0.2.3 会在 loop 里剥离外层引号再判断是否为空。
  这避免了用户从 markdown 复制示例时把空串丢给 LLM（命中 `[API Error: 401]`）。
- **DEFAULT_CONFIG 太老**：`ConfigManager` 默认从 `Qwen2.5-7B-Instruct`
  升级到 `Qwen3-235B-A22B-Instruct-2507`（或 `Qwen3-32B` 作为
  `PROVIDERS.siliconflow.defaultModel`）。

### Changed
- **刷新内置模型列表**（`src/repl/welcome.ts` + `src/core/types.ts`）：
  - SiliconFlow：Qwen3-235B / Qwen3-Coder-480B / Kimi-K2 / DeepSeek-V3.2 /
    ERNIE-4.5 等。
  - MiniMax：M3（推荐）、M2.5、M2.1（默认从 `MiniMax-M2.5` 升到 `MiniMax-M3`）。
  - OpenAI：GPT-4.1 / GPT-4.1-mini / GPT-4o / o4-mini / GPT-5。
  - Anthropic：Claude-Haiku-4.5 / Claude-Sonnet-4.5 / Claude-Opus-4.1。
  - Gemini：Gemini-2.5-Flash / Gemini-2.5-Pro / Gemini-2.0-Flash。
  - Kimi：Moonshot-V1-128K / Kimi-K2。
  - DeepSeek：DeepSeek-V3（带 R1 推理）。
  - ERNIE：ERNIE-4.5-8K（百度最新旗舰）。
- **`PROVIDERS` 默认模型**全部更新到 2025+ 推荐（Qwen3-32B、MiniMax-M3、
  GPT-4.1-mini、Claude-Haiku-4.5、Llama3、Gemini-2.5-Flash、Kimi-K2 等）。

---

## [0.2.2] - 2026-07-06

### Added
- **`/model` / `/provider` REPL 命令**：1.0.4 老版本里这两个交互式切换命令
  在 0.2.x 系列中曾经被删掉，这次重新实现并对齐新代码结构，并且从
  `thatgfsj-code@1.0.4` 的 TUI 版本里借鉴并移植了两项核心体验：
  - `/model` 列出当前 provider 的所有模型（含 `✓` 标记当前选中），输入编号
    或完整 model id 切换；立即写入 `~/.thatgfsj/config.json` 并通过
    `AIEngine.updateConfig()` 让下一次流式请求生效。空输入回车保持当前，
    Ctrl+C 取消。
  - **历史记录持久化**（借鉴 1.0.4 的 `saveModelToHistory`）：切换过的
    model id 写入 `~/.thatgfsj/models.json`，下次打开 `/model` 时会在
    内置列表上方显示「最近使用」段（最多 5 条，按时间排序，可通过 `r1`..`r5`
    快捷选取，自动 dedup）。
  - **任意 model id**：输入既不在内置列表也不在历史里的字符串，按自定义模型
    处理（适合 OpenAI-compatible 中转站 / Ollama 自定义模型名场景）。
  - `/provider` 列出 9 个支持的 provider，选完自动跟进 `/model` 让用户选
    新 provider 下的模型；如果新 provider 缺少对应的 API Key 环境变量，会提示
    用户先 `gfcode init` 或 `export`。
  - 两个命令都接受带或不带前导 `/`（与 1.0.4 的 `/模型` 老习惯兼容）。
  - 切换后会把一行 `[system: ... switched to ...]` 注入 `SessionManager`，
    让 LLM 在下一轮看到变更而不丢失上下文。
- **`AIEngine.updateConfig()` / `getConfig()`**：暴露给 REPL 内部用，支持
  在不重启引擎的情况下替换 `model` / `provider` / `baseUrl` / `temperature` /
  `maxTokens`。
- **34 个单元 / 冒烟测试**（`tests/`）：npm 内置 `node:test`，覆盖：
  - `smoke-cli.test.js` — `--version` / `--help` / 子命令空参守卫 / `bash -n`。
  - `unit-session.test.js` — `SessionManager` 拦截「已中断」、相邻助手去重、
    `truncate` 保留 system。
  - `unit-diff.test.js` — `DiffPreview.compare` 边界（unicode / 大输入 / CRLF /
    空输入）。
  - `unit-switcher.test.js` — `/model` 的纯 helper（编号 / id 解析）
    与 `AIEngine.updateConfig` 行为。
  - **新增** `unit-model-history.test.js` — `~/.thatgfsj/models.json` 的
    读写、dedup、corrupt-file 容错（`tests` 5 个 case）。

### Fixed
- **ESM `require()` 报错**：`src/index.ts` 顶层原先使用
  `require('child_process')` / `require('fs')`，在 `"type": "module"` 项目里
  直接抛 `ReferenceError: require is not defined`，导致 CLI 在包含 `package.json`
  的项目目录下完全无法启动。改为 `createRequire(import.meta.url)` 兼容。
- **`--version` 与 banner 打印老版本号**：`src/index.ts:102` 与
  `src/repl/output.ts:198` 硬编码 `0.2.0`/`v0.2.0`，而 `package.json` 是 `0.2.1`
  甚至后续 release。两处都改为从 `package.json` 动态读取。
- **REPL Ctrl+C 无法退出**：`src/repl/loop.ts` 的全局 SIGINT 处理只打
  warning，从来不调用 `this.running = false`。新增 `REPLInput.requestCancel()`，
  在空输入连按两次 Ctrl+C 时正确退出。
- **`executeTask` 助手消息丢失**：单命令模式下助手回复从来没写回
  `SessionManager`，导致同名 SessionManager 实例对多轮 prompt 拿不到上下文。
- **`(this.ai as any).chatStream`** 多余 `any` 强转：`this.ai` 已经过
  null-check，删掉即可。
- **`extractToolCalls` 死分支**：`src/core/ai-engine.ts` 中 `if (…includes('tool_use'))
  return undefined; return undefined;` 等价于永远返回 `undefined`。改为单行
  `return undefined;` 并添加注释说明当前实际无法解析 tool call（属于已知限制）。
- **欢迎页 banner 字样写错**：`src/repl/welcome.ts` 顶部仍写着 `Claude Code`，
  与项目名 `Thatgfsj Code` 不一致。已更正。

### Changed
- **`init` 命令动态 import 去重**：`src/index.ts:54` 的
  `await import('./repl/welcome.js')` 与顶部静态 import 重复，删除。
- **`handleModelSwitch`** 在 `src/index.ts` 中属于死代码（无调用者），删除。
- **欢迎页标题框宽度自适应**：把 banner 顶部的 `Claude Code ` 换成
  `Thatgfsj Code ` 后调整间隔符长度，保证盒子保持 62 列对齐。

### Documentation
- 新增 `DEVELOPMENT.md`：覆盖架构图、构建/测试流程、添加 provider / 命令 / tool
  的步骤、跨平台注意事项、发布流程。
- 新增本文件 `CHANGELOG.md`。
- 更新 `README.md`：替换失效的 `git.io/thatgfsj` 安装链接为 GitHub raw 直链；
  补上 `gfcode init` 使用示例与所有顶层 / 子命令 flag；附 REPL 内置命令列表
  以及 Node ≥ 18 的前置条件。
- `docs/FAQ.md`、`docs/API_KEY_GUIDE.md` 交叉链接到 `DEVELOPMENT.md`。

### Packaging
- `package.json` 新增 `files`、`engines`、`repository`、`bugs`、`homepage`
  字段；原先没有 `files` 白名单会导致 `npm publish` 不会自动包含 `dist/`
  （dist 在 `.gitignore` 里），现在通过显式白名单确保 tarball 包含
  构建产物与文档。
- 新增 `scripts.test`、`scripts.test:silent`、`scripts.prepublishOnly`，
  发布前自动跑测试和 build，防止 release 出错。

### Tests
- 新增 `tests/` 目录，使用 Node 内置 `node --test` 跑通：
  - `tests/smoke-cli.test.js` — `dist/index.js --version` / `--help` / `chat`
    / `explain` / `debug` / `template` 空参守卫；`bash -n install.sh` 语法。
  - `tests/unit-session.test.js` — `SessionManager` 拦截「已中断」污染、
    相邻助手消息去重、`truncate` 保留 system。
  - `tests/unit-diff.test.js` — `DiffPreview.compare` 在相同 / 不同 /
    空 / unicode / CRLF 输入下的行为。

---

## [0.2.1] - 2026-07-XX

### Fixed
- REPL 数字小键盘方向键响应（升级到 `@inquirer/input`，不再用 Node `readline`
  直接 `.question()`）。
- 流式输出保留完整内容、不再 reset 终端 / 跳顶，用户可滚动查看历史。
- 修复 AI 输出 `[已中断]` 等污染字符串时反复循环同一段的 bug（`SessionManager`
  拦截 `已中断` / `think` block，`getMessages()` 做相邻助手去重）。

### Added
- `src/repl/welcome.ts` Claude Code 风格欢迎页与 `gfcode init` 配置向导。
- `src/tools/{file,shell,git,search}.ts` 完整工具实现，并通过
  `ToolRegistry` 注册到 AI Engine。
- `src/agent/{core,intent,streaming}.ts` Agent Loop、意图识别、流式输出。
- `src/utils/{diff-preview,memory,project-context}.ts`。
- `src/mcp/client.ts`：MCP 客户端雏形。

---

## [0.1.0] - initial

- 初版发布：基础 `explain` / `debug` / `chat` / `template` 命令与 REPL 雏形。
