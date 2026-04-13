/**
 * AI API 调用管理模块 (OpenAI 兼容协议版)
 * 适配：OpenAI, Gemini (V1 兼容模式), Claude (中转), DeepSeek 等
 */

export const AIConfig = {
    // 获取配置
    getSettings() {
        const saved = localStorage.getItem('INFOSOU_AI_SETTINGS');
        return saved ? JSON.parse(saved) : { 
            apiKey: '', 
            model: 'gemini-1.5-flash', 
            apiBase: 'https://generativelanguage.googleapis.com/v1' 
        };
    },

    // 保存配置
    saveSettings(settings) {
        localStorage.setItem('INFOSOU_AI_SETTINGS', JSON.stringify(settings));
    },

    /**
     * 调用 AI 总结情报
     * 使用标准的 OpenAI Chat Completions 协议，容错率最高
     */
    async summarizeDaily(newsItems) {
        let { apiKey, model, apiBase } = this.getSettings();
        if (!apiKey) throw new Error("AUTH_TOKEN_NOT_FOUND");

        // 1. 智能修正 URL 拼接逻辑
        let baseUrl = apiBase.trim();
        if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
        
        // 自动补齐标准 OpenAI 路径
        let finalUrl = baseUrl;
        if (!finalUrl.includes('/chat/completions')) {
            finalUrl = finalUrl.endsWith('/v1') ? `${finalUrl}/chat/completions` : `${finalUrl}/v1/chat/completions`;
        }

        const prompt = `你是一个高级情报分析官。请审阅以下提供的新闻聚合数据，并为其撰写一份核心简报。
        任务：
        1. 总结今日最重要的 3 个技术或行业动态。
        2. 指出潜在的深度阅读价值项。
        3. 语气要硬核且干练。
        
        待处理情报流：
        ${JSON.stringify(newsItems.map(i => ({
            t: i.title,
            s: i.source,
            c: (i.content || "").replace(/<[^>]+>/g, '').slice(0, 150) // 提取前150字纯文本供 AI 深度分析
        })))}`;

        // 2. 发起标准请求
        const response = await fetch(finalUrl, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: "system", content: "You are a professional intelligence officer." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.5
            })
        });

        // 3. 稳健解析逻辑
        const rawText = await response.text();
        let data;
        
        try {
            data = JSON.parse(rawText);
        } catch (e) {
            throw new Error(`SERVER_RESPONSE_NOT_JSON: ${rawText.substring(0, 100)}...`);
        }

        // 4. 报错详情透传
        if (!response.ok || data.error) {
            const errorMsg = data.error?.message || data.error || rawText.substring(0, 100);
            throw new Error(`API_STATUS_${response.status}: ${errorMsg}`);
        }

        // 5. 适配所有主流 API 返回格式 (OpenAI, Gemini-v1-compatible, etc.)
        const result = data.choices?.[0]?.message?.content || 
                       data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!result) {
            console.error("DEBUG_PAYLOAD:", data);
            throw new Error("EMPTY_RESPONSE: API 返回内容为空。可能是安全过滤或模型参数错误。");
        }

        return result;
    }
};
