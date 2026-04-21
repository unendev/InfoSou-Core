import requests
import json
import os
import feedparser
import praw
import re
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

# 硬编码配置来源
SOURCES = {
    "rss": [
        {"name": "Linux.do", "url": "https://linux.do/latest.rss"},
        {"name": "阮一峰的网志", "url": "https://feeds.feedburner.com/ruanyifeng"},
        {"name": "少数派", "url": "https://sspai.com/feed"},
        {"name": "Gaming | 机核网", "url": "https://www.gcores.com/rss"},
        {"name": "Gaming | 游研社", "url": "https://www.yystv.cn/rss/feed"},
    ],
    "reddit_subs": [
        "gamedev", "unrealengine", "Unity3D", "godot", "IndieGames", "gamedevjobs"
    ],
    "hn_top": "https://hacker-news.firebaseio.com/v0/topstories.json",
    "hn_item": "https://hacker-news.firebaseio.com/v0/item/{}.json"
}

def clean_content(text, source=""):
    if not text: return ""
    # 移除 HTML 标签
    text = re.sub(r'<[^>]+>', '', text).strip()
    # 移除多余空白
    text = re.sub(r'\s+', ' ', text)
    
    # 针对不同源的特殊清洗
    if "阮一峰" in source:
        if text.startswith("封面图"):
            text = text[3:].strip()
            
    return text

def fetch_robust(url, name):
    """
    终极优雅抓取逻辑：
    1. 优先调用系统 curl.exe (绕过 TLS 指纹，自动处理代理)
    2. 如果失败，则回退到带代理重试的 requests
    """
    ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    
    # 尝试 1: 使用系统原生 curl
    try:
        import subprocess
        res = subprocess.run(['curl.exe', '-L', '-s', '-H', f'User-Agent: {ua}', url], capture_output=True, timeout=15)
        # 只要有内容且不是 WAF 页面就通过
        if res.returncode == 0 and len(res.stdout) > 100 and b"aliyun_waf" not in res.stdout[:1000]:
            return res.stdout
    except: pass

    # 尝试 2: 回退到 requests 代理轮询
    proxies_to_try = [
        None,
        {"http": "http://127.0.0.1:7897", "https": "http://127.0.0.1:7897"},
        {"http": "http://127.0.0.1:10809", "https": "http://127.0.0.1:10809"},
    ]
    headers = {'User-Agent': ua, 'Accept': '*/*'}

    for proxy in proxies_to_try:
        try:
            resp = requests.get(url, headers=headers, proxies=proxy, timeout=12)
            if resp.status_code == 200 and "aliyun_waf" not in resp.text:
                return resp.content
        except: continue
    return None

def fetch_rss(name, url):
    print(f"[DEBUG][抓取开始] 来源: {name}")
    try:
        is_linux_do = "linux.do" in url.lower()
        content = fetch_robust(url, name)
        if not content: return []
            
        feed = feedparser.parse(content)
        items = []
        for entry in feed.entries[:20]:
            raw_content = entry.get('summary') or entry.get('description', '')
            plain_content = re.sub(r'<[^>]+>', '', raw_content).strip()
            plain_content = clean_content(plain_content, name)
            
            if not name.startswith("Gaming") and "const " in plain_content and "document.get" in plain_content:
                continue

            item = {
                "title": entry.title,
                "link": entry.link,
                "source": name,
                "time": entry.get('published', datetime.now().isoformat()),
                "content": plain_content[:2000],
                "comments": []
            }

            # 恢复 Linux.do 评论抓取逻辑
            if is_linux_do and "/t/" in entry.link:
                try:
                    topic_content = fetch_robust(entry.link + ".rss", f"{name}_reply")
                    if topic_content:
                        topic_feed = feedparser.parse(topic_content)
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
        print(f"[ERROR] {name} 解析失败: {e}")
        return []

def translate_items_ai(items, name="General"):
    """
    利用已有的 AI 配置进行批量翻译，提升海外源阅读效率
    """
    if not items: return items
    
    key = os.environ.get("AI_API_KEY", "sk-263d3dcfe61c4c3da96d2bcbbb22dc11")
    base = os.environ.get("AI_BASE_URL", "http://localhost:8046/v1")
    model = os.environ.get("AI_MODEL_NAME", "gemini-3-flash")

    if not key or "sk-" not in key: return items

    # 构造翻译任务
    to_translate = [f"{idx}: {item['title']}" for idx, item in enumerate(items)]
    prompt = f"你是一个专业的技术情报翻译官。请将以下【{name}】的标题翻译成中文。要求：极客风格、术语准确、极其简练。只需返回结果，格式为 '索引: 翻译'，每行一个。\n\n" + "\n".join(to_translate)

    try:
        url = base.rstrip('/') + ("/chat/completions" if "/chat/completions" not in base else "")
        res = requests.post(url, headers={"Authorization": f"Bearer {key}"}, json={
            "model": model, 
            "messages": [{"role": "user", "content": prompt}], 
            "temperature": 0.1
        }, timeout=30)
        
        if res.status_code == 200:
            content = res.json()['choices'][0]['message']['content']
            for line in content.split('\n'):
                if ":" in line:
                    try:
                        idx_str, trans = line.split(":", 1)
                        idx = int(re.sub(r'\D', '', idx_str))
                        if idx < len(items):
                            items[idx]["title_cn"] = trans.strip().strip('"')
                    except: continue
    except Exception as e:
        print(f"[DEBUG] AI 翻译失败 [{name}]: {e}")
    
    return items

def fetch_hacker_news():
    print("[DEBUG] Fetching HN...")
    try:
        from urllib.parse import urlparse
        top_ids = requests.get(SOURCES["hn_top"], timeout=10).json()[:25]
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
                "content": clean_content(re.sub(r'<[^>]+>', '', i.get('text', '')).strip()) or f"Score: {i.get('score')} | Comments: {i.get('descendants')}",
                "comments": []
            })
        
        print(f"[DEBUG] 正在翻译 HN 标题...")
        return translate_items_ai(items, "Hacker News")
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
        
        print(f"[DEBUG] 正在翻译 Reddit 标题...")
        return translate_items_ai(items, "Reddit")
    except Exception as e:
        print(f"[ERROR] Reddit 失败: {e}")
        return []

def generate_ai_summary(items):
    key = os.environ.get("AI_API_KEY", "sk-263d3dcfe61c4c3da96d2bcbbb22dc11")
    base = os.environ.get("AI_BASE_URL", "http://localhost:8046/v1")
    model = os.environ.get("AI_MODEL_NAME", "gemini-3-flash")

    if not key or "sk-" not in key: return "§ SYSTEM_ERROR: AI_LINK_UNAVAILABLE (Key Missing)"

    print(f"[DEBUG] [AI_ENGINE] Model: {model} | Base: {base} | Generating Source-Based Intelligence Report...")
    
    # 过滤核心干扰
    filtered_items = [i for i in items if len(i['content']) > 5 and not ("const " in i['content'] and "render" in i['content'])]
    display_items = filtered_items[:250]

    # 按源物理分组 (Root Source)
    source_groups = {}
    for idx, item in enumerate(display_items):
        root_source = item['source'].split('|')[0].strip()
        if root_source not in source_groups:
            source_groups[root_source] = []
        source_groups[root_source].append((idx, item))

    # 构造按源排列的上下文
    context_parts = []
    for source, grouped_items in source_groups.items():
        source_context = f"### SOURCE_ZONE: {source}\n"
        for idx, item in grouped_items:
            comments_str = ""
            if item.get('comments'):
                comments_str = "\n评论: " + " | ".join([f"{c['author']}: {c['text']}" for c in item['comments'][:2]])
            source_context += f"ID:{idx} [{item['source']}] {item['title']}\n内容摘要: {item['content'][:600]}{comments_str}\n---\n"
        context_parts.append(source_context)
    
    context = "\n\n".join(context_parts)
    
    prompt = f"""你是一名顶级【技术情报分析师】。你的任务是基于今日按“信息源”划分的情报流（共 {len(display_items)} 条），撰写一份结构化的【深度情报研报】。

### 核心使命 (必须无条件执行)：
1. **全量捕捉 (Zero Blind Spot)**：你必须分析情报流中提供的【每一个ID】。
2. **固定分区 (Source-based Zoning)**：我已经为你划分好了战区（即 SOURCE_ZONE），请保持这些分区，不要合并。
3. **深度研判**：针对每个战区内部的所有 ID，撰写深度研判 `deep_dive`（不少于 150 字），挖掘该源今日讨论的核心话题、技术热点或情绪风向。
4. **区域主接待**：`zone_master` 是针对该信息源今日动态的一句话毒辣总结。

### 必须严格返回如下 JSON 格式 (严禁任何非JSON字符)：
{{
  "strategic_overview": {{
    "trends": ["跨源整体趋势1", "趋势2"],
    "keyword": "今日全局核心词"
  }},
  "zones": [
    {{
      "name": "信息源名称 (如 Reddit)",
      "zone_master": "针对该源的犀利结论",
      "deep_dive": "基于该源所有 ID 的深度研判分析报告",
      "related_ids": [该源包含的所有ID数字列表]
    }}
  ],
  "final_verdict": "全量情报汇总后的最终战略建议"
}}

情报流：
{context}"""

    try:
        url = base.rstrip('/') + ("/chat/completions" if "/chat/completions" not in base else "")
        res = requests.post(url, headers={"Authorization": f"Bearer {key}"}, json={
            "model": model, "messages": [{"role": "user", "content": prompt}], "temperature": 0.2,
            "response_format": { "type": "json_object" }
        }, timeout=120)
        
        if res.status_code != 200:
            return json.dumps({"error": f"HTTP {res.status_code}"})
            
        content = res.json()['choices'][0]['message']['content']
        return content
    except Exception as e:
        return json.dumps({"error": str(e)})

def main():
    print("=== InfoSou 情报聚合引擎 ===")
    
    all_items = []
    
    # 1. 抓取 RSS 源 (并发)
    with ThreadPoolExecutor(max_workers=5) as executor:
        future_to_rss = {executor.submit(fetch_rss, s["name"], s["url"]): s["name"] for s in SOURCES["rss"]}
        for future in as_completed(future_to_rss):
            all_items.extend(future.result())
            
    # 2. 抓取 HN 和 Reddit
    all_items.extend(fetch_hacker_news())
    all_items.extend(fetch_reddit_with_praw())
    
    if not all_items:
        print("!!! 未抓取到任何数据，终止任务。")
        return

    # 3. 排序与持久化
    # 保持原有排序逻辑
    all_items.sort(key=lambda x: x.get('time', ''), reverse=True)
    
    # 生成 metadata 并保存
    data_dir = os.path.join('public', 'data')
    archive_dir = os.path.join(data_dir, 'archive')
    os.makedirs(archive_dir, exist_ok=True)
    
    latest_path = os.path.join(data_dir, 'latest.json')
    
    # 增量逻辑
    existing_items = []
    if os.path.exists(latest_path):
        try:
            with open(latest_path, 'r', encoding='utf-8') as f:
                existing_items = json.load(f).get('items', [])
        except: pass
        
    seen = {i['link'] for i in all_items}
    new_batch = all_items
    cleaned_existing = []
    for item in existing_items:
        if item['link'] not in seen:
            item['content'] = clean_content(item['content'], item['source'])
            cleaned_existing.append(item)
            
    final_items = new_batch + cleaned_existing
    
    summary_raw = generate_ai_summary(final_items)
    try:
        summary_json = json.loads(summary_raw)
        # 强制消除盲区校验
        covered_ids = set()
        for z in summary_json.get('zones', []):
            covered_ids.update([int(i) for i in z.get('related_ids', [])])
        
        all_ids = set(range(len(final_items[:250])))
        missing_ids = all_ids - covered_ids
        
        if missing_ids:
            print(f"[WARN] Detection Blind Spot: {len(missing_ids)} IDs missed. Appending to 'Others' zone.")
            summary_json['zones'].append({
                "name": "长尾信号与未分类节点",
                "zone_master": "这些是自动化算法尚未归类但池中确实存在的情报脉络。",
                "deep_dive": f"系统自动回收了 {len(missing_ids)} 条溢出信号。这些信号可能包含跨领域的零散讨论，建议通过专区助手发起针对性提问以进行深挖。",
                "related_ids": sorted(list(missing_ids))
            })

        summary = json.dumps(summary_json, ensure_ascii=False)
    except:
        summary = summary_raw

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

    # 自动更新归档索引
    print(">>> 正在同步归档索引...")
    index_path = os.path.join(data_dir, 'index.json')
    archives = sorted([f.replace('.json', '') for f in os.listdir(archive_dir) if f.endswith('.json')], reverse=True)
    index_data = {
        "latest": datetime.now().date().isoformat(),
        "archives": archives
    }
    with open(index_path, 'w', encoding='utf-8') as f:
        json.dump(index_data, f, ensure_ascii=False, indent=2)

    print("完成。")

if __name__ == "__main__":
    main()
