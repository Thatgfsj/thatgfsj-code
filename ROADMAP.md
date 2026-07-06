# Thatgfsj Code - Development Roadmap

---

## ✅ v0.9.0 - 稳定版 (当前版本)

### 核心架构
- [x] Ink (React) TUI 框架
- [x] LLM Provider 抽象层 (OpenAI/Anthropic/Gemini)
- [x] 15 个 Provider + 自定义中转站
- [x] 模块化目录结构 (cmd/app/config/llm/session/tools/tui/skills/hooks/prompts)

### 工具系统
- [x] file (读/写/列表/删除)
- [x] shell (执行命令)
- [x] git (操作)
- [x] search (搜索)
- [x] nwt (项目记忆，30天自动归档)

### Skills 系统
- [x] 16 个内置 Skills (规划/调试/TDD/架构/浏览器等)
- [x] /skills 命令管理
- [x] 自动激活

### UI/UX
- [x] Ink TUI 流式输出
- [x] Markdown 渲染 (marked-terminal)
- [x] 工具调用显示 (opencode 风格)
- [x] 状态栏
- [x] 命令系统 (/model, /new, /compact, /skills, /mcp, /help)
- [x] /model 交互式选择框

### 智能功能
- [x] 自动读取 CLAUDE.md/SKILLS.md (通用路径)
- [x] NWT 项目历史自动注入系统提示
- [x] 上下文自动压缩 (超限触发)
- [x] API 错误检测 (401/403/429)
- [x] 启动时检测 API Key

### 安装
- [x] npm install -g thatgfsj-code
- [x] Windows PowerShell 一键安装
- [x] Linux/macOS Bash 一键安装
- [x] 自动下载 Node.js (如果没有)

### 测试通过
- [x] 简单任务: 读文件 + 回答
- [x] 中等任务: 修改文件 + 验证
- [x] 困难任务: 多步骤 + NWT 记录
- [x] Git + Search + NWT 联合测试
- [x] 多文件创建和修改

---

## 📋 未来计划

### v1.0.0
- [ ] SQLite 会话持久化
- [ ] Token 使用量显示
- [ ] 命令 Tab 补全
- [ ] 多会话管理
- [ ] LSP 集成
- [ ] 图片支持

---

## 历史版本

### ✅ v0.8.0 - 命令系统
- /model, /new, /compact, /skills, /mcp 命令

### ✅ v0.7.0 - Skills + NWT
- 16 个内置 Skills, NWT 项目记忆

### ✅ v0.6.0 - Ink TUI
- React 组件化 UI, Markdown 渲染

### ✅ v0.5.0 - Provider 重写
- 15 个 Provider, 自定义中转站

### ✅ v0.4.0 - UI 优化
- 流式输出, 工具调用显示

### ✅ v0.3.0 - 架构重构
- 模块化目录, Provider 抽象

### ✅ v0.2.0 - 工具 + LLM
- Git/搜索工具, 多 Provider

### ✅ v0.1.0 - REPL 基础
- 彩色 UI, 命令提示符
