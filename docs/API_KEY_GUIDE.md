# API Key 获取教程

Thatgfsj Code 支持多种 AI 提供商，以下是各提供商 API Key 的获取教程。

## 目录

1. [SiliconFlow (推荐)](#1-siliconflow-推荐)
2. [MiniMax](#2-minimax)
3. [OpenAI](#3-openai)
4. [Anthropic (Claude)](#4-anthropic-claude)
5. [Google Gemini](#5-google-gemini)
6. [Kimi (Moonshot AI)](#6-kimi-moonshot-ai)
7. [DeepSeek](#7-deepseek)
8. [文心一言 (ERNIE)](#8-文心一言-ernie)
9. [Ollama (本地模型)](#9-ollama-本地模型)

---

## 1. SiliconFlow (推荐)

**官网**: https://siliconflow.cn

### 步骤

1. 访问 [SiliconFlow](https://siliconflow.cn) 并注册账号
2. 完成实名认证（可选，部分模型需要）
3. 进入「API 密钥」页面
4. 点击「创建新密钥」
5. 复制生成的 API Key

### 特点

- ✅ 国产模型，性价比高
- ✅ 支持 Qwen、Kimi、DeepSeek、GLM 等
- ✅ 免费额度：¥8.8（新用户）

---

## 2. MiniMax

**官网**: https://platform.minimax.io

### 步骤

1. 访问 [MiniMax](https://platform.minimax.io) 并注册账号
2. 进入「API 密钥」页面
3. 点击「创建 API Key」
4. 复制生成的密钥

### 特点

- ✅ Moonshot Kimi 系列模型
- ✅ Agent 能力强

---

## 3. OpenAI

**官网**: https://platform.openai.com

### 步骤

1. 访问 [OpenAI](https://platform.openai.com) 并注册账号
2. 进入「API Keys」页面
3. 点击「Create new secret key」
4. 复制生成的密钥

### 特点

- ⚠️ 需要海外支付方式
- ✅ GPT-4o 系列最强模型

---

## 4. Anthropic (Claude)

**官网**: https://www.anthropic.com

### 步骤

1. 访问 [Anthropic](https://www.anthropic.com) 并注册账号
2. 进入「API Keys」页面
3. 点击「Create Key」
4. 复制生成的密钥

### 特点

- ⚠️ 需要海外支付方式
- ✅ Claude 系列模型能力强

---

## 5. Google Gemini

**官网**: https://aistudio.google.com/app/apikey

### 步骤

1. 访问 [Google AI Studio](https://aistudio.google.com/app/apikey)
2. 点击「Create API Key」
3. 选择已有项目或创建新项目
4. 复制生成的密钥

### 特点

- ✅ 免费额度充足
- ✅ Gemini 模型能力强

---

## 6. Kimi (Moonshot AI)

**官网**: https://platform.moonshot.cn

### 步骤

1. 访问 [Moonshot AI](https://platform.moonshot.cn) 并注册账号
2. 进入「API 密钥管理」页面
3. 点击「创建」
4. 复制生成的密钥

### 特点

- ✅ 国产模型
- ✅ 长上下文能力强

---

## 7. DeepSeek

**官网**: https://platform.deepseek.com

### 步骤

1. 访问 [DeepSeek](https://platform.deepseek.com) 并注册账号
2. 进入「API Keys」页面
3. 点击「创建 API Key」
4. 复制生成的密钥

### 特点

- ✅ 性价比高
- ✅ 编程能力强

---

## 8. 文心一言 (ERNIE)

**官网**: https://login.bce.baidu.com

### 步骤

1. 访问 [百度智能云](https://login.bce.baidu.com) 并注册账号
2. 进入「文心一言 API」产品页
3. 创建应用并获取 API Key 和 Secret Key
4. 使用 Secret Key 获取 Access Token

### 特点

- ✅ 百度 ERNIE 系列
- ⚠️ 配置稍复杂

---

## 9. Ollama (本地模型)

**官网**: https://ollama.com

### 步骤

1. 下载并安装 [Ollama](https://ollama.com)
2. 终端运行 `ollama run llama2`
3. 设置环境变量 `OLLAMA_BASE_URL=http://localhost:11434`

### 特点

- ✅ 完全免费
- ✅ 本地运行，保护隐私
- ⚠️ 需要本地有足够配置

---

## 环境变量设置

获取 API Key 后，设置方式：

```bash
# SiliconFlow
export SILICONFLOW_API_KEY=你的密钥

# MiniMax
export MINIMAX_API_KEY=你的密钥

# OpenAI
export OPENAI_API_KEY=你的密钥

# Anthropic
export ANTHROPIC_API_KEY=你的密钥

# Google Gemini
export GEMINI_API_KEY=你的密钥

# Kimi
export KIMI_API_KEY=你的密钥

# DeepSeek
export DEEPSEEK_API_KEY=你的密钥

# Ollama
export OLLAMA_BASE_URL=http://localhost:11434
```

或者运行 `gfcode init` 交互式配置。

---

## 常见问题

### Q: 哪个 Provider 最推荐？

**A**: SiliconFlow 性价比最高，适合新手入门。

### Q: 为什么我的 API Key 不工作？

**A**: 
1. 检查环境变量是否正确设置
2. 确认 API Key 没有过期
3. 查看账户是否有足够余额

### Q: 可以同时使用多个 Provider 吗？

**A**: 可以，通过配置文件或环境变量切换。

---

如有问题，请提交 Issue: https://github.com/Thatgfsj/thatgfsj-code/issues
