/**
 * Content Script — 划词助手 v4
 *
 * 架构：ES6 Class 模块化
 *   ConfigManager     — 从 storage 加载全量配置
 *   LanguageDetector  — 文本语种检测
 *   InputBoxDetector  — 输入框/编辑器检测
 *   TriggerEngine     — 根据场景+事件决策触发方式
 *   DragController    — 面板拖拽
 *   ResizeController  — 面板缩放（右下角拖拽手柄）
 *   AccordionCard     — 单个模型折叠卡片
 *   FloatingIcon      — 悬浮小图标
 *   PanelInstance     — 单个面板实例（三种状态：unpinned / screen-pinned / page-pinned）
 *   PanelManager      — 面板实例管理器（单例路由、生命周期、状态分发）
 *   SelectionManager  — 全局事件监听与编排
 *   ExtensionApp      — 根节点，组合所有模块
 */

(function () {
  'use strict';

  if (window.__nyaSelectionHelperV4__) return;
  window.__nyaSelectionHelperV4__ = true;

  const NS = 'my-ext';

  // ─── SVG 图标常量 ─────────────────────────────────────────────────────────

  const SVG_PIN = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/></svg>`;
  const SVG_CLOSE = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  const SVG_CHAT = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  const SVG_CHEVRON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
  const SVG_RESIZE = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 21 15 21 21 15"/><line x1="21" y1="21" x2="15" y2="15"/></svg>`;

  // ─── 默认配置 ─────────────────────────────────────────────────────────────

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

  // ═══════════════════════════════════════════════════════════════════════════
  //  DragController — 鼠标拖拽面板
  // ═══════════════════════════════════════════════════════════════════════════

  class DragController {
    constructor(panelEl, handleEl, onDragEnd = null) {
      this._panel = panelEl;
      this._handle = handleEl;
      this._onDragEnd = onDragEnd;
      this._active = false;
      this._ox = 0; this._oy = 0;
      this._pl = 0; this._pt = 0;

      this._down = this._down.bind(this);
      this._move = this._move.bind(this);
      this._up = this._up.bind(this);

      handleEl.addEventListener('mousedown', this._down);
      handleEl.style.cursor = 'grab';
    }

    _down(e) {
      if (e.button !== 0) return;
      if (e.target.closest('button') || e.target.closest('select')) return;
      e.preventDefault();
      e.stopPropagation();

      this._active = true;
      this._ox = e.clientX;
      this._oy = e.clientY;
      this._pl = parseInt(this._panel.style.left, 10) || 0;
      this._pt = parseInt(this._panel.style.top, 10) || 0;

      document.addEventListener('mousemove', this._move);
      document.addEventListener('mouseup', this._up);
      this._handle.style.cursor = 'grabbing';
      this._panel.style.transition = 'none';
    }

    _move(e) {
      if (!this._active) return;
      const dx = e.clientX - this._ox;
      const dy = e.clientY - this._oy;
      const pw = this._panel.offsetWidth;
      const ph = this._panel.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const isFixed = this._panel.style.position === 'fixed';

      let left, top;
      if (isFixed) {
        left = Math.max(8, Math.min(this._pl + dx, vw - pw - 8));
        top = Math.max(8, Math.min(this._pt + dy, vh - ph - 8));
      } else {
        const sx = window.scrollX, sy = window.scrollY;
        left = Math.max(sx + 8, Math.min(this._pl + dx, sx + vw - pw - 8));
        top = Math.max(sy + 8, Math.min(this._pt + dy, sy + vh - ph - 8));
      }

      this._panel.style.left = `${left}px`;
      this._panel.style.top = `${top}px`;
    }

    _up() {
      if (!this._active) return;
      this._active = false;
      document.removeEventListener('mousemove', this._move);
      document.removeEventListener('mouseup', this._up);
      this._handle.style.cursor = 'grab';
      this._panel.style.transition = '';
      if (typeof this._onDragEnd === 'function') {
        this._onDragEnd();
      }
    }

    destroy() {
      this._handle.removeEventListener('mousedown', this._down);
      document.removeEventListener('mousemove', this._move);
      document.removeEventListener('mouseup', this._up);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ResizeController — 面板右下角缩放手柄
  // ═══════════════════════════════════════════════════════════════════════════

  class ResizeController {
    constructor(panelEl, handleEl, options = {}) {
      this._panel = panelEl;
      this._handle = handleEl;
      this._minWidth = options.minWidth ?? 300;
      this._minHeight = options.minHeight ?? 200;
      this._active = false;
      this._ox = 0; this._oy = 0;
      this._ow = 0; this._oh = 0;

      this._down = this._down.bind(this);
      this._move = this._move.bind(this);
      this._up = this._up.bind(this);

      handleEl.addEventListener('mousedown', this._down);
    }

    _down(e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      this._active = true;
      this._ox = e.clientX;
      this._oy = e.clientY;
      this._ow = this._panel.offsetWidth;
      this._oh = this._panel.offsetHeight;

      document.addEventListener('mousemove', this._move);
      document.addEventListener('mouseup', this._up);
      this._panel.style.transition = 'none';
    }

    _move(e) {
      if (!this._active) return;
      const dx = e.clientX - this._ox;
      const dy = e.clientY - this._oy;

      const newW = Math.max(this._minWidth, this._ow + dx);
      const newH = Math.max(this._minHeight, this._oh + dy);

      this._panel.style.width = `${newW}px`;
      this._panel.style.height = `${newH}px`;
    }

    _up() {
      if (!this._active) return;
      this._active = false;
      document.removeEventListener('mousemove', this._move);
      document.removeEventListener('mouseup', this._up);
      this._panel.style.transition = '';
    }

    destroy() {
      this._handle.removeEventListener('mousedown', this._down);
      document.removeEventListener('mousemove', this._move);
      document.removeEventListener('mouseup', this._up);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  AccordionCard — 单个模型的折叠展示卡片
  // ═══════════════════════════════════════════════════════════════════════════

  class AccordionCard {
    constructor(modelId, modelLabel) {
      this.modelId = modelId;
      this.label = modelLabel;
      this._useCombined = true;
      this.state = {
        translate: { status: 'idle', content: '' },
        explain: { status: 'idle', content: '' },
        combined: { status: 'idle', content: '' },
      };
      this.onFetch = null;

      this._open = true;
      this._body = null;
      this._dot = null;
      this._chevron = null;
      this.el = null;

      this._build();
    }

    _build() {
      this.el = document.createElement('div');
      this.el.className = `${NS}-accordion`;

      const hdr = document.createElement('div');
      hdr.className = `${NS}-accordion-header`;

      const titleWrap = document.createElement('div');
      titleWrap.className = `${NS}-accordion-title`;

      const badge = document.createElement('span');
      badge.className = `${NS}-accordion-badge ${NS}-accordion-badge--${this.modelId}`;
      badge.textContent = this.label;
      this._badgeEl = badge;

      this._dot = document.createElement('span');
      this._dot.className = `${NS}-accordion-dot`;

      titleWrap.appendChild(badge);
      titleWrap.appendChild(this._dot);

      this._chevron = document.createElement('span');
      this._chevron.className = `${NS}-accordion-chevron ${NS}-accordion-chevron--up`;
      this._chevron.innerHTML = SVG_CHEVRON;

      hdr.appendChild(titleWrap);
      hdr.appendChild(this._chevron);
      hdr.addEventListener('click', () => this._toggle());

      this._body = document.createElement('div');
      this._body.className = `${NS}-accordion-body ${NS}-accordion-body--open`;

      this.el.appendChild(hdr);
      this.el.appendChild(this._body);

      this._renderBody();
    }

    _toggle() {
      this._open = !this._open;
      this._body.classList.toggle(`${NS}-accordion-body--open`, this._open);
      this._chevron.classList.toggle(`${NS}-accordion-chevron--up`, this._open);
    }

    forceOpen() {
      this._open = true;
      this._body.classList.add(`${NS}-accordion-body--open`);
      this._chevron.classList.add(`${NS}-accordion-chevron--up`);
    }

    setLabel(label) {
      this.label = label;
      if (this._badgeEl) this._badgeEl.textContent = label;
    }

    setLoading(action) {
      if (action in this.state) {
        this.state[action] = { status: 'loading', content: '' };
      }
      this._updateDot();
      this.forceOpen();
      this._renderBody();
    }

    setResult(action, content) {
      if (action in this.state) {
        this.state[action] = { status: 'result', content };
      }
      this._updateDot();
      this._renderBody();
    }

    setError(action, error) {
      if (action in this.state) {
        this.state[action] = { status: 'error', content: error };
      }
      this._updateDot();
      this._renderBody();
    }

    reset() {
      this.state = {
        translate: { status: 'idle', content: '' },
        explain: { status: 'idle', content: '' },
        combined: { status: 'idle', content: '' },
      };
      this._updateDot();
      this._renderBody();
    }

    _updateDot() {
      const { translate, explain, combined } = this.state;
      const relevant = this._useCombined
        ? [combined]
        : [translate, explain];

      const hasError = relevant.some(s => s.status === 'error');
      const hasLoading = relevant.some(s => s.status === 'loading');
      const allResult = relevant.every(s => s.status === 'result');

      if (hasError) {
        this._dot.className = `${NS}-accordion-dot ${NS}-accordion-dot--error`;
      } else if (hasLoading) {
        this._dot.className = `${NS}-accordion-dot ${NS}-accordion-dot--loading`;
      } else if (allResult) {
        this._dot.className = `${NS}-accordion-dot ${NS}-accordion-dot--success`;
      } else {
        this._dot.className = `${NS}-accordion-dot`;
      }
    }

    _renderBody() {
      this._body.innerHTML = '';
      if (this._useCombined) {
        this._renderBodyCombined();
      } else {
        this._renderBodySplit();
      }
    }

    _renderBodyCombined() {
      const { combined } = this.state;

      if (combined.status === 'idle') {
        const hint = document.createElement('p');
        hint.className = `${NS}-hint`;
        hint.textContent = `由 ${this.label} 同时提供翻译与解释`;
        this._body.appendChild(hint);
        return;
      }

      if (combined.status === 'loading') {
        this._body.appendChild(this._buildLoader());
        return;
      }

      if (combined.status === 'error') {
        const err = document.createElement('div');
        err.className = `${NS}-error`;
        err.style.cssText = 'margin:10px;';
        err.textContent = `⚠️ ${combined.content}`;
        this._body.appendChild(err);

        const retryBtn = this._btn('🔄 重试', () => {
          this.onFetch?.(this.modelId, 'combined');
        }, true);
        retryBtn.style.cssText = 'margin:8px 10px 12px; display:inline-flex;';
        this._body.appendChild(retryBtn);
        return;
      }

      if (combined.status === 'result') {
        this._renderCombinedSections(combined.content);
      }
    }

    _renderCombinedSections(content) {
      const sectionRe = /^###\s+(.+)$/m;
      const parts = content.split(/(?=^###\s+)/m).filter(s => s.trim());

      if (parts.length === 0) {
        const section = document.createElement('div');
        section.className = `${NS}-combined-section`;
        const body = document.createElement('div');
        body.className = `${NS}-result-body`;
        body.textContent = content;
        const footer = document.createElement('div');
        footer.className = `${NS}-result-footer`;
        footer.style.cssText = 'padding:0 10px 10px;';
        footer.appendChild(this._copyBtn(content));
        section.appendChild(body);
        section.appendChild(footer);
        this._body.appendChild(section);
        return;
      }

      parts.forEach((part, idx) => {
        const match = part.match(sectionRe);
        const rawTitle = match ? match[1].trim() : '';
        const bodyText = part.replace(sectionRe, '').trim();

        if (idx > 0) {
          const divider = document.createElement('div');
          divider.className = `${NS}-combined-divider`;
          this._body.appendChild(divider);
        }

        const section = document.createElement('div');
        section.className = `${NS}-combined-section`;

        if (rawTitle) {
          const label = document.createElement('div');
          label.className = `${NS}-combined-label`;
          const icon = rawTitle.includes('翻译') ? '🌐' : '📖';
          label.textContent = `${icon} ${rawTitle}`;
          section.appendChild(label);
        }

        const body = document.createElement('div');
        body.className = `${NS}-result-body`;
        body.textContent = bodyText;
        section.appendChild(body);

        const footer = document.createElement('div');
        footer.className = `${NS}-result-footer`;
        footer.style.cssText = 'padding:0 0 6px;';
        footer.appendChild(this._copyBtn(bodyText));
        section.appendChild(footer);

        this._body.appendChild(section);
      });
    }

    _renderBodySplit() {
      const { translate, explain } = this.state;

      const isLoading = translate.status === 'loading' || explain.status === 'loading';
      const hasError = translate.status === 'error' || explain.status === 'error';
      const allIdle = translate.status === 'idle' && explain.status === 'idle';

      if (allIdle) {
        const hint = document.createElement('p');
        hint.className = `${NS}-hint`;
        hint.textContent = `由 ${this.label} 为你提供翻译和解释`;
        this._body.appendChild(hint);
        return;
      }

      if (isLoading) {
        this._body.appendChild(this._buildLoader());
      }

      if (translate.status === 'result' || translate.status === 'error') {
        this._renderResultSection('translate', translate);
      }

      if (explain.status === 'result' || explain.status === 'error') {
        this._renderResultSection('explain', explain);
      }

      if (hasError && !isLoading && translate.status !== 'result' && explain.status !== 'result') {
        const retryBtn = this._btn('🔄 重试', () => {
          if (translate.status === 'error') this.onFetch?.(this.modelId, 'translate');
          if (explain.status === 'error') this.onFetch?.(this.modelId, 'explain');
        }, true);
        retryBtn.style.cssText = 'margin-top:12px; display:inline-flex;';
        this._body.appendChild(retryBtn);
      }
    }

    _buildLoader() {
      const loader = document.createElement('div');
      loader.className = `${NS}-loading`;

      const spinner = document.createElement('div');
      spinner.className = `${NS}-spinner`;

      const txt = document.createElement('span');
      txt.className = `${NS}-loading-text`;
      txt.textContent = `${this.label} 正在思考中…`;

      const dots = document.createElement('div');
      dots.className = `${NS}-dots`;
      for (let i = 0; i < 3; i++) {
        const d = document.createElement('span');
        d.className = `${NS}-dot`;
        dots.appendChild(d);
      }

      loader.appendChild(spinner);
      loader.appendChild(txt);
      loader.appendChild(dots);
      return loader;
    }

    _renderResultSection(type, state) {
      const isError = state.status === 'error';
      const isTranslate = type === 'translate';

      const section = document.createElement('div');
      section.className = `${NS}-result-section`;

      const header = document.createElement('div');
      header.className = `${NS}-result-header`;
      header.textContent = isTranslate ? '🌐 翻译结果' : '📖 术语解释';

      const body = document.createElement('div');
      body.className = isError ? `${NS}-error` : `${NS}-result-body`;
      body.textContent = isError ? `⚠️ ${state.content}` : state.content;

      const footer = document.createElement('div');
      footer.className = `${NS}-result-footer`;

      if (!isError) {
        footer.appendChild(this._copyBtn(state.content));
      }

      section.appendChild(header);
      section.appendChild(body);
      section.appendChild(footer);

      this._body.appendChild(section);
    }

    _btn(label, onClick, ghost = false) {
      const btn = document.createElement('button');
      btn.className = `${NS}-btn${ghost ? ` ${NS}-btn--ghost` : ''}`;
      btn.textContent = label;
      if (onClick) btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
      return btn;
    }

    _copyBtn(text) {
      const btn = this._btn('📋 复制', null, true);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text)
          .then(() => { btn.textContent = '✅ 已复制'; setTimeout(() => { btn.textContent = '📋 复制'; }, 1500); })
          .catch(() => { btn.textContent = '❌ 失败'; setTimeout(() => { btn.textContent = '📋 复制'; }, 1500); });
      });
      return btn;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  FloatingIcon — 划词后出现的悬浮小气泡图标
  // ═══════════════════════════════════════════════════════════════════════════

  class FloatingIcon {
    constructor() {
      this.el = null;
      this.onOpen = null;
      /** @type {() => Record<string, unknown>} */
      this._getConfigData = null;
    }

    show(x, y) {
      this.hide();
      this.el = document.createElement('div');
      this.el.id = `${NS}-icon`;
      this.el.className = `${NS}-icon`;
      this.el.title = '点击查询（翻译 / 解释）';
      this.el.innerHTML = SVG_CHAT;

      const pos = this._clamp(x + 12, y + 12);
      this.el.style.left = `${pos.left}px`;
      this.el.style.top = `${pos.top}px`;

      if (typeof this._getConfigData === 'function') {
        NyaAppearance.applyToContentRoot(
          this.el,
          NyaAppearance.mergeAppearance({ appearance: this._getConfigData().appearance })
        );
      }

      this.el.addEventListener('click', (e) => {
        e.stopPropagation();
        const iconPos = { x, y };
        this.hide();
        this.onOpen?.(iconPos);
      });

      document.body.appendChild(this.el);
      requestAnimationFrame(() => this.el?.classList.add(`${NS}-icon--visible`));
    }

    hide() {
      this.el?.remove();
      this.el = null;
    }

    contains(target) {
      return !!this.el?.contains(target);
    }

    _clamp(x, y, w = 36, h = 36) {
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const sx = window.scrollX, sy = window.scrollY;
      return {
        left: Math.min(Math.max(x, sx + 8), sx + vw - w - 8),
        top: Math.min(Math.max(y, sy + 8), sy + vh - h - 8),
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PanelInstance — 单个面板实例
  //  三种状态：
  //    'unpinned'     — 默认态，点击空白处销毁
  //    'screen-pinned' — 屏幕固定（单例），position: fixed，不随滚动
  //    'page-pinned'   — 便利贴固定（多例），position: absolute，随滚动
  // ═══════════════════════════════════════════════════════════════════════════

  class PanelInstance {
    constructor(panelManager, config, id = `panel-${Date.now()}-${Math.random().toString(36).slice(2)}`) {
      this._panelManager = panelManager;
      this._config = config;
      this.id = id;
      this.el = null;
      this.pinMode = 'unpinned';
      this._drag = null;
      this._resize = null;
      this._cards = {};
      this._preview = null;
      this._pinDropdown = null;
      this._pinDropdownAbort = null;
      this._selectedText = '';
      this._modelSelect = null;
      this._selectedModelId = '';
      this._selectedProvider = 'openai';
      this._modelSelectMs = null;
    }

    get isPinned() { return this.pinMode !== 'unpinned'; }
    get isOpen() { return !!this.el; }

    open(text, pos) {
      if (this.isOpen) {
        this._updateText(text);
        return;
      }

      this.el = this._build(text);
      const clamped = this._clamp(pos.x, pos.y);
      this.el.style.left = `${clamped.left}px`;
      this.el.style.top = `${clamped.top}px`;

      document.body.appendChild(this.el);
      this._refreshModelSelect();
      requestAnimationFrame(() => this.el?.classList.add(`${NS}-panel--visible`));

      const pref = this._config.get('preferredAction');
      if (pref && pref !== 'none') {
        this._fetchAll();
      }
    }

    close() {
      if (!this.el) return;

      if (this._modelSelectMs) {
        this._modelSelectMs.destroy();
        this._modelSelectMs = null;
      }

      const el = this.el;
      this.el = null;

      this._pinDropdownAbort?.abort();
      this._pinDropdownAbort = null;

      if (this._drag) {
        this._drag.destroy();
        this._drag = null;
      }
      if (this._resize) {
        this._resize.destroy();
        this._resize = null;
      }

      el.classList.remove(`${NS}-panel--visible`);

      const cleanup = () => {
        el.remove();
        this._panelManager?.onPanelClosed(this.id);
      };

      const timer = setTimeout(cleanup, 220);
      el.addEventListener('transitionend', () => {
        clearTimeout(timer);
        cleanup();
      }, { once: true });
    }

    contains(target) {
      return !!this.el?.contains(target);
    }

    updateContent(text) {
      this._selectedText = text;
      if (this._preview) this._preview.textContent = `"${this._truncate(text)}"`;
      Object.values(this._cards).forEach((c) => c.reset());

      if (this.el) {
        this.el.classList.add(`${NS}-panel--flash`);
        setTimeout(() => this.el?.classList.remove(`${NS}-panel--flash`), 600);
      }

      const pref = this._config.get('preferredAction');
      if (pref && pref !== 'none') {
        this._fetchAll();
      }
    }

    _build(text) {
      const panel = document.createElement('div');
      panel.id = `${NS}-panel-${this.id}`;
      panel.className = `${NS}-panel`;
      panel.dataset.status = this.pinMode;

      panel.appendChild(this._buildHeader(text));
      panel.appendChild(this._buildActionBar());
      panel.appendChild(this._buildAccordionWrap());
      panel.appendChild(this._buildResizeHandle());

      NyaAppearance.applyToContentRoot(
        panel,
        NyaAppearance.mergeAppearance({ appearance: this._config.get('appearance') })
      );

      this._drag = new DragController(panel, panel.querySelector(`.${NS}-panel-header`), () => this._onDragEnd());
      this._resize = new ResizeController(panel, panel.querySelector(`.${NS}-resize-handle`), {
        minWidth: 300,
        minHeight: 200,
      });

      return panel;
    }

    _buildHeader(text) {
      const header = document.createElement('div');
      header.className = `${NS}-panel-header`;

      const logo = document.createElement('div');
      logo.className = `${NS}-panel-logo`;
      logo.innerHTML = SVG_CHAT;

      const title = document.createElement('span');
      title.className = `${NS}-panel-title`;
      title.textContent = 'NyaTransalte';

      this._modelSelect = document.createElement('select');
      this._modelSelect.className = `${NS}-panel-model-select`;
      this._modelSelect.title = '选择模型';
      this._modelSelect.addEventListener('click', (e) => e.stopPropagation());
      this._modelSelect.addEventListener('change', () => this._onModelSelectChange());

      const spacer = document.createElement('div');
      spacer.className = `${NS}-panel-spacer`;

      this._preview = document.createElement('span');
      this._preview.className = `${NS}-preview`;
      this._preview.textContent = `"${this._truncate(text)}"`;

      const pinContainer = document.createElement('div');
      pinContainer.className = `${NS}-pin-container`;

      const btnPin = document.createElement('button');
      btnPin.className = `${NS}-header-btn`;
      btnPin.title = '固定面板';
      btnPin.innerHTML = SVG_PIN;

      const dropdown = document.createElement('div');
      dropdown.className = `${NS}-pin-dropdown`;
      dropdown.style.display = 'none';

      const optionUnpin = document.createElement('button');
      optionUnpin.className = `${NS}-pin-option ${NS}-pin-option--danger`;
      optionUnpin.innerHTML = '<span style="margin-right:6px">✖</span>取消固定';
      optionUnpin.addEventListener('click', (e) => {
        e.stopPropagation();
        this._setPinMode('unpinned');
        dropdown.style.display = 'none';
      });

      const optionScreen = document.createElement('button');
      optionScreen.className = `${NS}-pin-option`;
      optionScreen.innerHTML = '<span style="margin-right:6px">📌</span>固定在屏幕（常驻翻译）';
      optionScreen.addEventListener('click', (e) => {
        e.stopPropagation();
        this._setPinMode('screen-pinned');
        dropdown.style.display = 'none';
      });

      const optionPage = document.createElement('button');
      optionPage.className = `${NS}-pin-option`;
      optionPage.innerHTML = '<span style="margin-right:6px">📝</span>固定在页面（便利贴）';
      optionPage.addEventListener('click', (e) => {
        e.stopPropagation();
        this._setPinMode('page-pinned');
        dropdown.style.display = 'none';
      });

      dropdown.appendChild(optionUnpin);
      dropdown.appendChild(optionScreen);
      dropdown.appendChild(optionPage);

      btnPin.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
      });

      const ac = new AbortController();
      this._pinDropdownAbort = ac;
      document.addEventListener('click', (e) => {
        if (!pinContainer.contains(e.target)) {
          dropdown.style.display = 'none';
        }
      }, { signal: ac.signal });

      pinContainer.appendChild(btnPin);
      pinContainer.appendChild(dropdown);
      this._pinDropdown = dropdown;

      const btnClose = document.createElement('button');
      btnClose.className = `${NS}-header-btn`;
      btnClose.title = '关闭';
      btnClose.innerHTML = SVG_CLOSE;
      btnClose.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
      });

      header.appendChild(logo);
      header.appendChild(title);
      header.appendChild(this._modelSelect);
      header.appendChild(spacer);
      header.appendChild(this._preview);
      header.appendChild(pinContainer);
      header.appendChild(btnClose);

      return header;
    }

    _buildActionBar() {
      const bar = document.createElement('div');
      bar.className = `${NS}-action-bar`;
      return bar;
    }

    _buildAccordionWrap() {
      const wrap = document.createElement('div');
      wrap.className = `${NS}-accordion-wrap`;

      const enabled = this._getEnabledModels();
      const first = enabled[0];
      const modelLabel = (first && (first.displayName || first.modelId)) || 'AI 翻译';
      const card = new AccordionCard('primary', modelLabel);
      card.onFetch = (_, action) => this._fetchModel('primary', action);
      this._cards['primary'] = card;
      wrap.appendChild(card.el);

      return wrap;
    }

    _buildResizeHandle() {
      const handle = document.createElement('div');
      handle.className = `${NS}-resize-handle`;
      handle.innerHTML = SVG_RESIZE;
      handle.title = '拖拽缩放面板';
      return handle;
    }

    _setPinMode(mode) {
      const oldMode = this.pinMode;
      this.pinMode = mode;

      if (this.el) {
        this.el.dataset.status = mode;
      }

      const btnPin = this.el?.querySelector(`.${NS}-header-btn`);
      if (btnPin) {
        btnPin.classList.toggle(`${NS}-header-btn--active`, mode !== 'unpinned');
        if (mode === 'screen-pinned') {
          btnPin.title = '固定在屏幕（常驻翻译）';
        } else if (mode === 'page-pinned') {
          btnPin.title = '固定在页面（便利贴）';
        } else {
          btnPin.title = '固定面板';
        }
      }

      if (mode === 'screen-pinned') {
        this._applyScreenPinned();
      } else if (mode === 'page-pinned') {
        this._applyPagePinned();
      } else {
        this._applyUnpinned(oldMode);
      }

      if (this._panelManager) {
        if (mode !== 'unpinned' && oldMode === 'unpinned') {
          this._panelManager.onPanelPinned(this.id, mode);
        } else if (mode === 'unpinned' && oldMode !== 'unpinned') {
          this._panelManager.onPanelUnpinned(this.id);
        } else if (oldMode !== 'unpinned' && mode !== 'unpinned' && oldMode !== mode) {
          this._panelManager.onPinModeChanged(this.id, oldMode, mode);
        }
      }
    }

    _applyScreenPinned() {
      if (!this.el) return;
      const rect = this.el.getBoundingClientRect();
      this.el.style.position = 'fixed';
      this.el.style.top = `${rect.top}px`;
      this.el.style.left = `${rect.left}px`;
    }

    _applyPagePinned() {
      if (!this.el) return;
      const rect = this.el.getBoundingClientRect();
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      this.el.style.position = 'absolute';
      this.el.style.left = `${rect.left + scrollX}px`;
      this.el.style.top = `${rect.top + scrollY}px`;
    }

    _applyUnpinned(oldMode) {
      if (!this.el) return;
      const rect = this.el.getBoundingClientRect();
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;

      this.el.style.position = 'absolute';
      this.el.style.left = `${rect.left + scrollX}px`;
      this.el.style.top = `${rect.top + scrollY}px`;
    }

    _onDragEnd() {
      // 拖拽结束后无需特殊处理，位置已由 DragController 更新
    }

    _normalizeModelRow(m) {
      if (!m) return null;
      if (m.modelId != null && (m.protocol === 'openai' || m.protocol === 'anthropic')) {
        return {
          ...m,
          displayName: m.displayName || m.modelId,
          modelId: m.modelId,
          protocol: m.protocol,
        };
      }
      const pid = String(m.id || '').trim();
      if (!pid) return null;
      return {
        id: pid,
        modelId: pid,
        displayName: pid,
        protocol: m.provider === 'anthropic' ? 'anthropic' : 'openai',
        enabled: m.enabled !== false,
      };
    }

    _getEnabledModels() {
      const models = this._config.get('models');
      if (!Array.isArray(models)) return [];
      return models
        .map((m) => this._normalizeModelRow(m))
        .filter((m) => m && m.enabled);
    }

    _refreshModelSelect() {
      if (!this._modelSelect) return;
      if (this._modelSelectMs) {
        this._modelSelectMs.destroy();
        this._modelSelectMs = null;
      }

      const list = this._getEnabledModels();
      this._modelSelect.innerHTML = '';

      if (list.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '无可用模型';
        this._modelSelect.appendChild(opt);
        this._modelSelect.disabled = true;
        this._selectedModelId = '';
        this._selectedProvider = 'openai';
        this._cards.primary?.setLabel('—');
        if (typeof MaterialSelect !== 'undefined') {
          this._modelSelectMs = new MaterialSelect(this._modelSelect, { compact: true });
        }
        return;
      }

      this._modelSelect.disabled = false;
      let keepIdx = -1;
      list.forEach((m, i) => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.displayName || m.modelId || m.id;
        opt.dataset.modelId = m.id;
        opt.dataset.provider = m.protocol === 'anthropic' ? 'anthropic' : 'openai';
        if (m.id === this._selectedModelId) keepIdx = i;
        this._modelSelect.appendChild(opt);
      });

      const idx = keepIdx >= 0 ? keepIdx : 0;
      this._modelSelect.selectedIndex = idx;
      const picked = list[idx];
      this._selectedModelId = picked.id;
      this._selectedProvider = picked.protocol === 'anthropic' ? 'anthropic' : 'openai';
      const label = picked.displayName || picked.modelId || picked.id;
      this._cards.primary?.setLabel(label);

      if (typeof MaterialSelect !== 'undefined') {
        this._modelSelectMs = new MaterialSelect(this._modelSelect, { compact: true });
      }
    }

    _onModelSelectChange() {
      const opt = this._modelSelect?.selectedOptions[0];
      if (!opt || !opt.dataset.modelId) return;
      this._selectedModelId = opt.dataset.modelId;
      this._selectedProvider = opt.dataset.provider === 'anthropic' ? 'anthropic' : 'openai';
      this._cards.primary?.setLabel(opt.textContent || this._selectedModelId);
      Object.values(this._cards).forEach((c) => c.reset());
      const pref = this._config.get('preferredAction');
      if (pref && pref !== 'none') {
        this._fetchAll();
      }
    }

    _fetchAll() {
      // 单模型，发送一次 combined 请求即可
      this._fetchModel('primary', 'combined');
    }

    _fetchModel(cardId, action) {
      const card = this._cards[cardId];
      if (!card) return;

      card.setLoading(action);
      chrome.runtime.sendMessage(
        {
          action,
          text: this._selectedText,
          targetModelId: this._selectedModelId,
        },
        (response) => {
          if (!this.isOpen) return;
          if (chrome.runtime.lastError) {
            card.setError(action, '无法连接扩展后台，请在 chrome://extensions 页面重新加载扩展。');
          } else if (response?.success) {
            card.setResult(action, response.result);
          } else if (response?.notConfigured) {
            // 未配置时显示引导性提示，非红色报错
            card.setError(action, response.error || '请先在设置页配置 API Key 和模型 ID 喵~');
          } else {
            card.setError(action, response?.error ?? '请求失败，请稍后重试。');
          }
        }
      );
    }

    _updateText(text) {
      this._selectedText = text;
      if (this._preview) this._preview.textContent = `"${this._truncate(text)}"`;
      Object.values(this._cards).forEach((c) => c.reset());
      const pref = this._config.get('preferredAction');
      if (pref && pref !== 'none') {
        this._fetchAll();
      }
    }

    _clamp(x, y, w = 360, h = 420) {
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const sx = window.scrollX, sy = window.scrollY;
      let left = x, top = y + 8;
      if (left + w > sx + vw - 8) left = sx + vw - w - 8;
      if (left < sx + 8) left = sx + 8;
      if (top + h > sy + vh - 8) top = y - h - 8;
      if (top < sy + 8) top = sy + 8;
      return { left, top };
    }

    _truncate(text, len = 38) {
      return text.length > len ? `${text.slice(0, len)}…` : text;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PanelManager — 面板实例管理器（单例）
  //  职责：
  //    1. 管理所有面板实例的生命周期
  //    2. 保证 screen-pinned 模式全局单例
  //    3. 提供路由查询接口：getScreenPinnedPanel()
  // ═══════════════════════════════════════════════════════════════════════════

  class PanelManager {
    constructor(config) {
      this._config = config;
      this._panels = new Map();
      this._activePanel = null;
      this._screenPinnedPanelId = null;
      this._pagePinnedPanelIds = new Set();
    }

    get activePanel() {
      return this._activePanel;
    }

    get screenPinnedPanel() {
      if (!this._screenPinnedPanelId) return null;
      return this._panels.get(this._screenPinnedPanelId) || null;
    }

    get pagePinnedPanels() {
      return Array.from(this._pagePinnedPanelIds)
        .map(id => this._panels.get(id))
        .filter(Boolean);
    }

    get allPanels() {
      return Array.from(this._panels.values());
    }

    hasScreenPinnedPanel() {
      return !!this.screenPinnedPanel;
    }

    createPanel(text, position, mode = 'unpinned') {
      if (mode === 'screen-pinned' && this.hasScreenPinnedPanel()) {
        console.warn('[PanelManager] screen-pinned 已存在，拒绝创建新实例');
        return this.screenPinnedPanel;
      }

      if (mode === 'unpinned' && this._activePanel) {
        this._activePanel.close();
      }

      const panel = new PanelInstance(this, this._config);
      panel._selectedText = text;
      this._panels.set(panel.id, panel);

      if (mode === 'unpinned') {
        this._activePanel = panel;
      } else if (mode === 'screen-pinned') {
        this._screenPinnedPanelId = panel.id;
      } else if (mode === 'page-pinned') {
        this._pagePinnedPanelIds.add(panel.id);
      }

      panel.open(text, position);
      return panel;
    }

    routeToScreenPinned(text) {
      const panel = this.screenPinnedPanel;
      if (!panel) return null;
      panel.updateContent(text);
      return panel;
    }

    onPanelPinned(panelId, mode) {
      const panel = this._panels.get(panelId);
      if (!panel) return;

      if (this._activePanel?.id === panelId) {
        this._activePanel = null;
      }

      if (mode === 'screen-pinned') {
        if (this._screenPinnedPanelId && this._screenPinnedPanelId !== panelId) {
          const oldPanel = this._panels.get(this._screenPinnedPanelId);
          if (oldPanel) {
            oldPanel._setPinMode('unpinned');
          }
        }
        this._screenPinnedPanelId = panelId;
      } else if (mode === 'page-pinned') {
        this._pagePinnedPanelIds.add(panelId);
      }
    }

    onPanelUnpinned(panelId) {
      const panel = this._panels.get(panelId);
      if (!panel) return;

      if (this._screenPinnedPanelId === panelId) {
        this._screenPinnedPanelId = null;
      }
      this._pagePinnedPanelIds.delete(panelId);

      if (!this._activePanel) {
        this._activePanel = panel;
      } else {
        panel.close();
      }

      panel.pinMode = 'unpinned';
    }

    onPinModeChanged(panelId, oldMode, newMode) {
      if (oldMode === 'screen-pinned') {
        this._screenPinnedPanelId = null;
      }
      if (newMode === 'screen-pinned') {
        if (this._screenPinnedPanelId && this._screenPinnedPanelId !== panelId) {
          const oldPanel = this._panels.get(this._screenPinnedPanelId);
          if (oldPanel) {
            oldPanel._setPinMode('unpinned');
          }
        }
        this._screenPinnedPanelId = panelId;
      }

      if (oldMode === 'page-pinned') {
        this._pagePinnedPanelIds.delete(panelId);
      }
      if (newMode === 'page-pinned') {
        this._pagePinnedPanelIds.add(panelId);
      }
    }

    onPanelClosed(panelId) {
      const panel = this._panels.get(panelId);
      if (!panel) return;

      this._panels.delete(panelId);

      if (this._screenPinnedPanelId === panelId) {
        this._screenPinnedPanelId = null;
      }
      this._pagePinnedPanelIds.delete(panelId);

      if (this._activePanel?.id === panelId) {
        this._activePanel = null;
      }
    }

    contains(element) {
      if (!element) return false;
      for (const panel of this._panels.values()) {
        if (panel.el && panel.el.contains(element)) {
          return true;
        }
      }
      return false;
    }

    closeAll() {
      for (const panel of this._panels.values()) {
        panel.close();
      }
    }

    closeUnpinned() {
      for (const panel of this._panels.values()) {
        if (panel.pinMode === 'unpinned') {
          panel.close();
        }
      }
    }

    refreshModelSelectsFromConfig() {
      for (const panel of this._panels.values()) {
        panel._refreshModelSelect?.();
      }
    }

    refreshAppearanceFromConfig() {
      const a = NyaAppearance.mergeAppearance({ appearance: this._config.get('appearance') });
      for (const panel of this._panels.values()) {
        if (panel.el) {
          NyaAppearance.applyToContentRoot(panel.el, a);
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SelectionManager — 全局事件监听、拦截器、触发器
  // ═══════════════════════════════════════════════════════════════════════════

  class SelectionManager {
    constructor(app) {
      this._app = app;
      this._downOnIcon = false;
      this._downOnPanel = false;
      this._isDblClick = false;
      this._dblTimer = null;
      this._hoverTimer = null;
      this._spaObserver = null;

      this._onDown = this._onDown.bind(this);
      this._onUp = this._onUp.bind(this);
      this._onClick = this._onClick.bind(this);
      this._onDbl = this._onDbl.bind(this);
      this._onKey = this._onKey.bind(this);
      this._onScroll = this._onScroll.bind(this);
      this._onMove = this._onMove.bind(this);

      this._setup();
      this._setupSpaWatcher();
    }

    _setup() {
      // 捕获阶段注册，确保在目标页脚本调用 stopPropagation 前拿到事件
      document.addEventListener('mousedown', this._onDown,  true);
      document.addEventListener('mouseup',   this._onUp,    true);
      document.addEventListener('click',     this._onClick, true);
      document.addEventListener('dblclick',  this._onDbl,   true);
      document.addEventListener('keydown',   this._onKey,   true);
      document.addEventListener('mousemove', this._onMove, { passive: true });
      window.addEventListener('scroll', this._onScroll, { passive: true });
    }

    _teardown() {
      document.removeEventListener('mousedown', this._onDown,  true);
      document.removeEventListener('mouseup',   this._onUp,    true);
      document.removeEventListener('click',     this._onClick, true);
      document.removeEventListener('dblclick',  this._onDbl,   true);
      document.removeEventListener('keydown',   this._onKey,   true);
      document.removeEventListener('mousemove', this._onMove);
      window.removeEventListener('scroll',      this._onScroll);
    }

    // SPA 路由存活：popstate（History API）+ MutationObserver（Turbo/Pjax 替换 body）
    _setupSpaWatcher() {
      window.addEventListener('popstate', () => this._reattach());

      // subtree:false 只看 body 直接子节点批量替换，避免过度触发
      this._spaObserver = new MutationObserver(() => this._reattach());
      this._spaObserver.observe(document.body, { childList: true, subtree: false });
    }

    _reattach() {
      this._teardown();
      this._setup();
    }

    // 取词：优先标准 API，穿透 Shadow DOM 兜底
    _getSelectionText() {
      const std = window.getSelection()?.toString().trim();
      if (std) return std;

      // 递归穿透持有焦点的 Shadow Root
      let root = document.activeElement?.shadowRoot;
      while (root) {
        const inner = root.getSelection?.()?.toString().trim();
        if (inner) return inner;
        root = root.activeElement?.shadowRoot ?? null;
      }
      return '';
    }

    _onDown(e) {
      this._downOnIcon = this._app.icon.contains(e.target);
      this._downOnPanel = this._app.panels.contains(e.target);
    }

    _onUp(e) {
      if (e.target.closest('.my-ext-panel')) return;
      if (this._downOnIcon) return;

      const capturedE = {
        pageX: e.pageX, pageY: e.pageY,
        ctrlKey: e.ctrlKey, altKey: e.altKey,
        shiftKey: e.shiftKey, metaKey: e.metaKey,
        target: e.target,
      };

      setTimeout(() => {
        const sel  = window.getSelection();
        const text = this._getSelectionText();

        if (text.length < 1 || text.length > 500) {
          if (!this._app.panels.activePanel?.isOpen) this._app.icon.hide();
          return;
        }

        if (this._app.config.get('disableInInputs')) {
          const anchor = sel?.anchorNode?.parentElement;
          const target = capturedE.target;
          if (InputBoxDetector.isInside(anchor) || InputBoxDetector.isInside(target)) return;
        }

        const langCfg = this._app.config.get('languages');
        const strict = this._app.config.get('strictLanguageMatch');
        if (!LanguageDetector.matches(text, langCfg, strict)) return;

        this._app.selectedText = text;

        let scenario;
        if (this._downOnPanel) {
          scenario = 'insidePanel';
        } else if (this._app.panels.pagePinnedPanels.length > 0 || this._app.panels.hasScreenPinnedPanel()) {
          scenario = 'pinned';
        } else {
          scenario = 'normal';
        }

        const action = this._app.trigger.evaluate(scenario, capturedE, this._isDblClick);

        if (action === 'direct') {
          this._app.icon.hide();

          if (this._app.panels.hasScreenPinnedPanel()) {
            this._app.panels.routeToScreenPinned(text);
          } else {
            const activePanel = this._app.panels.activePanel;
            if (activePanel?.isOpen) {
              activePanel._updateText(text);
            } else {
              this._app.panels.createPanel(text, { x: capturedE.pageX, y: capturedE.pageY }, 'unpinned');
            }
          }
        } else if (action === 'icon') {
          if (!this._app.panels.activePanel?.isOpen) {
            this._app.icon.show(capturedE.pageX, capturedE.pageY);
          }
        }
      }, 10);
    }

    _onClick(e) {
      if (this._app.panels.contains(e.target)) return;
      this._app.panels.closeUnpinned();
      if (!this._app.icon.contains(e.target)) {
        this._app.icon.hide();
      }
    }

    _onDbl() {
      this._isDblClick = true;
      clearTimeout(this._dblTimer);
      this._dblTimer = setTimeout(() => { this._isDblClick = false; }, 400);
    }

    _onKey(e) {
      if (e.key === 'Escape') {
        this._app.icon.hide();
        this._app.panels.closeUnpinned();
      }
    }

    _onScroll() {
      this._app.icon.hide();
      this._app.panels.closeUnpinned();
    }

    _onMove(e) {
      if (!this._app.config.get('triggerRules.normal.hoverSelect')) return;
      if (this._app.panels.activePanel?.isOpen) return;

      clearTimeout(this._hoverTimer);
      this._hoverTimer = setTimeout(() => {
        const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
        if (!range) return;

        range.expand?.('word');
        const word = range.toString().trim();
        if (word.length < 1 || word.length > 100) return;

        if (this._app.config.get('disableInInputs')) {
          if (InputBoxDetector.isInside(range.startContainer?.parentElement)) return;
        }

        this._app.selectedText = word;
        this._app.icon.show(e.pageX, e.pageY);
      }, 600);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  VisionResultPanel — 视觉翻译结果悬浮面板
  //  职责：接收 background 返回的视觉识别+翻译结果，在指定位置展示
  //  与普通 PanelInstance 独立，不参与 PanelManager 生命周期
  // ═══════════════════════════════════════════════════════════════════════════

  class VisionResultPanel {
    constructor(getConfigData) {
      this._el   = null;
      this._drag = null;
      /** @type {() => Record<string, unknown>} */
      this._getConfigData = getConfigData || null;
    }

    _applyAppearance(el) {
      if (!el || typeof this._getConfigData !== 'function') return;
      NyaAppearance.applyToContentRoot(
        el,
        NyaAppearance.mergeAppearance({ appearance: this._getConfigData().appearance })
      );
    }

    /** 展示加载中状态（固定在右上角） */
    showLoading() {
      this._close();
      const panel = this._createBase();
      panel.style.cssText += ';position:fixed;right:24px;top:80px;width:220px;';

      const loader = document.createElement('div');
      loader.className = `${NS}-loading`;

      const spinner = document.createElement('div');
      spinner.className = `${NS}-spinner`;

      const txt = document.createElement('span');
      txt.className   = `${NS}-loading-text`;
      txt.textContent = '视觉识别中…';

      loader.appendChild(spinner);
      loader.appendChild(txt);
      panel.appendChild(loader);
      this._applyAppearance(panel);
      this._mount(panel, null);
    }

    /** 展示识别+翻译结果 */
    show(result, modelLabel, pos) {
      this._close();
      const panel = this._createBase();

      // ── 头部 ──
      const header = document.createElement('div');
      header.className = `${NS}-panel-header`;

      const logo = document.createElement('div');
      logo.className = `${NS}-panel-logo`;
      logo.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

      const title = document.createElement('span');
      title.className   = `${NS}-panel-title`;
      title.textContent = '视觉翻译';

      const badge = document.createElement('span');
      badge.className = `${NS}-vision-badge`;
      badge.textContent = modelLabel || '视觉模型';

      const spacer = document.createElement('div');
      spacer.className = `${NS}-panel-spacer`;

      const closeBtn = document.createElement('button');
      closeBtn.className = `${NS}-header-btn`;
      closeBtn.title     = '关闭';
      closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
      closeBtn.addEventListener('click', () => this._close());

      header.appendChild(logo);
      header.appendChild(title);
      header.appendChild(badge);
      header.appendChild(spacer);
      header.appendChild(closeBtn);

      // ── 结果内容区 ──
      const body = document.createElement('div');
      body.style.cssText = 'padding:12px 14px;overflow-y:auto;max-height:380px;';

      const resultBody = document.createElement('div');
      resultBody.className   = `${NS}-result-body`;
      resultBody.style.cssText = 'white-space:pre-wrap;font-size:13px;line-height:1.75;';
      resultBody.textContent   = result;

      const footer = document.createElement('div');
      footer.className   = `${NS}-result-footer`;
      footer.style.cssText = 'padding:6px 0 4px;';

      const copyBtn = document.createElement('button');
      copyBtn.className   = `${NS}-btn ${NS}-btn--ghost`;
      copyBtn.textContent = '📋 复制';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(result).then(() => {
          copyBtn.textContent = '✅ 已复制';
          setTimeout(() => { copyBtn.textContent = '📋 复制'; }, 1500);
        }).catch(() => {
          copyBtn.textContent = '❌ 失败';
          setTimeout(() => { copyBtn.textContent = '📋 复制'; }, 1500);
        });
      });

      footer.appendChild(copyBtn);
      body.appendChild(resultBody);
      body.appendChild(footer);

      panel.appendChild(header);
      panel.appendChild(body);
      this._applyAppearance(panel);
      this._mount(panel, pos);

      // 添加可拖拽支持
      this._drag = new DragController(panel, header, () => {});
    }

    /** 展示错误信息（5 秒后自动关闭） */
    showError(msg) {
      if (this._el) {
        const errDiv = document.createElement('div');
        errDiv.className   = `${NS}-error`;
        errDiv.style.cssText = 'padding:12px 14px;font-size:13px;';
        errDiv.textContent   = `⚠️ ${msg}`;

        this._el.innerHTML = '';
        this._el.appendChild(errDiv);
        requestAnimationFrame(() => this._el?.classList.add(`${NS}-panel--visible`));

        setTimeout(() => this._close(), 5000);
      }
    }

    _createBase() {
      const panel = document.createElement('div');
      panel.className = `${NS}-panel`;
      return panel;
    }

    _mount(panel, pos) {
      // 定位（fixed 模式，不随页面滚动）
      panel.style.position = 'fixed';

      if (pos) {
        const vw = document.documentElement.clientWidth;
        const vh = window.innerHeight;
        const pw = 360, ph = 300;
        // pos 是页面坐标（pageX/pageY），转换为视口坐标
        let left = pos.x - window.scrollX + 12;
        let top  = pos.y - window.scrollY + 8;

        if (left + pw > vw - 8)  left = vw - pw - 8;
        if (left < 8)            left = 8;
        if (top  + ph > vh - 8)  top  = (pos.y - window.scrollY) - ph - 8;
        if (top  < 8)            top  = 8;

        panel.style.left = `${left}px`;
        panel.style.top  = `${top}px`;
      } else {
        panel.style.right = '24px';
        panel.style.top   = '80px';
      }

      document.body.appendChild(panel);
      requestAnimationFrame(() => panel?.classList.add(`${NS}-panel--visible`));
      this._el = panel;
    }

    _close() {
      if (!this._el) return;
      const el = this._el;
      this._el = null;
      this._drag?.destroy();
      this._drag = null;

      el.classList.remove(`${NS}-panel--visible`);
      const t = setTimeout(() => el.remove(), 220);
      el.addEventListener('transitionend', () => { clearTimeout(t); el.remove(); }, { once: true });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ScreenshotOverlay — 全屏截图框选遮罩
  //  流程：
  //    1. 接收 background 传来的当前视口截图（dataURL）
  //    2. 在全屏 Canvas 上绘制半透明灰色遮罩
  //    3. 用户拖拽绘制选区（白色描边矩形 + 镂空）
  //    4. 松鼠标时用 OffscreenCanvas 裁剪图像 → Base64
  //    5. sendMessage → background（nya-vision-crop）→ 视觉 API
  //    6. 销毁自身
  // ═══════════════════════════════════════════════════════════════════════════

  class ScreenshotOverlay {
    constructor(screenshotDataUrl) {
      this._dataUrl    = screenshotDataUrl;
      this._canvas     = null;
      this._ctx        = null;
      this._img        = null;
      this._dragging   = false;
      this._startX     = 0;
      this._startY     = 0;
      this._endX       = 0;
      this._endY       = 0;

      this._onDown = this._onDown.bind(this);
      this._onMove = this._onMove.bind(this);
      this._onUp   = this._onUp.bind(this);
      this._onKey  = this._onKey.bind(this);
    }

    mount() {
      const dpr = window.devicePixelRatio || 1;
      this._dpr = dpr;

      const canvas  = document.createElement('canvas');
      // 物理像素尺寸，对齐 captureVisibleTab 截图的位图分辨率
      canvas.width  = Math.round(window.innerWidth  * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      canvas.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:2147483647',
        'cursor:crosshair',
        'display:block',
        `width:${window.innerWidth}px`,
        `height:${window.innerHeight}px`,
      ].join(';');

      this._canvas = canvas;
      this._ctx    = canvas.getContext('2d');

      // 预加载截图图像，加载完成后挂载 Canvas 并绑定事件
      const img  = new Image();
      img.onload = () => {
        this._img = img;
        this._draw(null);

        document.body.appendChild(canvas);

        canvas.addEventListener('mousedown', this._onDown);
        canvas.addEventListener('mousemove', this._onMove);
        canvas.addEventListener('mouseup',   this._onUp);
        document.addEventListener('keydown', this._onKey);
      };
      img.src = this._dataUrl;
    }

    /** 绘制遮罩；selRect 不为 null 时额外绘制选区矩形 */
    _draw(selRect) {
      const { width: cw, height: ch } = this._canvas;
      const ctx = this._ctx;

      // 先把截图画作背景
      ctx.drawImage(this._img, 0, 0, cw, ch);

      // 半透明灰色全屏遮罩
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      ctx.fillRect(0, 0, cw, ch);

      if (selRect && selRect.width > 0 && selRect.height > 0) {
        const { x, y, width: sw, height: sh } = selRect;

        // 镂空选区——重绘原图对应区域，营造清晰窗口感
        ctx.drawImage(this._img, x, y, sw, sh, x, y, sw, sh);

        // 白色描边
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.lineWidth   = 1.5;
        ctx.strokeRect(x + 0.5, y + 0.5, sw - 1, sh - 1);

        // 四角白色小圆点
        const corners = [[x, y], [x + sw, y], [x, y + sh], [x + sw, y + sh]];
        ctx.fillStyle = '#ffffff';
        corners.forEach(([cx, cy]) => {
          ctx.beginPath();
          ctx.arc(cx, cy, 4, 0, Math.PI * 2);
          ctx.fill();
        });

        // 选区尺寸标注（转回 CSS 像素显示，对用户友好）
        const dpr = this._dpr || 1;
        const sizeLabel = `${Math.round(sw / dpr)} × ${Math.round(sh / dpr)}`;
        ctx.font      = 'bold 11px -apple-system,sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        const labelY  = y > 20 ? y - 6 : y + sh + 14;
        ctx.fillText(sizeLabel, x + 4, labelY);
      }

      // 顶部操作提示
      ctx.font      = '12px -apple-system,sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.fillText('拖拽鼠标框选区域    按 Esc 取消', 12, 20);
    }

    _onDown(e) {
      this._dragging = true;
      this._startX   = e.clientX * this._dpr;
      this._startY   = e.clientY * this._dpr;
      this._endX     = this._startX;
      this._endY     = this._startY;
    }

    _onMove(e) {
      if (!this._dragging) return;
      this._endX = e.clientX * this._dpr;
      this._endY = e.clientY * this._dpr;
      this._draw(this._selRect());
    }

    _onUp(e) {
      if (!this._dragging) return;
      this._dragging = false;
      this._endX     = e.clientX * this._dpr;
      this._endY     = e.clientY * this._dpr;

      const rect = this._selRect();
      this._destroy();

      // 太小的框选忽略
      if (rect.width < 10 || rect.height < 10) return;

      this._cropAndSend(rect);
    }

    _onKey(e) {
      if (e.key === 'Escape') this._destroy();
    }

    _selRect() {
      return {
        x:      Math.min(this._startX, this._endX),
        y:      Math.min(this._startY, this._endY),
        width:  Math.abs(this._endX - this._startX),
        height: Math.abs(this._endY - this._startY),
      };
    }

    /**
     * 用 OffscreenCanvas 从截图中裁剪选区，转 Base64 后发给 background
     * DPR（Device Pixel Ratio）补偿以保证高分屏裁剪精度
     */
    _cropAndSend(rect) {
      // rect 坐标已是物理像素（经 _onDown/Move/Up 乘以 _dpr），直接使用
      const cropW = Math.round(rect.width);
      const cropH = Math.round(rect.height);

      const offscreen = new OffscreenCanvas(cropW, cropH);
      const octx      = offscreen.getContext('2d');

      octx.drawImage(
        this._img,
        rect.x, rect.y, cropW, cropH,
        0, 0, cropW, cropH
      );

      offscreen.convertToBlob({ type: 'image/png' }).then((blob) => {
        const reader  = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result;            // "data:image/png;base64,..."
          const base64  = dataUrl.split(',')[1];

          const dpr = this._dpr || 1;
          // 将物理像素坐标转回 CSS 像素页面坐标（用于定位结果面板）
          chrome.runtime.sendMessage({
            action:   'nya-vision-crop',
            base64,
            mimeType: 'image/png',
            x: Math.round(rect.x / dpr + rect.width  / dpr / 2 + window.scrollX),
            y: Math.round(rect.y / dpr + rect.height / dpr / 2 + window.scrollY),
          });
        };
        reader.readAsDataURL(blob);
      });
    }

    _destroy() {
      this._canvas?.removeEventListener('mousedown', this._onDown);
      this._canvas?.removeEventListener('mousemove', this._onMove);
      this._canvas?.removeEventListener('mouseup',   this._onUp);
      document.removeEventListener('keydown', this._onKey);
      this._canvas?.remove();
      this._canvas = null;
      this._ctx    = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ExtensionApp — 根节点，组合所有模块
  // ═══════════════════════════════════════════════════════════════════════════

  class ExtensionApp {
    constructor() {
      this.selectedText = '';
      this.config   = new ConfigManager();
      this.icon     = new FloatingIcon();
      this.panels   = new PanelManager(this.config);
      this.vision   = new VisionResultPanel(() => this.config.data);   // 视觉结果面板（单例）
      this.trigger  = null;
      this.selection = null;

      Object.defineProperty(this, 'panel', {
        get() { return this.panels.activePanel; },
      });

      this.icon.onOpen = (pos) => {
        this.panels.createPanel(this.selectedText, pos, 'unpinned');
      };
    }

    _applyAppearanceToContentRoots() {
      const a = NyaAppearance.mergeAppearance({ appearance: this.config.get('appearance') });
      if (this.icon.el) {
        NyaAppearance.applyToContentRoot(this.icon.el, a);
      }
      this.panels.refreshAppearanceFromConfig();
    }

    async init() {
      await this.config.load();
      this.icon._getConfigData = () => this.config.data;
      this.trigger   = new TriggerEngine(this.config);
      this.selection = new SelectionManager(this);
      this._setupMessageListener();

      this._onAppearanceMedia = () => {
        const mode = NyaAppearance.mergeAppearance({ appearance: this.config.get('appearance') }).themeMode;
        if (mode === 'system') this._applyAppearanceToContentRoots();
      };
      this._appearanceMq = window.matchMedia('(prefers-color-scheme: dark)');
      this._appearanceMq.addEventListener('change', this._onAppearanceMedia);

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.models) {
          this.config.load().then(() => {
            this.panels.refreshModelSelectsFromConfig();
          });
        }
        if (changes.appearance) {
          this.config.load().then(() => {
            this._applyAppearanceToContentRoots();
          });
        }
      });
      console.debug('[NyaTranslate v3.2] 初始化完成 — models 列表 + 面板模型选择。');
    }

    /**
     * 监听来自 background 的消息（视觉翻译结果、截图推送）
     *
     * v3.1 变化：截图现在由 background 主动 push（nya-screenshot-start），
     * 不再由 content.js 发起拉取（nya-start-screenshot），消除 popup 关闭时序问题。
     */
    _setupMessageListener() {
      chrome.runtime.onMessage.addListener((message) => {
        const { action } = message;

        // background 通知：正在识别图片（右键菜单触发）
        if (action === 'nya-vision-loading') {
          this.vision.showLoading();
          return;
        }

        // background 通知：视觉翻译结果已就绪
        if (action === 'nya-vision-result') {
          const pos = (message.x != null && message.y != null)
            ? { x: message.x, y: message.y }
            : null;
          this.vision.show(message.result, message.label || message.model, pos);
          return;
        }

        // background 通知：视觉翻译失败
        if (action === 'nya-vision-error') {
          this.vision.showError(message.error || '视觉翻译失败，请重试。');
          return;
        }

        // background push：截图数据已就绪，直接挂载 ScreenshotOverlay
        // 触发来源：Alt+Shift+S 快捷键 或 右键「区域截图翻译」
        if (action === 'nya-screenshot-start') {
          if (message.dataUrl) {
            new ScreenshotOverlay(message.dataUrl).mount();
          }
          return;
        }
      });
    }
  }

  // ── 启动 ──────────────────────────────────────────────────────────────────
  const app = new ExtensionApp();
  app.init();

})();
