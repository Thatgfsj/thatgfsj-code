# Playwright Crawler Helper

🕷️ Playwright 爬虫辅助工具 - 通过分析浏览器网络请求来辅助编写爬虫脚本。

## 功能特点

- **JavaScript 渲染支持**: 自动处理需要渲染 JavaScript 的动态页面
- **网络请求分析**: 捕获和分析 XHR/Fetch 请求
- **反爬虫对抗**: 内置多种反爬虫对抗策略
- **检查点恢复**: 支持断点续传，避免重复爬取

## 快速开始

### 安装依赖

```bash
pip install -r requirements.txt
playwright install
```

### 基本用法

```python
from ai_crawler import load_config, create_browser

# 加载配置
load_config("config.yaml")

# 创建浏览器
with create_browser(headless=False) as browser:
    browser.goto("https://example.com")
    browser.wait_for_selector("#content")
    browser.screenshot("screenshot.png")
    
    # 获取 XHR 请求
    requests = browser.get_xhr_requests()
    print(requests)
```

## 配置项 (config.yaml)

```yaml
browser:
  headless: false  # 是否无头模式
  viewport:
    width: 1920
    height: 1080

request:
  timeout: 30000
  anticrawler: true

antiCrawler:
  # 反爬配置
  userAgent: "Mozilla/5.0..."
  delay: 1000

logging:
  level: INFO

output:
  directory: ./output

queue:
  # 队列配置
  type: memory

checkpoint:
  enabled: true
  interval: 10
```

## 使用场景

1. **动态页面爬取**: 需要 JavaScript 渲染的页面
2. **API 分析**: 分析网页的 XHR/Fetch 请求，提取 API 接口
3. **反爬对抗**: 处理验证码、IP 限制等反爬机制
4. **大规模爬取**: 支持队列和检查点恢复

## 依赖

- Python 3.8+
- playwright
- 其他依赖见 requirements.txt

## License

MIT
