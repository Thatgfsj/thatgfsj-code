# Thatgfsj Code 🤖

你的 CLI 工具 - 像 Claude Code 一样使用 AI 编程。

> 当前版本: **2.2.0** · Node.js ≥ 18 · MIT 许可证

---

## ℹ️ 关于 1.0.4 vs 2.x 的 UX

**`thatgfsj-code@1.0.4`** 是基于 Ink (React for CLI) 的全屏 REPL,有实时行内
命令补全 (`/foo` 时下方出现过滤列表)。

**2.x** (本仓库,2.0.0 起) 是纯 ESM + Node `readline` + `@inquirer/*`。
**没有 Ink 渲染栈**,所以在 2.x 里**没有办法**实现 1.0.4 那种"输入 `/` 后下方
行内 filter 列表"的 UX。

**取舍**:2.x 提供更稳定、更易维护的 REPL 体验,但放弃了 live filter。如果你需要
1.0.4 那种 UX,**用 \`npm i -g thatgfsj-code@1.0.4\`** 即可同时存在两个版本。

2.x 仍然有 (相对 0.x 系列):
- ✅ `/model` `/edit` `/provider` 用 `@inquirer/select` 上下键选
- ✅ 中文命令别名 (`/模型` `/提供商` `/清屏` `/帮助` ...)
- ✅ 自定义 provider (`custom_openai` / `custom_anthropic` 中转站)
- ✅ "已中断"污染循环治本修复 (Ctrl+C 中断 + AbortSignal)
- ✅ 添加模型向导 (provider → key → url → name → ctx(M) → thinking)

---

## ⭐ 特性

- 🤖 **AI 对话** — 用自然语言让 AI 帮你写代码
- 📖 **代码解释** — 通俗易懂地解释代码含义
- 🔧 **代码调试** — 找出 bug 并给出修复方案
- 📦 **代码模板** — 快速生成项目代码
- 💬 **交互模式** — 持续对话，像聊天一样编程
- 🧰 **内置工具** — 文件读写 / Shell 执行 / Git 操作 / 代码搜索
- 🚫 **抗污染防御** — `SessionManager` 自动过滤 `[已中断]` 等历史污染

---

## 🚀 快速开始

### 🎯 一键安装（推荐）

安装脚本全部托管在 GitHub 上、`install.sh` / `install.ps1` / `install.bat`
可直接 curl / iwr：

**macOS / Linux**：

```bash
curl -L https://raw.githubusercontent.com/Thatgfsj/thatgfsj-code/main/install.sh | bash
```

**Windows (PowerShell)**：

```powershell
irm https://raw.githubusercontent.com/Thatgfsj/thatgfsj-code/main/install.ps1 | iex
```

**Windows (CMD)**：

```cmd
curl -L https://raw.githubusercontent.com/Thatgfsj/thatgfsj-code/main/install.bat -o install.bat && install.bat
```

> ⚠️ 旧版本 README 里出现的 `https://git.io/thatgfsj` 短链已失效（GitHub 在 2022
> 年下线了 `git.io`），请使用上面的原始 GitHub 链接。

安装过程会自动完成：
1. 检查/安装 Node.js（≥ 18）
2. 下载代码 / 链接 npm 全局命令
3. 安装依赖并构建 `dist/`
4. 引导你设置 API Key

---

## 📖 使用方法

安装完成后，在终端里直接用 `gfcode`（或 `thatgfsj`，两个 bin 都指向同一入口）：

```bash
# 交互模式（推荐）
gfcode

# 让 AI 帮你写代码（单命令模式，自动流式输出）
gfcode "写一个 Python 的 Hello World"
gfcode -m Qwen/Qwen2.5-32B-Instruct "重构 src/index.ts"

# 解释代码:直接传字符串,或 -f 指定文件
gfcode explain "const add = (a, b) => a + b;"
gfcode explain -f src/index.ts

# 调试代码:可附加 -e 错误信息
gfcode debug "你的代码"
gfcode debug -f src/foo.ts -e "TypeError: x is not a function"

# 问答（带当前项目上下文）
gfcode chat "怎么用 Node.js 写 API?"

# 生成代码模板
gfcode template react -n MyButton -o ./components
```

> `--stream` / `--no-auto` / `-m` 接受任意命令并对当次调用生效；`-i` 强制进入 REPL。
> 详细 flag 见 [`DEVELOPMENT.md`](./DEVELOPMENT.md) 第 5 节。

### REPL 内置命令

进入交互模式（直接运行 `gfcode`）后，可以输入下列命令（带或不带前导 `/` 都行）：

| 命令           | 作用                                                |
| -------------- | --------------------------------------------------- |
| `help`         | 显示所有内置命令                                    |
| `exit`         | 退出 REPL                                           |
| `clear`        | 清屏                                                |
| `context`      | 显示当前项目上下文                                  |
| `history`      | 显示本次会话的命令历史                              |
| `tools`        | 列出已注册的工具（file / shell / git / search）     |
| `models`       | 只读地列出当前 provider 的可用模型                  |
| `providers`    | 只读地列出支持的 provider                           |
| `/model`       | **交互式切换当前 provider 下的模型**，立即生效并持久化到 `~/.thatgfsj/config.json` |
| `/provider`    | **交互式切换 provider**，切换后自动跟进选模型       |
| `Ctrl+C`       | 单次：停止当前流式生成；空输入连续两次退出 REPL     |

#### `/model` / `/provider` 示例

```
> /model
🤖 /model — 切换模型 (provider: siliconflow)

  最近使用:
  r1. Qwen/Qwen2.5-32B-Instruct
  r2. Pro/moonshotai/Kimi-K2.5

  内置模型:
   1. Qwen2.5-7B (推荐)             Qwen/Qwen2.5-7B-Instruct  ✓
   2. Qwen2.5-32B                   Qwen/Qwen2.5-32B-Instruct
   3. Qwen2.5-72B                   Qwen/Qwen2.5-72B-Instruct
   4. Kimi-K2.5 (私有)              Pro/moonshotai/Kimi-K2.5
   5. DeepSeek-V3                   Pro/deepseek-ai/DeepSeek-V3
   …

输入编号 (r1-r2 / 1-10)、完整 model id、或任意自定义 id。回车保持当前。
model > r2
✅ 模型已切换为: Pro/moonshotai/Kimi-K2.5  (Pro/moonshotai/Kimi-K2.5)

# 也可以直接粘一个自定义 model id(适合 OpenAI-compatible 中转/Ollama):
model > my-custom-fine-tune
✅ 模型已切换为: my-custom-fine-tune  (自定义)
```

`/provider` 的工作流类似，但会让你先选 9 个提供商之一（SiliconFlow /
MiniMax / OpenAI / Anthropic / Gemini / Kimi / DeepSeek / ERNIE / Ollama），
然后自动跟进模型选择。如果新 provider 缺少对应的环境变量，会提示先
`gfcode init` 或手动 `export`。

切换过的 model 会写入 `~/.thatgfsj/models.json` 历史文件,下次打开
`/model` 时按时间倒序展示在「最近使用」段。

---

## ❓ 常见问题

### Q: 安装后命令找不到？

**A**: 重启终端，然后运行 `gfcode`。Windows 上确认 PowerShell / CMD 已重新加载 `%PATH%`。

### Q: 怎么配置 API Key？

**A**: 运行 `gfcode init`，按提示选择提供商、粘贴 key、挑选模型。也可以直接设置环境变量
（`SILICONFLOW_API_KEY` / `OPENAI_API_KEY` / `MINIMAX_API_KEY` /
`ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `KIMI_API_KEY` / `DEEPSEEK_API_KEY` /
`ERNIE_API_KEY`），或者把配置写到 `~/.thatgfsj/config.json`。

### Q: 哪个 Provider 最好？

**A**: 新手推荐 **SiliconFlow**（性价比高，国产），可选用 Qwen2.5 / Kimi-K2.5 / DeepSeek-V3 等模型。

### Q: `--version` 显示老版本号？

**A**: 升级到 0.2.2+，版本号现在从 `package.json` 动态读取，CI / re-install 都会自动同步。

### Q: 启动瞬间报错 `ReferenceError: require is not defined`？

**A**: 那是 0.2.1 之前的 bug，0.2.2 已经修复（使用 `createRequire(import.meta.url)` 兼容）。

更多问题 → [`docs/FAQ.md`](./docs/FAQ.md)。

---

## 📚 文档

- [DEVELOPMENT.md](./DEVELOPMENT.md) — 架构 / 构建 / 扩展 / 发布（贡献者必读）
- [CHANGELOG.md](./CHANGELOG.md) — 每次版本的变更说明
- [docs/API_KEY_GUIDE.md](./docs/API_KEY_GUIDE.md) — 9 个 Provider 的 API Key 获取教程
- [docs/FAQ.md](./docs/FAQ.md) — 详细 FAQ

---

## 🧪 本地自检

```bash
npm install
npm test          # node --test tests/
npm run build
node dist/index.js --version
```

---

## 🤝 问题反馈

有问题？去 GitHub 提 Issue：

https://github.com/Thatgfsj/thatgfsj-code/issues

---

## 📜 License

MIT © Thatgfsj
