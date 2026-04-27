/**
 * content_panel.js — UI 渲染层
 *
 * 包含：AccordionCard（单模型折叠卡片）、FloatingIcon（悬浮气泡）、
 *       PanelInstance（单面板实例）、PanelManager（面板生命周期管理器）
 *
 * 依赖：NS、SVG_*、DEFAULT_CONFIG（content_utils.js）；
 *       DragController、ResizeController（content_drag.js）；
 *       NyaAppearance（appearance.js）
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
//  AccordionCard — 单个模型的折叠卡片（combined-only：翻译+解释一并呈现）
//
//  状态模型简化：每张卡只有一个聚合状态机。
//    idle    — 占位，刚渲染骨架时
//    loading — 等后台返回
//    result  — 已收到 Markdown 结果
//    error   — 失败（含 notConfigured / timeout / API err）
// ═══════════════════════════════════════════════════════════════════════════

class AccordionCard {
  constructor(modelRowId, modelLabel) {
    this.modelRowId = modelRowId;
    this.label = modelLabel;
    /** @type {{ status: 'idle'|'loading'|'result'|'error', content: string }} */
    this.state = { status: 'idle', content: '' };
    /** @type {((modelRowId: string) => void) | null} */
    this.onFetch = null;

    this._open = true;
    this._body = null;
    this._dot = null;
    this._chevron = null;
    this._badgeEl = null;
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
    badge.className = `${NS}-accordion-badge`;
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
    if (!label) return;
    this.label = label;
    if (this._badgeEl) this._badgeEl.textContent = label;
  }

  setLoading() {
    this.state = { status: 'loading', content: '' };
    this._updateDot();
    this.forceOpen();
    this._renderBody();
  }

  setResult(content) {
    this.state = { status: 'result', content: content || '' };
    this._updateDot();
    this._renderBody();
  }

  setError(message) {
    this.state = { status: 'error', content: message || '请求失败' };
    this._updateDot();
    this._renderBody();
  }

  _updateDot() {
    const cls = `${NS}-accordion-dot`;
    switch (this.state.status) {
      case 'loading':
        this._dot.className = `${cls} ${cls}--loading`;
        break;
      case 'error':
        this._dot.className = `${cls} ${cls}--error`;
        break;
      case 'result':
        this._dot.className = `${cls} ${cls}--success`;
        break;
      default:
        this._dot.className = cls;
    }
  }

  _renderBody() {
    this._body.innerHTML = '';
    const { status, content } = this.state;

    if (status === 'idle') {
      const hint = document.createElement('p');
      hint.className = `${NS}-hint`;
      hint.textContent = `等待 ${this.label} 启动…`;
      this._body.appendChild(hint);
      return;
    }

    if (status === 'loading') {
      this._body.appendChild(this._buildLoader());
      return;
    }

    if (status === 'error') {
      const err = document.createElement('div');
      err.className = `${NS}-error`;
      err.style.cssText = 'margin:10px;';
      err.textContent = `⚠️ ${content}`;
      this._body.appendChild(err);

      const retryBtn = this._btn('🔄 重试', () => {
        this.onFetch?.(this.modelRowId);
      }, true);
      retryBtn.style.cssText = 'margin:0 10px 12px; display:inline-flex;';
      this._body.appendChild(retryBtn);
      return;
    }

    if (status === 'result') {
      this._renderCombinedSections(content);
    }
  }

  _renderCombinedSections(content) {
    const sectionRe = /^###\s+(.+)$/m;
    const parts = content.split(/(?=^###\s+)/m).filter((s) => s.trim());

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
    /** @type {Map<string, AccordionCard>} key: modelRowId */
    this._cards = new Map();
    this._wrapEl = null;
    this._preview = null;
    this._pinDropdown = null;
    this._pinDropdownAbort = null;
    this._selectedText = '';
    this._currentRequestId = '';
    this._msgListener = null;
  }

  get isPinned() { return this.pinMode !== 'unpinned'; }
  get isOpen() { return !!this.el; }

  open(text, pos) {
    if (this.isOpen) {
      this.updateContent(text);
      return;
    }

    this._selectedText = text;
    this.el = this._build(text);
    const clamped = this._clamp(pos.x, pos.y);
    this.el.style.left = `${clamped.left}px`;
    this.el.style.top = `${clamped.top}px`;

    document.body.appendChild(this.el);
    this._attachMessageListener();
    requestAnimationFrame(() => this.el?.classList.add(`${NS}-panel--visible`));

    const pref = this._config.get('preferredAction');
    if (pref && pref !== 'none') {
      this._dispatchMulti();
    }
  }

  close() {
    if (!this.el) return;

    if (this._msgListener) {
      chrome.runtime.onMessage.removeListener(this._msgListener);
      this._msgListener = null;
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
    this._renderSkeletonCards();

    if (this.el) {
      this.el.classList.add(`${NS}-panel--flash`);
      setTimeout(() => this.el?.classList.remove(`${NS}-panel--flash`), 600);
    }

    const pref = this._config.get('preferredAction');
    if (pref && pref !== 'none') {
      this._dispatchMulti();
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

    // 防御式事件拦截：面板内任何点击都不得冒泡到 document，
    // 避免 SelectionManager 的 closeUnpinned 把面板误销毁；
    // 仅 stopPropagation，不 preventDefault，否则按钮、文本选择全瘫。
    ['mousedown', 'mouseup', 'click'].forEach((evt) => {
      panel.addEventListener(evt, (e) => { e.stopPropagation(); }, false);
    });

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
    title.textContent = 'NyaTranslate';

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
    this._wrapEl = wrap;
    this._renderSkeletonCards();
    return wrap;
  }

  /**
   * 按当前 enabled 模型列表为面板生成 N 张骨架卡（一卡一模型）。
   * 每次划新词或配置变更时整体重建，确保卡片列表与 enabled 模型严格一致。
   */
  _renderSkeletonCards() {
    if (!this._wrapEl) return;
    this._wrapEl.innerHTML = '';
    this._cards.clear();

    const enabled = this._getEnabledModels();
    if (enabled.length === 0) {
      const hint = document.createElement('div');
      hint.className = `${NS}-hint`;
      hint.style.cssText = 'padding:18px 14px;text-align:center;line-height:1.7;';
      hint.textContent = '尚未启用任何模型，请前往设置页配置后再试 ~';
      this._wrapEl.appendChild(hint);
      return;
    }

    enabled.forEach((m) => {
      const label = m.displayName || m.modelId || m.id;
      const card = new AccordionCard(m.id, label);
      card.onFetch = (modelRowId) => this._retryOne(modelRowId);
      this._cards.set(m.id, card);
      this._wrapEl.appendChild(card.el);
    });
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

  /**
   * 多引擎并行调度入口：
   *   1. 生成新 requestId，标记当前查询批次
   *   2. 把所有卡片切到 loading 骨架
   *   3. 发一条 nya-multi-translate；后台并发打所有 enabled 模型，
   *      逐个 settle 后通过 chrome.tabs.sendMessage 推回到 _msgListener
   */
  _dispatchMulti() {
    const text = this._selectedText;
    if (!text) return;
    if (this._cards.size === 0) return;

    const requestId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this._currentRequestId = requestId;

    this._cards.forEach((card) => card.setLoading());

    chrome.runtime.sendMessage(
      { action: 'nya-multi-translate', text, requestId },
      () => {
        if (!this.isOpen) return;
        if (chrome.runtime.lastError) {
          this._cards.forEach((c) => c.setError(
            '无法连接扩展后台，请在 chrome://extensions 页面重新加载扩展。'
          ));
        }
      }
    );
  }

  /**
   * 单卡片重试：仅重新打这个 modelRowId 对应的模型。
   */
  _retryOne(modelRowId) {
    const card = this._cards.get(modelRowId);
    if (!card) return;
    const text = this._selectedText;
    if (!text) return;

    // 复用当前 requestId：保持回执匹配，不污染其他卡片的状态
    const requestId = this._currentRequestId
      || ((typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    this._currentRequestId = requestId;

    card.setLoading();
    chrome.runtime.sendMessage(
      { action: 'nya-translate-single', text, requestId, modelRowId },
      () => {
        if (!this.isOpen) return;
        if (chrome.runtime.lastError) {
          card.setError('无法连接扩展后台，请在 chrome://extensions 重新加载扩展。');
        }
      }
    );
  }

  /**
   * 监听后台精准回执：只接受 requestId 匹配当前批次的消息，
   * 旧请求迟到结果会被静默丢弃，不会污染新内容。
   */
  _attachMessageListener() {
    if (this._msgListener) return;

    this._msgListener = (msg) => {
      if (!this.isOpen) return;
      if (!msg || typeof msg !== 'object') return;

      if (msg.action === 'nya-multi-result' && msg.requestId === this._currentRequestId) {
        const card = this._cards.get(msg.modelRowId);
        if (!card) return;
        if (msg.label) card.setLabel(msg.label);
        if (msg.status === 'success') {
          card.setResult(msg.result || '');
        } else {
          card.setError(msg.error || '请求失败');
        }
        return;
      }

      if (msg.action === 'nya-multi-empty' && msg.requestId === this._currentRequestId) {
        // 后台告知没有 enabled 模型——卡片已为空，但为冗余兜底
        this._cards.forEach((c) => c.setError(msg.error || '没有启用的模型'));
      }
    };

    chrome.runtime.onMessage.addListener(this._msgListener);
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

  /**
   * 配置（enabled 模型集合）变更时实时刷新所有打开面板的卡片骨架。
   * 不自动重发请求，避免用户在设置页改动时无意触发 API 调用。
   */
  refreshCardsFromConfig() {
    for (const panel of this._panels.values()) {
      if (panel.isOpen) panel._renderSkeletonCards?.();
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
