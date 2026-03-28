# Playwright Crawler Helper

使用 Playwright 浏览器自动化进行网页爬取。用于需要渲染 JavaScript 的动态页面或需要分析网络请求的场景。

## 快速开始

`python
from crawler import load_config, create_browser

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
`

## 配置项 (config.yaml)

- **browser**: 浏览器配置
  - headless: 是否无头模式 (默认 false)
  - iewport: 窗口尺寸
- **request**: 请求配置
  - 	imeout: 超时时间
  - nticrawler: 反爬虫配置
- **antiCrawler**: 反爬配置
- **logging**: 日志级别
- **output**: 输出目录
- **queue**: 队列配置
- **checkpoint**: 检查点配置