# Thatgfsj Code - Development Roadmap

> 版本口径：以 `package.json`（npm 包版本）为单一事实来源。
> 3.0.5 起 `gfcode --version` / TUI / 文档统一读它。

---

## ✅ v3.0.18 - 对齐主流 CLI (当前版本, 2026-09)

> **3.0.13 - 3.0.18 摘要**：浏览器工具（内置 Chromium）/ 85% 阈值自动压缩 / token 用量统计 / 滚动修复 / 模型设置面板

### 核心架构
- [x] Ink (React) TUI 框架
- [x] LLM Provider 抽象层 (OpenAI/Anthropic/Gemini 三协议)
- [x] 15 个 Provider + 自定义中转站 + Ollama 本地模型
- [x] Reasonix 式 Prompt Caching（稳定序列化 / 断点 / 智能 TTL / 命中率统计）
- [x] 版本号单一来源（package.json 运行时读取）

### Agent 能力（对标 2026 主流 coding CLI 的桌面标准）
- [x] MCP stdio 客户端接入（mcp.json 配置、动态工具注册、/mcp 状态、退出清理）
- [x] 会话持久化 + /resume（自动保存、悬空 tool_calls 校验修复）
- [x] Headless JSON 模式（--json 事件流、--yolo、退出码）
- [x] 权限确认管线（y/a/n、diff 预览、60s 超时、TUI 独占输入互斥）
- [x] 上下文自动压缩（原子工具调用块、不切配对）
- [x] AGENTS.md / CLAUDE.md / SKILLS.md 项目指令读取
- [x] 模型热切换（/model、-m 即时生效）
- [x] 工具结果回传渲染（TUI 面板显示真实输出）

### 质量与安全
- [x] git/search 注入修复（execFile 参数数组 / 纯 JS grep）
- [x] AbortSignal 全链路贯通（取消即中止 HTTP）
- [x] 流式空闲看门狗（120s）
- [x] 103+ 个 vitest 单测（cache / mcp / session / tools）
- [x] npm 发布就绪（files/prepublishOnly/engines/repository）

---

## 📋 未来计划

### 近期（对齐 P1 差异化）
- [ ] Plan mode（先规划后执行，主流产品均有）
- [ ] Checkpoints / 回滚（基于 git snapshot 的简化实现）
- [ ] Subagent 并行任务（task 工具 + 工作区隔离）
- [ ] MCP SSE / HTTP transport（当前仅 stdio）
- [ ] 外部 SKILL.md 目录发现（兼容 Claude skills 格式，替代内置 ts 数组）
- [ ] 逐消息 token 用量 / 成本显示
- [ ] 图片 / 多模态输入（ContentBlock 已预留 image 类型）

### 远期（前沿跟踪）
- [ ] Hooks 事件系统接线（当前模块存在、事件发射点未接入）
- [ ] LSP 集成（走标准协议，不自研语义索引）
- [ ] 订阅 OAuth 直连（ChatGPT / Claude Pro，需官方 client 凭据）
- [ ] OS 级 sandbox（平台相关，成本高，谨慎评估）
- [ ] 远程 / 云端 agent（头部产品免费送，个人项目不硬刚）

### 明确不做
- 自建插件分发市场（兼容 Claude marketplace 格式即可）
- 自研语义索引 / repo map（agent + grep + LSP 组合已覆盖）
- 自研模型网关

---

## 历史版本

### ✅ v3.0.5 - 对齐主流 CLI（2026-09）
- Ink TUI / Provider 抽象 / Prompt Caching / MCP / 权限管线落地

### ✅ v3.0.0 - Reasonix Prompt Caching（2026-08）
- 结构化 StreamChunk 流协议 / Anthropic cache 断点 / 缓存统计

### ✅ v2.x - 稳定性系列（2026-07）
- anti-pollution 过滤、thinking 压缩、TUI 修复

### ✅ v0.1 - v0.9 - 产品早期（产品版本口径）
- REPL → Ink TUI → Provider 重写 → Skills + NWT → 命令系统
