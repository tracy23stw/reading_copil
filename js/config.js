/**
 * config.js — 全局配置
 *
 * 在这里填入你的专属大模型 API 配置。
 * 因为你是唯一的受众，所以直接硬编码在这里，无需做设置 UI。
 */

const APP_CONFIG = {
  llm: {
    // Kimi (Moonshot) API 完整调用地址
    baseUrl: 'https://api.moonshot.cn/v1/chat/completions',
    
    // 你的专属 API Token (请替换为你的 MOONSHOT_API_KEY)
    apiKey: 'sk-RhuxmBSi4ARfnTUQ0fs6VzuvZVLHL72VTgSrDia86qwsgJD7 ',
    
    // 使用的模型名称
    model: 'moonshot-v1-32k',
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = APP_CONFIG;
}
