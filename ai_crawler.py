#!/usr/bin/env python3
"""
AI Crawler - 极简爬虫接口
专为 AI 代理设计，单文件、无状态、纯内存
"""

import json
import time
from typing import Dict, List, Any, Iterator, Optional
from urllib.parse import urlparse

# ========== 错误码 ==========
E = {
    "OK": "成功",
    "TIMEOUT": "请求超时",
    "NETWORK": "网络错误",
    "BLOCKED": "被拦截",
    "BAD_URL": "无效URL",
    "TOO_BIG": "内容过大",
    "PARSE": "解析失败",
}

def ok(data, meta=None):
    return {"ok": True, "data": data, "error": "", "code": "OK", "meta": meta or {}}

def err(msg, code="UNKNOWN", meta=None):
    return {"ok": False, "data": None, "error": msg, "code": code, "meta": meta or {}}

# ========== 核心爬虫 ==========

def fetch(url: str, sel: str = None) -> Dict:
    """
    最简调用 - 1行搞定
    
    >>> result = fetch("https://example.com")
    >>> print(result["data"]["title"])
    """
    import requests
    from bs4 import BeautifulSoup
    
    # 校验
    if not url.startswith(("http://", "https://")):
        return err("URL需以http://或https://开头", "BAD_URL")
    
    try:
        r = requests.get(url, timeout=15, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        })
        
        if r.status_code != 200:
            return err(f"HTTP {r.status_code}", "BLOCKED")
        
        if len(r.content) > 1024*1024:
            return err("响应超过1MB", "TOO_BIG")
        
        soup = BeautifulSoup(r.text, "html.parser")
        
        if sel:
            items = soup.select(sel)
            data = [{"text": i.get_text(strip=True)[:500], "html": str(i)[:200]} for i in items[:20]]
        else:
            data = {"title": soup.title.string if soup.title else "", "text": soup.get_text()[:3000]}
        
        return ok(data, {"url": url, "size": len(r.content)})
        
    except requests.Timeout:
        return err("请求超时", "TIMEOUT")
    except Exception as e:
        return err(str(e)[:100], "NETWORK")


def crawl(urls: List[str], sel: str = None, limit: int = 10) -> Dict:
    """
    批量爬取 - 自动去重
    
    >>> result = crawl(["https://example.com", "https://example.org"], "h2")
    >>> for item in result["data"]: print(item["url"])
    """
    import requests
    from bs4 import BeautifulSoup
    
    visited = set()
    results = []
    
    for url in urls:
        if len(results) >= limit:
            break
        if url in visited:
            continue
        visited.add(url)
        
        try:
            r = requests.get(url, timeout=15)
            if r.status_code != 200:
                continue
            if len(r.content) > 1024*1024:
                continue
                
            soup = BeautifulSoup(r.text, "html.parser")
            
            if sel:
                for el in soup.select(sel)[:10]:
                    results.append({
                        "url": url,
                        "text": el.get_text(strip=True)[:500]
                    })
            else:
                results.append({"url": url, "title": soup.title.string if soup.title else ""})
                
        except:
            continue
    
    return ok(results, {"count": len(results)})


def links(url: str, sel: str = "a") -> Dict:
    """
    获取页面链接
    
    >>> links = fetch("https://example.com")["data"]
    >>> print(links)
    """
    import requests
    from bs4 import BeautifulSoup
    
    try:
        r = requests.get(url, timeout=15)
        soup = BeautifulSoup(r.text, "html.parser")
        
        base = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
        out = []
        
        for el in soup.select(sel):
            href = el.get("href", "")
            if href:
                if href.startswith("http"):
                    out.append(href)
                elif href.startswith("/"):
                    out.append(base + href)
        
        return ok(out[:50])
    except Exception as e:
        return err(str(e)[:100], "PARSE")


def json_api(url: str) -> Dict:
    """
    快速获取 JSON API
    
    >>> data = json_api("https://api.github.com/users/octocat")
    >>> print(data["data"]["login"])
    """
    import requests
    
    try:
        r = requests.get(url, timeout=15)
        if r.status_code != 200:
            return err(f"HTTP {r.status_code}", "BLOCKED")
        return ok(r.json())
    except Exception as e:
        return err(str(e)[:100], "PARSE")


def *stream(urls: List[str], sel: str = None) -> Iterator[Dict]:
    """
    流式返回 - 避免大结果截断
    
    >>> for item in stream(["https://example.com"]):
    >>>     print(item)  # 逐个输出
    """
    import requests
    from bs4 import BeautifulSoup
    
    seen = set()
    
    for url in urls:
        if url in seen:
            continue
        seen.add(url)
        
        try:
            r = requests.get(url, timeout=15)
            if r.status_code != 200:
                continue
            
            soup = BeautifulSoup(r.text, "html.parser")
            
            if sel:
                for el in soup.select(sel):
                    yield ok({"url": url, "text": el.get_text(strip=True)[:500]})
            else:
                yield ok({"url": url, "title": soup.title.string if soup.title else ""})
                
        except Exception as e:
            yield err(str(e)[:100])


# ========== 极简示例 (给 AI 看) ==========

"""
# ===== 3 行跑通 =====
from ai_crawler import fetch
result = fetch("https://example.com")
print(result["data"]["title"])

# ===== 带选择器 =====
result = fetch("https://example.com", "h2")
print(result["data"])  # [{"text": "..."}]

# ===== 批量爬取 =====
from ai_crawler import crawl
result = crawl(["https://example.com", "https://example.org"], "article")
print(result["data"])

# ===== 获取链接 =====
from ai_crawler import links
result = links("https://example.com")
print(result["data"])  # ["http://..."]

# ===== JSON API =====
from ai_crawler import json_api
result = json_api("https://api.github.com/users/octocat")
print(result["data"]["login"])

# ===== 流式返回 =====
from ai_crawler import stream
for item in stream(["https://a.com", "https://b.com"], "p"):
    print(item)
"""
