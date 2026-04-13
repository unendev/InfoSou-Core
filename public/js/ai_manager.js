/**
 * AI API 调用管理模块 (BYOK 模式)
 * 核心逻辑：本地持久化 API Key，部署不丢失。
 */

export const AIConfig = {
    // 获取配置
    getSettings() {
        const saved = localStorage.getItem('INFOSOU_AI_SETTINGS');
        return saved ? JSON.parse(saved) : { apiKey: '', model: 'gemini-1.5-flash', apiBase: 'https://generativelanguage.googleapis.com' };
    },

    // 保存配置
    saveSettings(settings) {
        localStorage.setItem('INFOSOU_AI_SETTINGS', JSON.stringify(settings));
    },

    /**
     * 调用 AI 总结每日信息流
     * @param {Array} newsItems 从 latest.json 读取的新闻列表
     */
    async summarizeDaily(newsItems) {
        const { apiKey, model, apiBase } = this.getSettings();
        if (!apiKey) throw new Error("请先在设置中配置 API Key");

        const prompt = `你是我个人的信息管家。以下是聚合站今日抓取的热点信息：
        ${JSON.stringify(newsItems.map(i => ({title: i.title, source: i.source})))}
        
        请完成以下任务：
        1. 挑选出最值得关注的 3 个技术或行业热点。
        2. 针对这 3 个热点，用一句话说明为什么值得关注。
        3. 用毒舌但客观的语气点评一下今天的整体信息质量。`;

        const response = await fetch(`${apiBase}/v1beta/models/${model}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        const data = await response.json();
        return data.candidates[0].content.parts[0].text;
    }
};
