# 常见问题 FAQ

## 目录

1. [安装问题](#1-安装问题)
2. [配置问题](#2-配置问题)
3. [使用问题](#3-使用问题)
4. [ Provider 问题](#4-provider-问题)
5. [其他问题](#5-其他问题)

---

## 1. 安装问题

### Q: npm install 失败怎么办？

**A**: 
- 确保 Node.js 版本 >= 20.19
- 尝试清除缓存: `npm cache clean --force`
- 如果是 Windows 问题，尝试使用 PowerShell 或管理员权限

### Q: npm link 后命令找不到？

**A**:
- 检查 PATH 环境变量是否包含 npm 全局路径
- Windows 上通常是: `C:\Users\你的用户名\AppData\Roaming\npm`
- 或者直接使用 `npx gfcode` 运行

---

## 2. 配置问题

### Q: 如何配置 API Key？

**A**: 两种方式：
1. 交互式配置（推荐）：运行 `gfcode init`
2. 环境变量：设置对应的环境变量

### Q: 配置文件在哪里？

**A**: `~/.thatgfsj/config.json`（用户主目录下的 .thatgfsj 文件夹）

### Q: 配置文件格式？

```json
{
  "model": "Qwen/Qwen2.5-7B-Instruct",
  "apiKey": "your_api_key",
  "provider": "siliconflow",
  "temperature": 0.7,
  "maxTokens": 4096
}
```

---

## 3. 使用问题

### Q: 交互模式怎么用？

**A**:
```bash
# 启动交互模式
gfcode

# 在交互模式中
> 帮我写一个函数
> /resume 恢复历史会话
> /help 查看命令
> exit 退出
```

### Q: 如何解释 / 调试 / 生成代码？

**A**: 直接用单次 prompt 描述任务即可（没有单独的 explain/debug/template 子命令）：

```bash
# 解释代码
gfcode "解释这段代码: const add = (a, b) => a + b;"

# 调试
gfcode "app.js 报 TypeError: undefined，帮我定位修复"

# 生成模板
gfcode "创建一个 React 按钮组件 MyButton"
```

### Q: 如何脚本化 / 在 CI 中使用？

**A**: 用 `--json` 获取行分隔 JSON 事件流（人读输出走 stderr）：

```bash
gfcode "总结这个仓库的结构" --json | jq -r 'select(.type=="result") | .content'
```

headless 环境默认拒绝写/执行类工具调用，需要放行加 `--yolo`（慎用）。

### Q: 工具调用为什么要求确认？

**A**: 写/执行类操作（shell、git 写操作、文件写入/删除）默认需要确认：`y` 允许一次，
`a` 本会话全部允许，`n` 拒绝。文件写入会展示 diff。想跳过用 `--yolo` 或 `/yolo`。

### Q: 会话可以恢复吗？

**A**: 可以。每轮对话自动保存到 `~/.thatgfsj/sessions/`（保留最近 20 个），
TUI 里 `/resume` 查看列表并恢复。

### Q: 如何接入 MCP 服务器？

**A**: 编辑 `~/.thatgfsj/mcp.json`：

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

重启后生效，`/mcp` 查看状态。

---

## 4. Provider 问题

### Q: 哪个 Provider 最推荐？

**A**: 
- 新手推荐 **SiliconFlow**，性价比高，支持国产模型
- 想用 GPT 推荐 **OpenAI**
- 想用 Claude 推荐 **Anthropic**
- 想免费用推荐 **Google Gemini**

### Q: API Key 在哪里获取？

**A**: 见 [API Key 获取教程](./API_KEY_GUIDE.md)

### Q: Provider 切换需要重新配置吗？

**A**: 
- 如果用环境变量，直接改环境变量即可
- 如果用配置文件，修改配置文件的 `provider` 和 `model` 字段

### Q: 遇到 "API Key 无效" 错误？

**A**:
1. 检查 API Key 是否正确
2. 检查环境变量是否设置正确
3. 检查账户是否有足够余额
4. 确认 API Key 没有过期

---

## 5. 其他问题

### Q: 如何查看当前版本？

```bash
gfcode --version
```

### Q: 如何更新到最新版本？

```bash
git pull
npm install
npm run build
```

### Q: 遇到其他错误怎么办？

**A**:
1. 查看错误信息
2. 尝试 Google 搜索错误
3. 提交 Issue: https://github.com/Thatgfsj/thatgfsj-code/issues

### Q: 如何贡献代码？

**A**:
1. Fork 仓库
2. 创建分支: `git checkout -b feature/your-feature`
3. 提交修改: `git commit -m 'Add something'`
4. 推送分支: `git push origin feature/your-feature`
5. 创建 Pull Request

---

## 联系方式

- GitHub Issues: https://github.com/Thatgfsj/thatgfsj-code/issues
- 欢迎提交 Bug 和功能请求！

---

如有更多问题，请提交 Issue。
