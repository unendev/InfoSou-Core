import requests
import json
import os
import feedparser
import praw
import re
from datetime import datetime

# 硬编码配置来源
SOURCES = {
    "rss": [
        {"name": "Linux.do", "url": "https://linux.do/latest.rss"},
        {"name": "阮一峰的网志", "url": "https://feeds.feedburner.com/ruanyifeng"},
        {"name": "少数派", "url": "https://sspai.com/feed"},
        {"name": "机核网", "url": "https://www.gcores.com/rss"},
    ],
    "reddit_subs": [
        "gamedev", "unrealengine", "Unity3D", "godot", "IndieGames", "gamedevjobs"
    ],
    "hn_top": "https://hacker-news.firebaseio.com/v0/topstories.json",
    "hn_item": "https://hacker-news.firebaseio.com/v0/item/{}.json"
}

def clean_content(text, source_name=None):
    if not text:
        return ""
    
    # 移除可能是图片数据的极长无空格字符串 (Base64 特征)
    text = re.sub(r'[A-Za-z0-9+/]{100,}', ' [BINARY_DATA] ', text)
    # 移除 Data URL
    text = re.sub(r'data:image/[^;]+;base64,', '', text)

    # 针对特定来源的特殊清洗逻辑
    if source_name == "阮一峰的网志":
        # 匹配标准的头部介绍文本并移除 (兼容中英文括号和换行)
        noise_pattern = r"这里记录每周值得分享的科技内容.*?yifeng\.ruan@gmail\.com.*?。"
        text = re.sub(noise_pattern, "", text, flags=re.DOTALL).strip()
        # 同时也移除可能残余的“封面图”字样
        if text.startswith("封面图"):
            text = text[3:].strip()
            
    return text

def fetch_rss(name, url):
    print(f"[DEBUG][抓取开始] 来源: {name}")
    try:
        is_linux_do = "linux.do" in url.lower()
        feed = feedparser.parse(url)
        items = []
        for entry in feed.entries[:20]:
            content = entry.get('summary') or entry.get('description', '')
            plain_content = re.sub(r'<[^>]+>', '', content).strip()
            plain_content = clean_content(plain_content, name)
            
            # 过滤逻辑：如果内容块中含有明显的 HTML/JS 源码特征，则视为干扰数据
            if "const " in plain_content and "document.get" in plain_content:
                continue

            item = {
                "title": entry.title,
                "link": entry.link,
                "source": name,
                "time": entry.get('published', datetime.now().isoformat()),
                "content": plain_content[:2000], # 限制内容长度
                "comments": []
            }
            if is_linux_do and "/t/" in entry.link:
                try:
                    topic_feed = feedparser.parse(entry.link + ".rss")
                    for reply in topic_feed.entries[1:4]:
                        r_text = re.sub(r'<[^>]+>', '', reply.get('summary', '')).strip()
                        if r_text:
                            item["comments"].append({
                                "author": reply.get('author', '匿名'), 
                                "text": clean_content(r_text[:150])
                            })
                except: pass
            items.append(item)
        return items
    except Exception as e:
        print(f"[ERROR] {name} 失败: {e}")
        return []

def fetch_hacker_news():
    print("[DEBUG] Fetching HN...")
    try:
        from urllib.parse import urlparse
        top_ids = requests.get(SOURCES["hn_top"], timeout=10).json()[:20]
        items = []
        for id in top_ids:
            i = requests.get(SOURCES["hn_item"].format(id), timeout=10).json()
            if not i: continue
            url = i.get('url', f"https://news.ycombinator.com/item?id={id}")
            domain = urlparse(url).netloc.replace('www.', '') if i.get('url') else "HN"
            items.append({
                "title": i.get('title'),
                "link": url,
                "source": f"HN | {domain}",
                "time": datetime.fromtimestamp(i.get('time')).isoformat() if i.get('time') else datetime.now().isoformat(),
                "content": clean_content(re.sub(r'<[^>]+>', '', i.get('text', '')).strip()),
                "comments": []
            })
        return items
    except Exception as e:
        print(f"[ERROR] HN 失败: {e}")
        return []

def fetch_reddit_with_praw():
    cid = os.environ.get("REDDIT_CLIENT_ID")
    sec = os.environ.get("REDDIT_CLIENT_SECRET")
    if not cid or not sec: return []
    print("[DEBUG] Fetching Reddit via PRAW...")
    try:
        reddit = praw.Reddit(client_id=cid, client_secret=sec, user_agent="InfoSou 1.0")
        items = []
        for sub_name in SOURCES["reddit_subs"]:
            for submission in reddit.subreddit(sub_name).hot(limit=7):
                item = {
                    "title": submission.title,
                    "link": f"https://www.reddit.com{submission.permalink}",
                    "source": f"Reddit | {sub_name}",
                    "time": datetime.fromtimestamp(submission.created_utc).isoformat(),
                    "content": clean_content(submission.selftext[:300] if submission.is_self else submission.url),
                    "comments": []
                }
                submission.comment_sort = 'top'
                for c in submission.comments[:3]:
                    if hasattr(c, 'body'):
                        item["comments"].append({"author": str(c.author), "text": clean_content(c.body[:150])})
                items.append(item)
        return items
    except Exception as e:
        print(f"[ERROR] Reddit 失败: {e}")
        return []

def generate_ai_summary(items):
    key = os.environ.get("AI_API_KEY", "sk-263d3dcfe61c4c3da96d2bcbbb22dc11")
    base = os.environ.get("AI_BASE_URL", "http://localhost:8046/v1")
    model = os.environ.get("AI_MODEL_NAME", "gemini-3-flash")

    if not key or "sk-" not in key: return "§ SYSTEM_ERROR: AI_LINK_UNAVAILABLE (Key Missing)"

    print(f"[DEBUG] [AI_ENGINE] Model: {model} | Base: {base} | Generating Summary...")
    filtered_items = [i for i in items if len(i['content']) > 5 and not ("const " in i['content'] and "render" in i['content'])]

    context = "\n---\n".join([f"[{i['source']}] {i['title']}\n内容: {i['content'][:250]}" for i in filtered_items[:50]])
    prompt = f"你是一个硬核游戏开发情报官。请根据以下情报流，总结今日最值得关注的 3-5 个技术、引擎或行业动态。要求：1. 严禁输出源代码。2. 忽略本项目本身讨论。3. 语气锐利、干练、专业，严禁内容重复或出现多余的自我介绍。4. 直接输出 Markdown 格式的总结内容。\n\n情报：\n{context}"

    try:
        url = base.rstrip('/') + ("/chat/completions" if "/chat/completions" not in base else "")
        res = requests.post(url, headers={"Authorization": f"Bearer {key}"}, json={
            "model": model, "messages": [{"role": "user", "content": prompt}], "temperature": 0.3
        }, timeout=80)
        return res.json()['choices'][0]['message']['content']
    except Exception as e:
        print(f"[ERROR] AI 总结失败: {e}")
        return f"§ STANDBY: AI 总结生成失败 ({str(e)})"

def main():
    data_dir = 'public/data'
    archive_dir = os.path.join(data_dir, 'archive')
    os.makedirs(archive_dir, exist_ok=True)
    latest_path = os.path.join(data_dir, 'latest.json')
    
    existing_items = []
    if os.path.exists(latest_path):
        try:
            with open(latest_path, 'r', encoding='utf-8') as f:
                old = json.load(f)
                last_date = datetime.fromisoformat(old['metadata']['last_updated']).date()
                if datetime.now().date() > last_date:
                    with open(os.path.join(archive_dir, f"{last_date}.json"), 'w', encoding='utf-8') as af:
                        json.dump(old, af, ensure_ascii=False, indent=2)
                else:
                    existing_items = old.get('items', [])
        except: pass

    new_batch = fetch_hacker_news() + fetch_reddit_with_praw()
    for s in SOURCES["rss"]: new_batch.extend(fetch_rss(s['name'], s['url']))
    
    seen = {i['link'] for i in new_batch}
    # 同时也对历史数据进行一次清洗，确保老数据也能过滤掉重复开头
    cleaned_existing = []
    for item in existing_items:
        if item['link'] not in seen:
            item['content'] = clean_content(item['content'], item['source'])
            cleaned_existing.append(item)
            
    final_items = new_batch + cleaned_existing
    
    summary = generate_ai_summary(final_items)
    
    output = {
        "metadata": {
            "last_updated": datetime.now().isoformat(),
            "total_count": len(final_items),
            "ai_summary": summary
        },
        "items": final_items
    }
    
    with open(latest_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print("完成。")

if __name__ == "__main__":
    main()
