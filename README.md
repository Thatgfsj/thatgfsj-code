# Thatgfsj Code ⚡

AI 编程助手 — 终端里的 AI 编程伙伴

---

## 特性

- **Ink TUI** — React 驱动的终端 UI，流式输出、Markdown 渲染
- **Agent 工具调用** — AI 可以读写文件、执行命令、搜索代码、操作 Git，写/删文件前展示 diff 并请求确认
- **apply_patch 多文件原子补丁** — Codex V4A 格式：一次调用完成增/改/删/改名多个文件，上下文锚定定位，整包一次确认
- **任务计划** — AI 对多步任务自动维护 `update_plan` 计划面板，实时显示进度；`/plan` 计划模式批准即执行；AGENTS.md 项目记忆逐层注入
- **分级审批** — 只读命令免确认直接跑，写/执行类才询问（Codex 式），`--yolo` 全放行
- **内置浏览器（Playwright）** — 首次运行可选择安装内置 Chromium（约 200MB，独立运行，不影响你的浏览器），AI 用它搜索网页、读取页面，零 API key
- **MCP 支持** — 接入 Model Context Protocol 服务器（stdio），工具动态注册进对话，`~/.thatgfsj/mcp.json` 配置
- **会话持久化** — 每轮自动保存到 `~/.thatgfsj/sessions/`，`/resume` 随时恢复历史会话
- **Headless 模式** — `gfcode "任务" --json` 输出行分隔 JSON 事件流，可脚本化 / 接 CI
- **权限管线** — 写/执行类工具调用默认需要确认（y / a / n），`--yolo` 跳过
- **上下文自动压缩** — 超过阈值按"完整工具调用块"原子压缩，不产生孤儿 tool_calls
- **Prompt Caching** — Reasonix 式缓存架构：稳定序列化、Anthropic cache_control 断点、智能 TTL、命中率统计
- **16 个内置 Skills** — 规划、调试、TDD、架构优化、代码审查等
- **NeuroWeave Timeline** — 项目演进记忆（v0.2.0 融合：事件自动链式、importance、diff/compact、快照备份与 parent 重映射、归档不丢数据）
- **多 Provider** — 15 个平台 + 自定义中转站，含 Ollama 本地模型
- **消息队列** — AI 工作时输入补充说明，完成后自动处理
- **中文命令** — `/模型` `/新建` `/压缩` `/技能` 等

---

## 快速开始

### 安装

**Windows（一键安装，自动下载 Node.js）：**
```powershell
irm https://www.thatgfsj.xyz/install/gfcode.ps1 | iex
```

**Linux / macOS：**
```bash
curl -fsSL https://www.thatgfsj.xyz/install/gfcode.sh | bash
```

**npm（已有 Node.js ≥ 20.19）：**
```bash
npm install -g thatgfsj-code
```

安装后四个命令等价：`gfcode`、`gfc`、`gfcgfc`、`thatgfsj`，任选顺手的用。

### 配置

```bash
gfcode init
```

交互式选择服务商 → 输入 API Key → 选模型 → 设上下文长度。

---

## 使用

```bash
# 交互模式（Ink TUI）
gfcode

# 单次 prompt
gfcode "帮我写一个 Hello World"

# headless JSON 事件流（可接脚本/CI）
gfcode "跑一下测试并总结结果" --json

# 跳过工具确认（谨慎）
gfcode --yolo

# 指定模型
gfcode -m deepseek-flash "你的任务"

# 思考强度 off|low|medium|high（需模型支持）
gfcode -t low "任务"
```

### 权限确认

写/执行类操作默认需要确认（分级审批）：

- **只读命令免确认**：`git status/log/diff`、`ls`、`cat` 等检查类命令直接执行（Codex 式分级）
- 文件写入展示**逐行 diff**（超长自动截断）；`apply_patch` 整包补丁一次确认
- `y` 允许一次 · `a` 本会话全部允许 · `n` 拒绝（60 秒无响应自动拒绝）
- headless / 非 TTY 环境默认**拒绝**，需要放行请加 `--yolo`（TUI 内也可用 `/yolo` 切换）
- shell 输出超 8000 字符自动 head+tail 截断，保护上下文窗口

### 三种权限模式

| 模式 | 命令 | 界色标识 | 行为 |
|------|------|----------|------|
| 默认确认 | - | 无 | 只读免确认，写/执行询问 |
| 🔵 计划模式 | `/plan`（`/计划模式`） | 蓝色 | 只读研究 + `update_plan` 列计划，写/执行自动拒绝；每轮结束弹出批准框，**批准后自动进入完整权限模式并开始执行** |
| 🔴 完整权限模式 | `/完整权限模式`（`/yolo`） | 红色 | 写/执行不再确认，直接执行 |

### 内置命令

| 命令 | 别名 | 说明 |
|------|------|------|
| `/model <名称>` | `/模型` | 切换模型（立即生效，无需重启） |
| `/provider` | `/服务商` | 更换服务商 |
| `/new` | `/新建` | 新建会话（保留系统提示） |
| `/resume [序号]` | `/恢复` | 恢复历史会话 |
| `/compact` | `/压缩` | 压缩上下文（保持工具调用完整） |
| `/init` | - | 扫描项目并生成 AGENTS.md（自动注入系统提示） |
| `/plan` | `/计划模式` | 计划模式：只读研究+列计划，批准后全自动执行（蓝色） |
| `/tasks` | `/任务` | 查看/清除任务计划（模型多步任务自动维护） |
| `/status` | `/状态` | 会话状态一览（模型/上下文/缓存/计划） |
| `/cache` | `/缓存` | 缓存命中率统计（`/cache reset` 清零） |
| `/ttl 5m\|1h` | `/ttl` | 设置缓存 TTL（立即生效） |
| `/thinking on\|off` | `/思考` | 切换思考块显示 |
| `/skills [id]` | `/技能` | 管理技能 |
| `/mcp` | - | MCP 服务器状态 |
| `/yolo` | - | 切换写/执行操作自动确认 |
| `/help` | `/帮助` | 查看帮助 |
| `exit` | - | 退出 |

输入 `/` 会弹出命令选择框，↑↓ 选择，Tab 补全。

### AGENTS.md 项目记忆

启动时自动按链发现并注入系统提示：全局 `~/.thatgfsj/AGENTS.md` → 项目根（`.git` 所在目录）→ 当前目录，逐层拼接、去重、截断。运行 `/init` 可让 AI 扫描项目自动生成一份。

### MCP 配置

编辑 `~/.thatgfsj/mcp.json`（兼容 Claude Code 的 `mcpServers` 键名）：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:\\projects"]
    }
  }
}
```

重启后生效，工具以 `mcp__服务器名__工具名` 注册进对话，`/mcp` 查看连接状态。

### 消息队列

AI 工作时可以继续输入，消息会排队等待：
```
  AI
    正在创建文件...

❯ 补充：再加一个测试函数
📎 已排队: 补充：再加一个测试函数

  AI
    (当前任务完成后自动处理)
```

---

## 支持的 Provider

| Provider | 格式 | 默认模型 |
|----------|------|----------|
| SiliconFlow | OpenAI | Qwen/Qwen3.5-35B-A3B |
| OpenAI | OpenAI | gpt-5.4-mini |
| DeepSeek | OpenAI | deepseek-flash |
| Kimi | OpenAI | kimi-k2.6 |
| Zhipu GLM | OpenAI | glm-5.2 |
| MiniMax | OpenAI | MiniMax-M2.5 |
| Baichuan | OpenAI | Baichuan4 |
| Stepfun | OpenAI | step-1-flash |
| Doubao | OpenAI | doubao-1.5-pro-32k |
| Anthropic | Anthropic | claude-sonnet-5 |
| Gemini | Gemini | gemini-3.8-flash |
| ERNIE | OpenAI | ernie-5.0-thinking-latest |
| Ollama | OpenAI | qwen3.6 |
| **自定义 OpenAI** | OpenAI | 中转站 |
| **自定义 Anthropic** | Anthropic | 中转站 |

---

## 内置工具

| 工具 | 功能 |
|------|------|
| `file` | 读/写/列表/删除文件（写/删需确认，写入带 diff 预览） |
| `shell` | 执行 shell 命令（每次确认，危险命令黑名单硬拦截） |
| `git` | Git 操作（写操作确认；参数以数组传递，无 shell 注入） |
| `search` | 代码搜索（纯 JS grep，Windows 原生可用） |
| `nwt` | 项目演进记忆（见下方说明） |
| `browser` | 内置浏览器：搜索网页（bing/baidu）、打开 URL 读正文，驱动内置 Chromium（独立运行，不影响你的浏览器） |
| `mcp__*` | 来自 MCP 服务器的动态工具 |

**会话统计**：底部状态栏实时显示 `ctx 已用/窗口 (占比) · ↑输入 ↓输出 tokens · 缓存节省`，上下文达到模型窗口 **85%** 时自动压缩历史（阈值可按模型在 `/models` → `w` 中设置，默认 128k）。

### NWT - NeuroWeave Timeline

项目演进记忆系统，自动记录开发过程中的重要事件。

**操作：**
| 命令 | 说明 |
|------|------|
| `nwt log` | 记录事件 |
| `nwt history` | 查看历史 |
| `nwt search` | 搜索事件 |
| `nwt story` | 项目故事 |
| `nwt explain <file>` | 文件历史 |
| `nwt diff <from> <to>` | 两个事件之间的变化 |
| `nwt compact` | 合并连续小事件 |
| `nwt archive` | 手动归档 |

**自动归档：** 超过 30 天的事件会在启动时自动归档到 `archives/` 目录。如需更长保留期，可定期手动备份 `.nwt/` 目录。

**事件重要性：** `low` / `normal` / `high` / `milestone`，用于 `story` 命令筛选。

**SQLite 支持：** 当前使用 JSON 文件存储。如需更高效的查询，可自行迁移至 SQLite。

---

## 内置 Skills

| Skill | 用途 |
|-------|------|
| writing-plans | 任务拆解 |
| executing-plans | 按步骤执行 |
| systematic-debugging | 结构化调试 |
| brainstorming | 多方案对比 |
| tdd | 测试驱动开发 |
| improve-architecture | 架构优化 |
| verification | 完成前验证 |
| code-review | 代码审查 |
| prototype | 快速原型 |
| triage | 问题分级 |
| git-workflow | Git 最佳实践 |
| subagent | 任务分解 |
| playwright | 浏览器自动化实践（提示词技能，Playwright 本身按需 `npx` 安装） |
| frontend-design | UI/UX 实践 |
| supabase | 数据库实践 |
| neuroweave | 项目记忆 |

---

## 架构

```
src/
├── cmd/        # CLI 入口（交互 / 单次 / --json headless）
├── app/        # 核心服务（组装、权限决策、模型热切换）
├── config/     # 配置 + Provider
├── llm/        # LLM 抽象层（openai / anthropic / gemini 三协议）
├── cache/      # Prompt caching（稳定序列化、断点、智能 TTL、统计）
├── session/    # 会话持久化 / resume / 自动压缩
├── tools/      # 工具系统（权限确认、diff 预览）
├── skills/     # 16 个内置 Skills
├── tui/        # Ink TUI 组件
├── mcp/        # MCP stdio 客户端
├── hooks/      # 钩子系统
├── prompts/    # 系统提示（分段构建）
├── utils/      # 工具函数
└── types.ts    # 全局类型
```

---

## 文档

- [API Key 获取教程](./docs/API_KEY_GUIDE.md)
- [常见问题 FAQ](./docs/FAQ.md)
- [版本路线图](./ROADMAP.md)
- [更新日志](./CHANGELOG.md)

---

## 问题反馈

https://github.com/Thatgfsj/thatgfsj-code/issues
