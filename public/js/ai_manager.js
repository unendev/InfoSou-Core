/**
 * AI API 调用管理模块 (支持流式响应)
 */

export const AIConfig = {
    getSettings() {
        const saved = localStorage.getItem('INFOSOU_AI_SETTINGS');
        return saved ? JSON.parse(saved) : {
            apiBase: 'http://127.0.0.1:18789/v1',
            model: 'gemini-3-flash',
            apiKey: 'sk-263d3dcfe61c4c3da96d2bcbbb22dc11'
        };
    },

    saveSettings(settings) {
        localStorage.setItem('INFOSOU_AI_SETTINGS', JSON.stringify(settings));
    },

    /**
     * 流式调用核心接口
     */
    async streamSummarize(newsItems, onDelta) {
        let { apiKey, model, apiBase } = this.getSettings();
        if (!apiKey) throw new Error("AUTH_TOKEN_MISSING");

        let baseUrl = apiBase.trim();
        if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
        let finalUrl = baseUrl.includes('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;

        const response = await fetch(finalUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: "system", content: "You are a professional intelligence officer. Respond briefly in Markdown." },
                    { role: "user", content: `根据情报生成深度解析: ${JSON.stringify(newsItems)}` }
                ],
                stream: true,
                temperature: 0.4
            })
        });

        if (!response.ok) throw new Error(`HTTP_STATUS_${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
                const cleanLine = line.replace(/^data: /, '').trim();
                if (!cleanLine || cleanLine === '[DONE]') continue;

                try {
                    const json = JSON.parse(cleanLine);
                    const delta = json.choices?.[0]?.delta?.content || "";
                    if (delta) {
                        buffer += delta;
                        if (onDelta) onDelta(buffer);
                    }
                } catch (e) {
                    // 忽略部分块拼接导致的 JSON 解析错误
                }
            }
        }
        return buffer;
    },

    async summarizeDaily(newsItems) {
        let { apiKey, model, apiBase } = this.getSettings();
        let baseUrl = apiBase.trim();
        if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
        let finalUrl = baseUrl.includes('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;

        const response = await fetch(finalUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model,
                messages: [{ role: "user", content: `简要总结情报流: ${JSON.stringify(newsItems)}` }]
            })
        });
        const data = await response.json();
        return data.choices[0].message.content;
    }
};
