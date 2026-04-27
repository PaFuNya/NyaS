/**
 * content_main.js — 入口层
 *
 * 包含：SelectionManager（全局事件监听与编排）、
 *       ExtensionApp（根节点，组合所有模块）、启动入口
 *
 * 依赖：content_utils.js、content_drag.js、content_panel.js、content_screenshot.js
 */

(function () {
  'use strict';

  if (window.__nyaSelectionHelperV4__) return;
  window.__nyaSelectionHelperV4__ = true;

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
              activePanel.updateContent(text);
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
      const t = e.target;
      if (this._app.panels.contains(t)) return;
      // 与 _onUp 一致的 closest 兜底：防止 e.target 是已脱离 panel 树的 portal 元素
      if (t?.closest?.(`.${NS}-panel`)) return;
      // 任何 MaterialSelect 风格的 portal 菜单都不应触发面板销毁
      if (t?.closest?.('.nya-ms__menu')) return;
      this._app.panels.closeUnpinned();
      if (!this._app.icon.contains(t)) {
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
            this.panels.refreshCardsFromConfig();
          });
        }
        if (changes.appearance) {
          this.config.load().then(() => {
            this._applyAppearanceToContentRoots();
          });
        }
      });
      console.debug('[NyaTranslate v4.1] 初始化完成 — 多引擎并行卡片流。');
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
