/**
 * InfoSou Core App Service - Nexus V5.8 Final Stability Build
 * 实现：自由拖拽、流式渲染、强制回车输入、简报收缩及本地缓存
 */

import { AIConfig } from './ai_manager.js';

class NexusTerminal {
    constructor() {
        this.rawData = [];
        this.selectedSources = new Set();
        this.filterDate = '';
        this.recencyMode = 'all';
        this.expandedGroups = new Set(JSON.parse(localStorage.getItem('nexus_expanded')) || ['Reddit', 'HN']);

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
        await this.loadData();
    }

    provisionConfig() {
        const DEF = { apiBase: 'http://127.0.0.1:18789/v1', model: 'gemini-3-flash', apiKey: 'sk-263d3dcfe61c4c3da96d2bcbbb22dc11' };
        if (!localStorage.getItem('INFOSOU_AI_SETTINGS')) localStorage.setItem('INFOSOU_AI_SETTINGS', JSON.stringify(DEF));
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

    async loadData() {
        try {
            const res = await fetch('data/latest.json?' + Date.now());
            const json = await res.json();
            this.rawData = (json.items || []).map(i => ({...i, title: i.title || 'Untitled', source: i.source || 'Unknown', time: i.time || new Date().toISOString()}));
            [...new Set(this.rawData.map(i => i.source))].forEach(s => this.selectedSources.add(s));

            // 首屏存储读取逻辑
            const todayKey = `nexus_brief_${new Date().toISOString().split('T')[0]}`;
            const localBrief = localStorage.getItem(todayKey);
            const staticBrief = (json.metadata?.ai_summary || json.ai_summary || "").trim();

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
            this.update();
        } catch(e) { console.error("BOOT_ERROR"); }
    }

    renderAISummary(content) {
        const el = document.getElementById('ai-content');
        if (content) {
            // 安全过滤：防止极其巨大的 Base64 字符串破坏 DOM
            const cleaned = content.replace(/[A-Za-z0-9+/]{300,}/g, ' [DATA_BLOCKED] ');
            el.innerHTML = this.md(cleaned);
        } else {
            el.innerHTML = `
                <div class="flex flex-col items-center justify-center py-6 border border-white/5 bg-black/10 rounded-lg">
                    <p class="text-stone-500 italic text-[11px] mb-4 uppercase tracking-[0.2em]">Static_Briefing_Empty</p>
                    <button onclick="window.NexusTerminal.forceGenerateBrief()" class="filter-btn px-6 py-2 rounded-full text-amber-500 font-black text-[9px] uppercase tracking-widest border-amber-900/40 hover:border-amber-500 transition-all">
                        Generate_Instant_Briefing
                    </button>
                </div>
            `;
        }
    }

    renderBriefContainerState() {
        const contentEl = document.getElementById('ai-content');
        const btn = document.getElementById('brief-toggle-btn');
        if (this.isBriefExpanded) {
            contentEl.style.display = 'block';
            if(btn) btn.innerText = "[ - ]";
        } else {
            contentEl.style.display = 'none';
            if(btn) btn.innerText = "[ + ]";
        }
    }

    async forceGenerateBrief() {
        const el = document.getElementById('ai-content');
        el.innerHTML = `<div class="animate-pulse text-amber-500 text-center text-[11px] py-8 font-mono">ACCESSING_NEURAL_STREAMS...</div>`;
        try {
            const summary = await AIConfig.summarizeDaily(this.rawData.slice(0, 40));
            // 关键：生成后持久化存储
            const todayKey = `nexus_brief_${new Date().toISOString().split('T')[0]}`;
            localStorage.setItem(todayKey, summary);

            el.innerHTML = this.md(summary);
            this.isBriefExpanded = true;
            this.renderBriefContainerState();
        } catch (e) { el.innerHTML = `<div class="text-stone-500 text-[10px] text-center">FAULT: ${e.message}</div>`; }
    }

    async handleAgentQuery() {
        const input = document.getElementById('chat-input');
        const box = document.getElementById('chat-history');
        const query = input.value.trim();
        if (!query) return;

        input.value = "";
        const bubble = document.createElement('div');
        bubble.className = "prose-nexus bg-stone-800/80 p-5 border border-white/5 rounded-xl text-[12.5px] italic mb-6 shadow-2xl animate-in fade-in";
        bubble.innerHTML = `<span class='text-amber-400 font-black text-[9px] uppercase block mb-1'>Query:</span><div class='mb-4 text-white font-normal'>${query}</div><div id='current-stream' class='opacity-50 text-[11px] animate-pulse'>Establishing_Link...</div>`;
        box.prepend(bubble);

        const streamTarget = bubble.querySelector('#current-stream');

        try {
            const ctx = this.rawData.slice(0, 15).map(i => i.title).join("; ");
            await AIConfig.streamSummarize([{title: `Directive: ${query}`, content: `Pool: ${ctx}`, source: "COMMAND"}], (delta) => {
                streamTarget.classList.remove('animate-pulse', 'opacity-50');
                streamTarget.innerHTML = this.md(delta);
            });
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

        const renderItem = (s, label, depth=false) => `
            <div onclick="window.toggleSource('${s}')" class="flex items-center gap-3 px-8 py-2.5 cursor-pointer group transition-all ${this.selectedSources.has(s)?'active':''} ${depth?'pl-12':''}">
                <div class="nexus-checkbox border-stone-600 group-hover:border-white">${this.selectedSources.has(s)?'<svg class="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="5"><path d="M5 13l4 4L19 7"/></svg>':''}</div>
                <span class="text-[10px] font-bold uppercase tracking-tighter text-white">${label || s}</span>
            </div>
        `;

        ['Reddit', 'HN'].forEach(gn => {
            const items = groups[gn] || []; if(!items.length) return;
            const isOpen = this.expandedGroups.has(gn);
            html += `<div class="border-b border-white/5 pb-0.5 mt-2">
                <div onclick="window.toggleGroup('${gn}')" class="flex items-center justify-between px-8 py-3 cursor-pointer hover:bg-white/5 transition-all">
                    <div class="flex items-center gap-3">
                        <div onclick="window.toggleGroupSources('${gn}', ${JSON.stringify(items).replace(/"/g, "'")}, event)" class="nexus-checkbox border-stone-600 group-hover:border-amber-400 ${items.every(s=>this.selectedSources.has(s))?'active':''}">
                            ${items.every(s=>this.selectedSources.has(s))?'<svg class="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="5"><path d="M5 13l4 4L19 7"/></svg>':''}
                        </div>
                        <span class="text-[10px] font-black uppercase tracking-[0.2em] font-white ${items.every(s=>this.selectedSources.has(s))?'text-amber-500':''}">${gn}</span>
                    </div>
                    <svg class="w-2.5 h-2.5 text-stone-700 transition-transform ${isOpen?'rotate-90':''}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M9 5l7 7-7 7"/></svg>
                </div>
                <div class="${isOpen?'block':'hidden'} space-y-0.5 bg-black/10">${items.map(s => renderItem(s, s.split('|')[1]?.trim() || s, true)).join('')}</div>
            </div>`;
        });
        groups['Others'].forEach(s => html += renderItem(s));
        nav.innerHTML = html;
    }

    renderFeed() {
        const container = document.getElementById('feed-container');
        let filtered = this.rawData.filter(i => this.selectedSources.has(i.source));
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

    renderCard(item) {
        const time = new Date(item.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        const cleanContent = (item.content || 'ENCRYPTED_SIGNALS').replace(/[A-Za-z0-9+/]{200,}/g, ' [BLOCKED] ');
        return `
            <div class="waterfall-item">
                <a href="${item.link}" target="_blank" class="block nexus-card rounded-lg p-6 group">
                    <div class="flex items-center justify-between gap-3 mb-5 text-[8px] font-black tracking-widest text-stone-500 uppercase font-mono">
                        <span class="text-amber-600/50 underline decoration-amber-900/40">${item.source}</span>
                        <span class="opacity-20">${time}</span>
                    </div>
                    <h4 class="text-amber-400 font-bold leading-tight text-[14.5px] group-hover:text-white transition-colors mb-4 line-clamp-3 uppercase tracking-tighter font-mono">${item.title}</h4>
                    <p class="text-white text-[12px] leading-relaxed font-normal line-clamp-6 opacity-95 italic">${cleanContent}</p>
                    ${item.comments && item.comments.length > 0 ? `
                        <div class="mt-6 pt-4 border-t border-white/5 space-y-4">
                            ${item.comments.slice(0,3).map(c => `<div class="text-[10px] leading-relaxed text-stone-400 italic font-light"><span class="font-black text-amber-500/40 uppercase">@${c.author}:</span> ${c.text}</div>`).join('')}
                        </div>
                    ` : ''}
                </a>
            </div>
        `;
    }

    md(txt) {
        if (typeof marked !== 'undefined') {
            return `<div class="prose-nexus text-white">${marked.parse(txt)}</div>`;
        }
        return txt;
    }
}

document.addEventListener('DOMContentLoaded', () => { window.NexusTerminal = new NexusTerminal(); });
