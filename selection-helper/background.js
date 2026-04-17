/**
 * Background Service Worker — 划词助手 v2
 *
 * 职责：
 *   - 从 chrome.storage.local 读取 API Key
 *   - 通过 fetchLLM() 向 DeepSeek / 通义千问发起请求
 *   - 将结果返回给 Content Script
 */

'use strict';

// ─── 模型配置 ─────────────────────────────────────────────────────────────────

const MODEL_CONFIG = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1/chat/completions',
    model:   'deepseek-chat',
    keyName: 'deepseekKey',          // 在 chrome.storage.local 中的键名
    label:   'DeepSeek',
  },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model:   'qwen-plus',
    keyName: 'qwenKey',
    label:   '通义千问',
  },
};

// ─── System Prompt 工厂 ───────────────────────────────────────────────────────

function buildSystemPrompt(type) {
  if (type === 'translate') {
    return (
      '你是一位专业翻译。请将用户发送的文本翻译成中文。' +
      '若原文已是中文，则翻译成英文。' +
      '只输出翻译结果，不要添加任何解释、前缀或引号。'
    );
  }
  if (type === 'explain') {
    return (
      '你是一位知识渊博的专家。请对用户发送的专业术语或概念给出简洁、清晰、专业的解释。' +
      '解释应包含：核心定义（1-2 句）、使用场景或领域背景（1-2 句）。' +
      '使用中文回答，语言简练，不要用 Markdown 格式。'
    );
  }
  if (type === 'combined') {
    return (
      '你是一位专业翻译和知识专家。请对用户发送的文本提供以下两部分分析，' +
      '严格按照下方格式输出，不要在标题前后添加任何额外说明：\n\n' +
      '### 翻译\n' +
      '将文本翻译成中文（若原文已是中文，则翻译成英文）。只输出翻译结果，不加任何前缀或引号。\n\n' +
      '### 术语解释\n' +
      '对文本的核心专业术语或概念给出简洁清晰的解释（2-4 句），' +
      '包含核心定义和典型使用场景。若为普通日常语句，则简要说明句子含义与语境。' +
      '使用中文回答，语言简练。'
    );
  }
  return '你是一个助手，请回答用户的问题。';
}

// ─── 核心请求函数 ─────────────────────────────────────────────────────────────

/**
 * 向指定 LLM 发起请求
 * @param {string} text   用户选中的文本
 * @param {string} type   'translate' | 'explain'
 * @param {string} model  'deepseek' | 'qwen'
 * @returns {Promise<string>} 模型返回的文本
 */
async function fetchLLM(text, type, model) {
  const cfg = MODEL_CONFIG[model];
  if (!cfg) throw new Error(`未知模型: ${model}`);

  // 从 storage 读取 API Key
  const stored = await chrome.storage.local.get([cfg.keyName]);
  const apiKey = stored[cfg.keyName];

  if (!apiKey || apiKey.trim() === '') {
    throw new Error(
      `尚未配置 ${cfg.label} 的 API Key。\n` +
      `请右键点击扩展图标 → 选项，进入设置页面填写。`
    );
  }

  const systemPrompt = buildSystemPrompt(type);

  const requestBody = {
    model:      cfg.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: text },
    ],
    stream:     false,
    max_tokens: 1024,
    temperature: 0.3,
  };

  let response;
  try {
    response = await fetch(cfg.baseUrl, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify(requestBody),
    });
  } catch (networkErr) {
    throw new Error(`网络请求失败，请检查网络连接。(${networkErr.message})`);
  }

  if (!response.ok) {
    let errMsg = `API 请求失败 (HTTP ${response.status})`;
    try {
      const errData = await response.json();
      if (errData?.error?.message) {
        errMsg = errData.error.message;
      }
    } catch (_) { /* 忽略 JSON 解析失败 */ }
    throw new Error(errMsg);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (!content) throw new Error('模型返回了空内容，请重试。');

  return content.trim();
}

// ─── 消息路由 ─────────────────────────────────────────────────────────────────

/**
 * 消息格式：{ action: 'translate'|'explain', text: string, model: 'deepseek'|'qwen' }
 * 响应格式：{ success: true, result: string } | { success: false, error: string }
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 只处理来自 content script (tab) 的消息
  if (!sender.tab) return false;

  const { action, text, model } = message;

  if (!text || typeof text !== 'string' || text.trim() === '') {
    sendResponse({ success: false, error: '文本内容无效。' });
    return true;
  }

  if (!['translate', 'explain', 'combined'].includes(action)) {
    sendResponse({ success: false, error: `未知的动作: ${action}` });
    return true;
  }

  if (!MODEL_CONFIG[model]) {
    sendResponse({ success: false, error: `未知的模型: ${model}` });
    return true;
  }

  fetchLLM(text.trim(), action, model)
    .then((result)  => sendResponse({ success: true, result }))
    .catch((err)    => {
      console.error(`[划词助手][${model}] 请求失败:`, err);
      sendResponse({ success: false, error: err.message });
    });

  // 必须返回 true，告知 Chrome 将异步发送响应
  return true;
});

console.log('[划词助手] Background Service Worker v2 已启动。');
