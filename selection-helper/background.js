/**
 * Background Service Worker — 划词助手
 * 负责接收 Content Script 的消息，发起 API 请求（当前为 Mock），并返回结果。
 *
 * 设计说明：
 *   - API 请求在 Background 中发起，可以绕过 Content Script 的 CORS 限制。
 *   - 当对接真实 API 时，只需替换 mockFetchTranslate / mockFetchExplain 函数的实现即可。
 */

'use strict';

// ─── 配置区域（对接真实 API 时修改这里） ─────────────────────────────────────────

const API_CONFIG = {
  // 示例：替换为你的真实 API Key 和地址
  apiKey: 'YOUR_API_KEY_HERE',
  translateUrl: 'https://api.example.com/translate',
  explainUrl: 'https://api.example.com/explain',
};

// ─── Mock 异步请求函数 ────────────────────────────────────────────────────────

/**
 * 模拟翻译接口（延迟 1 秒）
 * @param {string} text 待翻译的文本
 * @returns {Promise<string>} 翻译结果
 */
function mockFetchTranslate(text) {
  return new Promise((resolve) => {
    setTimeout(() => {
      // ── 真实 API 对接示例（解除注释并填入 API_CONFIG） ──────────────
      // const response = await fetch(API_CONFIG.translateUrl, {
      //   method: 'POST',
      //   headers: {
      //     'Content-Type': 'application/json',
      //     'Authorization': `Bearer ${API_CONFIG.apiKey}`,
      //   },
      //   body: JSON.stringify({ text, target_lang: 'zh' }),
      // });
      // const data = await response.json();
      // resolve(data.translation);
      // ────────────────────────────────────────────────────────────────

      // Mock 返回值
      const mockResults = [
        `"${text}" 的中文翻译为：【${text}的示例译文】。（这是模拟数据）`,
        `翻译结果：这是对 "${truncateMock(text)}" 的模拟翻译，实际结果请对接真实翻译 API。`,
      ];
      resolve(mockResults[Math.floor(Math.random() * mockResults.length)]);
    }, 1000);
  });
}

/**
 * 模拟术语解释接口（延迟 1.2 秒）
 * @param {string} text 待解释的文本
 * @returns {Promise<string>} 术语解释结果
 */
function mockFetchExplain(text) {
  return new Promise((resolve) => {
    setTimeout(() => {
      // ── 真实 API 对接示例（解除注释并填入 API_CONFIG） ──────────────
      // const response = await fetch(API_CONFIG.explainUrl, {
      //   method: 'POST',
      //   headers: {
      //     'Content-Type': 'application/json',
      //     'Authorization': `Bearer ${API_CONFIG.apiKey}`,
      //   },
      //   body: JSON.stringify({ term: text }),
      // });
      // const data = await response.json();
      // resolve(data.explanation);
      // ────────────────────────────────────────────────────────────────

      // Mock 返回值
      resolve(
        `【${truncateMock(text)}】是一个专业术语。\n\n` +
        `定义：这是对该术语的模拟解释内容。在正式环境中，此处将展示来自知识库或大语言模型的详细解释。\n\n` +
        `（当前为模拟数据，请对接真实 API）`
      );
    }, 1200);
  });
}

/** 截断长文本，仅用于 Mock 展示 */
function truncateMock(text, len = 20) {
  return text.length > len ? text.slice(0, len) + '…' : text;
}

// ─── 消息路由 ─────────────────────────────────────────────────────────────────

/**
 * 监听来自 Content Script 的消息。
 *
 * 消息格式：{ action: 'translate' | 'explain', text: string }
 * 响应格式：{ success: true, result: string } | { success: false, error: string }
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action, text } = message;

  // 验证消息来源：确保消息来自扩展自身的 Content Script
  if (!sender.tab) {
    // 非 tab 来源的消息不处理
    return false;
  }

  if (!text || typeof text !== 'string' || text.trim() === '') {
    sendResponse({ success: false, error: '文本内容无效。' });
    return true;
  }

  if (action === 'translate') {
    mockFetchTranslate(text.trim())
      .then((result) => sendResponse({ success: true, result }))
      .catch((err) => {
        console.error('[划词助手] 翻译请求失败:', err);
        sendResponse({ success: false, error: '翻译请求失败，请稍后重试。' });
      });

    // 返回 true 表示将异步发送响应（必须，否则消息通道会被关闭）
    return true;
  }

  if (action === 'explain') {
    mockFetchExplain(text.trim())
      .then((result) => sendResponse({ success: true, result }))
      .catch((err) => {
        console.error('[划词助手] 术语解释请求失败:', err);
        sendResponse({ success: false, error: '术语解释请求失败，请稍后重试。' });
      });

    return true;
  }

  // 未知的 action
  sendResponse({ success: false, error: `未知的操作类型: ${action}` });
  return false;
});

// Service Worker 激活日志
console.log('[划词助手] Background Service Worker 已启动。');
