# Thatgfsj Code 🤖

你的 AI 编程助手 - 像 Claude Code 一样的 CLI 工具

---

## ⭐ 特性

- 🤖 **AI 对话** - 用自然语言让 AI 帮你写代码
- 📖 **代码解释** - 通俗易懂地解释代码含义
- 🔧 **代码调试** - 找出 bug 并给出修复方案
- 📦 **代码模板** - 快速生成项目代码
- 💬 **交互模式** - 持续对话，像聊天一样编程

---

## 🚀 快速开始

### 🎯 一键安装（推荐）

**Windows 用户**：复制下面命令，粘贴到 CMD 里回车：

```cmd
curl -L https://git.io/thatgfsj -o install.bat && install.bat
```

**Windows (PowerShell)**：

```powershell
powershell -c "irm https://git.io/thatgfsj | iex"
```

**macOS / Linux**：

```bash
curl -sL https://git.io/thatgfsj | bash
```

安装过程会自动完成：
1. 检查/安装 Node.js
2. 下载代码
3. 安装依赖
4. 配置命令
5. 引导设置 API Key

---

## 📖 使用方法

安装完成后，在终端里直接用：

```bash
# 交互模式（推荐）
gfcode

# 让 AI 帮你写代码
gfcode "写一个 Python 的 Hello World"

# 解释代码
gfcode explain "const add = (a, b) => a + b;"

# 调试代码
gfcode debug "你的代码"

# 问答
gfcode chat "怎么用 Node.js 写 API?"

# 生成代码模板
gfcode template react -n MyButton
```

---

## ❓ 常见问题

### Q: 安装后命令找不到？

**A**: 重启终端，然后运行 `gfcode`

### Q: 怎么配置 API Key？

**A**: 运行 `gfcode init`，按提示选择并输入 API Key

### Q: 哪个 Provider 最好？

**A**: 新手推荐 **SiliconFlow**（性价比高，国产）

---

## 📚 文档

- [API Key 获取教程](./docs/API_KEY_GUIDE.md)
- [常见问题 FAQ](./docs/FAQ.md)

---

## 🤝 问题反馈

有问题？去 GitHub 提 Issue：  
https://github.com/Thatgfsj/thatgfsj-code/issues
