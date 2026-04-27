/**
 * Background Service Worker — NyaTranslate v3.1
 *
 * 架构重构要点：
 *   - 零硬编码厂商信息：模型 ID / Base URL / API Key 全部动态读自 storage
 *   - 适配器模式保留（OpenAIAdapter / ClaudeAdapter），入口改为动态 cfg
 *   - notConfigured 标记：未配置时优雅降级，不暴力抛错
 *   - 截图调度权移交 background：keyboard shortcut + 右键菜单直接 captureVisibleTab
 *     并 push dataUrl 给 content.js（消除 popup 关闭导致的时序问题）
 *   - HistoryManager 保持不变
 */

'use strict';

// ─── 存储 Schema 默认值 ───────────────────────────────────────────────────────

const DEFAULT_OPENAI_BASE_URL    = 'https://api.openai.com/v1';
const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';

/**
 * @returns {string}
 */
function newModelRowId() {
  try {
    return crypto.randomUUID();
  } catch (_) {
    return `m-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}

/**
 * 统一解析 models：支持 v4 独立鉴权结构，并兼容旧版全局 Key + 旧 models 行。
 * @typedef {{ id: string, modelId: string, displayName: string, protocol: 'openai'|'anthropic', baseUrl: string, apiKey: string, enabled: boolean }} ModelRow
 * @param {Record<string, unknown>} stored
 * @returns {ModelRow[]}
 */
function ensureModelsArray(stored) {
  const globals = {
    openaiKey:       String(stored.openaiKey || ''),
    openaiBaseUrl:   String(stored.openaiBaseUrl || DEFAULT_OPENAI_BASE_URL).replace(/\/$/, ''),
    anthropicKey:    String(stored.anthropicKey || ''),
    anthropicBaseUrl: String(stored.anthropicBaseUrl || DEFAULT_ANTHROPIC_BASE_URL).replace(/\/$/, ''),
  };

  const raw = Array.isArray(stored.models) ? stored.models : [];
  /** @type {ModelRow[]} */
  const out = [];
  const seenIds = new Set();

  const pushRow = (row) => {
    const id = String(row.id || '').trim() || newModelRowId();
    if (seenIds.has(id)) return;
    seenIds.add(id);
    out.push({
      id,
      modelId:     String(row.modelId || '').trim(),
      displayName: String(row.displayName || row.modelId || '').trim() || String(row.modelId || '').trim(),
      protocol:    row.protocol === 'anthropic' ? 'anthropic' : 'openai',
      baseUrl:     String(row.baseUrl || '').trim().replace(/\/$/, ''),
      apiKey:      String(row.apiKey || ''),
      enabled:     row.enabled !== false,
    });
  };

  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;

    if (m.modelId != null && (m.protocol === 'openai' || m.protocol === 'anthropic')) {
      const proto = m.protocol === 'anthropic' ? 'anthropic' : 'openai';
      const defBase = proto === 'anthropic' ? DEFAULT_ANTHROPIC_BASE_URL : DEFAULT_OPENAI_BASE_URL;
      pushRow({
        id:          m.id,
        modelId:     m.modelId,
        displayName: m.displayName != null ? m.displayName : m.modelId,
        protocol:    proto,
        baseUrl:     m.baseUrl != null && String(m.baseUrl).trim() ? m.baseUrl : defBase,
        apiKey:      m.apiKey != null ? m.apiKey : '',
        enabled:     m.enabled,
      });
      continue;
    }

    const oldApiName = String(m.id || '').trim();
    if (!oldApiName) continue;
    const proto = m.provider === 'anthropic' ? 'anthropic' : 'openai';
    pushRow({
      id:          newModelRowId(),
      modelId:     oldApiName,
      displayName: oldApiName,
      protocol:    proto,
      baseUrl:     proto === 'anthropic' ? globals.anthropicBaseUrl : globals.openaiBaseUrl,
      apiKey:      proto === 'anthropic' ? globals.anthropicKey : globals.openaiKey,
      enabled:     m.enabled !== false,
    });
  }

  const legacyText = (stored.textModelId && String(stored.textModelId).trim()) || '';
  const legacyProto = stored.textModelProtocol === 'anthropic' ? 'anthropic' : 'openai';
  if (legacyText && !out.some((r) => r.modelId === legacyText)) {
    pushRow({
      id:          newModelRowId(),
      modelId:     legacyText,
      displayName: legacyText,
      protocol:    legacyProto,
      baseUrl:     legacyProto === 'anthropic' ? globals.anthropicBaseUrl : globals.openaiBaseUrl,
      apiKey:      legacyProto === 'anthropic' ? globals.anthropicKey : globals.openaiKey,
      enabled:     true,
    });
  }

  if (out.length === 0) {
    return [
      {
        id: newModelRowId(),
        modelId: 'gpt-4o',
        displayName: 'GPT-4o',
        protocol: 'openai',
        baseUrl: DEFAULT_OPENAI_BASE_URL,
        apiKey: '',
        enabled: true,
      },
      {
        id: newModelRowId(),
        modelId: 'claude-3-5-sonnet-20241022',
        displayName: 'Claude 3.5 Sonnet',
        protocol: 'anthropic',
        baseUrl: DEFAULT_ANTHROPIC_BASE_URL,
        apiKey: '',
        enabled: true,
      },
      {
        id: newModelRowId(),
        modelId: 'deepseek-chat',
        displayName: 'DeepSeek Chat',
        protocol: 'openai',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: '',
        enabled: true,
      },
    ];
  }

  return out;
}

/**
 * @param {Record<string, unknown>} stored
 * @param {{ targetModelId?: string, modelId?: string }} [override]
 */
function buildCfgForModel(stored, override) {
  const models = ensureModelsArray(stored);
  const target = (override?.targetModelId || override?.modelId || '').trim();

  let row = target
    ? models.find((m) => m.id === target)
    : null;

  if (!row) {
    row = models.find((m) => m.enabled) || null;
  }

  if (!row) {
    return {
      protocol:    'openai',
      model:       '',
      baseUrl:     '',
      apiKey:      '',
      label:       '',
      hasRow:      false,
      missingKey:  false,
    };
  }

  const protocol = row.protocol === 'anthropic' ? 'anthropic' : 'openai';
  const base = (row.baseUrl || (protocol === 'anthropic' ? DEFAULT_ANTHROPIC_BASE_URL : DEFAULT_OPENAI_BASE_URL))
    .replace(/\/$/, '');
  const apiKey = (row.apiKey || '').trim();
  const model = (row.modelId || '').trim();
  const fullUrl = protocol === 'anthropic'
    ? `${base}/messages`
    : `${base}/chat/completions`;

  const label = (row.displayName || '').trim() || model || (protocol === 'anthropic' ? 'Claude' : 'AI');

  return {
    protocol,
    model,
    baseUrl: fullUrl,
    apiKey,
    label,
    hasRow:     true,
    missingKey: !apiKey,
  };
}


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
      '你是翻译与术语解释专家。请对用户发送的文本同时完成以下两项任务，' +
      '严格按照以下 Markdown 格式输出，不要添加任何额外说明：\n\n' +
      '### 翻译\n' +
      '（将文本翻译成中文；若原文已是中文则译为英文；只输出译文本身）\n\n' +
      '### 解释\n' +
      '（对文本中的核心术语或概念给出简洁专业解释：核心定义 1-2 句 + 使用场景或领域背景 1-2 句；用中文作答）'
    );
  }
  if (type === 'vision') {
    return '请识别图中文字，并在保持原有段落排版的情况下，将其翻译为流畅的中文。';
  }
  return '你是一个助手，请回答用户的问题。';
}

// ═══════════════════════════════════════════════════════════════════════════
//  动态配置读取器
//  从 storage 构建运行时 cfg 对象，不再依赖硬编码 MODEL_CONFIG
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
//  适配器一：OpenAI 兼容协议
// ═══════════════════════════════════════════════════════════════════════════

class OpenAIAdapter {
  static async fetchText(text, systemPrompt, apiKey, cfg) {
    const body = {
      model:       cfg.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: text },
      ],
      stream:      false,
      max_tokens:  1024,
      temperature: 0.3,
    };
    return OpenAIAdapter._request(cfg.baseUrl, apiKey, body);
  }

  static async fetchVision(base64, mimeType, systemPrompt, apiKey, cfg) {
    const body = {
      model: cfg.model,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            {
              type:      'image_url',
              image_url: { url: `data:${mimeType};base64,${base64}` },
            },
          ],
        },
      ],
      stream:      false,
      max_tokens:  2048,
      temperature: 0.3,
    };
    return OpenAIAdapter._request(cfg.baseUrl, apiKey, body);
  }

  static async _request(url, apiKey, body) {
    let response;
    try {
      response = await fetch(url, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error(`网络请求失败，请检查网络连接。(${e.message})`);
    }

    if (!response.ok) {
      let errMsg = `API 请求失败 (HTTP ${response.status})`;
      try {
        const d = await response.json();
        if (d?.error?.message) errMsg = d.error.message;
      } catch (_) { /* 忽略 JSON 解析失败 */ }
      throw new Error(errMsg);
    }

    const data    = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('模型返回了空内容，请重试。');
    return content.trim();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  适配器二：Anthropic 协议（Claude）
// ═══════════════════════════════════════════════════════════════════════════

class ClaudeAdapter {
  static async fetchText(text, systemPrompt, apiKey, cfg) {
    const body = {
      model:      cfg.model,
      max_tokens: 1024,
      system:     systemPrompt,
      messages: [
        { role: 'user', content: text },
      ],
    };
    return ClaudeAdapter._request(cfg.baseUrl, apiKey, body);
  }

  static async fetchVision(base64, mimeType, systemPrompt, apiKey, cfg) {
    const body = {
      model:      cfg.model,
      max_tokens: 2048,
      system:     systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type:   'image',
              source: {
                type:       'base64',
                media_type: mimeType,
                data:       base64,
              },
            },
          ],
        },
      ],
    };
    return ClaudeAdapter._request(cfg.baseUrl, apiKey, body);
  }

  static async _request(url, apiKey, body) {
    let response;
    try {
      response = await fetch(url, {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         apiKey.trim(),
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error(`网络请求失败，请检查网络连接。(${e.message})`);
    }

    if (!response.ok) {
      let errMsg = `API 请求失败 (HTTP ${response.status})`;
      try {
        const d = await response.json();
        if (d?.error?.message) errMsg = d.error.message;
      } catch (_) { /* 忽略 JSON 解析失败 */ }
      throw new Error(errMsg);
    }

    const data    = await response.json();
    const content = data?.content?.[0]?.text;
    if (!content) throw new Error('模型返回了空内容，请重试。');
    return content.trim();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  请求分发器 — 文本翻译/解释
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 文本翻译/解释统一入口
 * 动态读取 storage 中的协议配置，无硬编码厂商信息
 * @param {string} text
 * @param {string} type  'translate' | 'explain' | 'combined'
 * @returns {Promise<string>}
 */
/**
 * @param {string} text
 * @param {string} type
 * @param {{ targetModelId?: string, modelId?: string }} [override] 面板所选模型配置行 id
 */
async function fetchLLM(text, type, override) {
  const s = await chrome.storage.local.get(null);
  const cfg = buildCfgForModel(s, override || {});

  if (!cfg.hasRow) {
    throw Object.assign(
      new Error('没有可用的已启用模型，请前往设置页添加并启用至少一个模型。'),
      { notConfigured: true }
    );
  }

  if (cfg.missingKey || !cfg.apiKey) {
    throw Object.assign(
      new Error('该模型的 API Key 未配置，请前往设置页填写'),
      { notConfigured: true }
    );
  }

  if (!cfg.model) {
    throw Object.assign(
      new Error('该模型的 Model ID 无效，请前往设置页检查。'),
      { notConfigured: true }
    );
  }

  const systemPrompt = buildSystemPrompt(type);

  if (cfg.protocol === 'anthropic') {
    return ClaudeAdapter.fetchText(text, systemPrompt, cfg.apiKey, cfg);
  }
  return OpenAIAdapter.fetchText(text, systemPrompt, cfg.apiKey, cfg);
}

// ═══════════════════════════════════════════════════════════════════════════
//  请求分发器 — 视觉（图片/截图）翻译
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 视觉翻译统一入口
 * @param {string} base64
 * @param {string} mimeType
 * @returns {Promise<string>}
 */
async function fetchVision(base64, mimeType) {
  const s = await chrome.storage.local.get(null);
  const cfg = buildCfgForModel(s, {});

  if (!cfg.hasRow) {
    throw Object.assign(
      new Error('没有可用的已启用模型，请前往设置页添加并启用至少一个模型。'),
      { notConfigured: true }
    );
  }

  if (cfg.missingKey || !cfg.apiKey) {
    throw Object.assign(
      new Error('该模型的 API Key 未配置，请前往设置页填写'),
      { notConfigured: true }
    );
  }

  if (!cfg.model) {
    throw Object.assign(
      new Error('该模型的 Model ID 无效，请前往设置页检查。'),
      { notConfigured: true }
    );
  }

  const systemPrompt = buildSystemPrompt('vision');

  if (cfg.protocol === 'anthropic') {
    return ClaudeAdapter.fetchVision(base64, mimeType, systemPrompt, cfg.apiKey, cfg);
  }
  return OpenAIAdapter.fetchVision(base64, mimeType, systemPrompt, cfg.apiKey, cfg);
}

// ═══════════════════════════════════════════════════════════════════════════
//  多引擎并发调度器
//  对标沙拉查词：一次性向所有已启用模型发起并行请求，
//  每个完成（或报错）后立即通过 chrome.tabs.sendMessage 单独推送回 content.js，
//  绝不等齐所有模型。
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Promise 超时包装，避免单个挂死请求永久阻塞卡片
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} msg
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, msg) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * 单模型执行单元：负责校验、发起 API、推送结果或错误。
 * 任何异常都被自身吞下，不会冒泡导致 Promise.all 整体 reject。
 * @param {{ id:string, modelId:string, displayName:string, protocol:string, baseUrl:string, apiKey:string, enabled:boolean }} row
 * @param {Record<string, unknown>} stored
 * @param {{ text:string, requestId:string, tabId:number, pageTitle:string }} ctx
 */
async function runOneModel(row, stored, { text, requestId, tabId, pageTitle }) {
  const cfg   = buildCfgForModel(stored, { targetModelId: row.id });
  const label = cfg.label || row.displayName || row.modelId;

  const fail = (err, notConfigured = false) => chrome.tabs.sendMessage(tabId, {
    action:        'nya-multi-result',
    requestId,
    modelRowId:    row.id,
    status:        'error',
    error:         err?.message || String(err),
    notConfigured: !!notConfigured || !!err?.notConfigured,
    label,
  }).catch(() => {});

  if (!cfg.hasRow)    return fail(new Error('模型配置丢失'), true);
  if (cfg.missingKey) return fail(new Error('该模型的 API Key 未配置，请前往设置页填写'), true);
  if (!cfg.model)     return fail(new Error('该模型的 Model ID 无效，请前往设置页检查'), true);

  try {
    const sysPrompt = buildSystemPrompt('combined');
    const adapter   = cfg.protocol === 'anthropic' ? ClaudeAdapter : OpenAIAdapter;
    const result    = await withTimeout(
      adapter.fetchText(text, sysPrompt, cfg.apiKey, cfg),
      30000,
      `${label} 请求超时（30s）`,
    );

    chrome.tabs.sendMessage(tabId, {
      action:     'nya-multi-result',
      requestId,
      modelRowId: row.id,
      status:     'success',
      result,
      label,
    }).catch(() => {});

    HistoryManager.save({
      originalText: text,
      result,
      model: label,
      pageTitle,
    });
  } catch (err) {
    fail(err);
  }
}

/**
 * 多引擎并行入口：读取所有 enabled 模型，Promise.all 同时发车，
 * 每个 settle 立即通过 chrome.tabs.sendMessage 单独推送结果。
 * @param {{ text:string, requestId:string, tabId:number, pageTitle:string }} ctx
 */
async function dispatchMultiTranslate({ text, requestId, tabId, pageTitle }) {
  const stored  = await chrome.storage.local.get(null);
  const enabled = ensureModelsArray(stored).filter((m) => m.enabled);

  if (enabled.length === 0) {
    chrome.tabs.sendMessage(tabId, {
      action: 'nya-multi-empty',
      requestId,
      error:  '尚未启用任何模型，请前往设置页配置。',
    }).catch(() => {});
    return;
  }

  await Promise.all(enabled.map((row) => runOneModel(row, stored, {
    text, requestId, tabId, pageTitle,
  })));
}

/**
 * 单卡片重试入口：仅对一个 modelRowId 重新发起请求。
 * @param {{ text:string, requestId:string, modelRowId:string, tabId:number, pageTitle:string }} ctx
 */
async function dispatchSingleTranslate({ text, requestId, modelRowId, tabId, pageTitle }) {
  const stored = await chrome.storage.local.get(null);
  const row    = ensureModelsArray(stored).find((m) => m.id === modelRowId && m.enabled);

  if (!row) {
    chrome.tabs.sendMessage(tabId, {
      action:     'nya-multi-result',
      requestId,
      modelRowId,
      status:     'error',
      error:      '该模型不存在或已禁用',
      label:      '',
    }).catch(() => {});
    return;
  }

  await runOneModel(row, stored, { text, requestId, tabId, pageTitle });
}

// ═══════════════════════════════════════════════════════════════════════════
//  HistoryManager — 本地翻译历史（chrome.storage.local）
// ═══════════════════════════════════════════════════════════════════════════

class HistoryManager {
  static MAX_RECORDS = 200;
  static STORAGE_KEY = 'translationHistory';

  static async save({ originalText, result, model, pageTitle }) {
    try {
      let list = await HistoryManager._load();

      const record = {
        id:           `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp:    Date.now(),
        originalText: (originalText || '').slice(0, 500),
        result:       (result || '').slice(0, 2000),
        model:        model || 'unknown',
        pageTitle:    (pageTitle || '').slice(0, 100),
      };

      list.unshift(record);
      if (list.length > HistoryManager.MAX_RECORDS) {
        list = list.slice(0, HistoryManager.MAX_RECORDS);
      }

      await chrome.storage.local.set({ [HistoryManager.STORAGE_KEY]: list });
    } catch (err) {
      console.warn('[NyaTranslate][History] 存储历史失败:', err);
    }
  }

  static async getAll() {
    return HistoryManager._load();
  }

  static async clear() {
    await chrome.storage.local.set({ [HistoryManager.STORAGE_KEY]: [] });
  }

  static async _load() {
    const stored = await chrome.storage.local.get([HistoryManager.STORAGE_KEY]);
    const list   = stored[HistoryManager.STORAGE_KEY];
    return Array.isArray(list) ? list : [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  截图调度器
//  background 直接拥有 captureVisibleTab 控制权，push dataUrl 给 content.js
//  消除 popup 关闭导致的时序问题
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 对指定 tab 截取当前视口，并将 dataUrl push 给 content.js 的 ScreenshotOverlay
 * @param {{ id: number, windowId: number }} tab
 */
async function initiateScreenshot(tab) {
  let dataUrl;
  try {
    dataUrl = await new Promise((resolve, reject) => {
      chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (url) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(url);
        }
      });
    });
  } catch (e) {
    console.error('[NyaTranslate][Screenshot] captureVisibleTab 失败:', e);
    chrome.tabs.sendMessage(tab.id, {
      action: 'nya-vision-error',
      error:  `截图失败：${e.message}`,
    }).catch(() => {});
    return;
  }

  // 将截图 dataUrl 直接 push 给 content.js，由 ScreenshotOverlay 接管
  chrome.tabs.sendMessage(tab.id, {
    action:  'nya-screenshot-start',
    dataUrl,
  }).catch((e) => {
    console.error('[NyaTranslate][Screenshot] 无法发送消息到 content.js:', e);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  右键菜单注册
// ═══════════════════════════════════════════════════════════════════════════

chrome.contextMenus.removeAll(() => {
  // 图片取词
  chrome.contextMenus.create({
    id:       'nya-translate-image',
    title:    '提取图片文字并翻译 (NyaTranslate)',
    contexts: ['image'],
  });

  // 区域截图翻译（全页面右键均可触发）
  chrome.contextMenus.create({
    id:       'nya-screenshot-area',
    title:    '区域截图翻译 (NyaTranslate)',
    contexts: ['all'],
  });
});

// ─── 图片 URL → Base64 工具 ────────────────────────────────────────────────

async function imageUrlToBase64(srcUrl) {
  if (srcUrl.startsWith('data:')) {
    const [header, data] = srcUrl.split(',');
    const mimeType = header.match(/data:([^;]+)/)?.[1] || 'image/png';
    return { base64: data, mimeType };
  }

  let response;
  try {
    response = await fetch(srcUrl);
  } catch (e) {
    throw new Error(`无法获取图片资源：${e.message}`);
  }
  if (!response.ok) throw new Error(`图片加载失败 (HTTP ${response.status})`);

  const blob     = await response.blob();
  const mimeType = blob.type || 'image/png';
  const buffer   = await blob.arrayBuffer();

  const bytes  = new Uint8Array(buffer);
  let   binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return { base64: btoa(binary), mimeType };
}

// ─── 右键菜单事件处理 ─────────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // ── 区域截图翻译 ──
  if (info.menuItemId === 'nya-screenshot-area') {
    initiateScreenshot(tab);
    return;
  }

  // ── 图片取词 ──
  if (info.menuItemId === 'nya-translate-image') {
    if (!info.srcUrl) return;

    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'nya-vision-loading' });
    } catch (_) { /* content script 可能未就绪 */ }

    try {
      const { base64, mimeType } = await imageUrlToBase64(info.srcUrl);
      const result               = await fetchVision(base64, mimeType);
      const s                    = await chrome.storage.local.get(null);
      const cfg                  = buildCfgForModel(s, {});

      chrome.tabs.sendMessage(tab.id, {
        action: 'nya-vision-result',
        result,
        label:  cfg.label,
      });

      HistoryManager.save({
        originalText: `[图片] ${info.srcUrl.slice(0, 80)}`,
        result,
        model:     cfg.label || cfg.model || 'unknown',
        pageTitle: tab.title || '',
      });
    } catch (err) {
      console.error('[NyaTranslate][Vision] 图片翻译失败:', err);
      chrome.tabs.sendMessage(tab.id, {
        action: 'nya-vision-error',
        error:  err.message,
      }).catch(() => {});
    }
  }
});

// ─── 键盘快捷键处理 ───────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'nya-screenshot') return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) initiateScreenshot(tab);
});

// ═══════════════════════════════════════════════════════════════════════════
//  消息路由
// ═══════════════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message;

  // ── 多引擎并行翻译（v4 主路径） ──────────────────────────────────────
  if (action === 'nya-multi-translate') {
    if (!sender.tab) return false;
    const { text, requestId } = message;
    if (!text || typeof text !== 'string' || !text.trim()) {
      sendResponse({ success: false, error: '文本无效' });
      return true;
    }
    dispatchMultiTranslate({
      text:      text.trim(),
      requestId: String(requestId || ''),
      tabId:     sender.tab.id,
      pageTitle: sender.tab.title || '',
    });
    sendResponse({ success: true, accepted: true });
    return false;
  }

  // ── 单卡片重试 ─────────────────────────────────────────────────────────
  if (action === 'nya-translate-single') {
    if (!sender.tab) return false;
    const { text, requestId, modelRowId } = message;
    if (!text || typeof text !== 'string' || !text.trim() || !modelRowId) {
      sendResponse({ success: false, error: '参数无效' });
      return true;
    }
    dispatchSingleTranslate({
      text:       text.trim(),
      requestId:  String(requestId || ''),
      modelRowId: String(modelRowId),
      tabId:      sender.tab.id,
      pageTitle:  sender.tab.title || '',
    });
    sendResponse({ success: true, accepted: true });
    return false;
  }

  // ── 文本翻译/解释（v3 兼容路径，popup 等仍在使用） ───────────────────
  if (['translate', 'explain', 'combined'].includes(action)) {
    if (!sender.tab) return false;

    const { text, targetModelId, modelId } = message;

    if (!text || typeof text !== 'string' || text.trim() === '') {
      sendResponse({ success: false, error: '文本内容无效。' });
      return true;
    }

    const tid = (typeof targetModelId === 'string' && targetModelId.trim())
      ? targetModelId.trim()
      : (typeof modelId === 'string' && modelId.trim() ? modelId.trim() : '');
    const override = tid ? { targetModelId: tid } : {};

    fetchLLM(text.trim(), action, override)
      .then((result) => {
        sendResponse({ success: true, result });

        // 静默存储历史（跳过 explain，避免与 combined 重复）
        if (action !== 'explain') {
          chrome.storage.local.get(null, (s) => {
            const cfg = buildCfgForModel(s || {}, override);
            HistoryManager.save({
              originalText: text.trim(),
              result,
              model:     cfg.label || cfg.model || 'unknown',
              pageTitle: sender.tab?.title || '',
            });
          });
        }
      })
      .catch((err) => {
        console.error(`[NyaTranslate][LLM] 请求失败:`, err);
        // notConfigured 标记透传给 content.js，用于区分"未配置"和"API 错误"
        sendResponse({
          success:        false,
          error:          err.message,
          notConfigured:  !!err.notConfigured,
        });
      });

    return true;
  }

  // ── 框选完成：content.js 发来裁剪好的 Base64 ─────────────────────────
  if (action === 'nya-vision-crop') {
    if (!sender.tab) return false;

    const { base64, mimeType, x, y } = message;

    fetchVision(base64, mimeType)
      .then(async (result) => {
        const s   = await chrome.storage.local.get(null);
        const cfg = buildCfgForModel(s, {});
        chrome.tabs.sendMessage(sender.tab.id, {
          action: 'nya-vision-result',
          result,
          label:  cfg.label,
          x, y,
        });
        HistoryManager.save({
          originalText: '[截图区域]',
          result,
          model:     cfg.label || cfg.model || 'unknown',
          pageTitle: sender.tab?.title || '',
        });
      })
      .catch((err) => {
        console.error('[NyaTranslate][Vision] 截图翻译失败:', err);
        chrome.tabs.sendMessage(sender.tab.id, {
          action: 'nya-vision-error',
          error:  err.message,
        }).catch(() => {});
      });

    sendResponse({ success: true });
    return true;
  }

  // ── 历史记录操作 ──────────────────────────────────────────────────────
  if (action === 'nya-history-get') {
    HistoryManager.getAll()
      .then((list) => sendResponse({ success: true, list }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (action === 'nya-history-clear') {
    HistoryManager.clear()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  return false;
});

console.log('[NyaTranslate] Background Service Worker v4.1 已启动（多引擎并行 + 每模型独立鉴权）。');
