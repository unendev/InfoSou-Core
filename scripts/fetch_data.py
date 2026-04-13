import requests
import json
import os
import feedparser
from datetime import datetime

# 硬编码配置来源 (Hardcoded Sources)
# 用户偏好：个人项目，直接写死即可
SOURCES = {
   "rss": [
       {"name": "Linux.do", "url": "https://linux.do/latest.rss"},
       # Reddit 游戏开发聚焦 (GameDev Focus)
       {"name": "Reddit | GameDev", "url": "https://www.reddit.com/r/gamedev.rss"},
       {"name": "Reddit | Unreal", "url": "https://www.reddit.com/r/unrealengine.rss"},
       {"name": "Reddit | Unity", "url": "https://www.reddit.com/r/Unity3D.rss"},
       {"name": "Reddit | Godot", "url": "https://www.reddit.com/r/godot.rss"},
       {"name": "Reddit | Indie", "url": "https://www.reddit.com/r/IndieGames.rss"},
       {"name": "Reddit | Jobs", "url": "https://www.reddit.com/r/gamedevjobs.rss"},
       {"name": "阮一峰的网志", "url": "https://feeds.feedburner.com/ruanyifeng"},
       {"name": "少数派", "url": "https://sspai.com/feed"},
       {"name": "机核网", "url": "https://www.gcores.com/rss"},
   ],
   # Hacker News 官方 API
   "hn_top": "https://hacker-news.firebaseio.com/v0/topstories.json",
   "hn_item": "https://hacker-news.firebaseio.com/v0/item/{}.json"
}

def fetch_rss(name, url):
    print(f"[DEBUG][抓取开始] 来源: {name} | URL: {url}")
    try:
        feed = feedparser.parse(url)
        if not feed.entries:
            print(f"[WARN][空数据] {name} 未能获取到任何条目，可能受到拦截或RSS解析失败。")
        
        items = []
        for entry in feed.entries[:20]:
            content = entry.get('summary') or entry.get('description', '')
            img_match = None
            if content:
                import re
                img_match = re.search(r'<img[^>]+src="([^">]+)"', content)
            
            print(f"  - [DEBUG][条目提取] {entry.title[:30]}... | 正文全长: {len(content)} | 图片: {img_match.group(1) if img_match else 'None'}")
            
            items.append({
                "title": entry.title,
                "link": entry.link,
                "source": name,
                "time": entry.get('published', ''),
                "content": content
            })
        print(f"[SUCCESS][完成] {name} 抓取成功，共 {len(items)} 条。")
        return items
    except Exception as e:
        print(f"[ERROR][抓取异常] {name} 失败: {e}")
        return []

def fetch_hacker_news():
    print("Fetching Hacker News...")
    try:
        top_ids = requests.get(SOURCES["hn_top"], timeout=10).json()[:30]
        items = []
        for id in top_ids:
            item = requests.get(SOURCES["hn_item"].format(id), timeout=10).json()
            url = item.get('url', f"https://news.ycombinator.com/item?id={id}")
            # 提取域名作为子来源标识
            from urllib.parse import urlparse
            domain = urlparse(url).netloc.replace('www.', '') if item.get('url') else "HN"
            
            items.append({
                "title": item.get('title'),
                "link": url,
                "source": f"HN | {domain}",
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
