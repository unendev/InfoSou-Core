/**
 * InfoSou Core App Service - Layout Fixed Build
 * 实现：自由拖拽、流式渲染、强制回车输入、简报收缩及本地缓存
 */

import { AIConfig } from './ai_manager.js';

class NexusTerminal {
    constructor() {
        this.rawData = [];
        this.aiData = null; // 存储结构化 AI 报告
        this.activeZoneIndex = -1; // -1 表示全局视图
        this.zonalChats = JSON.parse(localStorage.getItem('nexus_zonal_chats')) || {}; // 存储按战区分隔的对话历史
        this.selectedSources = new Set();
        this.filterDate = '';
        this.recencyMode = 'all';
        this.expandedGroups = new Set(JSON.parse(localStorage.getItem('nexus_expanded')) || ['Reddit', 'HN', 'Gaming']);

        // 简报空间管理
        this.isBriefExpanded = localStorage.getItem('nexus_brief_collapsed') !== 'true';

        // 拖拽核心状态
        this.isDragging = false;
        this.currentX = 0;
        this.currentY = 0;
        this.initialX = 0;
        this.initialY = 0;
        this.xOffset = 0;
        this.yOffset = 0;

        this.init();
    }

    async init() {
        this.provisionConfig();
        this.bindEvents();
        this.initDraggable();
        
        // 优先加载索引
        try {
            const idxRes = await fetch(`data/index.json?${Date.now()}`);
            this.indexData = await idxRes.json();
            console.log("Index_Vault_Loaded:", this.indexData);
            this.renderArchiveSelector();
        } catch (e) {
            console.error("INDEX_LOAD_FAULT");
        }

        // 根据 URL 参数或索引选择初始加载日期
        const params = new URLSearchParams(window.location.search);
        const targetDate = params.get('date');
        
        if (targetDate && this.indexData) {
            await this.loadIntelligence(targetDate);
        } else {
            await this.loadData();
        }
    }

    provisionConfig() {
        // 强制重置配置以确保测试使用的是正确地址和模型
        const DEF = { 
            apiBase: 'http://localhost:8046/v1', 
            model: 'gemini-3-flash', 
            apiKey: 'sk-263d3dcfe61c4c3da96d2bcbbb22dc11' 
        };
        localStorage.setItem('INFOSOU_AI_SETTINGS', JSON.stringify(DEF));
        console.log("Nexus_Config_Provisioned:", DEF);
    }

    initDraggable() {
        const win = document.getElementById('agent-window');
        const handle = document.getElementById('agent-drag-handle');
        if (!win || !handle) return;

        const start = (e) => {
            const cx = e.type === "touchstart" ? e.touches[0].clientX : e.clientX;
            const cy = e.type === "touchstart" ? e.touches[0].clientY : e.clientY;
            this.initialX = cx - this.xOffset;
            this.initialY = cy - this.yOffset;
            if (e.target === handle || handle.contains(e.target)) {
                this.isDragging = true;
                win.style.transition = 'none';
            }
        };

        const move = (e) => {
            if (!this.isDragging) return;
            e.preventDefault();
            const cx = e.type === "touchmove" ? e.touches[0].clientX : e.clientX;
            const cy = e.type === "touchmove" ? e.touches[0].clientY : e.clientY;
            this.currentX = cx - this.initialX;
            this.currentY = cy - this.initialY;
            this.xOffset = this.currentX;
            this.yOffset = this.currentY;
            win.style.transform = `translate3d(${this.currentX}px, ${this.currentY}px, 0)`;
        };

        const end = () => { this.isDragging = false; win.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'; };

        handle.addEventListener("mousedown", start);
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", end);
        handle.addEventListener("touchstart", start, {passive: false});
        window.addEventListener("touchmove", move, {passive: false});
        window.addEventListener("touchend", end);
    }

    bindEvents() {
        window.toggleMenu = (open) => {
            document.getElementById('sidebar').classList.toggle('open', open);
            document.getElementById('main-view').classList.toggle('sidebar-open', open);
        };
        window.toggleSettings = (show) => {
            if (show) {
                const cfg = AIConfig.getSettings();
                document.getElementById('cfg-base').value = cfg.apiBase || '';
                document.getElementById('cfg-model').value = cfg.model || '';
                document.getElementById('cfg-key').value = cfg.apiKey || '';
                document.getElementById('settings-modal').classList.remove('hidden');
            } else document.getElementById('settings-modal').classList.add('hidden');
        };
        window.saveSettings = () => {
            AIConfig.saveSettings({apiBase: document.getElementById('cfg-base').value.trim(), model: document.getElementById('cfg-model').value.trim(), apiKey: document.getElementById('cfg-key').value.trim()});
            location.reload();
        };

        window.toggleAgent = (st) => {
            const win = document.getElementById('agent-window');
            const act = typeof st === 'boolean' ? st : !win.classList.contains('active');
            act ? win.classList.add('active') : win.classList.remove('active');
            if (act) setTimeout(() => document.getElementById('chat-input')?.focus(), 300);
        };

        // 简报收缩控制
        window.toggleBrief = () => {
            this.isBriefExpanded = !this.isBriefExpanded;
            localStorage.setItem('nexus_brief_collapsed', (!this.isBriefExpanded).toString());
            this.renderBriefContainerState();
        };

        const inp = document.getElementById('chat-input');
        if (inp) {
            inp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.handleAgentQuery();
                }
            });
        }
        window.runDeepChat = () => this.handleAgentQuery();

        window.setDateFilter = (m) => { this.filterDate = (m==='today' ? new Date().toISOString().split('T')[0] : ''); this.recencyMode='all'; this.update(); };
        window.setRecency = (m) => { this.recencyMode = m; if(m==='history') this.filterDate=''; this.update(); };
        window.toggleGroup = (n) => {
            this.expandedGroups.has(n) ? this.expandedGroups.delete(n) : this.expandedGroups.add(n);
            localStorage.setItem('nexus_expanded', JSON.stringify([...this.expandedGroups]));
            this.renderSidebar();
        };
        window.toggleSource = (s) => { this.selectedSources.has(s) ? this.selectedSources.delete(s) : this.selectedSources.add(s); this.update(); };
        window.toggleGroupSources = (gn, itemArr, ev) => {
            ev.stopPropagation();
            const allIn = itemArr.every(s => this.selectedSources.has(s));
            if (allIn) itemArr.forEach(s => this.selectedSources.delete(s));
            else itemArr.forEach(s => this.selectedSources.add(s));
            this.update();
        };
        window.toggleAll = () => {
            const allS = [...new Set(this.rawData.map(i => i.source))];
            if (this.selectedSources.size === allS.length) this.selectedSources.clear();
            else allS.forEach(s => this.selectedSources.add(s));
            this.update();
        };
    }

    async loadData(customPath = null) {
        try {
            const path = customPath || 'data/latest.json';
            console.log(`[SYTEM] Fetching intelligence from: ${path}`);
            
            const res = await fetch(path + '?' + Date.now());
            if (!res.ok) throw new Error("FILE_NOT_FOUND");
            
            const json = await res.json();
            this.rawData = (json.items || []).map(i => ({...i, title: i.title || 'Untitled', source: i.source || 'Unknown', time: i.time || new Date().toISOString()}));
            
            // 默认全选来源
            [...new Set(this.rawData.map(i => i.source))].forEach(s => this.selectedSources.add(s));

            // 确定当前数据的日期标签 (用于隔离存储)
            this.currentDataDate = (json.metadata && json.metadata.last_updated) ? json.metadata.last_updated.split('T')[0] : new Date().toISOString().split('T')[0];

            // 首屏存储读取逻辑
            const todayKey = `nexus_brief_${this.currentDataDate}`;
            const localBrief = localStorage.getItem(todayKey);
            const staticBrief = ((json.metadata && json.metadata.ai_summary) || json.ai_summary || "").trim();

            // 智能选择最可靠的简报源
            let finalBrief = null;
            if (staticBrief.length > 5 && !staticBrief.includes("未配置")) {
                finalBrief = staticBrief;
                // 当静态简报存在且有效时，强制展开，防止 STANDBY
                this.isBriefExpanded = true;
                localStorage.setItem('nexus_brief_collapsed', 'false');
            }
            else if (localBrief) {
                finalBrief = localBrief;
            }

            this.renderAISummary(finalBrief);
            this.renderBriefContainerState();
            
            // 历史模式视觉切换
            const isHistorical = this.indexData && this.indexData.latest && this.currentDataDate !== this.indexData.latest;
            if (isHistorical) {
                document.body.classList.add('historical-mode');
                const label = document.getElementById('historical-date-label');
                if (label) label.innerText = this.currentDataDate;
            } else {
                document.body.classList.remove('historical-mode');
            }

            this.update();
            this.renderArchiveSelector();
        } catch(e) { console.error("BOOT_ERROR"); }
    }

    renderMatrixWall() {
        const wall = document.getElementById('intel-matrix-wall');
        if (!wall) return;
        wall.innerHTML = '';
        wall.classList.remove('hidden');

        // 计算全量捕获情况
        const capturedIds = new Set();
        if (this.aiData && this.aiData.zones) {
            this.aiData.zones.forEach(z => (z.related_ids || []).forEach(id => capturedIds.add(String(id))));
        }

        const totalToDisplay = Math.min(this.rawData.length, 250);
        for (let i = 0; i < totalToDisplay; i++) {
            const item = this.rawData[i];
            const dot = document.createElement('div');
            const isCaptured = capturedIds.has(i.toString());
            
            // 拓扑色彩逻辑
            let colorClass = 'unvisited';
            if (isCaptured) {
                const src = item.source.toLowerCase();
                if (src.includes('reddit')) colorClass = 'dot-reddit';
                else if (src.includes('hn') || src.includes('hacker')) colorClass = 'dot-hn';
                else if (src.includes('linux.do')) colorClass = 'dot-linuxdo';
                else if (src.includes('gcores') || src.includes('机核') || src.includes('游研社')) colorClass = 'dot-gcores';
                else if (src.includes('少数派') || src.includes('sspai')) colorClass = 'dot-sspai';
                else colorClass = 'featured';
            }

            dot.className = `matrix-dot ${colorClass}`;
            dot.id = `mdot-${i}`;
            dot.title = `[ID:${i}] [${item.source}] ${item.title}`;
            
            // 拓扑点击逻辑：如果已被分析，点击进入对应战区，否则滚动到卡片
            dot.onclick = () => {
                const zoneIdx = this.aiData?.zones.findIndex(z => z.related_ids.includes(i) || z.related_ids.includes(String(i)));
                if (zoneIdx !== undefined && zoneIdx !== -1) {
                    this.enterZone(zoneIdx);
                } else {
                    this.scrollToCard(i);
                }
            };
            wall.appendChild(dot);
        }

        // 更新捕获率指示器
        const rate = Math.round((capturedIds.size / totalToDisplay) * 100);
        const indicator = document.getElementById('full-capture-indicator');
        if (indicator) {
            indicator.innerHTML = `已捕获情报: <span class="${rate >= 100 ? 'text-green-500' : 'text-amber-500'} font-black italic underline">${rate}%</span> (${capturedIds.size}/${totalToDisplay})`;
            indicator.classList.remove('hidden');
        }
    }

    renderAISummary(content) {
        const el = document.getElementById('ai-content');
        if (!content) {
            el.innerHTML = `<div class="flex flex-col items-center justify-center py-6 border border-white/5 bg-black/10 rounded-lg"><p class="text-stone-500 italic text-[11px] mb-4 uppercase tracking-[0.2em]">报告尚未生成</p><button onclick="window.NexusTerminal.forceGenerateBrief()" class="filter-btn px-6 py-2 rounded-full text-amber-500 font-black text-[9px] uppercase tracking-widest border-amber-900/40 hover:border-amber-500 transition-all">立即计算</button></div>`;
            return;
        }

        try {
            // 尝试解析 JSON 格式研报
            this.aiData = JSON.parse(content);
            if (this.activeZoneIndex === -1) {
                this.renderPortalHub();
            } else {
                this.renderWarRoom(this.activeZoneIndex);
            }
            this.renderMatrixWall();
        } catch (e) {
            console.warn("JSON_PARSE_FAILED, falling back to legacy render:", e);
            el.innerHTML = `<div class="prose-nexus text-[13px] opacity-90">${this.md(content)}</div>`;
        }
    }

    renderPortalHub() {
        const el = document.getElementById('ai-content');
        document.getElementById('exit-zone-btn').classList.add('hidden');
        
        let zonesHtml = this.aiData.zones.map((zone, idx) => `
            <div class="portal-card group" onclick="window.NexusTerminal.enterZone(${idx})">
                <div class="flex items-center justify-between mb-4">
                    <div class="text-amber-500/60 text-[10px] font-black tracking-[0.2em] uppercase italic">${zone.name}</div>
                    <div class="px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[8px] font-mono">${zone.related_ids.length} Items</div>
                </div>
                <div class="zone-master-greeting mb-6 min-h-[50px] flex items-center">“${zone.zone_master}”</div>
                <div class="text-[11px] text-stone-500 line-clamp-3 mb-6 leading-relaxed italic opacity-80 group-hover:opacity-100 transition-opacity">
                    ${zone.deep_dive.substring(0, 120)}...
                </div>
                <div class="enter-zone-btn w-full text-center py-2.5 bg-amber-900/20 border border-amber-500/30 group-hover:bg-amber-500 group-hover:text-black transition-all text-[9px] font-black uppercase tracking-widest">
                    进入该战区研判
                </div>
            </div>
        `).join('');

        el.innerHTML = `
            <div class="mb-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
                <div>
                    <div class="text-stone-500 text-[10px] font-black uppercase tracking-[0.5em] mb-2">情报全景概览</div>
                    <div class="text-white text-4xl font-black tracking-tighter mb-4 uppercase select-none leading-none">${this.aiData.strategic_overview?.keyword || '战略核心摘要'}</div>
                    <div class="flex flex-wrap gap-2">
                        ${(this.aiData.strategic_overview?.trends || []).map(t => `<span class="px-3 py-1 bg-amber-500/5 border border-amber-500/20 text-amber-500 text-[10px] uppercase font-mono font-bold tracking-tighter italic"># ${t}</span>`).join('')}
                    </div>
                </div>
                <div class="bg-amber-500/5 border border-amber-500/10 p-4 rounded-lg max-w-md">
                    <div class="text-[9px] font-black text-amber-500/40 uppercase tracking-widest mb-2 flex items-center gap-2">
                        <span class="w-1 h-1 bg-amber-500 rounded-full animate-ping"></span>
                        战术判定结果
                    </div>
                    <div class="text-[12px] italic text-stone-400 leading-relaxed font-serif">“${this.aiData.final_verdict}”</div>
                </div>
            </div>
            <div id="ai-content-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">${zonesHtml}</div>
        `;
    }

    renderWarRoom(idx) {
        const zone = this.aiData.zones[idx];
        const el = document.getElementById('ai-content');
        document.getElementById('exit-zone-btn').classList.remove('hidden');

        const chatKey = `${this.currentDataDate}_${idx}`;
        if (!this.zonalChats[chatKey]) this.zonalChats[chatKey] = [];

        const chatHtml = this.zonalChats[chatKey].map(m => `
            <div class="mb-4 ${m.role === 'user' ? 'text-right' : 'text-left'}">
                <div class="inline-block px-4 py-2 rounded-lg ${m.role === 'user' ? 'bg-amber-500/20 border border-amber-500/40 text-amber-200' : 'bg-stone-800 border border-white/5 text-stone-300'} text-[12.5px] max-w-[90%]">
                    ${this.md(m.content)}
                </div>
            </div>
        `).join('');

        el.innerHTML = `
            <div class="war-room-container max-w-5xl mx-auto">
                <div class="war-room-header shadow-2xl bg-gradient-to-b from-stone-900/80 to-black/40">
                    <div class="flex items-center justify-between mb-4">
                        <div class="text-amber-500 font-black text-[11px] tracking-[0.5em] uppercase opacity-70">专区研判定报告 // No.${idx+1}</div>
                        <div class="flex items-center gap-4">
                            <div class="px-2 py-0.5 border border-amber-500/30 text-amber-500 text-[9px] font-mono">${zone.related_ids.length} 条相关情报</div>
                            <div class="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_10px_#22c55e]"></div>
                        </div>
                    </div>
                    
                    <div class="war-room-title text-4xl mb-6">${zone.name}</div>
                    
                    <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
                        <div class="lg:col-span-8">
                            <div class="text-amber-400/90 font-bold text-lg mb-4 italic">“${zone.zone_master}”</div>
                            <div class="prose-nexus text-[15px] text-stone-200 leading-relaxed mb-8 bg-white/5 p-6 rounded-lg border border-white/5 shadow-inner">
                                ${this.md(zone.deep_dive)}
                            </div>
                            
                            <div class="sector-chat border-t border-white/10 pt-8">
                                <div class="flex items-center gap-3 mb-6">
                                    <span class="text-[10px] font-black text-amber-500 uppercase tracking-widest">专区智能助手</span>
                                    <div class="h-px flex-1 bg-amber-500/20"></div>
                                </div>
                                <div id="zonal-chat-history" class="mb-6 max-h-[400px] overflow-y-auto custom-scrollbar">
                                    ${chatHtml || '<p class="text-stone-600 text-[11px] italic text-center py-4">等待指令...</p>'}
                                </div>
                                <div class="relative">
                                    <input type="text" 
                                           id="zonal-chat-input"
                                           class="sector-chat-input pl-4 pr-12 py-4 bg-stone-900/80 border-amber-900/30 focus:border-amber-500" 
                                           placeholder="对该区域的情报有疑问？在指挥部原地追问..." 
                                           onkeydown="if(event.key === 'Enter') window.NexusTerminal.handleZoneChat(this.value, ${idx})">
                                    <div class="absolute right-4 top-1/2 -translate-y-1/2 text-amber-500/30 font-mono text-[10px]">ENTER ↵</div>
                                </div>
                            </div>
                        </div>
                        
                        <div class="lg:col-span-4 flex flex-col gap-6">
                            <div class="bg-black/20 p-6 rounded-lg border border-white/5 flex-1 overflow-hidden flex flex-col">
                                <h5 class="text-amber-500 text-[10px] font-black uppercase mb-4 tracking-[0.3em] flex items-center gap-2">
                                    <span class="w-1.5 h-1.5 bg-amber-500 animate-pulse"></span>
                                    全量情报清单
                                </h5>
                                <div class="space-y-3 overflow-y-auto custom-scrollbar pr-2" style="max-height: 600px;">
                                    ${zone.related_ids.map(id => {
                                        const item = this.rawData[id];
                                        if(!item) return '';
                                        return `
                                            <div onclick="window.NexusTerminal.scrollToCard(${id})" 
                                                 class="group/item p-3 bg-white/5 border border-white/5 hover:border-amber-500/50 hover:bg-amber-500/5 cursor-pointer transition-all rounded">
                                                <div class="flex justify-between items-start mb-1 gap-2">
                                                    <div class="text-[11px] font-bold text-stone-300 group-hover/item:text-amber-400 line-clamp-2 leading-tight uppercase font-mono">${item.title}</div>
                                                    <span class="text-[8px] font-mono text-stone-600">ID:${id}</span>
                                                </div>
                                                <div class="text-[9px] text-stone-500 line-clamp-1 italic">${item.content.substring(0, 100)}...</div>
                                            </div>
                                        `;
                                    }).join('')}
                                </div>
                            </div>
                            
                            <div class="bg-stone-900/40 p-4 border border-amber-900/20 rounded italic text-[10px] text-stone-500">
                                Tip: 点击情报列表可快速定位原始卡片进行交互。
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    async handleZoneChat(query, zoneIdx) {
        if (!query.trim()) return;
        const chatKey = `${this.currentDataDate}_${zoneIdx}`;
        this.zonalChats[chatKey].push({ role: 'user', content: query });
        this.renderWarRoom(zoneIdx);

        const aiMsgIdx = this.zonalChats[chatKey].length;
        this.zonalChats[chatKey].push({ role: 'assistant', content: '📡 Thinking...' });
        this.renderWarRoom(zoneIdx);

        const zone = this.aiData.zones[zoneIdx];
        const zoneContext = `当前战区: ${zone.name}\n核心洞察: ${zone.zone_master}\n深度研判报告: ${zone.deep_dive}\n所辖情报条目 (ID): ${zone.related_ids.join(',')}`;
        
        const tools = [
            {
                type: "function",
                function: {
                    name: "query_intel_pool",
                    description: "【搜索】基于关键词在情报池中模糊检索相关帖子（返回题目与摘要）。",
                    parameters: {
                        type: "object",
                        properties: {
                            keywords: { type: "array", items: { type: "string" }, description: "检索关键词" },
                            sources: { type: "array", items: { type: "string" }, description: "限制来源, 如 ['Reddit', 'HN']" },
                            limit: { type: "number", default: 10 }
                        }
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "fetch_post_detail",
                    description: "【详情】获取指定帖子的全文内容及评论详情。建议先通过搜索锁定标题后查询。",
                    parameters: {
                        type: "object",
                        properties: {
                            title: { type: "string", description: "帖子的精准标题" }
                        },
                        required: ["title"]
                    }
                }
            }
        ];

        const sysPrompt = `你现在是该情报战区的助理。你拥有查询本地实时情报库的权限。
当前战区上下文：
${zoneContext}
请基于上下文回答问题。回复请保持简练且专业。`;

        const messages = [
            { role: "system", content: sysPrompt },
            { role: "user", content: query }
        ];

        try {
            const runStep = async (currentMessages) => {
                const res = await AIConfig.streamChat(currentMessages, tools, (delta) => {
                    if (delta.type === 'content') {
                        this.zonalChats[chatKey][aiMsgIdx].content = delta.text;
                        this.renderWarRoom(zoneIdx);
                    }
                });

                if (res.toolCalls && res.toolCalls.length > 0) {
                    const nextMessages = [...currentMessages, {
                        role: "assistant",
                        content: res.content || "",
                        tool_calls: res.toolCalls.map(tc => ({ ...tc, type: tc.type || "function" }))
                    }];

                    for (const call of res.toolCalls) {
                        const args = JSON.parse(call.function.arguments);
                        let toolResult = null;
                        
                        if (call.function.name === "query_intel_pool") {
                            let results = this.rawData;
                            if (args.sources) results = results.filter(i => args.sources.some(s => i.source.includes(s)));
                            if (args.keywords) results = results.filter(i => args.keywords.some(k => i.title.toLowerCase().includes(k.toLowerCase()) || i.content?.toLowerCase().includes(k.toLowerCase())));
                            toolResult = results.slice(0, args.limit || 10).map(i => ({ title: i.title, source: i.source, summary: i.content?.substring(0, 150) + "..." }));
                        } 
                        else if (call.function.name === "fetch_post_detail") {
                            const post = this.rawData.find(i => i.title === args.title);
                            toolResult = post ? { title: post.title, source: post.source, content: post.content, comments: post.comments || [] } : { error: "POST_NOT_FOUND" };
                        }
                        nextMessages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(toolResult) });
                    }
                    return runStep(nextMessages);
                }
                if (res.content) this.zonalChats[chatKey][aiMsgIdx].content = res.content;
                localStorage.setItem('nexus_zonal_chats', JSON.stringify(this.zonalChats));
            };
            await runStep(messages);
        } catch (e) {
            this.zonalChats[chatKey][aiMsgIdx].content = `⚠️ Operation Failed: ${e.message}`;
            this.renderWarRoom(zoneIdx);
        }
    }

    enterZone(idx) {
        this.activeZoneIndex = idx;
        this.renderWarRoom(idx);
        this.renderFeed();
        document.getElementById('main-scroll').scrollTo({top: 0, behavior: 'smooth'});
    }

    exitZone() {
        this.activeZoneIndex = -1;
        this.renderPortalHub();
        this.renderFeed();
    }

    renderFeed() {
        const container = document.getElementById('feed-container');
        let filtered = this.rawData.filter(i => this.selectedSources.has(i.source));
        
        if (this.activeZoneIndex !== -1 && this.aiData) {
            const allowedIds = new Set((this.aiData.zones[this.activeZoneIndex].related_ids || []).map(id => String(id)));
            filtered = filtered.filter((item, index) => allowedIds.has(String(index)));
        }

        if (this.filterDate) filtered = filtered.filter(i => i.time.startsWith(this.filterDate));
        else if (this.recencyMode === 'history') filtered = filtered.filter(i => !i.time.startsWith(new Date().toISOString().split('T')[0]));

        const dayGroups = {};
        filtered.sort((a,b) => new Date(b.time)-new Date(a.time)).forEach(item => {
            const d = new Date(item.time).toLocaleDateString('zh-CN', {month:'long', day:'numeric'});
            dayGroups[d] = dayGroups[d] || []; dayGroups[d].push(item);
        });

        container.innerHTML = Object.keys(dayGroups).map(date => `
            <div class="mb-14">
                <div class="flex items-center gap-6 mb-8 uppercase text-[9px] font-black text-stone-600 tracking-[0.4rem] font-mono italic">
                    <span>${date}</span><div class="h-px flex-1 bg-white/5"></div>
                </div>
                <div class="waterfall columns-1 md:columns-2 lg:columns-3 xl:columns-4 gap-4">
                    ${dayGroups[date].map(item => this.renderCard(item)).join('')}
                </div>
            </div>
        `).join('') || '<div class="py-32 text-center opacity-5 font-mono text-[10px]">EMPTY_STREAM</div>';
        window.scrollTo({behavior:'smooth', top:0});
    }

    renderBriefContainerState() {
        const contentEl = document.getElementById('ai-content');
        const btn = document.getElementById('brief-toggle-btn');
        if (this.isBriefExpanded) {
            contentEl.style.display = 'block';
            if(btn) btn.innerHTML = '<span class="text-[9px] opacity-40 hover:opacity-100 transition-opacity">收起汇报</span>';
        } else {
            contentEl.style.display = 'none';
            if(btn) btn.innerHTML = '<span class="text-[9px] opacity-40 hover:opacity-100 transition-opacity">展开汇报</span>';
        }
    }

    async forceGenerateBrief() {
        const el = document.getElementById('ai-content');
        const originalContent = el.innerHTML;
        el.innerHTML = `<div class="animate-pulse text-amber-500 text-center text-[11px] py-8 font-mono italic">正在聚合全网情报，计算深度报告...</div>`;
        try {
            if (!this.rawData || this.rawData.length === 0) throw new Error("EMPTY_DATA_POOL");
            const summary = await AIConfig.summarizeDaily(this.rawData.slice(0, 250)); 
            const todayKey = `nexus_brief_${new Date().toISOString().split('T')[0]}`;
            localStorage.setItem(todayKey, summary);
            this.renderAISummary(summary);
            this.isBriefExpanded = true;
            this.renderBriefContainerState();
            document.getElementById('main-scroll').scrollTo({top: 0, behavior: 'smooth'});
        } catch (e) { 
            console.error("GENERATE_BRIEF_FAULT:", e);
            el.innerHTML = `<div class="text-stone-500 text-[10px] text-center p-4">FAULT: ${e.message}</div>`;
            setTimeout(() => { el.innerHTML = originalContent; }, 5000);
        }
    }

    scrollToCard(id) {
        const cards = document.querySelectorAll('.nexus-card');
        const target = Array.from(cards).find(c => {
            const title = c.querySelector('h4').innerText;
            const index = this.rawData.findIndex(r => r.title === title || (r.title_cn && (r.title_cn + r.title).includes(title)));
            return index === parseInt(id);
        });

        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.classList.add('ring-2', 'ring-amber-500', 'scale-[1.02]');
            setTimeout(() => target.classList.remove('ring-2', 'ring-amber-500', 'scale-[1.02]'), 3000);
        }
    }

    async handleAgentQuery() {
        const input = document.getElementById('chat-input');
        const box = document.getElementById('chat-history');
        const query = input.value.trim();
        if (!query) return;

        input.value = "";
        const bubble = document.createElement('div');
        bubble.className = "prose-nexus bg-stone-800/80 p-5 border border-white/5 rounded-xl text-[12.5px] mb-6 shadow-2xl animate-in fade-in";
        bubble.innerHTML = `<span class='text-amber-400 font-black text-[9px] uppercase block mb-1'>Query:</span><div class='mb-4 text-white font-normal'>${query}</div><div id='current-stream' class='text-amber-500/80 text-[11px] animate-pulse font-mono tracking-tighter'>Connecting...</div>`;
        box.prepend(bubble);

        const streamTarget = bubble.querySelector('#current-stream');
        const tools = [
            {
                type: "function",
                function: {
                    name: "query_intel_pool",
                    description: "【搜索】基于关键词检索情报。",
                    parameters: {
                        type: "object",
                        properties: {
                            keywords: { type: "array", items: { type: "string" } },
                            sources: { type: "array", items: { type: "string" } },
                            limit: { type: "number", default: 10 }
                        }
                    }
                }
            }
        ];

        const messages = [
            { role: "system", content: "你是一个专业的情报分析官。" },
            { role: "user", content: query }
        ];

        try {
            const runStep = async (currentMessages) => {
                const res = await AIConfig.streamChat(currentMessages, tools, (delta) => {
                    if (delta.type === 'content') {
                        streamTarget.classList.remove('animate-pulse', 'font-mono');
                        streamTarget.innerHTML = this.md(delta.text);
                    }
                });

                if (res.toolCalls && res.toolCalls.length > 0) {
                    const nextMessages = [...currentMessages, { role: "assistant", content: res.content || "", tool_calls: res.toolCalls }];
                    for (const call of res.toolCalls) {
                        const args = JSON.parse(call.function.arguments);
                        let results = this.rawData;
                        if (args.keywords) results = results.filter(i => args.keywords.some(k => i.title.toLowerCase().includes(k.toLowerCase())));
                        nextMessages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(results.slice(0, 10)) });
                    }
                    return runStep(nextMessages);
                }
            };
            await runStep(messages);
        } catch(e) { streamTarget.innerText = `ERR: ${e.message}`; }
    }

    update() { this.renderSidebar(); this.renderFeed(); }

    renderSidebar() {
        const nav = document.getElementById('source-filter');
        const allSources = [...new Set(this.rawData.map(i => i.source))];
        const groups = { 'Others': [] };
        allSources.forEach(s => { const p = s.split('|'); if(p.length>1) { const g=p[0].trim(); groups[g]=groups[g]||[]; groups[g].push(s); } else groups['Others'].push(s); });

        const isAll = this.selectedSources.size === allSources.length;
        let html = `<div onclick="window.toggleAll()" class="flex items-center gap-3 px-8 py-5 cursor-pointer border-b border-white/5 group border-t mt-4">
            <div class="nexus-checkbox border-stone-600 ${isAll?'active':''}">
                ${isAll?'<svg class="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="4"><path d="M5 13l4 4L19 7"/></svg>':''}
            </div>
            <span class="text-[11px] font-black uppercase tracking-widest text-white">ALL_MATRIX</span>
        </div>`;

        const renderItem = (s, label, depth=false) => {
            const isSelected = this.selectedSources.has(s);
            return `
            <div onclick="window.toggleSource('${s}')" class="flex items-center gap-3 px-8 py-2.5 cursor-pointer group transition-all ${isSelected?'active':''} ${depth?'pl-12':''}">
                <div class="nexus-checkbox border-stone-600 group-hover:border-amber-400 ${isSelected?'active':''}">
                    ${isSelected?'<svg class="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="5"><path d="M5 13l4 4L19 7"/></svg>':''}
                </div>
                <span class="text-[10px] font-bold uppercase tracking-tighter text-white ${isSelected?'text-amber-500':''}">${label || s}</span>
            </div>
            `;
        };

        ['Reddit', 'HN', 'Gaming'].forEach(gn => {
            const items = groups[gn] || []; if(!items.length) return;
            const isOpen = this.expandedGroups.has(gn);
            const allIn = items.every(s => this.selectedSources.has(s));
            html += `<div class="border-b border-white/5 pb-0.5 mt-2">
                <div onclick="window.toggleGroupSources('${gn}', ${JSON.stringify(items).replace(/"/g, "'")}, event)" class="flex items-center justify-between px-8 py-3 cursor-pointer hover:bg-white/5 transition-all group">
                    <div class="flex items-center gap-3">
                        <div class="nexus-checkbox border-stone-600 group-hover:border-amber-400 ${allIn?'active':''}">
                            ${allIn?'<svg class="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="5"><path d="M5 13l4 4L19 7"/></svg>':''}
                        </div>
                        <span class="text-[10px] font-black uppercase tracking-[0.2em] font-white ${allIn?'text-amber-500':''}">${gn}</span>
                    </div>
                    <div onclick="event.stopPropagation(); window.toggleGroup('${gn}')" class="p-2 -mr-2 hover:bg-white/10 rounded-full transition-colors">
                        <svg class="w-3 h-3 text-stone-500 transition-transform ${isOpen?'rotate-90':''}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M9 5l7 7-7 7"/></svg>
                    </div>
                </div>
                <div class="${isOpen?'block':'hidden'} space-y-0.5 bg-black/5">${items.map(s => renderItem(s, s.split('|')[1]?.trim() || s, true)).join('')}</div>
            </div>`;
        });
        groups['Others'].forEach(s => html += renderItem(s));
        nav.innerHTML = html;
    }

    renderCard(item) {
        const time = new Date(item.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        const cleanContent = (item.content || 'ENCRYPTED_SIGNALS').replace(/[A-Za-z0-9+/]{200,}/g, ' [BLOCKED] ');
        const displayTitle = item.title_cn || item.title;
        const subTitle = item.title_cn ? `<div class="text-[10px] text-stone-500 mt-1.5 opacity-40 group-hover:opacity-80 transition-opacity font-mono lowercase tracking-tighter">${item.title}</div>` : '';

        return `
            <div class="waterfall-item">
                <a href="${item.link}" target="_blank" class="block nexus-card rounded-lg p-6 group">
                    <div class="flex items-center justify-between gap-3 mb-5 text-[8px] font-black tracking-widest text-stone-500 uppercase font-mono">
                        <span class="text-amber-600/50 underline decoration-amber-900/40">${item.source}</span>
                        <span class="opacity-20">${time}</span>
                    </div>
                    <h4 class="text-amber-400 font-bold leading-tight text-[14.5px] group-hover:text-white transition-colors uppercase tracking-tighter font-mono">
                        ${displayTitle}
                        ${subTitle}
                    </h4>
                    <p class="text-white text-[12px] leading-relaxed font-normal line-clamp-6 opacity-95 italic mt-4">${cleanContent}</p>
                    ${item.comments && item.comments.length > 0 ? `
                        <div class="mt-6 pt-4 border-t border-white/5 space-y-4">
                            ${item.comments.slice(0,3).map(c => `<div class="text-[10px] leading-relaxed text-stone-400 italic font-light"><span class="font-black text-amber-500/40 uppercase">@${c.author}:</span> ${c.text}</div>`).join('')}
                        </div>
                    ` : ''}
                </a>
            </div>
        `;
    }

    md(txt) { return (typeof marked !== 'undefined') ? `<div class="prose-nexus text-white">${marked.parse(txt)}</div>` : txt; }

    async loadIntelligence(date) {
        if (!date) return;
        const path = (this.indexData && date === this.indexData.latest) ? 'data/latest.json' : `data/archive/${date}.json`;
        this.activeZoneIndex = -1;
        this.aiData = null; 
        const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + `?date=${date}`;
        window.history.pushState({path:newUrl},'',newUrl);
        await this.loadData(path);
    }

    renderArchiveSelector() {
        const container = document.getElementById('archive-selector-container');
        if (!container || !this.indexData) return;
        const currentParams = new URLSearchParams(window.location.search);
        const activeDate = currentParams.get('date') || this.indexData.latest;
        const allDates = [this.indexData.latest, ...this.indexData.archives];
        let html = `
            <div class="flex items-center gap-3 bg-black/40 border border-white/10 px-4 py-1.5 rounded-full shadow-inner">
                <span class="text-[9px] font-black text-stone-500 uppercase tracking-widest">Archive_Vault</span>
                <select onchange="window.NexusTerminal.loadIntelligence(this.value)" 
                        class="bg-transparent text-amber-500 text-[10px] font-bold outline-none cursor-pointer hover:text-white transition-colors">
                    ${allDates.map(d => `<option value="${d}" class="bg-stone-900 text-white" ${d === activeDate ? 'selected' : ''}>${d === this.indexData.latest ? `PRESENT (${d})` : d}</option>`).join('')}
                </select>
            </div>
        `;
        container.innerHTML = html;
    }
}
document.addEventListener('DOMContentLoaded', () => { window.NexusTerminal = new NexusTerminal(); });
