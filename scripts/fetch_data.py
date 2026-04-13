import requests
import json
import os
import feedparser
from datetime import datetime

# 硬编码配置来源 (Hardcoded Sources)
# 用户偏好：个人项目，直接写死即可
SOURCES = {
    "linux_do": "https://linux.do/latest.json",
    "rss": [
        {"name": "阮一峰的网志", "url": "https://feeds.feedburner.com/ruanyifeng"},
        {"name": "少数派", "url": "https://sspai.com/feed"},
        {"name": "机核网", "url": "https://www.gcores.com/rss"},
    ],
    # Hacker News 官方 API
    "hn_top": "https://hacker-news.firebaseio.com/v0/topstories.json",
    "hn_item": "https://hacker-news.firebaseio.com/v0/item/{}.json"
}

def fetch_linux_do():
    print("Fetching Linux.do...")
    try:
        # 优化 Header 模拟真实浏览器，规避部分 Cloudflare 拦截
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'Referer': 'https://linux.do/',
            'X-Requested-With': 'XMLHttpRequest'
        }
        response = requests.get(SOURCES["linux_do"], headers=headers, timeout=15)
        
        # 打印状态码用于在 GitHub Actions 日志中排查
        print(f"Linux.do Response Status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"Warning: Linux.do returned {response.status_code}. It might be blocked by Cloudflare.")
            return []

        data = response.json()
        return [{
            "title": t['title'],
            "link": f"https://linux.do/t/topic/{t['id']}",
            "source": "Linux.do",
            "time": t['created_at'],
            "content": t.get('excerpt', '') # Linux.do API 提供的摘要字段
        } for t in data['topic_list']['topics'][:50]]
    except Exception as e:
        print(f"Error Linux.do: {e}")
        return []

def fetch_rss(name, url):
    print(f"Fetching {name}...")
    try:
        feed = feedparser.parse(url)
        return [{
            "title": entry.title,
            "link": entry.link,
            "source": name,
            "time": entry.get('published', ''),
            "content": entry.get('summary') or entry.get('description', '') # 提取 RSS 摘要
        } for entry in feed.entries[:20]]
    except Exception as e:
        print(f"Error {name}: {e}")
        return []

def fetch_hacker_news():
    print("Fetching Hacker News...")
    try:
        top_ids = requests.get(SOURCES["hn_top"], timeout=10).json()[:30]
        items = []
        for id in top_ids:
            item = requests.get(SOURCES["hn_item"].format(id), timeout=10).json()
            items.append({
                "title": item.get('title'),
                "link": item.get('url', f"https://news.ycombinator.com/item?id={id}"),
                "source": "Hacker News",
                "time": datetime.fromtimestamp(item.get('time')).isoformat() if item.get('time') else "",
                "content": item.get('text', '') # HN 有时会有 text 正文
            })
        return items
    except Exception as e:
        print(f"Error HN: {e}")
        return []

def main():
    all_items = []
    
    # 执行各路聚合
    all_items.extend(fetch_linux_do())
    all_items.extend(fetch_hacker_news())
    for rss_source in SOURCES["rss"]:
        all_items.extend(fetch_rss(rss_source['name'], rss_source['url']))
    
    # 按时间降序排序（如果时间格式统一的话）
    # 这里简单按来源顺序堆叠，前端再做展示过滤
    
    # 结构化输出
    output = {
        "metadata": {
            "last_updated": datetime.now().isoformat(),
            "total_count": len(all_items),
            "status": "success"
        },
        "items": all_items
    }
    
    # 确保存储目录存在
    os.makedirs('public/data', exist_ok=True)
    
    with open('public/data/latest.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    print(f"Aggregation completed: {len(all_items)} items saved.")

if __name__ == "__main__":
    main()
