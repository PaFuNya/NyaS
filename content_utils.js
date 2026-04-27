/**
 * content_utils.js — 底层工具层
 *
 * 包含：NS 命名空间前缀、SVG 图标常量、DEFAULT_CONFIG、
 *       ConfigManager、LanguageDetector、InputBoxDetector、TriggerEngine
 *
 * 依赖：NyaAppearance（appearance.js，需在本文件之前加载）
 */

'use strict';

// ─── 命名空间前缀 ──────────────────────────────────────────────────────────────

const NS = 'my-ext';

// ─── SVG 图标常量 ─────────────────────────────────────────────────────────────

const SVG_PIN = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/></svg>`;
const SVG_CLOSE = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const SVG_CHAT = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const SVG_CHEVRON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
const SVG_RESIZE = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 21 15 21 21 15"/><line x1="21" y1="21" x2="15" y2="15"/></svg>`;

// ─── 默认配置 ─────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  disableInInputs: true,
  touchMode: false,
  languages: {
    zh: true, en: true, ja: false,
    ko: false, fr: false, es: false, de: false,
  },
  strictLanguageMatch: false,
  triggerRules: {
    normal: {
      showIcon: true,
      directSearch: false,
      dblclickSearch: false,
      modifiers: [],
      hoverSelect: false,
    },
    pinned: {
      showIcon: false,
      directSearch: true,
      dblclickSearch: false,
      modifiers: [],
      hoverSelect: false,
    },
    insidePanel: {
      showIcon: false,
      directSearch: true,
      dblclickSearch: false,
      modifiers: [],
      hoverSelect: false,
    },
    standalone: {
      showIcon: false,
      directSearch: true,
      dblclickSearch: false,
      modifiers: [],
      hoverSelect: false,
    },
  },
  preferredAction: 'translate',
  models: [],
  appearance: { ...NyaAppearance.DEFAULT },
};

// ═══════════════════════════════════════════════════════════════════════════
//  ConfigManager — 全量读取 storage，深度合并默认值
// ═══════════════════════════════════════════════════════════════════════════

class ConfigManager {
  constructor() {
    this.data = this._clone(DEFAULT_CONFIG);
  }

  load() {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (stored) => {
        this.data = this._deepMerge(DEFAULT_CONFIG, stored || {});
        this.data.appearance = NyaAppearance.mergeAppearance({ appearance: this.data.appearance });
        resolve(this.data);
      });
    });
  }

  get(path) {
    return path.split('.').reduce((o, k) => o?.[k], this.data);
  }

  _deepMerge(defaults, overrides) {
    const out = { ...defaults };
    for (const k of Object.keys(overrides)) {
      if (
        k in defaults &&
        defaults[k] !== null &&
        typeof defaults[k] === 'object' &&
        !Array.isArray(defaults[k])
      ) {
        out[k] = this._deepMerge(defaults[k], overrides[k] ?? {});
      } else {
        out[k] = overrides[k];
      }
    }
    return out;
  }

  _clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  LanguageDetector — 通过正则匹配判断文本语种
// ═══════════════════════════════════════════════════════════════════════════

class LanguageDetector {
  static PATTERNS = {
    zh: /[\u4e00-\u9fff\u3400-\u4dbf]/,
    en: /[a-zA-Z]/,
    ja: /[\u3040-\u30ff\u31f0-\u31ff\uff65-\uff9f]/,
    ko: /[\uac00-\ud7af\u1100-\u11ff]/,
    fr: /[àâäéèêëîïôùûüÿæœç]/i,
    es: /[áéíóúüñ¿¡]/i,
    de: /[äöüß]/i,
  };

  static detect(text) {
    return Object.entries(this.PATTERNS)
      .filter(([, re]) => re.test(text))
      .map(([lang]) => lang);
  }

  static matches(text, langConfig, strict) {
    const enabled = Object.keys(langConfig).filter((k) => langConfig[k]);
    if (enabled.length === 0) return true;
    const detected = this.detect(text);
    if (detected.length === 0) return true;
    return strict
      ? detected.every((l) => enabled.includes(l))
      : detected.some((l) => enabled.includes(l));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  InputBoxDetector — 检测目标元素是否处于输入框/代码编辑器内
// ═══════════════════════════════════════════════════════════════════════════

class InputBoxDetector {
  static EDITOR_CLASSES = [
    'CodeMirror', 'ace_editor', 'monaco-editor',
    'cm-editor', 'ProseMirror', 'ql-editor', 'tox-edit-area',
  ];

  static isInside(element) {
    if (!element) return false;
    const tag = element.tagName?.toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag)) return true;
    if (element.isContentEditable) return true;
    if (element.closest?.('[contenteditable="true"], [contenteditable=""]')) return true;

    let el = element;
    while (el && el !== document.body) {
      if (el.classList) {
        for (const cls of this.EDITOR_CLASSES) {
          if (el.classList.contains(cls)) return true;
        }
      }
      el = el.parentElement;
    }
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  TriggerEngine — 根据场景和事件决定触发方式
// ═══════════════════════════════════════════════════════════════════════════

class TriggerEngine {
  constructor(config) {
    this.config = config;
  }

  evaluate(scenario, event, isDblClick = false) {
    const rules = this.config.get(`triggerRules.${scenario}`);
    if (!rules) return 'off';

    if (isDblClick && rules.dblclickSearch) return 'direct';

    if (rules.modifiers?.length > 0) {
      const hit = rules.modifiers.some((mod) => {
        if (mod === 'ctrl') return event.ctrlKey;
        if (mod === 'alt') return event.altKey;
        if (mod === 'shift') return event.shiftKey;
        if (mod === 'meta') return event.metaKey;
        return false;
      });
      if (hit) return 'direct';
    }

    if (rules.directSearch) return 'direct';
    if (rules.showIcon) return 'icon';
    return 'off';
  }
}
