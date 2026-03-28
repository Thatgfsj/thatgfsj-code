# GitHub PR Automation Skill (全自动开源贡献助手)

一个全自动化的 GitHub 开源贡献 Skill —— 从智能搜索 Issue 到自动提交 PR，全程无需干预。

## Trigger Words

"开源贡献", "GitHub贡献", "find issue", "good first issue", "提交PR", "贡献项目", "auto PR", "自动贡献"

## 架构概览

```mermaid
graph TD
    A[用户指令: 去 Contributing] --> B[Phase 1: 智能搜索]
    B --> C{找到合适 Issue?}
    C -- No --> D[报告无合适任务，结束]
    C -- Yes --> E[Phase 2: 候选列表展示]
    E --> F[用户选择: 点击/输入编号]
    F --> G[Phase 3: 全自动执行链]
    
    subgraph Phase 3: 全自动执行链 [无干预执行]
        G --> H[1. 环境准备<br/>Clone/Install]
        H --> I[2. 深度分析<br/>Read Context]
        I --> J[3. 代码实现<br/>Coding]
        J --> K{4. 本地测试<br/>Test Gate}
        K -- 失败 --> L[自动终止 + 报错日志<br/>绝不推送]
        K -- 通过 --> M[5. Git 操作<br/>Commit/Push]
        M --> N[6. 创建 PR<br/>GitHub API]
        N --> O[7. 输出结果<br/>PR 链接]
    end
```

---

## Phase 1: 智能搜索 (Smart Filtering)

不要只搜 `good first issue`，要使用多维度过滤策略，减少用户选择负担。

### 搜索命令模板

```bash
# 基础过滤：最近更新 + 无指派人 + 语言匹配
gh search issues \
  "label:good-first-issue OR label:help-wanted OR label:beginner-friendly" \
  --language "{PREFERRED_LANGUAGE}" \
  --updated ">={DATE_30_DAYS_AGO}" \
  --state open \
  --limit 20 \
  --json number,title,body,url,repository,createdAt,updatedAt,assignees,labels

# 附加过滤：排除已分配、排除复杂标签
gh search issues \
  "label:good-first-issue -label:complex -label:needs-triage" \
  --language python \
  --updated ">=2026-02-15" \
  --state open \
  --limit 10
```

### 智能过滤策略

| 维度 | 规则 | 目的 |
|------|------|------|
| **时间过滤** | 只找最近 30 天内创建或更新的 Issue | 避免死坑（stale issues） |
| **无指派人** | 使用 `no:assignee` 或检查 `assignees` 为空数组 | 确保没人正在做 |
| **语言匹配** | 自动读取 `.env` 中的 `PREFERRED_LANGUAGE` | 技术栈匹配 |
| **标签优先级** | `good-first-issue` > `help-wanted` > `beginner-friendly` | 难度分层 |
| **复杂度预判** | AI 快速分析 Issue 描述字数 | 太少(信息不足)或太多(太复杂)的直接丢弃 |
| **仓库活跃度** | 检查最近 3 个月是否有提交 | 避免废弃项目 |

### 复杂度预判算法

```python
def assess_complexity(issue_body: str, issue_title: str) -> dict:
    """
    快速评估 Issue 复杂度
    返回: {"score": 1-5, "reason": str, "should_skip": bool}
    """
    text = f"{issue_title} {issue_body or ''}"
    word_count = len(text.split())
    
    # 信息太少 - 跳过
    if word_count < 20:
        return {"score": 0, "reason": "描述信息不足", "should_skip": True}
    
    # 明显太复杂的关键词
    complex_keywords = ["refactor", "architecture", "redesign", "breaking change", 
                        "migration", "rewrite", "deprecate", "multiple files"]
    if any(kw in text.lower() for kw in complex_keywords):
        return {"score": 5, "reason": "涉及架构变更", "should_skip": True}
    
    # 预估难度
    if word_count < 50:
        return {"score": 1, "reason": "简单文档/小修复", "should_skip": False}
    elif word_count < 150:
        return {"score": 2, "reason": "中小型功能", "should_skip": False}
    else:
        return {"score": 3, "reason": "需要仔细阅读", "should_skip": False}
```

---

## Phase 2: 极简交互 (Minimal Interaction)

AI 输出格式化候选列表，用户只需回复数字即可。

### 输出格式示例

```
🔍 已找到 3 个适合您的 Python 开源任务：

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 🐛 [Fix] 修复用户登录时的空指针异常
   📁 项目: awesome-project (⭐ 2.3k)
   🎯 难度: ⭐⭐ (简单)
   📝 简述: 当用户名为空时，后端未做校验导致崩溃。
   ⏱️  预估耗时: 15 分钟
   🔗 https://github.com/owner/repo/issues/123

2. ✨ [Feature] 为 CLI 添加 --version 参数
   📁 项目: cli-tool (⭐ 500)
   🎯 难度: ⭐ (非常简单)
   📝 简述: 目前无法查看版本号，需添加标准参数。
   ⏱️  预估耗时: 10 分钟
   🔗 https://github.com/owner/repo/issues/456

3. 📚 [Docs] 更新安装文档中的过时 pip 命令
   📁 项目: doc-site (⭐ 1.2k)
   🎯 难度: ⭐ (文档类)
   📝 简述: 文档中仍使用旧版安装方式。
   ⏱️  预估耗时: 5 分钟
   🔗 https://github.com/owner/repo/issues/789

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

👉 请直接回复数字 (1/2/3) 选择您要执行的任务，
   我将立即开始全自动修复并提交 PR。

💡 提示: 输入 0 或 "跳过" 可查看下一批任务
```

### 难度评级标准

| 星级 | 描述 | 典型场景 |
|------|------|----------|
| ⭐ | 非常简单 | 文档错别字、添加注释、简单参数 |
| ⭐⭐ | 简单 | 单文件修复、简单函数修改 |
| ⭐⭐⭐ | 中等 | 跨文件修改、需要理解业务逻辑 |
| ⭐⭐⭐⭐ | 较难 | 新功能开发、API 设计 |
| ⭐⭐⭐⭐⭐ | 复杂 | 架构变更、大规模重构（已过滤掉） |

---

## Phase 3: 全自动执行链 (Zero-Intervention Execution)

用户选择后，进入全自动模式，**全程无需干预**。

### Step 1: 环境准备

```bash
# 1. 获取 Issue 详情
gh issue view {ISSUE_NUMBER} --repo {OWNER}/{REPO} --json title,body,url

# 2. Fork 仓库（如未 Fork）
gh repo fork {OWNER}/{REPO} --clone=false

# 3. Clone 到本地临时目录
TEMP_DIR="/tmp/gh-contrib-$(date +%s)"
gh repo clone {YOUR_FORK} "$TEMP_DIR"
cd "$TEMP_DIR"

# 4. 创建分支
BRANCH_NAME="fix/issue-{ISSUE_NUMBER}-$(echo {ISSUE_TITLE} | tr ' ' '-' | cut -c1-30)"
git checkout -b "$BRANCH_NAME"

# 5. 安装依赖（动态检测）
if [ -f "requirements.txt" ]; then pip install -r requirements.txt; fi
if [ -f "package.json" ]; then npm install; fi
if [ -f "go.mod" ]; then go mod download; fi
if [ -f "Cargo.toml" ]; then cargo build; fi
```

### Step 2: 深度分析

1. **阅读项目文档**: README.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md
2. **理解 Issue 上下文**: 复现步骤、期望行为、实际行为
3. **定位代码**: 根据错误信息/功能描述找到相关文件
4. **查看相似实现**: 参考项目中类似功能的代码风格

### Step 3: 代码实现

1. 根据 Issue 描述实现修复
2. 遵循项目代码风格
3. 添加必要的注释
4. **不要修改无关文件**

### Step 4: 测试门禁 (Test Gate) ⛔

**这是核心安全机制。在 git push 之前，必须强制通过测试。**

#### 动态识别测试命令

```bash
# 检测测试框架并运行
detect_and_run_tests() {
    if [ -f "pytest.ini" ] || [ -f "setup.py" ] || [ -f "pyproject.toml" ]; then
        echo "📦 检测到 Python 项目，运行 pytest..."
        pytest -v --tb=short 2>&1
        return $?
    fi
    
    if [ -f "package.json" ]; then
        if grep -q "\"test\"" package.json; then
            echo "📦 检测到 Node.js 项目，运行 npm test..."
            npm test 2>&1
            return $?
        fi
    fi
    
    if [ -f "go.mod" ]; then
        echo "📦 检测到 Go 项目，运行 go test..."
        go test ./... 2>&1
        return $?
    fi
    
    if [ -f "Cargo.toml" ]; then
        echo "📦 检测到 Rust 项目，运行 cargo test..."
        cargo test 2>&1
        return $?
    fi
    
    if [ -f "Makefile" ]; then
        if grep -q "^test:" Makefile; then
            echo "📦 检测到 Makefile，运行 make test..."
            make test 2>&1
            return $?
        fi
    fi
    
    echo "⚠️ 未检测到标准测试命令，跳过测试阶段"
    return 0
}
```

#### 测试门禁逻辑

```python
def test_gate():
    """
    测试门禁：测试失败则立即停止，绝不推送
    """
    exit_code, output = run_tests()
    
    if exit_code == 0:
        print("✅ 测试通过，继续执行 Git 操作...")
        return True
    else:
        print("❌ 测试失败，执行链终止！")
        print("\n📋 错误日志:\n" + "-" * 50)
        print(output[-2000:])  # 显示最后 2000 字符
        print("-" * 50)
        print("\n⚠️  已放弃提交。可能原因:")
        print("   1. 原始测试就已失败（非本修改导致）")
        print("   2. 修复代码引入了新的问题")
        print("   3. 测试环境配置问题")
        print("\n💡 建议: 手动检查问题后再试，或选择其他 Issue")
        return False
```

### Step 5: Git 操作

```bash
# 仅在测试通过后执行

# 1. 添加文件
git add -A

# 2. 提交（遵循 Conventional Commits）
git commit -m "fix: {简洁描述}

- {变更点 1}
- {变更点 2}

Fixes #{ISSUE_NUMBER}

Assisted development. Original: {OWNER}/{REPO} (LICENSE)"

# 3. 推送
git push -u origin "$BRANCH_NAME"
```

### Step 6: 创建 PR

```bash
# 使用 GitHub CLI 创建 PR
gh pr create \
  --repo {OWNER}/{REPO} \
  --title "Fix: {ISSUE_TITLE}" \
  --body "## Summary

{简洁描述变更}

## Changes

- {变更点 1}
- {变更点 2}

## Testing

- [x] 本地测试通过
- [x] 运行了 {测试命令}

## Related

Fixes #{ISSUE_NUMBER}

---

**Declaration**: This is assisted development.
Original project: {OWNER}/{REPO} ({LICENSE})
Reference: https://github.com/{OWNER}/{REPO}/issues/{ISSUE_NUMBER}" \
  --base main
```

### Step 7: 输出结果

```
✅ 全自动执行完成！

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 任务摘要
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 Issue: #{ISSUE_NUMBER} - {ISSUE_TITLE}
📁 项目: {OWNER}/{REPO}
🌿 分支: {BRANCH_NAME}
✅ 测试: 通过 ({测试命令})
📤 PR: https://github.com/{OWNER}/{REPO}/pull/{PR_NUMBER}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔗 请在浏览器中查看并跟进 PR 状态
💬 维护者可能会要求修改，请关注通知
```

---

## 配置与安全 (Explicit Config)

### .env 文件模板

```bash
# ==========================================
# GitHub PR Automation Skill 配置
# ==========================================

# -------------------------------------------------
# 必需配置
# -------------------------------------------------

# GitHub Token (必须)
# 创建方式: https://github.com/settings/tokens
# 权限要求: 
#   - repo (完整仓库访问)
#   - workflow (如果需要修改 GitHub Actions)
# 强烈建议使用 Fine-grained Personal Access Token:
#   https://github.com/settings/personal-access-tokens
# 最小权限:
#   - Contents: Read and Write
#   - Pull requests: Read and Write
#   - Issues: Read
GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# -------------------------------------------------
# 用户偏好配置
# -------------------------------------------------

# 首选编程语言 (影响 Issue 搜索)
# 可选: python, javascript, typescript, go, rust, java, etc.
PREFERRED_LANGUAGE=python

# 最大 Issue 年龄（天）
# 超过此天数的 Issue 将被忽略
MAX_ISSUE_AGE_DAYS=30

# 每次展示的候选数量
CANDIDATES_PER_BATCH=3

# -------------------------------------------------
# 安全与行为配置
# -------------------------------------------------

# 本地测试开关 (默认开启，强烈建议保持开启)
# 设置为 false 将跳过测试门禁（危险！）
ENABLE_LOCAL_TEST=true

# 自动推送开关 (默认关闭)
# 设置为 true 将在测试通过后自动 push（无需二次确认）
# 建议：新手保持 false，确认无误后再改为 true
AUTO_PUSH=false

# 测试超时时间（秒）
TEST_TIMEOUT=300

# -------------------------------------------------
# 日志与调试
# -------------------------------------------------

# 详细日志模式
VERBOSE=false

# 临时文件保留（调试用途）
KEEP_TEMP_FILES=false
```

### 权限最小化指南

#### 推荐的 Token 权限 (Fine-grained PAT)

| 权限 | 级别 | 用途 |
|------|------|------|
| **Contents** | Read and Write | Fork 仓库、推送分支 |
| **Pull requests** | Read and Write | 创建 PR、查看状态 |
| **Issues** | Read | 搜索和读取 Issue |

#### ❌ 不要授予的权限

| 权限 | 风险 |
|------|------|
| **Administration** | 可删除仓库、修改设置 |
| **Delete packages** | 可删除发布的包 |
| **Delete workflows** | 可删除 Actions 运行记录 |
| **Security events** | 可访问安全警报 |

#### 安全建议

1. **使用专用小号**: 不要用主账号的 Token 做自动化
2. **定期轮换**: 每 90 天更换一次 Token
3. **监控活动**: 定期检查 https://github.com/settings/security-log
4. **限制仓库**: Fine-grained Token 可以限制只对特定仓库有效

---

## 完整工作流程示例

### 用户对话示例

```
User: 我想做开源贡献

AI: 🔍 正在为您搜索适合的 Python 开源任务...
    
    已找到 3 个候选任务：
    
    1. 🐛 [Fix] 修复用户登录时的空指针异常
       📁 项目: awesome-project (⭐ 2.3k)
       🎯 难度: ⭐⭐ (简单)
       📝 简述: 当用户名为空时，后端未做校验导致崩溃。
       ⏱️  预估耗时: 15 分钟
    
    2. ✨ [Feature] 为 CLI 添加 --version 参数
       📁 项目: cli-tool (⭐ 500)
       🎯 难度: ⭐ (非常简单)
       📝 简述: 目前无法查看版本号，需添加标准参数。
       ⏱️  预估耗时: 10 分钟
    
    3. 📚 [Docs] 更新安装文档中的过时 pip 命令
       📁 项目: doc-site (⭐ 1.2k)
       🎯 难度: ⭐ (文档类)
       📝 简述: 文档中仍使用旧版安装方式。
       ⏱️  预估耗时: 5 分钟
    
    👉 请回复数字 (1/2/3) 选择任务

User: 2

AI: 🚀 开始全自动执行链...
    
    [Step 1/7] 环境准备...
    ✓ Forked owner/cli-tool -> yourname/cli-tool
    ✓ Cloned to /tmp/gh-contrib-1712345678
    ✓ Created branch: fix/issue-456-add-version-flag
    ✓ Installed dependencies (npm install)
    
    [Step 2/7] 深度分析...
    ✓ 阅读 CONTRIBUTING.md
    ✓ 定位到 cli.js 主入口文件
    ✓ 参考现有参数处理方式
    
    [Step 3/7] 代码实现...
    ✓ 添加 --version 参数处理
    ✓ 读取 package.json 版本号
    ✓ 输出格式遵循 POSIX 标准
    
    [Step 4/7] 本地测试...
    $ npm test
    ✓ 测试通过 (3/3)
    ⛔ 测试门禁: 通过 ✅
    
    [Step 5/7] Git 操作...
    ✓ Committed: feat: add --version flag
    ✓ Pushed to origin/fix/issue-456-add-version-flag
    
    [Step 6/7] 创建 PR...
    ✓ PR #42 created: https://github.com/owner/cli-tool/pull/42
    
    [Step 7/7] 完成！
    
    ✅ 任务完成！PR 链接: https://github.com/owner/cli-tool/pull/42
```

---

## 错误处理

### 常见错误与处理

| 错误场景 | 处理方式 |
|----------|----------|
| 搜索无结果 | 放宽条件（增加语言、扩大时间范围） |
| Fork 失败 | 检查 Token 权限、检查是否已 Fork |
| 依赖安装失败 | 尝试备用安装命令、跳过测试（警告用户） |
| 测试失败 | **立即停止**、输出日志、建议人工检查 |
| PR 创建失败 | 检查分支是否推送、检查是否已存在 PR |
| 网络超时 | 重试 3 次后放弃 |

---

## 注意事项

1. **测试门禁不可关闭**: `ENABLE_LOCAL_TEST` 建议始终为 `true`
2. **尊重许可证**: 只贡献符合许可证要求的项目
3. **遵循贡献指南**: 读取并遵守 CONTRIBUTING.md
4. **声明辅助开发**: 在 PR 中明确标注 "Assisted development"
5. **质量优先**: 宁可不做，也不提交低质量代码

---

*Last updated: 2026-03-17*
*Version: 2.0 - 全自动执行链*