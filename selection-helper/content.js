/**
 * Content Script — 划词助手 v2
 *
 * 交互流程：
 *   1. mouseup → 检测选中文本 → 在光标右下角显示悬浮小图标
 *   2. 点击图标 → 图标消失，原地展开带 Tab 的悬浮面板
 *   3. 点击页面空白处 / 按 Esc / 滚动 → 关闭所有元素
 */

(function () {
  'use strict';

  const NS = 'my-ext';

  // ─── 全局状态 ──────────────────────────────────────────────────────────────
  const state = {
    selectedText: '',
    iconPos: { x: 0, y: 0 },
    activeTab: 'deepseek',
    // 每个 Tab 独立维护：{ status: 'idle'|'loading'|'result'|'error', action: string, content: string }
    tabState: {
      deepseek: { status: 'idle', action: null, content: '' },
      qwen:     { status: 'idle', action: null, content: '' },
    },
    mousedownOnWidget: false,
  };

  let iconEl = null;
  let panelEl = null;

  // ─── 工具函数 ──────────────────────────────────────────────────────────────

  function truncate(text, len = 50) {
    return text.length > len ? text.slice(0, len) + '…' : text;
  }

  function resetTabState() {
    state.tabState = {
      deepseek: { status: 'idle', action: null, content: '' },
      qwen:     { status: 'idle', action: null, content: '' },
    };
    state.activeTab = 'deepseek';
  }

  /** 销毁图标与面板，重置状态 */
  function cleanup() {
    if (iconEl)  { iconEl.remove();  iconEl  = null; }
    if (panelEl) { panelEl.remove(); panelEl = null; }
    resetTabState();
  }

  /** 将图标限制在视口内 */
  function clampIcon(x, y, w = 36, h = 36) {
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const sx = window.scrollX, sy = window.scrollY;
    return {
      left: Math.min(Math.max(x, sx + 8), sx + vw - w - 8),
      top:  Math.min(Math.max(y, sy + 8), sy + vh - h - 8),
    };
  }

  /** 将面板限制在视口内 */
  function clampPanel(x, y, w = 360, h = 320) {
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const sx = window.scrollX, sy = window.scrollY;
    let left = x;
    let top  = y + 8;
    if (left + w > sx + vw - 8) left = sx + vw - w - 8;
    if (left < sx + 8)          left = sx + 8;
    if (top  + h > sy + vh - 8) top  = y - h - 8;
    if (top  < sy + 8)          top  = sy + 8;
    return { left, top };
  }

  // ─── 第一步：显示悬浮小图标 ────────────────────────────────────────────────

  function showIcon(x, y) {
    if (iconEl) { iconEl.remove(); iconEl = null; }

    state.iconPos = { x, y };

    iconEl = document.createElement('div');
    iconEl.id        = `${NS}-icon`;
    iconEl.className = `${NS}-icon`;
    iconEl.title     = '点击查询（翻译 / 解释）';

    // 内部 SVG：气泡 + 笔形图标
    iconEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

    const { left, top } = clampIcon(x + 12, y + 12);
    iconEl.style.left = `${left}px`;
    iconEl.style.top  = `${top}px`;

    iconEl.addEventListener('click', (e) => {
      e.stopPropagation();
      openPanel();
    });

    document.body.appendChild(iconEl);
    // 触发入场动画
    requestAnimationFrame(() => iconEl?.classList.add(`${NS}-icon--visible`));
  }

  // ─── 第二步：点击图标，展开面板 ────────────────────────────────────────────

  function openPanel() {
    if (iconEl) { iconEl.remove(); iconEl = null; }
    if (panelEl) { panelEl.remove(); panelEl = null; }

    panelEl = buildPanel();

    const { left, top } = clampPanel(state.iconPos.x, state.iconPos.y);
    panelEl.style.left = `${left}px`;
    panelEl.style.top  = `${top}px`;

    document.body.appendChild(panelEl);
    requestAnimationFrame(() => panelEl?.classList.add(`${NS}-panel--visible`));
  }

  // ─── 面板 DOM 构造 ─────────────────────────────────────────────────────────

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id        = `${NS}-panel`;
    panel.className = `${NS}-panel`;

    // 顶部：选中文本预览 + 关闭按钮
    const header = document.createElement('div');
    header.className = `${NS}-panel-header`;

    const preview = document.createElement('span');
    preview.className = `${NS}-preview`;
    preview.textContent = `"${truncate(state.selectedText)}"`;

    const btnClose = document.createElement('button');
    btnClose.className = `${NS}-close-btn`;
    btnClose.title = '关闭';
    btnClose.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    btnClose.addEventListener('click', (e) => { e.stopPropagation(); cleanup(); });

    header.appendChild(preview);
    header.appendChild(btnClose);

    // Tab 栏
    const tabBar = document.createElement('div');
    tabBar.className = `${NS}-tabbar`;

    const TABS = [
      { id: 'deepseek', label: 'DeepSeek', badge: 'R1' },
      { id: 'qwen',     label: '通义千问', badge: 'Plus' },
    ];

    TABS.forEach(({ id, label, badge }) => {
      const tab = document.createElement('button');
      tab.className   = `${NS}-tab${state.activeTab === id ? ` ${NS}-tab--active` : ''}`;
      tab.dataset.tab = id;

      const labelSpan = document.createElement('span');
      labelSpan.textContent = label;

      const badgeSpan = document.createElement('span');
      badgeSpan.className = `${NS}-tab-badge`;
      badgeSpan.textContent = badge;

      tab.appendChild(labelSpan);
      tab.appendChild(badgeSpan);
      tab.addEventListener('click', (e) => { e.stopPropagation(); switchTab(id); });
      tabBar.appendChild(tab);
    });

    // 内容区
    const content = document.createElement('div');
    content.className = `${NS}-content`;
    content.id        = `${NS}-content`;

    panel.appendChild(header);
    panel.appendChild(tabBar);
    panel.appendChild(content);

    renderTabContent(content, state.activeTab);

    return panel;
  }

  // ─── Tab 切换 ──────────────────────────────────────────────────────────────

  function switchTab(tabId) {
    if (state.activeTab === tabId) return;
    state.activeTab = tabId;

    if (!panelEl) return;

    panelEl.querySelectorAll(`.${NS}-tab`).forEach((tab) => {
      tab.classList.toggle(`${NS}-tab--active`, tab.dataset.tab === tabId);
    });

    const contentEl = panelEl.querySelector(`#${NS}-content`);
    if (contentEl) renderTabContent(contentEl, tabId);
  }

  // ─── 内容区渲染（状态机）──────────────────────────────────────────────────

  function renderTabContent(container, tabId) {
    container.innerHTML = '';
    const ts = state.tabState[tabId];
    const modelName = tabId === 'deepseek' ? 'DeepSeek' : '通义千问';

    // ── idle：展示操作按钮 ──
    if (ts.status === 'idle') {
      const actions = document.createElement('div');
      actions.className = `${NS}-actions`;

      const btnTranslate = makeActionBtn('🌐 翻译', () => triggerFetch(tabId, 'translate'));
      const btnExplain   = makeActionBtn('📖 解释术语', () => triggerFetch(tabId, 'explain'));

      actions.appendChild(btnTranslate);
      actions.appendChild(btnExplain);
      container.appendChild(actions);

      const hint = document.createElement('p');
      hint.className = `${NS}-hint`;
      hint.textContent = `选择操作，由 ${modelName} 为你解答`;
      container.appendChild(hint);
    }

    // ── loading：旋转动画 ──
    else if (ts.status === 'loading') {
      const loader = document.createElement('div');
      loader.className = `${NS}-loading`;

      const spinner = document.createElement('div');
      spinner.className = `${NS}-spinner`;

      const txt = document.createElement('span');
      txt.className = `${NS}-loading-text`;
      txt.textContent = `${modelName} 正在思考中…`;

      const dotsWrap = document.createElement('div');
      dotsWrap.className = `${NS}-dots`;
      for (let i = 0; i < 3; i++) {
        const dot = document.createElement('span');
        dot.className = `${NS}-dot`;
        dotsWrap.appendChild(dot);
      }

      loader.appendChild(spinner);
      loader.appendChild(txt);
      loader.appendChild(dotsWrap);
      container.appendChild(loader);
    }

    // ── result：展示结果 ──
    else if (ts.status === 'result') {
      const resultHeader = document.createElement('div');
      resultHeader.className = `${NS}-result-header`;
      resultHeader.textContent = ts.action === 'translate' ? '🌐 翻译结果' : '📖 术语解释';

      const body = document.createElement('div');
      body.className = `${NS}-result-body`;
      body.textContent = ts.content;

      const footer = document.createElement('div');
      footer.className = `${NS}-result-footer`;

      const otherAction = ts.action === 'translate' ? 'explain' : 'translate';
      const otherLabel  = otherAction === 'translate' ? '🌐 翻译' : '📖 解释术语';

      const btnSwitch = makeActionBtn(otherLabel, () => triggerFetch(tabId, otherAction), true);
      const btnCopy   = makeCopyBtn(ts.content);

      footer.appendChild(btnSwitch);
      footer.appendChild(btnCopy);

      container.appendChild(resultHeader);
      container.appendChild(body);
      container.appendChild(footer);
    }

    // ── error：展示错误 ──
    else if (ts.status === 'error') {
      const errEl = document.createElement('div');
      errEl.className = `${NS}-error`;
      errEl.textContent = `⚠️ ${ts.content}`;

      const btnRetry = makeActionBtn('🔄 重试', () => triggerFetch(tabId, ts.action || 'translate'), true);
      btnRetry.style.marginTop = '10px';

      container.appendChild(errEl);
      container.appendChild(btnRetry);
    }
  }

  // ─── 按钮工厂函数 ──────────────────────────────────────────────────────────

  function makeActionBtn(label, onClick, ghost = false) {
    const btn = document.createElement('button');
    btn.className = `${NS}-btn${ghost ? ` ${NS}-btn--ghost` : ''}`;
    btn.textContent = label;
    btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return btn;
  }

  function makeCopyBtn(text) {
    const btn = document.createElement('button');
    btn.className = `${NS}-btn ${NS}-btn--ghost`;
    btn.textContent = '📋 复制';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = '✅ 已复制';
        setTimeout(() => { btn.textContent = '📋 复制'; }, 1500);
      }).catch(() => {
        btn.textContent = '❌ 失败';
        setTimeout(() => { btn.textContent = '📋 复制'; }, 1500);
      });
    });
    return btn;
  }

  // ─── 核心：发送消息给 Background 发起 API 请求 ──────────────────────────

  function triggerFetch(tabId, action) {
    // 切换到该 Tab 并进入 loading 状态
    state.tabState[tabId] = { status: 'loading', action, content: '' };
    if (state.activeTab !== tabId) switchTab(tabId);
    else {
      const contentEl = panelEl?.querySelector(`#${NS}-content`);
      if (contentEl) renderTabContent(contentEl, tabId);
    }

    chrome.runtime.sendMessage(
      { action, text: state.selectedText, model: tabId },
      (response) => {
        if (chrome.runtime.lastError) {
          state.tabState[tabId] = {
            status: 'error',
            action,
            content: '无法连接扩展后台，请在 chrome://extensions 页面重新加载扩展。',
          };
        } else if (response?.success) {
          state.tabState[tabId] = { status: 'result', action, content: response.result };
        } else {
          state.tabState[tabId] = {
            status: 'error',
            action,
            content: response?.error || '请求失败，请稍后重试。',
          };
        }

        // 若当前面板仍在，且该 Tab 是活跃 Tab，则更新视图
        if (panelEl && state.activeTab === tabId) {
          const contentEl = panelEl.querySelector(`#${NS}-content`);
          if (contentEl) renderTabContent(contentEl, tabId);
        }
      }
    );
  }

  // ─── 全局事件监听 ──────────────────────────────────────────────────────────

  /** 记录 mousedown 是否落在我们的 widget 上，防止 click 事件误关闭 */
  document.addEventListener('mousedown', (e) => {
    state.mousedownOnWidget = !!(
      (iconEl  && iconEl.contains(e.target)) ||
      (panelEl && panelEl.contains(e.target))
    );
  });

  /** 划词监听 */
  document.addEventListener('mouseup', (e) => {
    if (state.mousedownOnWidget) return;

    setTimeout(() => {
      const sel  = window.getSelection();
      const text = sel?.toString().trim() ?? '';

      if (text.length >= 1 && text.length <= 500) {
        state.selectedText = text;
        resetTabState();
        // 如果面板已打开，不要覆盖它；只在没有面板时才显示图标
        if (!panelEl) showIcon(e.pageX, e.pageY);
      } else {
        // 点击空白导致 selection 清空，关闭所有
        if (!panelEl) {
          if (iconEl) { iconEl.remove(); iconEl = null; }
        }
      }
    }, 10);
  });

  /** 点击空白处：关闭 */
  document.addEventListener('click', (e) => {
    if (!state.mousedownOnWidget) {
      if (iconEl  && !iconEl.contains(e.target))  { iconEl.remove();  iconEl  = null; }
      if (panelEl && !panelEl.contains(e.target)) cleanup();
    }
  });

  /** Esc 关闭 */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cleanup();
  });

  /** 滚动时关闭（防止面板位置漂移） */
  window.addEventListener('scroll', cleanup, { passive: true });

})();
