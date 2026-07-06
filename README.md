# Thatgfsj Code ⚡

AI 编程助手 — 终端里的 AI 编程伙伴

---

## 特性

- **Ink TUI** — React 驱动的终端 UI，流式输出、Markdown 渲染
- **工具调用** — AI 可以读写文件、执行命令、搜索代码、操作 Git
- **16 个内置 Skills** — 规划、调试、TDD、架构优化、代码审查等
- **NeuroWeave Timeline** — 项目演进记忆，自动归档（30天）
- **多 Provider** — 15 个平台 + 自定义中转站
- **上下文压缩** — 超限自动压缩，节省 token
- **Playwright** — 浏览器自动化（测试/抓取/截图）
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

**npm（已有 Node.js）：**
```bash
npm install -g thatgfsj-code
```

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

# 指定模型
gfcode -m gpt-4o "你的任务"
```

### 内置命令

| 命令 | 别名 | 说明 |
|------|------|------|
| `/model <名称>` | `/模型` | 切换模型 |
| `/provider` | `/服务商` | 更换服务商 |
| `/new` | `/新建` | 新建会话 |
| `/compact` | `/压缩` | 压缩上下文 |
| `/skills [id]` | `/技能` | 管理技能 |
| `/mcp` | - | MCP 设置 |
| `/help` | `/帮助` | 查看帮助 |
| `exit` | - | 退出 |

输入 `/` 会弹出命令选择框，↑↓ 选择，Tab 补全。

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
| SiliconFlow | OpenAI | Qwen2.5-7B |
| OpenAI | OpenAI | gpt-4o-mini |
| DeepSeek | OpenAI | deepseek-chat |
| Kimi | OpenAI | kimi-k2.6 |
| Zhipu GLM | OpenAI | glm-4-flash |
| MiniMax | OpenAI | MiniMax-Text-01 |
| Baichuan | OpenAI | Baichuan4 |
| Stepfun | OpenAI | step-1-flash |
| Doubao | OpenAI | doubao-1.5-pro-32k |
| Anthropic | Anthropic | claude-sonnet-4 |
| Gemini | Gemini | gemini-2.0-flash |
| ERNIE | OpenAI | ernie-4.5-8k |
| Ollama | OpenAI | llama3.1 |
| **自定义 OpenAI** | OpenAI | 中转站 |
| **自定义 Anthropic** | Anthropic | 中转站 |

---

## 内置工具

| 工具 | 功能 |
|------|------|
| `file` | 读/写/列表/删除文件 |
| `shell` | 执行 shell 命令 |
| `git` | Git 操作 |
| `search` | 代码搜索 |
| `nwt` | 项目演进记忆（见下方说明） |

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
| playwright | 浏览器自动化 |
| frontend-design | UI/UX 实践 |
| supabase | 数据库实践 |
| neuroweave | 项目记忆 |

---

## 架构

```
src/
├── cmd/        # CLI 入口
├── app/        # 核心服务
├── config/     # 配置 + Provider
├── llm/        # LLM 抽象层
├── session/    # 会话 + 自动压缩
├── tools/      # 工具系统
├── skills/     # 16 个内置 Skills
├── tui/        # Ink TUI 组件
├── mcp/        # MCP 协议
├── hooks/      # 钩子系统
├── prompts/    # 系统提示
├── utils/      # 工具函数
└── types.ts    # 全局类型
```

---

## 文档

- [API Key 获取教程](./docs/API_KEY_GUIDE.md)
- [常见问题 FAQ](./docs/FAQ.md)
- [版本路线图](./ROADMAP.md)

---

## 问题反馈

https://github.com/Thatgfsj/thatgfsj-code/issues
