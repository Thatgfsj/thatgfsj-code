# 黑盒测试发现（2026-09-21 夜间，内置免费 Qwen/Qwen3.5-4B，隔离沙箱）

## 实测通过 ✅
- 普通对话（内置共享模型流式回复正常）
- 写文件全链路：模型发起写 → 权限确认弹窗出现 → y 放行 → 文件落盘 → 模型回复完成（BB-06）
- /models 对话框开合、esc 关闭（BB-13/14 通过，无 FIND）
- emoji + 生僻字输入回显正常（BB-15 通过）
- 危险命令（BB-07）：模型层面直接拒绝执行、未调用工具——"Blocked" 工具层拦截未触发属预期；工具层拦截已有 26 个单测覆盖
- 中转站配置全流程（独立 pty 复验）：选服务商 → 输 Key → 输 Base URL → 切换成功

## 判定为探针伪影（非产品 bug）
- BB-08/09/10：Ctrl+C 是设计上的退出（底栏标注 ctrl+c 退出），并非"中断回合"。
  探针误用 Ctrl+C 当中断，后续场景全在已退出的进程上执行。
  → 改进项 UX-1：流式输出中第一次 Ctrl+C 应中断当前回合（显示 [已中断]），
  第二次 Ctrl+C 才退出（Claude Code 行为）。当前流式中途退出会丢失该回合记录。

## 确认待修（本轮 3.4.10 修复）
- BB-HELP：/help 输出换行被 Markdown 软换行折叠成一段 → marked `breaks: true`
- RELAY-URL：自定义中转站输完 Key 直接"切换成功"，从不询问 Base URL
  （判断条件用了必然非空的已解析 baseUrl），且继承了上一服务商的端点
- CACHE-STATS：平均缓存命中率 3% 系统计失真——OpenAI 兼容端点
  （zhipu/SiliconFlow）的 `prompt_tokens_details.cached_tokens` 从未被读取，
  命中一律记 0；Gemini 的 `cachedContentTokenCount` 同样被丢弃
  （详见 docs/cache-hitrate-research.md）
- SWITCH-BASEURL：切换服务商时旧的 baseUrl 字段被带入新服务商

## 缓存命中率调查结论（docs/cache-hitrate-research.md）
1. 首要：统计层丢弃 cached_tokens（失真，非真未命中）→ 本轮已修
2. Anthropic 消息序列无 cache_control 断点（真实命中损失，待做）
3. 命中率分母语义在 Anthropic 上不精确（待做）
4. 默认 50 条消息窗口偏小 + 压缩策略破坏前缀（待评估）
5. system prompt 易变段在 rebuildSystemPrompt 时全量 bust（待评估）
