/**
 * llm-client.js — 大模型客户端
 *
 * 负责组装 Prompt，请求 LLM 对前端粗筛的人物候选进行清洗、合并和提取关系。
 */

class LLMClient {
  constructor() {
    this.config = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.llm : null;
  }

  /**
   * 调用 LLM 进行人物清洗和分析
   * @param {Array} candidates - 粗筛的候选人名列表 [{name, count, samples: [...]}]
   * @param {String} bookTitle - 书名
   * @returns {Promise<Object>} - LLM 返回的结构化 JSON 数据
   */
  async processCharacters(candidates, bookTitle) {
    if (!this.config || this.config.apiKey === 'YOUR_API_KEY_HERE') {
      throw new Error('LLM API 未配置。请在 js/config.js 中填入你的 API Key。');
    }

    console.log(`[LLMClient] 开始请求大模型分析，发送候选人数: ${candidates.length}`);

    // 构建发给 LLM 的 Payload 数据
    const payloadData = candidates.map(c => ({
      name: c.name,
      frequency: c.count,
      context_samples: c.samples
    }));

    const prompt = `
你现在是一个资深的文学分析专家和数据清洗引擎。
我将提供给你一份从小说《${bookTitle}》中通过词频粗筛出来的“候选人物名单”，以及每个候选词在书中的一些上下文片段。

你的任务是仔细阅读这些上下文片段，然后帮我完成以下五件事：
1. **剔除误报 (Filter)**：排除所有的地点（如“马州”、“咖啡馆”）、常见称呼（如“妈妈”、“亲爱的”）、碎片词或普通名词。只保留真正的核心人物。
2. **合并同名 (Merge Aliases)**：判断上下文中不同称呼是否指代同一个人（例如“艾姬”和“斯莱德”如果是同一个人，请合并）。合并后选一个最常用的名字作为 \`primaryName\`。
3. **编写摘要 (Summarize)**：根据提供的上下文，为每个确认的核心人物写一段 50-80 字的精准人物简介，描述其身份和性格。绝不要捏造片段外没有提及的信息。
4. **提取关系 (Relationships)**：根据所有的上下文，推断出核心人物之间的主要关系网络。
5. **家族阵营 (Families)**：分析这些人物是否从属于某些特定的家族或阵营（比如“斯莱德家族”、“咖啡馆顾客”）。把属于同一个群组的人归为一类。如果没有明显的群组，可以把他们归为“其他”。

请严格返回以下 JSON 格式的数据，不要包含任何额外的 Markdown 标记或分析过程文字：

{
  "characters": [
    {
      "primaryName": "主要姓名",
      "aliases": ["别名1", "别名2"],
      "summary": "50-80字的精准简介"
    }
  ],
  "relationships": [
    {
      "source": "人物A的主要姓名",
      "target": "人物B的主要姓名",
      "relation": "关系描述（如：夫妻、朋友、母女）"
    }
  ],
  "families": [
    {
      "groupName": "家族/阵营名称（如：Threadgoode家族）",
      "members": ["人物A的主要姓名", "人物B的主要姓名"]
    }
  ]
}

以下是粗筛出来的候选名单及上下文数据：
${JSON.stringify(payloadData, null, 2)}
`;

    try {
      const response = await fetch(this.config.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'user', content: prompt }
          ],
          temperature: 0.2, // 低温度，确保输出稳定的结构化数据
          max_tokens: 4000
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API 请求失败: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      
      // 解析 LLM 返回的文本（提取 JSON）
      let rawContent = '';
      if (data.choices && data.choices[0] && data.choices[0].message) {
        rawContent = data.choices[0].message.content; // OpenAI 格式
      } else if (data.content && data.content[0] && data.content[0].text) {
        rawContent = data.content[0].text; // Anthropic 格式
      } else {
        rawContent = JSON.stringify(data); // 备用
      }

      // 用正则提取出 JSON 块
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('LLM 未返回有效的 JSON 结构。返回内容: ' + rawContent.substring(0, 100));
      }

      const resultJSON = JSON.parse(jsonMatch[0]);
      console.log('[LLMClient] 大模型分析完成，识别到核心人物数量:', resultJSON.characters.length);
      return resultJSON;

    } catch (error) {
      console.error('[LLMClient] 请求异常:', error);
      throw error;
    }
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LLMClient;
}
