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
