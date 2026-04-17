/**
 * Content Script — 划词助手 v3.1
 *
 * 架构总览（ES6 Class 模块化）：
 *
 *   ConfigManager     — 全量读取 storage，深度合并默认值
 *   LanguageDetector  — 7 种语种正则检测
 *   InputBoxDetector  — 精准输入框/编辑器检测（含 contentEditable 递归）
 *   TriggerEngine     — 根据场景+事件返回 'icon'|'direct'|'off'
 *   DragController    — 支持 position:absolute 和 position:fixed 的拖拽
 *   AccordionCard     — 折叠卡片，DeepSeek=combined 双效，Qwen=单效可切换
 *   PinDropdown       — 固定模式选择下拉（吸附页面 / 吸附屏幕）
 *   PanelInstance     — 单个面板实例（包含 Pin 逻辑、独立关闭）
 *   PanelRegistry     — 多开管理：维护 pinned[] + 唯一 active
 *   FloatingIcon      — 悬浮小气泡图标（单例）
 *   SelectionManager  — 全局事件总线（含拖拽距离防误触）
 *   ExtensionApp      — 根节点，组合所有模块
 *
 * 核心修复：
 *   - mouseup 拦截：drag distance < 4px + downOnAnyPanel 双重守卫
 *   - InputBoxDetector：递归向上检测 contenteditable
 *   - 直接搜索：action==='direct' 时绝不显示小图标
 *   - DeepSeek combined：单次请求返回翻译+解释的 markdown 结构
 *   - 多开架构：pinned 面板不随新划词关闭
 */

(function () {
  'use strict';

  if (window.__nyaSelectionHelperV3__) return;
  window.__nyaSelectionHelperV3__ = true;

  const NS = 'my-ext';

  // ─── SVG 图标常量 ─────────────────────────────────────────────────────────

  const SVG_PIN     = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/></svg>`;
  const SVG_CLOSE   = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  const SVG_CHAT    = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  const SVG_CHEVRON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

  // ─── 默认配置 ─────────────────────────────────────────────────────────────

  const DEFAULT_CONFIG = {
    disableInInputs:     true,
    touchMode:           false,
    languages: { zh: true, en: true, ja: false, ko: false, fr: false, es: false, de: false },
    strictLanguageMatch: false,
    triggerRules: {
      normal:      { showIcon: true,  directSearch: false, dblclickSearch: false, modifiers: [], hoverSelect: false },
      pinned:      { showIcon: false, directSearch: true,  dblclickSearch: false, modifiers: [], hoverSelect: false },
      insidePanel: { showIcon: false, directSearch: true,  dblclickSearch: false, modifiers: [], hoverSelect: false },
      standalone:  { showIcon: false, directSearch: true,  dblclickSearch: false, modifiers: [], hoverSelect: false },
    },
    preferredAction: 'translate',
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  ConfigManager
  // ═══════════════════════════════════════════════════════════════════════════

  class ConfigManager {
    constructor() { this.data = JSON.parse(JSON.stringify(DEFAULT_CONFIG)); }

    load() {
      return new Promise((resolve) => {
        chrome.storage.local.get(null, (stored) => {
          this.data = this._deepMerge(DEFAULT_CONFIG, stored || {});
          resolve(this.data);
        });
      });
    }

    get(path) { return path.split('.').reduce((o, k) => o?.[k], this.data); }

    _deepMerge(def, over) {
      const out = { ...def };
      for (const k of Object.keys(over)) {
        if (k in def && def[k] !== null && typeof def[k] === 'object' && !Array.isArray(def[k])) {
          out[k] = this._deepMerge(def[k], over[k] ?? {});
        } else {
          out[k] = over[k];
        }
      }
      return out;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  LanguageDetector
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
      return Object.entries(this.PATTERNS).filter(([, re]) => re.test(text)).map(([l]) => l);
    }

    static matches(text, langConfig, strict) {
      const enabled = Object.keys(langConfig).filter((k) => langConfig[k]);
      if (!enabled.length) return true;
      const detected = this.detect(text);
      if (!detected.length) return true;
      return strict
        ? detected.every((l) => enabled.includes(l))
        : detected.some((l) => enabled.includes(l));
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  InputBoxDetector — 递归检测 contenteditable 及常见编辑器
  // ═══════════════════════════════════════════════════════════════════════════

  class InputBoxDetector {
    static EDITOR_CLASSES = [
      'CodeMirror', 'ace_editor', 'monaco-editor',
      'cm-editor', 'ProseMirror', 'ql-editor', 'tox-edit-area',
    ];

    static isInside(element) {
      if (!element) return false;
      const tag = element.tagName?.toLowerCase();
      // 直接 input/textarea/select
      if (['input', 'textarea', 'select'].includes(tag)) return true;
      // isContentEditable 会向上继承，一次性搞定
      if (element.isContentEditable) return true;

      // 递归向上检查：
      //   1. contenteditable 属性（兼容 isContentEditable 未返回 true 的边缘情况）
      //   2. 常见代码编辑器的 CSS 类名
      let el = element;
      while (el && el !== document.documentElement) {
        if (el.getAttribute?.('contenteditable') === 'true') return true;
        if (el.getAttribute?.('contenteditable') === '') return true; // <div contenteditable>
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
  //  TriggerEngine
  // ═══════════════════════════════════════════════════════════════════════════

  class TriggerEngine {
    constructor(config) { this.config = config; }

    /** @returns {'icon'|'direct'|'off'} */
    evaluate(scenario, event, isDblClick = false) {
      const rules = this.config.get(`triggerRules.${scenario}`);
      if (!rules) return 'off';
      if (isDblClick && rules.dblclickSearch) return 'direct';
      if (rules.modifiers?.length) {
        const hit = rules.modifiers.some((m) => {
          if (m === 'ctrl')  return event.ctrlKey;
          if (m === 'alt')   return event.altKey;
          if (m === 'shift') return event.shiftKey;
          if (m === 'meta')  return event.metaKey;
          return false;
        });
        if (hit) return 'direct';
      }
      if (rules.directSearch) return 'direct';
      if (rules.showIcon)     return 'icon';
      return 'off';
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  DragController — 同时支持 position:absolute 和 position:fixed
  // ═══════════════════════════════════════════════════════════════════════════

  class DragController {
    constructor(panelEl, handleEl) {
      this._panel  = panelEl;
      this._handle = handleEl;
      this._active = false;
      this._ox = 0; this._oy = 0;
      this._pl = 0; this._pt = 0;

      this._down = this._down.bind(this);
      this._move = this._move.bind(this);
      this._up   = this._up.bind(this);

      handleEl.addEventListener('mousedown', this._down);
      handleEl.style.cursor = 'grab';
    }

    _down(e) {
      if (e.button !== 0) return;
      if (e.target.closest('button')) return;
      e.preventDefault();
      e.stopPropagation();

      this._active = true;
      this._ox = e.clientX;
      this._oy = e.clientY;

      // 根据当前 position 模式读取起始坐标
      const isFixed = getComputedStyle(this._panel).position === 'fixed';
      if (isFixed) {
        const rect = this._panel.getBoundingClientRect();
        this._pl = rect.left;
        this._pt = rect.top;
      } else {
        this._pl = parseInt(this._panel.style.left, 10) || 0;
        this._pt = parseInt(this._panel.style.top,  10) || 0;
      }

      document.addEventListener('mousemove', this._move);
      document.addEventListener('mouseup',   this._up);
      this._handle.style.cursor    = 'grabbing';
      this._panel.style.transition = 'none';
    }

    _move(e) {
      if (!this._active) return;
      const dx  = e.clientX - this._ox;
      const dy  = e.clientY - this._oy;
      const pw  = this._panel.offsetWidth;
      const ph  = this._panel.offsetHeight;
      const isFixed = getComputedStyle(this._panel).position === 'fixed';

      let left, top;
      if (isFixed) {
        const vw = window.innerWidth, vh = window.innerHeight;
        left = Math.max(8, Math.min(this._pl + dx, vw - pw - 8));
        top  = Math.max(8, Math.min(this._pt + dy, vh - ph - 8));
      } else {
        const sx = window.scrollX, sy = window.scrollY;
        const vw = window.innerWidth, vh = window.innerHeight;
        left = Math.max(sx + 8, Math.min(this._pl + dx, sx + vw - pw - 8));
        top  = Math.max(sy + 8, Math.min(this._pt + dy, sy + vh - ph - 8));
      }

      this._panel.style.left = `${left}px`;
      this._panel.style.top  = `${top}px`;
    }

    _up() {
      if (!this._active) return;
      this._active = false;
      document.removeEventListener('mousemove', this._move);
      document.removeEventListener('mouseup',   this._up);
      this._handle.style.cursor    = 'grab';
      this._panel.style.transition = '';
    }

    destroy() {
      this._handle.removeEventListener('mousedown', this._down);
      document.removeEventListener('mousemove', this._move);
      document.removeEventListener('mouseup',   this._up);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  AccordionCard — DeepSeek combined 模式 / Qwen 单效可切换
  // ═══════════════════════════════════════════════════════════════════════════

  class AccordionCard {
    /**
     * @param {string}  modelId    'deepseek' | 'qwen'
     * @param {string}  label      显示名
     * @param {boolean} isCombined DeepSeek=true，直接发 combined 动作，无按钮
     */
    constructor(modelId, label, isCombined = false) {
      this.modelId    = modelId;
      this.label      = label;
      this.isCombined = isCombined;
      this.state      = { status: 'idle', action: null, content: '' };
      this.onFetch    = null; // (modelId, action) => void — 由 PanelInstance 注入

      this._open    = true;
      this._body    = null;
      this._dot     = null;
      this._chevron = null;
      this.el       = null;

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
      badge.className   = `${NS}-accordion-badge ${NS}-accordion-badge--${this.modelId}`;
      badge.textContent = this.label;

      this._dot = document.createElement('span');
      this._dot.className = `${NS}-accordion-dot`;

      titleWrap.appendChild(badge);
      titleWrap.appendChild(this._dot);

      this._chevron = document.createElement('span');
      this._chevron.className = `${NS}-accordion-chevron ${NS}-accordion-chevron--up`;
      this._chevron.innerHTML = SVG_CHEVRON;

      hdr.appendChild(titleWrap);
      hdr.appendChild(this._chevron);
      hdr.addEventListener('click', (e) => { e.stopPropagation(); this._toggle(); });

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

    setLoading(action) {
      this.state = { status: 'loading', action, content: '' };
      this._setDot('loading');
      this.forceOpen();
      this._renderBody();
    }

    setResult(action, content) {
      this.state = { status: 'result', action, content };
      this._setDot('success');
      this._renderBody();
    }

    setError(action, error) {
      this.state = { status: 'error', action, content: error };
      this._setDot('error');
      this._renderBody();
    }

    reset() {
      this.state = { status: 'idle', action: null, content: '' };
      this._setDot('');
      this._renderBody();
    }

    _setDot(v) {
      this._dot.className = `${NS}-accordion-dot${v ? ` ${NS}-accordion-dot--${v}` : ''}`;
    }

    // ── 状态机渲染 ────────────────────────────────────────────────────────────

    _renderBody() {
      this._body.innerHTML = '';
      const { status, action, content } = this.state;

      if (status === 'idle') {
        const hint = document.createElement('p');
        hint.className   = `${NS}-hint`;
        hint.textContent = this.isCombined
          ? '正在准备查询…'
          : `点击上方按钮，由 ${this.label} 为你解答`;
        this._body.appendChild(hint);

      } else if (status === 'loading') {
        const loader  = document.createElement('div');
        loader.className = `${NS}-loading`;

        const spinner = document.createElement('div');
        spinner.className = `${NS}-spinner`;

        const txt = document.createElement('span');
        txt.className   = `${NS}-loading-text`;
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
        this._body.appendChild(loader);

      } else if (status === 'result') {
        if (this.isCombined) {
          this._renderCombined(content);
        } else {
          this._renderSingle(action, content);
        }

      } else if (status === 'error') {
        const errEl = document.createElement('div');
        errEl.className   = `${NS}-error`;
        errEl.textContent = `⚠️ ${content}`;

        const retryAction = this.isCombined ? 'combined' : (action || 'translate');
        const btnRetry    = this._btn('🔄 重试', () => this.onFetch?.(this.modelId, retryAction), true);
        btnRetry.style.cssText = 'margin-top:8px; display:inline-flex;';

        this._body.appendChild(errEl);
        this._body.appendChild(btnRetry);
      }
    }

    // ── DeepSeek combined 模式渲染（解析 markdown ### 段落） ─────────────────

    _renderCombined(content) {
      const sections = this._parseMarkdownSections(content);
      const ICON_MAP  = { '翻译': '🌐', '术语解释': '📖', '解释': '📖' };

      if (Object.keys(sections).length === 0) {
        // 没有 ### 标题时降级为纯文本
        const body = document.createElement('div');
        body.className   = `${NS}-result-body`;
        body.textContent = content;
        this._body.appendChild(body);
      } else {
        Object.entries(sections).forEach(([title, text]) => {
          const section = document.createElement('div');
          section.className = `${NS}-combined-section`;

          const titleEl = document.createElement('div');
          titleEl.className   = `${NS}-combined-title`;
          titleEl.textContent = `${ICON_MAP[title] || '📝'} ${title}`;

          const bodyEl = document.createElement('div');
          bodyEl.className   = `${NS}-combined-body`;
          bodyEl.textContent = text;

          section.appendChild(titleEl);
          section.appendChild(bodyEl);
          this._body.appendChild(section);
        });
      }

      const footer = document.createElement('div');
      footer.className = `${NS}-result-footer`;
      footer.appendChild(this._copyBtn(content));
      this._body.appendChild(footer);
    }

    /** 解析 "### 标题\n内容" 的 markdown 结构 */
    _parseMarkdownSections(content) {
      const result = {};
      const re     = /^###\s*(.+)$/gm;
      let match, prevTitle = null, prevEnd = 0;

      while ((match = re.exec(content)) !== null) {
        if (prevTitle !== null) {
          result[prevTitle] = content.slice(prevEnd, match.index).trim();
        }
        prevTitle = match[1].trim();
        prevEnd   = re.lastIndex;
      }
      if (prevTitle !== null) {
        result[prevTitle] = content.slice(prevEnd).trim();
      }
      return result;
    }

    // ── Qwen 单效模式渲染 ─────────────────────────────────────────────────────

    _renderSingle(action, content) {
      const rHdr = document.createElement('div');
      rHdr.className   = `${NS}-result-header`;
      rHdr.textContent = action === 'translate' ? '🌐 翻译结果' : '📖 术语解释';

      const rBody = document.createElement('div');
      rBody.className   = `${NS}-result-body`;
      rBody.textContent = content;

      const rFoot  = document.createElement('div');
      rFoot.className = `${NS}-result-footer`;

      const otherAction = action === 'translate' ? 'explain' : 'translate';
      const otherLabel  = otherAction === 'translate' ? '🌐 翻译' : '📖 解释';

      rFoot.appendChild(this._btn(otherLabel, () => this.onFetch?.(this.modelId, otherAction), true));
      rFoot.appendChild(this._copyBtn(content));

      this._body.appendChild(rHdr);
      this._body.appendChild(rBody);
      this._body.appendChild(rFoot);
    }

    // ── 按钮工厂 ──────────────────────────────────────────────────────────────

    _btn(label, onClick, ghost = false) {
      const btn = document.createElement('button');
      btn.className = `${NS}-btn${ghost ? ` ${NS}-btn--ghost` : ''}`;
      btn.textContent = label;
      if (onClick) {
        btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
      }
      return btn;
    }

    _copyBtn(text) {
      const btn = this._btn('📋 复制', null, true);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text)
          .then(() => { btn.textContent = '✅ 已复制'; setTimeout(() => { btn.textContent = '📋 复制'; }, 1500); })
          .catch(() => { btn.textContent = '❌ 失败';  setTimeout(() => { btn.textContent = '📋 复制'; }, 1500); });
      });
      return btn;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PinDropdown — 固定模式选择下拉菜单
  // ═══════════════════════════════════════════════════════════════════════════

  class PinDropdown {
    /**
     * @param {HTMLElement} anchorEl  锚点元素（Pin 按钮）
     * @param {function}    onSelect  (mode: 'page'|'screen') => void
     */
    constructor(anchorEl, onSelect) {
      this._anchor   = anchorEl;
      this._onSelect = onSelect;
      this._el       = null;
      this._outside  = null;
    }

    toggle() {
      this._el ? this.close() : this.open();
    }

    open() {
      // 确保同时只有一个 PinDropdown 存在
      document.querySelector(`.${NS}-pin-dropdown`)?.remove();

      this._el = document.createElement('div');
      this._el.className = `${NS}-pin-dropdown`;

      const OPTIONS = [
        { mode: 'page',   icon: '📌', title: '固定在页面', desc: '随页面滚动，方便对照阅读' },
        { mode: 'screen', icon: '🖥️', title: '固定在屏幕', desc: '始终显示在屏幕固定位置' },
      ];

      OPTIONS.forEach(({ mode, icon, title, desc }) => {
        const btn = document.createElement('button');
        btn.className = `${NS}-pin-option`;
        btn.innerHTML = `
          <span class="${NS}-pin-option-icon">${icon}</span>
          <div>
            <div class="${NS}-pin-option-title">${title}</div>
            <div class="${NS}-pin-option-desc">${desc}</div>
          </div>`;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._onSelect(mode);
          this.close();
        });
        this._el.appendChild(btn);
      });

      // 定位：锚点按钮正下方，右对齐
      const rect = this._anchor.getBoundingClientRect();
      this._el.style.cssText = `
        position: fixed;
        top:   ${rect.bottom + 4}px;
        right: ${window.innerWidth - rect.right}px;
        z-index: 2147483647;
      `;

      document.body.appendChild(this._el);
      requestAnimationFrame(() => this._el?.classList.add(`${NS}-pin-dropdown--visible`));

      // 点击外部关闭
      this._outside = (e) => {
        if (!this._el?.contains(e.target) && e.target !== this._anchor) this.close();
      };
      setTimeout(() => document.addEventListener('click', this._outside), 0);
    }

    close() {
      document.removeEventListener('click', this._outside);
      this._el?.remove();
      this._el = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PanelInstance — 单个面板实例（含 Pin / 多开支持）
  // ═══════════════════════════════════════════════════════════════════════════

  class PanelInstance {
    constructor(registry, selectedText, pos) {
      this._registry    = registry;
      this._app         = registry.app;
      this.id           = `p-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      this.selectedText = selectedText;
      this.isPinned     = false;
      this.pinMode      = null;   // 'page' | 'screen'

      this._drag        = null;
      this._cards       = {};
      this._preview     = null;
      this._btnPin      = null;
      this._pinDropdown = null;

      this.el = this._build(selectedText, pos);
    }

    /** 挂载到 DOM 并执行入场动画 */
    mount() {
      document.body.appendChild(this.el);
      requestAnimationFrame(() => this.el?.classList.add(`${NS}-panel--visible`));
    }

    /** 关闭此面板 */
    close() {
      this._pinDropdown?.close();
      this._drag?.destroy();
      this.el?.remove();
      this._registry._remove(this.id);
    }

    /** 切换至指定 Pin 模式 */
    _doPinWithMode(mode) {
      this.isPinned = true;
      this.pinMode  = mode;

      if (mode === 'screen') {
        const rect = this.el.getBoundingClientRect();
        this.el.style.position = 'fixed';
        this.el.style.left     = `${Math.round(rect.left)}px`;
        this.el.style.top      = `${Math.round(rect.top)}px`;
      }
      // 'page' 模式保持 position:absolute 不变

      this.el.dataset.pinMode = mode;
      this._btnPin.classList.add(`${NS}-header-btn--active`);
      this._btnPin.title = mode === 'screen'
        ? '已固定在屏幕（点击取消）'
        : '已固定在页面（点击取消）';

      this._registry._onPinned(this.id);
    }

    /** 取消固定 */
    _doUnpin() {
      if (!this.isPinned) return;

      if (this.pinMode === 'screen') {
        const rect = this.el.getBoundingClientRect();
        this.el.style.position = 'absolute';
        this.el.style.left     = `${Math.round(rect.left + window.scrollX)}px`;
        this.el.style.top      = `${Math.round(rect.top  + window.scrollY)}px`;
      }

      this.isPinned = false;
      this.pinMode  = null;
      delete this.el.dataset.pinMode;
      this._btnPin.classList.remove(`${NS}-header-btn--active`);
      this._btnPin.title = '固定面板';

      // 重新成为活动面板
      this._registry._activeId = this.id;
    }

    // ── DOM 构建 ────────────────────────────────────────────────────────────

    _build(text, pos) {
      const panel = document.createElement('div');
      panel.className         = `${NS}-panel`;
      panel.dataset.instanceId = this.id;

      const clamped          = this._clamp(pos.x, pos.y);
      panel.style.position   = 'absolute';
      panel.style.left       = `${clamped.left}px`;
      panel.style.top        = `${clamped.top}px`;

      panel.appendChild(this._buildHeader(text));
      panel.appendChild(this._buildActionBar());
      panel.appendChild(this._buildAccordionWrap());

      this._drag = new DragController(panel, panel.querySelector(`.${NS}-panel-header`));
      return panel;
    }

    _buildHeader(text) {
      const header = document.createElement('div');
      header.className = `${NS}-panel-header`;

      const logo = document.createElement('div');
      logo.className = `${NS}-panel-logo`;
      logo.innerHTML = SVG_CHAT;

      const title = document.createElement('span');
      title.className   = `${NS}-panel-title`;
      title.textContent = '划词助手';

      const spacer = document.createElement('div');
      spacer.className = `${NS}-panel-spacer`;

      this._preview = document.createElement('span');
      this._preview.className   = `${NS}-preview`;
      this._preview.textContent = `"${this._truncate(text)}"`;

      // 📌 Pin 按钮（点击 → 若已固定则 unpin；否则展开下拉）
      this._btnPin = document.createElement('button');
      this._btnPin.className = `${NS}-header-btn`;
      this._btnPin.title     = '固定面板';
      this._btnPin.innerHTML = SVG_PIN;

      this._pinDropdown = new PinDropdown(this._btnPin, (mode) => {
        this._doPinWithMode(mode);
      });

      this._btnPin.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.isPinned) {
          this._doUnpin();
        } else {
          this._pinDropdown.toggle();
        }
      });

      // ❌ 关闭按钮
      const btnClose = document.createElement('button');
      btnClose.className = `${NS}-header-btn`;
      btnClose.title     = '关闭';
      btnClose.innerHTML = SVG_CLOSE;
      btnClose.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
      });

      header.appendChild(logo);
      header.appendChild(title);
      header.appendChild(spacer);
      header.appendChild(this._preview);
      header.appendChild(this._btnPin);
      header.appendChild(btnClose);

      return header;
    }

    _buildActionBar() {
      const bar = document.createElement('div');
      bar.className = `${NS}-action-bar`;

      // 操作按钮只控制 Qwen（DeepSeek 始终 combined，不受此控制）
      const btnTr = document.createElement('button');
      btnTr.className   = `${NS}-btn ${NS}-btn--sm`;
      btnTr.textContent = '🌐 翻译';
      btnTr.addEventListener('click', (e) => {
        e.stopPropagation();
        this._fetchModel('qwen', 'translate');
      });

      const btnEx = document.createElement('button');
      btnEx.className   = `${NS}-btn ${NS}-btn--sm ${NS}-btn--ghost`;
      btnEx.textContent = '📖 解释术语';
      btnEx.addEventListener('click', (e) => {
        e.stopPropagation();
        this._fetchModel('qwen', 'explain');
      });

      bar.appendChild(btnTr);
      bar.appendChild(btnEx);
      return bar;
    }

    _buildAccordionWrap() {
      const wrap = document.createElement('div');
      wrap.className = `${NS}-accordion-wrap`;

      // DeepSeek: combined 模式，无操作按钮，自动发请求
      const deepseekCard = new AccordionCard('deepseek', 'DeepSeek', true);
      deepseekCard.onFetch = (id, action) => this._fetchModel(id, action);
      this._cards['deepseek'] = deepseekCard;

      // Qwen: 单效模式，保留操作按钮
      const qwenCard = new AccordionCard('qwen', '通义千问', false);
      qwenCard.onFetch = (id, action) => this._fetchModel(id, action);
      this._cards['qwen'] = qwenCard;

      wrap.appendChild(deepseekCard.el);
      wrap.appendChild(qwenCard.el);
      return wrap;
    }

    // ── 初始化请求 ────────────────────────────────────────────────────────────

    /** 面板 mount 后立即触发，DeepSeek combined + Qwen preferredAction */
    fetchInitial() {
      this._fetchModel('deepseek', 'combined');
      const pref = this._app.config.get('preferredAction') || 'translate';
      this._fetchModel('qwen', pref);
    }

    /** 文本更新时重新查询 */
    refetch(newText) {
      this.selectedText = newText;
      if (this._preview) this._preview.textContent = `"${this._truncate(newText)}"`;
      Object.values(this._cards).forEach((c) => c.reset());
      this.fetchInitial();
    }

    // ── API 请求 ────────────────────────────────────────────────────────────

    _fetchModel(modelId, action) {
      const card = this._cards[modelId];
      if (!card) return;

      card.setLoading(action);
      chrome.runtime.sendMessage(
        { action, text: this.selectedText, model: modelId },
        (response) => {
          if (!this.el?.isConnected) return; // 面板已关闭，丢弃响应
          if (chrome.runtime.lastError) {
            card.setError(action, '无法连接扩展后台，请在 chrome://extensions 重新加载扩展。');
          } else if (response?.success) {
            card.setResult(action, response.result);
          } else {
            card.setError(action, response?.error ?? '请求失败，请稍后重试。');
          }
        }
      );
    }

    // ── 工具 ─────────────────────────────────────────────────────────────────

    _clamp(x, y, w = 360, h = 420) {
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const sx = window.scrollX, sy = window.scrollY;
      let left = x, top = y + 8;
      if (left + w > sx + vw - 8) left = sx + vw - w - 8;
      if (left < sx + 8)          left = sx + 8;
      if (top  + h > sy + vh - 8) top  = y - h - 8;
      if (top  < sy + 8)          top  = sy + 8;
      return { left, top };
    }

    _truncate(text, len = 38) {
      return text.length > len ? `${text.slice(0, len)}…` : text;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PanelRegistry — 多开管理（pinned[] + 唯一 active）
  // ═══════════════════════════════════════════════════════════════════════════

  class PanelRegistry {
    constructor(app) {
      this.app       = app;
      this._instances = new Map();   // id → PanelInstance
      this._activeId  = null;
    }

    /** 当前的非钉住活动面板（可能为 null） */
    get active() { return this._instances.get(this._activeId) ?? null; }

    /**
     * 创建新的活动面板。
     * - 若已有非钉住面板，先关闭它。
     * - 钉住的面板不受影响。
     */
    openActive(text, pos) {
      const cur = this.active;
      if (cur) cur.close(); // 关闭旧的活动面板（_remove 会同步清空 _activeId）

      const inst = new PanelInstance(this, text, pos);
      this._instances.set(inst.id, inst);
      this._activeId = inst.id;
      inst.mount();
      inst.fetchInitial();
      return inst;
    }

    /** 检查 target 是否在任意面板内（含 pinned） */
    containsTarget(target) {
      for (const [, inst] of this._instances) {
        if (inst.el?.contains(target)) return true;
      }
      return false;
    }

    /** 关闭全部面板（滚动/Esc 时关闭活动面板，pinned 不关） */
    closeActive() {
      const cur = this.active;
      if (cur) cur.close();
    }

    closeAll() {
      for (const [, inst] of this._instances) {
        inst._drag?.destroy();
        inst._pinDropdown?.close();
        inst.el?.remove();
      }
      this._instances.clear();
      this._activeId = null;
    }

    // ── 内部回调 ──────────────────────────────────────────────────────────────

    /** 面板被 Pin 时调用 → 清除 active 引用，下次划词生成新面板 */
    _onPinned(id) {
      if (this._activeId === id) this._activeId = null;
    }

    /** 面板关闭时调用 */
    _remove(id) {
      this._instances.delete(id);
      if (this._activeId === id) this._activeId = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  FloatingIcon — 悬浮小气泡（单例）
  // ═══════════════════════════════════════════════════════════════════════════

  class FloatingIcon {
    constructor() {
      this.el     = null;
      this.onOpen = null; // (pos: {x,y}) => void
    }

    show(x, y) {
      this.hide();
      this.el = document.createElement('div');
      this.el.id        = `${NS}-icon`;
      this.el.className = `${NS}-icon`;
      this.el.title     = '点击查询（翻译 / 解释）';
      this.el.innerHTML = SVG_CHAT;

      const pos = this._clamp(x + 12, y + 12);
      this.el.style.left = `${pos.left}px`;
      this.el.style.top  = `${pos.top}px`;

      this.el.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = { x, y };
        this.hide();
        this.onOpen?.(p);
      });

      document.body.appendChild(this.el);
      requestAnimationFrame(() => this.el?.classList.add(`${NS}-icon--visible`));
    }

    hide() { this.el?.remove(); this.el = null; }
    contains(t) { return !!this.el?.contains(t); }

    _clamp(x, y, w = 36, h = 36) {
      const vw = document.documentElement.clientWidth, vh = window.innerHeight;
      const sx = window.scrollX, sy = window.scrollY;
      return {
        left: Math.min(Math.max(x, sx + 8), sx + vw - w - 8),
        top:  Math.min(Math.max(y, sy + 8), sy + vh - h - 8),
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SelectionManager — 全局事件总线（含所有 Bug 修复）
  // ═══════════════════════════════════════════════════════════════════════════

  class SelectionManager {
    constructor(app) {
      this._app           = app;
      this._downOnIcon    = false;
      this._downOnAnyPanel = false;
      this._mouseDownPt   = null;
      this._dragDist      = 0;     // mousedown → mouseup 的拖拽距离（像素）
      this._isDblClick    = false;
      this._dblTimer      = null;
      this._hoverTimer    = null;

      this._onDown   = this._onDown.bind(this);
      this._onUp     = this._onUp.bind(this);
      this._onClick  = this._onClick.bind(this);
      this._onDbl    = this._onDbl.bind(this);
      this._onKey    = this._onKey.bind(this);
      this._onScroll = this._onScroll.bind(this);
      this._onMove   = this._onMove.bind(this);

      document.addEventListener('mousedown', this._onDown);
      document.addEventListener('mouseup',   this._onUp);
      document.addEventListener('click',     this._onClick);
      document.addEventListener('dblclick',  this._onDbl);
      document.addEventListener('keydown',   this._onKey);
      document.addEventListener('mousemove', this._onMove, { passive: true });
      window.addEventListener('scroll',      this._onScroll, { passive: true });
    }

    // ── mousedown：记录 widget 命中 & 起始坐标 ─────────────────────────────

    _onDown(e) {
      this._mouseDownPt    = { x: e.clientX, y: e.clientY };
      this._dragDist       = 0;
      this._downOnIcon     = this._app.icon.contains(e.target);
      this._downOnAnyPanel = this._app.registry.containsTarget(e.target);
    }

    // ── mouseup：核心拦截器 + 触发器 ──────────────────────────────────────
    //
    //  守卫链：
    //    1. mousedown 落在小图标上 → 图标自身处理，此处忽略
    //    2. mousedown 落在面板上 + 没有明显拖动（drag < 4px）→ 按钮点击，忽略
    //    3. 文本长度不在 [1, 500] → 忽略
    //    4. 输入框检测
    //    5. 语言匹配检测
    //    → 通过所有守卫后，根据场景+触发规则决策

    _onUp(e) {
      if (this._downOnIcon) return;

      // 计算 mousedown → mouseup 的移动距离
      if (this._mouseDownPt) {
        const dx = e.clientX - this._mouseDownPt.x;
        const dy = e.clientY - this._mouseDownPt.y;
        this._dragDist = Math.sqrt(dx * dx + dy * dy);
      }

      // ★ 关键修复：mousedown 落在面板 + 没有拖动 = 按钮点击，禁止触发划词
      if (this._downOnAnyPanel && this._dragDist < 4) return;

      const capturedE = {
        pageX: e.pageX, pageY: e.pageY,
        ctrlKey: e.ctrlKey, altKey: e.altKey,
        shiftKey: e.shiftKey, metaKey: e.metaKey,
      };

      setTimeout(() => {
        const sel  = window.getSelection();
        const text = sel?.toString().trim() ?? '';

        if (text.length < 1 || text.length > 500) {
          if (!this._app.registry.active) this._app.icon.hide();
          return;
        }

        // ── 守卫 1：输入框 ──
        if (this._app.config.get('disableInInputs')) {
          const anchor = sel.anchorNode?.parentElement;
          if (InputBoxDetector.isInside(anchor)) return;
        }

        // ── 守卫 2：语言匹配 ──
        if (!LanguageDetector.matches(
          text,
          this._app.config.get('languages'),
          this._app.config.get('strictLanguageMatch')
        )) return;

        this._app.selectedText = text;

        // ── 场景判断 ──
        let scenario;
        if (this._downOnAnyPanel) {
          scenario = 'insidePanel';
        } else {
          const active = this._app.registry.active;
          scenario = (active && active.isPinned) ? 'pinned' : 'normal';
        }

        const action = this._app.trigger.evaluate(scenario, capturedE, this._isDblClick);

        // ★ 直接搜索：绝不显示小图标，直接开面板
        if (action === 'direct') {
          this._app.icon.hide();
          this._app.registry.openActive(text, { x: capturedE.pageX, y: capturedE.pageY });
        } else if (action === 'icon') {
          if (!this._app.registry.active) {
            this._app.icon.show(capturedE.pageX, capturedE.pageY);
          }
        }
        // 'off' → 静默
      }, 10);
    }

    // ── click：点击空白处关闭活动面板 ────────────────────────────────────

    _onClick(e) {
      if (this._downOnIcon || this._downOnAnyPanel) return;

      const active = this._app.registry.active;
      if (active && !active.isPinned && !active.el.contains(e.target)) {
        active.close();
      }
      if (!this._app.icon.contains(e.target)) {
        this._app.icon.hide();
      }
    }

    // ── dblclick ─────────────────────────────────────────────────────────

    _onDbl() {
      this._isDblClick = true;
      clearTimeout(this._dblTimer);
      this._dblTimer = setTimeout(() => { this._isDblClick = false; }, 400);
    }

    // ── keydown：Esc 关闭 ────────────────────────────────────────────────

    _onKey(e) {
      if (e.key === 'Escape') {
        this._app.icon.hide();
        this._app.registry.closeActive(); // 只关闭活动面板，保留 pinned
      }
    }

    // ── scroll：关闭活动面板，pinned 不受影响 ────────────────────────────

    _onScroll() {
      this._app.icon.hide();
      this._app.registry.closeActive();
    }

    // ── mousemove：悬浮取词 ──────────────────────────────────────────────

    _onMove(e) {
      // 追踪拖拽距离
      if (this._mouseDownPt) {
        const dx = e.clientX - this._mouseDownPt.x;
        const dy = e.clientY - this._mouseDownPt.y;
        this._dragDist = Math.max(this._dragDist, Math.sqrt(dx * dx + dy * dy));
      }

      if (!this._app.config.get('triggerRules.normal.hoverSelect')) return;
      if (this._app.registry.active) return;

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
  //  ExtensionApp — 根节点
  // ═══════════════════════════════════════════════════════════════════════════

  class ExtensionApp {
    constructor() {
      this.selectedText = '';
      this.config    = new ConfigManager();
      this.icon      = new FloatingIcon();
      this.registry  = new PanelRegistry(this);
      this.trigger   = null;
      this.selection = null;

      this.icon.onOpen = (pos) => {
        this.registry.openActive(this.selectedText, pos);
      };
    }

    async init() {
      await this.config.load();
      this.trigger   = new TriggerEngine(this.config);
      this.selection = new SelectionManager(this);
      console.debug('[划词助手 v3.1] 初始化完成。');
    }
  }

  // ── 启动 ──────────────────────────────────────────────────────────────────
  const app = new ExtensionApp();
  app.init();

})();
