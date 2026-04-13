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
        response = requests.get(SOURCES["linux_do"], headers={'User-Agent': 'Mozilla/5.0'}, timeout=10)
        data = response.json()
        return [{
            "title": t['title'], 
            "link": f"https://linux.do/t/topic/{t['id']}", 
            "source": "Linux.do",
            "time": t['created_at']
        } for t in data['topic_list']['topics'][:15]]
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
            "time": entry.get('published', '')
        } for entry in feed.entries[:8]]
    except Exception as e:
        print(f"Error {name}: {e}")
        return []

def fetch_hacker_news():
    print("Fetching Hacker News...")
    try:
        top_ids = requests.get(SOURCES["hn_top"], timeout=10).json()[:10]
        items = []
        for id in top_ids:
            item = requests.get(SOURCES["hn_item"].format(id), timeout=10).json()
            items.append({
                "title": item.get('title'),
                "link": item.get('url', f"https://news.ycombinator.com/item?id={id}"),
                "source": "Hacker News",
                "time": datetime.fromtimestamp(item.get('time')).isoformat() if item.get('time') else ""
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
