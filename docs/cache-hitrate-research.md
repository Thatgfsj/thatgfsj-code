# 缓存命中率 3% 调查报告

> 调查日期：2026-09-20。范围：只读审计 `src/`，未改任何代码。
> 用户实测：zhipu GLM-5.3-Flash 与 SiliconFlow 内置 Qwen（均为 OpenAI 兼容端点），
> 长会话平均缓存命中率约 3%。成熟终端编码 CLI 同场景应为 80–95%。

---

## 一、根因结论（按证据强度 / 预期收益排序）

### 根因 1（首要）：OpenAI 兼容路径根本不读 `prompt_tokens_details.cached_tokens` —— zhipu / SiliconFlow 的命中数被整体丢弃，统计恒为 0

命中率的计算链是 `provider.normalizeUsage → StreamChunk{type:'usage'} → App.streamResponse → CacheStatsStore.record → snapshot().hitRate`。逐环核实：

1. **解析层丢字段**：`src/llm/openai.ts:303-315` 的 `normalizeUsage()` 只透传了
   DeepSeek 的 `prompt_cache_hit_tokens / prompt_cache_miss_tokens` 和 Anthropic 风格的
   `cache_*_input_tokens`，**没有读 `raw.prompt_tokens_details?.cached_tokens`**。
   而这正是 OpenAI 官方及一切 OpenAI 兼容层（含 zhipu、SiliconFlow）报告缓存命中的标准位置。
2. **类型层没有这个字段**：`src/types.ts:63-73` 的 `Usage` 接口只有
   `cache_creation_input_tokens / cache_read_input_tokens / prompt_cache_hit_tokens / prompt_cache_miss_tokens`，
   无任何 `cached_tokens` 字段。全 `src/` 检索 `cached_tokens` 与 `prompt_tokens_details` 均**零命中**（findstr 验证）。
3. **统计层只认两种字段**：`src/cache/stats.ts:117-119` 的 `record()`：
   `read = usage.cache_read_input_tokens ?? usage.prompt_cache_hit_tokens ?? 0`。
   zhipu / SiliconFlow 的响应两个都不带 → **每轮 read 恒为 0**。
4. **展示层**：`src/cache/stats.ts:159` `hitRate = totalReadTokens / totalInputTokens`；
   TUI 在 `src/tui/hooks/useCommands.ts:265-270, 371-381`（`/cache`、状态栏）直接渲染该比值。
5. **错误的注释固化了错误认知**：`src/cache/stats.ts:13` 写着
   "OpenAI does not surface any cache stats at all (their automatic cache is invisible to the client)"。
   这已过时多年：OpenAI 及兼容端点都在 `usage.prompt_tokens_details.cached_tokens` 返回命中数（见第三节来源）。

**结论**：在 zhipu GLM / SiliconFlow Qwen 上，无论上游真实命中率是 90% 还是 0%，本项目的显示值都趋近 0%。
用户测得的"3%"最合理的解释是：绝大多数轮次被记为 0，仅极少数轮次（如 DeepSeek 字段形状的响应、
或中转站顺带补了 Anthropic 风格字段）贡献了少量 read。**这是统计失真，不是（或不只是）没命中。**

### 根因 2（真实命中损失，影响 Anthropic 官方 API 路径）：消息序列上没有任何 cache_control 断点 —— 对话历史永远不进缓存

`src/llm/anthropic.ts` 全文只有两处自动断点：

- system 块尾：`anthropic.ts:329-337`（`block.cache_control = { type: 'ephemeral', ttl }`）；
- 工具列表尾：`anthropic.ts:418-424`（`toolDefs[toolDefs.length - 1].cache_control = ...`）。

消息数组（`anthropicMessages`，`anthropic.ts:342-405`）唯一能带上 `cache_control` 的途径是
`m.cache_control` 透传（`anthropic.ts:394-399`），而注释自己承认这是 "rare" ——
`src/llm/index.ts` 的 agent loop 从不设置它。

Anthropic 的缓存**写入只发生在断点处**：断点只覆盖 system + tools 意味着长会话中占大头的
对话消息 token 每轮全价重算。命中率上限 = `(tools+system) / (tools+system+messages)`，
长会话里 messages 占 90%+，即使系统提示词 8k、工具 8k、对话 200k，命中率也只有 ~7%，
且随对话增长单调下降趋近 0 —— 这就是"3%"量级的第二来源（对走 Anthropic 格式的用户是真实损失）。

对照官方模式（见第三节）：Anthropic 允许最多 4 个断点，推荐 tools → system → 最近消息逐级放置，
Claude Code 用满 4 个（system + 最后 3 条消息），每轮把对话尾部写进缓存，下一轮前缀命中。
本项目 4 个断点只用了 2 个，且恰好漏掉了唯一会增长的那一段。

**未发现的问题（顺带核实过，是好的）**：
- 1h TTL 确实带了 beta 头：`anthropic.ts:448-450` 在 `resolvedTtl==='1h'` 时发送
  `anthropic-beta: prompt-caching-2024-07-31,extended-cache-ttl-2025-04-11`。✓
- TTL 跨轮 sticky：`src/llm/index.ts:53, 177-192` 首轮 `decideTTL` 后写回 provider（`anthropic.ts:78-80, 322`），
  且 `decideTTL` 恒返回 `'1h'`（`src/cache/smartModel.ts:122-133`），不会每轮漂移。✓
- `[TOOL_REPAIR]` / `[SYSTEM REMINDER]` 是 append-only：`src/llm/index.ts:313-316, 334-337, 391-394, 409-412`
  只 push 不改写旧消息，不破坏前缀。✓
- 序列化字节稳定：`src/utils/stableStringify.ts:36` 递归按键字典序输出；openai/anthropic 的
  `doRequest` 都走它（`openai.ts:292`、`anthropic.ts:461`）。✓

### 根因 3：命中率公式混用两种 provider 语义（Anthropic 分母错，且可能算出 >100%）

`src/cache/stats.ts:159`：`hitRate = totalReadTokens / totalInputTokens`。

- OpenAI 兼容 / DeepSeek：`prompt_tokens` **包含**缓存命中部分（DeepSeek 更是 `prompt = hit + miss`），
  `read/prompt` 是正确口径。
- Anthropic：`input_tokens` **不含** `cache_read_input_tokens` 与 `cache_creation_input_tokens`
  （三者互斥相加才是总输入）。用 `read / input` 做分母会高估命中率（可 >100%），
  正确口径是 `read / (input + read + creation)`。

另外 `src/cache/stats.ts:135-136` 的 `const total = read + (input - read)` 恒等于 `input`，
是无效代码（行为无错但说明口径没有想清楚）。

### 根因 4：默认 50 条消息窗口 + 压缩重写历史，长会话周期性全量 bust

- 默认窗口：`src/app/index.ts:686-689` `effectiveContextLength` 兜底 `?? 50`（条，不是 token）。
  agent loop 每轮追加 3–5 条消息（assistant tool_calls + tool 结果 + 偶发 TOOL_REPAIR/SYSTEM REMINDER，
  `src/llm/index.ts:253-258, 313-323, 379-394`），**几十次工具调用就跨过 50 条**。
- 一旦跨过：`src/session/index.ts:273-287` `autoCompact()` → `src/session/compactor.ts:77-132`
  把中段历史替换成一条 `[CONTEXT CHECKPOINT]` system 摘要（`compactor.ts:116-122, 202-209`）
  —— 从插入点起**整个前缀作废**，system+tools+全部消息重新全价缓存一遍。
- 第二个重写点：`src/app/index.ts:546-566` `preCallContextCheck`（85% token 窗口）同样整段重写。

压缩本身是必要的上下文管理，但当前策略对缓存极不友好：每次压缩后一轮是必然的全量 miss，
且 50 条的默认值让"每次压缩"在长会话里高频发生。

### 根因 5（次级）：系统提示词"易变段排尾"的设计意图被 `build()` 拍平抵消

- 设计意图正确：`src/prompts/index.ts:72-85` 把 NWT 历史、当前时间两个 `volatile: true` 段
  排在 segments 尾部（时间戳没有被排进前缀的问题不存在——见下）。
- 但 `build()`（`src/prompts/index.ts:50-55`）把所有段 join 成**一个字符串**；
  Anthropic 路径把它装进**一个** content block 并把断点打在这个块上（`anthropic.ts:329-337`）。
  只要任何 volatile 段变化，整块（含断点）内容改变 → system+tools+全部消息全量 miss。
- 实际触发频率：system prompt 只在启动时构建一次（`src/app/index.ts:219`），
  `date` 在 builder 构造时固定（`src/prompts/index.ts:45`），**会话内是稳定的** ✓。
  但 `rebuildSystemPrompt()`（`src/app/index.ts:413-418`）会在权限模式切换 / `/model` 热切换时重建，
  并重新读盘 `.nwt/events`（`src/prompts/index.ts:295-324`）—— 模型每次按 NWT 规则记完日志
  （`prompts/index.ts:106-130` 要求"每个有意义的任务都必须记"）之后一旦发生 rebuild，
  NWT 段必变 → 全量 bust。在 zhipu/SiliconFlow 的自动前缀缓存下，system 是 messages 的前缀，
  NWT 变化同样 bust 掉它之后的一切。
- 会话间（`/new`）：`session.reset()` 保留旧 system（`src/session/index.ts:209-218`），
  不重建 prompt，跨会话时间戳/NWT 不会刷新——反而省了缓存写入，算隐性正确。

### 根因 6（信息性）：Gemini 路径同样丢缓存统计

`src/llm/gemini.ts:160-166` `normalizeUsage` 只读 `promptTokenCount / candidatesTokenCount / totalTokenCount`，
丢弃了 `usageMetadata.cachedContentTokenCount`（Gemini 隐式/显式缓存的命中数），
且 `thoughtsTokenCount` 未计入 completion（小误差）。

---

## 二、统计是否失真：各 provider usage 字段核对表

| Provider（用户场景加粗） | 上游命中数字段 | 本项目是否读取 | 读取位置 | 结果 |
|---|---|---|---|---|
| **zhipu GLM（OpenAI 兼容）** | `usage.prompt_tokens_details.cached_tokens`（官方文档明确此字段查命中量） | **否** | — | **恒记 0，全丢** |
| **SiliconFlow Qwen（OpenAI 兼容）** | `usage.prompt_tokens_details.cached_tokens`（OpenAI 兼容标准） | **否** | — | **恒记 0，全丢**（注意部分模型该字段可能为 `null`，需容错） |
| OpenAI 官方 | `usage.prompt_tokens_details.cached_tokens`（Responses API 为 `input_tokens_details.cached_tokens`） | 否 | — | 丢 |
| DeepSeek | `usage.prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` | 是 | `openai.ts:309-310` → `stats.ts:117-119` | 正确 |
| Anthropic 官方 / 兼容中转 | `usage.cache_read_input_tokens` / `cache_creation_input_tokens`（流式在 message_start/message_delta） | 是 | `anthropic.ts:220-231, 476-484` | 读取正确；但 `stats.ts:159` 分母口径错（见根因 3） |
| Gemini | `usageMetadata.cachedContentTokenCount` | 否 | — | 丢 |

**结论：统计严重失真。** 用户的两个主力端点（zhipu、SiliconFlow）的命中数都在解析层被丢弃；
唯一读取正确的 Anthropic 路径又被分母口径歪曲。因此"3%"首先是仪表盘坏了，
其次（对 Anthropic 路径）才是引擎真的只有 3%——见根因 2。

调试辅助已存在：环境变量 `GFCODE_DEBUG_USAGE` 可打印原始 usage（`src/app/index.ts:599, 615-619`），
修复后可先用它核对上游字段是否真的到了客户端。

---

## 三、同行做法清单（附来源）

**Anthropic 官方（cache_control 语义与增量模式）**
- 每请求最多 4 个断点；推荐顺序 tools → system → messages；支持"增量缓存"：保留旧断点、
  每轮把新断点放在最近的消息上，长对话每轮只为新增量付费。
  https://platform.claude.com/docs/en/build-with-claude/prompt-caching （https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching 同文）
- 显式断点之前约 20 个 content block 内的边界会自动尝试命中；超过 20 块的 prompt 需要更早的额外断点；
  缓存写入发生在断点处；最小可缓存长度 1024（2048/4096 视模型）tokens；5m 写入 1.25x、1h 写入 2x，读取均 0.1x。
  https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
- 提供顶层 `cache_control: {"type":"ephemeral"}` 自动断点模式（自动打到最后的可缓存块）。
  https://platform.claude.com/docs/en/build-with-claude/prompt-caching

**Claude Code（断点用满 4 个）**
- 断点策略：system prompt 1 个 + 最后 3 条非 system 消息各 1 个，共 4 个；工具定义与 CLAUDE.md
  作为稳定前缀自然被覆盖。每轮把对话尾部写入缓存 → 下一轮整段前缀命中。
  https://www.claudecodecamp.com （"How Prompt Caching Actually Works in Claude Code"）；
  社区讨论 https://github.com/anthropics/claude-code 相关 issues；
  实操建议汇总 https://www.mindstudio.ai/blog/prompt-caching-claude-code-save-tokens

**OpenAI / Codex CLI（自动前缀缓存 + cached_tokens 展示）**
- 缓存全自动：≥1024 tokens、按 128 递增取整；静态内容（system、工具、指令）放最前，
  动态内容（时间戳、检索结果）放最后；命中数在 `usage.prompt_tokens_details.cached_tokens`
  （Responses API 为 `input_tokens_details.cached_tokens`）。
  https://developers.openai.com/api/docs/guides/prompt-caching
  https://developers.openai.com/cookbook/examples/prompt_caching_201
- Codex CLI 在 token 用量读数中直接展示 cached input tokens；首轮贵、后续轮次靠缓存摊薄，
  前提是 system prompt 逐字节稳定。
  https://dev.to/snowflake/why-the-first-turn-in-a-coding-agent-can-use-so-many-input-tokens-and-why-that-gets-better-over-f8b

**opencode（反面教材同样有价值）**
- TUI/用量中区分 cache read / cache write；生态里出现过"插件中途改写请求导致 0% 命中"的案例，
  与本项目根因 4/5 同构：**任何在会话中途修改历史的层都会杀死缓存**。
  https://github.com/code-yeongyu/oh-my-openagent/issues/1247
  https://www.reddit.com/r/opencodeCLI/comments/1ryr6lr/understanding_cache_in_opencode
  https://opencode.ai/docs/cli

**DeepSeek（自动缓存字段基准）**
- 全自动磁盘缓存，无显式标记；`usage.prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`，
  命中价约为 miss 的 1/10；命中按前缀匹配。
  https://api-docs.deepseek.com/guides/kv_cache
  https://api-docs.deepseek.com/news/news0802

**zhipu / SiliconFlow（用户主力端点）**
- 智谱上下文缓存（隐式）：命中量通过 `usage.prompt_tokens_details.cached_tokens` 查询，命中按优惠价计费。
  https://docs.bigmodel.cn （"上下文缓存"）；海外站 https://docs.z.ai （Context Caching）
- SiliconFlow：OpenAI 兼容 `usage.prompt_tokens_details.cached_tokens`；cache read 折扣计价；
  底层即 vLLM Automatic Prefix Caching（前缀 KV 块复用，静态前缀前置即自动命中）。
  https://www.siliconflow.com （"How Cache Read Pricing Can Reduce Your API Bill"）
  https://api-docs.siliconflow.cn https://docs.vllm.ai （Automatic Prefix Caching）

---

## 四、可执行的修复建议（按预期收益排序）

1. **【统计修复，收益最大、改动最小】让 OpenAI 兼容路径读 `cached_tokens`。**
   - `src/types.ts:63-73`：`Usage` 增加可选字段（如 `cached_tokens?: number`）。
   - `src/llm/openai.ts:303-315`：`normalizeUsage` 增加
     `cached_tokens: raw.prompt_tokens_details?.cached_tokens`（字段可能为 `null`/缺失，需 `??` 容错）。
   - `src/cache/stats.ts:117`：`record()` 的 read 链改为
     `cache_read_input_tokens ?? prompt_cache_hit_tokens ?? cached_tokens ?? 0`。
   - 效果：zhipu / SiliconFlow 的显示命中率立即从 0% 恢复为上游真实值。
     若上游真实命中依然低，再查根因 4/5；若恢复到 80%+，则"3%"基本结案为统计失真。

2. **【Anthropic 真实命中，收益次大】给消息序列加增量断点（4 个用满）。**
   - `src/llm/anthropic.ts` `buildRequest`：保留 system 尾、tools 尾两个断点；
     再给**最后一个** `anthropicMessages` 元素（tool result 块或最后一条消息）打第 3 个
     `cache_control: { type: 'ephemeral', ttl: cacheTtl }`（content block 级别，参考现有
     `anthropic.ts:394-399` 的正确写法）。这即官方"incremental caching"模式、Claude Code 同款。
   - 注意断点必须打在 content block 上而非消息顶层（项目里 v3.0.5 已踩过这个 400 坑）。

3. **【减少周期性全量 bust】调大消息窗口 / 改压缩策略保前缀。**
   - `src/app/index.ts:686-689`：默认 `contextLength` 从 50 条提到 200 条以上（成熟 CLI 的消息窗口都在百级）。
   - `src/session/compactor.ts:77-132`：压缩结果尽量**保留旧前缀、替换尾部**（保留 system + 最早的
     若干完整组），把摘要插到中后段，使未压缩的前缀字节不变——上游前缀缓存可继续命中压缩点之前的部分。
     当前"摘要插在 system 之后"（`compactor.ts:122`）是每前必全 bust 的最差位置。

4. **【统计口径修正】hitRate 分母按 provider 语义拆分。**
   - `src/cache/stats.ts:116-143, 156-165`：record 时顺带记录 `creation`；snapshot 时
     Anthropic 形态用 `read / (input + read + creation)`，OpenAI/DeepSeek 形态用 `cached / prompt_tokens`。
     可在 store 里记一个"本次 read 来自哪个字段族"的标记来区分。删除 `stats.ts:135-136` 的无效 `total` 计算。

5. **【Gemini 统计补齐】`src/llm/gemini.ts:160-166` 读取 `raw.cachedContentTokenCount`，
   并把 `thoughtsTokenCount` 并入 completion_tokens。**

6. **【系统提示词抗变】把 system prompt 拆成两个稳定域。**
   - `src/prompts/index.ts:50-85`：`build()` 之外提供 `buildStablePrefix()`（project-instructions…skills，
     volatile=false 段）与 `buildVolatileTail()`（nwt-history、date-info）。Anthropic 路径输出两个
     system block、断点只打稳定块尾（`anthropic.ts:329-337`）；OpenAI 兼容路径可将 volatile 尾段
     挪到首条 user 消息或独立注入点，避免 rebuild 时 bust 全部对话。
   - `src/app/index.ts:413-418` `rebuildSystemPrompt` 改为只替换 volatile 段对应的 system block。

7. **【验证手段】修复后用 `GFCODE_DEBUG_USAGE=1`（`src/app/index.ts:599, 615-619`）跑一轮
   长会话，逐轮核对 zhipu / SiliconFlow 响应里 `prompt_tokens_details.cached_tokens` 是否非零、
   与 `/cache` 展示一致；再对比修复前后的 `/cache` 命中率曲线。**

---

### 附：本次核实过、确认没有问题的环节（避免重复排查）

- `stableStringify` 键序稳定（`src/utils/stableStringify.ts:20-47`），且两条主路径 `doRequest` 均使用。
- `[TOOL_REPAIR]` / `[SYSTEM REMINDER]` 注入为 append-only，不移动前缀（`src/llm/index.ts`）。
- 中途 system 消息（TOOL_REPAIR）在 OpenAI/Anthropic/Gemini 三条路径上都降级为
  `[system note]` user 轮，位置原地（`openai.ts:222-231`、`anthropic.ts:344-355`、`gemini.ts:74-86`）。
- TTL sticky 机制（`llm/index.ts:53, 177-192` + `anthropic.ts:78-80, 322`）与 1h beta 头（`anthropic.ts:448-450`）正确。
- 会话往返（agent loop mirror → session → 下一 turn `sanitizeLoadedMessages`）对完整历史是保真的，
  跨 turn 前缀字节稳定；`stableStringify` 不改数组序（`openai.ts:592-597`、`session/index.ts:89-146`）。
- 时间戳/NWT 虽在 system 尾，但会话内 system prompt 只构建一次、date 固定（`app/index.ts:219`、`prompts/index.ts:45`），
  会话内不是每轮变化源。
