/**
 * Options Page Script — 划词助手 v3
 *
 * 模块划分：
 *   NavController        — 侧边栏导航切换
 *   ToastManager         — 全局通知
 *   ApiConfigSection     — API Key 读写
 *   BasicSettingsSection — 基础开关读写
 *   LangMatchSection     — 语言 Chip + 严格模式读写
 *   TriggerRulesSection  — 动态构建 4 大场景卡片，读写触发规则
 *   PrefsSection         — 偏好设置读写
 *   OptionsApp           — 根节点，组合并初始化
 */

'use strict';

// ─── 常量定义 ─────────────────────────────────────────────────────────────────

const LANGUAGES = [
  { key: 'zh', label: '中文',     emoji: '🇨🇳' },
  { key: 'en', label: '英文',     emoji: '🇺🇸' },
  { key: 'ja', label: '日文',     emoji: '🇯🇵' },
  { key: 'ko', label: '韩文',     emoji: '🇰🇷' },
  { key: 'fr', label: '法文',     emoji: '🇫🇷' },
  { key: 'es', label: '西班牙文', emoji: '🇪🇸' },
  { key: 'de', label: '德文',     emoji: '🇩🇪' },
];

const TRIGGER_SCENARIOS = [
  {
    key:   'normal',
    label: '普通划词',
    icon:  '🖱️',
    desc:  '在普通页面上划选文字时的触发方式（面板未打开或未固定）。',
  },
  {
    key:   'pinned',
    label: '面板钉住后划词',
    icon:  '📌',
    desc:  '查词面板被【📌 固定】时，在外部页面继续划选文字的触发方式。',
  },
  {
    key:   'insidePanel',
    label: '面板内部划词',
    icon:  '📋',
    desc:  '在已打开的查词面板内部选中文字时的触发方式（如划选翻译结果中的单词再查词）。',
  },
  {
    key:   'standalone',
    label: '独立窗口划词',
    icon:  '🪟',
    desc:  '在扩展的独立弹出窗口中划词时的触发方式（预留场景）。',
  },
];

const MODIFIER_KEYS = [
  { key: 'ctrl',  label: 'Ctrl'  },
  { key: 'alt',   label: 'Alt'   },
  { key: 'shift', label: 'Shift' },
  { key: 'meta',  label: '⌘ Meta' },
];

const DEFAULT_TRIGGER_RULE = {
  showIcon:       true,
  directSearch:   false,
  dblclickSearch: false,
  modifiers:      [],
  hoverSelect:    false,
};

// ═══════════════════════════════════════════════════════════════════════════
//  ToastManager
// ═══════════════════════════════════════════════════════════════════════════

class ToastManager {
  constructor(el) {
    this._el    = el;
    this._timer = null;
  }

  show(type, message) {
    if (this._timer) clearTimeout(this._timer);
    const icon = type === 'success' ? '✓' : '✕';
    this._el.innerHTML  = `<span class="toast-icon">${icon}</span><span>${message}</span>`;
    this._el.className  = `toast toast--${type}`;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this._el.classList.add('toast--show'));
    });
    this._timer = setTimeout(() => {
      this._el.classList.remove('toast--show');
      this._timer = setTimeout(() => {
        this._el.className = 'toast';
        this._el.innerHTML = '';
      }, 300);
    }, 2800);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  NavController
// ═══════════════════════════════════════════════════════════════════════════

class NavController {
  init() {
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sectionKey = btn.dataset.section;
        document.querySelectorAll('.nav-item').forEach((b) =>
          b.classList.toggle('nav-item--active', b === btn)
        );
        document.querySelectorAll('.section').forEach((sec) => {
          sec.classList.toggle('section--active', sec.id === `section-${sectionKey}`);
        });
      });
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  ApiConfigSection
// ═══════════════════════════════════════════════════════════════════════════

class ApiConfigSection {
  constructor(toast) {
    this._toast        = toast;
    this._deepseekInput = document.getElementById('deepseek-key');
    this._qwenInput     = document.getElementById('qwen-key');
    this._statusDeepseek = document.getElementById('status-deepseek');
    this._statusQwen     = document.getElementById('status-qwen');
    this._btnSave        = document.getElementById('btn-save-api');
  }

  init() {
    this._initEyeToggles();
    this._initKeyStatusWatchers();
    this._initEnterSave();
    this._btnSave.addEventListener('click', () => this._save());
  }

  load(stored) {
    if (stored.deepseekKey) this._deepseekInput.value = stored.deepseekKey;
    if (stored.qwenKey)     this._qwenInput.value     = stored.qwenKey;
    this._updateStatus(this._deepseekInput, this._statusDeepseek);
    this._updateStatus(this._qwenInput, this._statusQwen);
  }

  _save() {
    const deepseekKey = this._deepseekInput.value.trim();
    const qwenKey     = this._qwenInput.value.trim();

    if (deepseekKey && !deepseekKey.startsWith('sk-')) {
      this._toast.show('error', 'DeepSeek API Key 格式有误，应以 sk- 开头');
      this._deepseekInput.focus();
      return;
    }
    if (qwenKey && !qwenKey.startsWith('sk-')) {
      this._toast.show('error', '通义千问 API Key 格式有误，应以 sk- 开头');
      this._qwenInput.focus();
      return;
    }
    if (!deepseekKey && !qwenKey) {
      this._toast.show('error', '请至少填写一个 API Key');
      return;
    }

    this._btnSave.disabled    = true;
    this._btnSave.textContent = '保存中…';

    chrome.storage.local.set({ deepseekKey, qwenKey }, () => {
      this._btnSave.disabled    = false;
      this._btnSave.textContent = '保存 API 配置';
      if (chrome.runtime.lastError) {
        this._toast.show('error', `保存失败：${chrome.runtime.lastError.message}`);
        return;
      }
      this._updateStatus(this._deepseekInput, this._statusDeepseek);
      this._updateStatus(this._qwenInput, this._statusQwen);
      this._toast.show('success', 'API 配置已保存，立即生效 ✓');
    });
  }

  _updateStatus(input, statusEl) {
    if (!statusEl) return;
    const has = input.value.trim().length > 0;
    statusEl.className   = `key-status ${has ? 'configured' : 'missing'}`;
    statusEl.textContent = has ? '✓ 已配置' : '○ 未填写';
  }

  _initKeyStatusWatchers() {
    [[this._deepseekInput, this._statusDeepseek], [this._qwenInput, this._statusQwen]]
      .forEach(([inp, stat]) => inp.addEventListener('input', () => this._updateStatus(inp, stat)));
  }

  _initEnterSave() {
    [this._deepseekInput, this._qwenInput].forEach((inp) => {
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._btnSave.click(); });
    });
  }

  _initEyeToggles() {
    const EYE_OPEN   = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
    const EYE_CLOSED = `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>`;

    document.querySelectorAll('.eye-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input   = document.getElementById(btn.dataset.target);
        if (!input) return;
        const showing = input.type === 'text';
        input.type    = showing ? 'password' : 'text';
        const svg     = btn.querySelector('svg');
        if (svg) svg.innerHTML = showing ? EYE_OPEN : EYE_CLOSED;
        btn.setAttribute('aria-label', showing ? '显示密码' : '隐藏密码');
      });
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  BasicSettingsSection
// ═══════════════════════════════════════════════════════════════════════════

class BasicSettingsSection {
  constructor(toast) {
    this._toast         = toast;
    this._chkInputs     = document.getElementById('toggle-disable-in-inputs');
    this._chkTouch      = document.getElementById('toggle-touch-mode');
    this._btnSave       = document.getElementById('btn-save-basic');
  }

  init() {
    this._btnSave.addEventListener('click', () => this._save());
  }

  load(stored) {
    this._chkInputs.checked = stored.disableInInputs !== false; // 默认 true
    this._chkTouch.checked  = stored.touchMode === true;
  }

  _save() {
    this._btnSave.disabled    = true;
    this._btnSave.textContent = '保存中…';

    chrome.storage.local.set({
      disableInInputs: this._chkInputs.checked,
      touchMode:       this._chkTouch.checked,
    }, () => {
      this._btnSave.disabled    = false;
      this._btnSave.textContent = '保存基础设置';
      if (chrome.runtime.lastError) {
        this._toast.show('error', `保存失败：${chrome.runtime.lastError.message}`);
        return;
      }
      this._toast.show('success', '基础设置已保存 ✓');
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  LangMatchSection
// ═══════════════════════════════════════════════════════════════════════════

class LangMatchSection {
  constructor(toast) {
    this._toast      = toast;
    this._container  = document.getElementById('lang-chips');
    this._chkStrict  = document.getElementById('toggle-strict-lang');
    this._btnSave    = document.getElementById('btn-save-lang');
    this._checkboxes = {}; // { zh: HTMLInputElement, ... }
  }

  init() {
    this._buildChips();
    this._btnSave.addEventListener('click', () => this._save());
  }

  load(stored) {
    const langs = stored.languages || {};
    for (const [key, chk] of Object.entries(this._checkboxes)) {
      // defaults: zh and en checked, rest unchecked
      const defaultVal = (key === 'zh' || key === 'en');
      chk.checked = langs[key] !== undefined ? langs[key] : defaultVal;
    }
    this._chkStrict.checked = stored.strictLanguageMatch === true;
  }

  _buildChips() {
    LANGUAGES.forEach(({ key, label, emoji }) => {
      const chip = document.createElement('label');
      chip.className = 'lang-chip';
      chip.htmlFor   = `lang-${key}`;

      const chk = document.createElement('input');
      chk.type  = 'checkbox';
      chk.id    = `lang-${key}`;
      chk.value = key;

      const span = document.createElement('span');
      span.textContent = `${emoji} ${label}`;

      chip.appendChild(chk);
      chip.appendChild(span);
      this._container.appendChild(chip);
      this._checkboxes[key] = chk;

      // 视觉联动
      chk.addEventListener('change', () =>
        chip.classList.toggle('lang-chip--checked', chk.checked)
      );
    });
  }

  _save() {
    const languages = {};
    for (const [key, chk] of Object.entries(this._checkboxes)) {
      languages[key] = chk.checked;
    }
    this._btnSave.disabled    = true;
    this._btnSave.textContent = '保存中…';

    chrome.storage.local.set({
      languages,
      strictLanguageMatch: this._chkStrict.checked,
    }, () => {
      this._btnSave.disabled    = false;
      this._btnSave.textContent = '保存语言设置';
      if (chrome.runtime.lastError) {
        this._toast.show('error', `保存失败：${chrome.runtime.lastError.message}`);
        return;
      }
      this._toast.show('success', '语言设置已保存 ✓');
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  TriggerRulesSection — 动态构建 4 个场景卡片
// ═══════════════════════════════════════════════════════════════════════════

class TriggerRulesSection {
  constructor(toast) {
    this._toast     = toast;
    this._container = document.getElementById('trigger-rules-container');
    this._btnSave   = document.getElementById('btn-save-trigger');
    this._fields    = {}; // { scenarioKey: { showIcon, directSearch, ... } }
  }

  init() {
    TRIGGER_SCENARIOS.forEach(({ key, label, icon, desc }) => {
      this._buildCard(key, label, icon, desc);
    });
    this._btnSave.addEventListener('click', () => this._save());
  }

  load(stored) {
    const rules = stored.triggerRules || {};
    for (const { key } of TRIGGER_SCENARIOS) {
      const rule   = rules[key] || DEFAULT_TRIGGER_RULE;
      const fields = this._fields[key];
      if (!fields) continue;

      fields.showIcon.checked       = rule.showIcon       ?? DEFAULT_TRIGGER_RULE.showIcon;
      fields.directSearch.checked   = rule.directSearch   ?? DEFAULT_TRIGGER_RULE.directSearch;
      fields.dblclickSearch.checked = rule.dblclickSearch ?? DEFAULT_TRIGGER_RULE.dblclickSearch;
      fields.hoverSelect.checked    = rule.hoverSelect    ?? DEFAULT_TRIGGER_RULE.hoverSelect;

      // 组合键
      MODIFIER_KEYS.forEach(({ key: mk }) => {
        if (fields.modifiers[mk]) {
          fields.modifiers[mk].checked = (rule.modifiers || []).includes(mk);
        }
      });
    }
  }

  _buildCard(scenarioKey, label, icon, desc) {
    const card = document.createElement('div');
    card.className = 'card trigger-card';

    // 卡片标题
    const head = document.createElement('div');
    head.className = 'card-head';
    head.innerHTML = `
      <div class="card-brand trigger-card-brand">
        <span class="trigger-icon">${icon}</span>
        <span>${label}</span>
      </div>
    `;
    card.appendChild(head);

    // 描述
    const descEl = document.createElement('p');
    descEl.className   = 'field-desc trigger-card-desc';
    descEl.textContent = desc;
    card.appendChild(descEl);

    // 选项列表
    const opts = document.createElement('div');
    opts.className = 'trigger-options';

    const showIconChk       = this._makeCheckRow(opts, `${scenarioKey}-showIcon`,       '显示图标',     '划词后在光标附近出现小气泡图标，悬停或点击后展开面板。');
    const directSearchChk   = this._makeCheckRow(opts, `${scenarioKey}-directSearch`,   '直接搜索',     '划词后直接弹出大面板，同时向两个模型发起请求，无需点击图标。');
    const dblclickSearchChk = this._makeCheckRow(opts, `${scenarioKey}-dblclickSearch`, '双击搜索',     '仅双击选词时才直接弹出面板（优先级高于"直接搜索"）。');
    const hoverSelectChk    = this._makeCheckRow(opts, `${scenarioKey}-hoverSelect`,    '鼠标悬浮取词', '无需点击，鼠标悬停约 0.6 秒后自动选取光标周边单词并显示图标。');

    // 组合键
    const modRow = document.createElement('div');
    modRow.className = 'trigger-option-row';
    modRow.innerHTML = `
      <div class="trigger-option-label">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h0M10 10h0M14 10h0M18 10h0M8 14h8"/></svg>
        组合键触发
      </div>
      <div class="trigger-option-desc">按住以下任一修饰键划词时，强制触发直接搜索（优先级高于基础模式）。</div>
    `;
    const modKeys = document.createElement('div');
    modKeys.className = 'modifier-keys';

    const modCheckboxes = {};
    MODIFIER_KEYS.forEach(({ key: mk, label: ml }) => {
      const modLabel = document.createElement('label');
      modLabel.className = 'modifier-key';

      const modChk = document.createElement('input');
      modChk.type  = 'checkbox';
      modChk.id    = `${scenarioKey}-mod-${mk}`;
      modChk.value = mk;
      modChk.addEventListener('change', () =>
        modLabel.classList.toggle('modifier-key--checked', modChk.checked)
      );

      const modSpan = document.createElement('span');
      modSpan.textContent = ml;

      modLabel.appendChild(modChk);
      modLabel.appendChild(modSpan);
      modKeys.appendChild(modLabel);
      modCheckboxes[mk] = modChk;
    });

    modRow.appendChild(modKeys);
    opts.appendChild(modRow);

    card.appendChild(opts);
    this._container.appendChild(card);

    // 保存字段引用
    this._fields[scenarioKey] = {
      showIcon:       showIconChk,
      directSearch:   directSearchChk,
      dblclickSearch: dblclickSearchChk,
      hoverSelect:    hoverSelectChk,
      modifiers:      modCheckboxes,
    };
  }

  /** 生成单行复选框选项，返回 input 元素 */
  _makeCheckRow(container, id, label, description) {
    const row = document.createElement('div');
    row.className = 'trigger-option-row';

    const labelEl = document.createElement('label');
    labelEl.className = 'trigger-check-label';
    labelEl.htmlFor   = id;

    const chk = document.createElement('input');
    chk.type  = 'checkbox';
    chk.id    = id;

    const checkMark = document.createElement('span');
    checkMark.className = 'trigger-checkmark';

    const textWrap = document.createElement('div');
    const titleSpan = document.createElement('span');
    titleSpan.className   = 'trigger-option-label';
    titleSpan.textContent = label;
    const descSpan = document.createElement('span');
    descSpan.className   = 'trigger-option-desc';
    descSpan.textContent = description;

    textWrap.appendChild(titleSpan);
    textWrap.appendChild(descSpan);

    labelEl.appendChild(chk);
    labelEl.appendChild(checkMark);
    labelEl.appendChild(textWrap);
    row.appendChild(labelEl);
    container.appendChild(row);

    return chk;
  }

  _save() {
    const triggerRules = {};
    for (const { key } of TRIGGER_SCENARIOS) {
      const fields = this._fields[key];
      if (!fields) continue;

      const modifiers = MODIFIER_KEYS
        .filter(({ key: mk }) => fields.modifiers[mk]?.checked)
        .map(({ key: mk }) => mk);

      triggerRules[key] = {
        showIcon:       fields.showIcon.checked,
        directSearch:   fields.directSearch.checked,
        dblclickSearch: fields.dblclickSearch.checked,
        hoverSelect:    fields.hoverSelect.checked,
        modifiers,
      };
    }

    this._btnSave.disabled    = true;
    this._btnSave.textContent = '保存中…';

    chrome.storage.local.set({ triggerRules }, () => {
      this._btnSave.disabled    = false;
      this._btnSave.textContent = '保存触发规则';
      if (chrome.runtime.lastError) {
        this._toast.show('error', `保存失败：${chrome.runtime.lastError.message}`);
        return;
      }
      this._toast.show('success', '触发规则已保存，刷新页面后生效 ✓');
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  PrefsSection
// ═══════════════════════════════════════════════════════════════════════════

class PrefsSection {
  constructor(toast) {
    this._toast          = toast;
    this._preferredAction = document.getElementById('preferred-action');
    this._btnSave        = document.getElementById('btn-save-prefs');
  }

  init() {
    this._btnSave.addEventListener('click', () => this._save());
  }

  load(stored) {
    if (stored.preferredAction) {
      this._preferredAction.value = stored.preferredAction;
    }
  }

  _save() {
    this._btnSave.disabled    = true;
    this._btnSave.textContent = '保存中…';

    chrome.storage.local.set({ preferredAction: this._preferredAction.value }, () => {
      this._btnSave.disabled    = false;
      this._btnSave.textContent = '保存偏好设置';
      if (chrome.runtime.lastError) {
        this._toast.show('error', `保存失败：${chrome.runtime.lastError.message}`);
        return;
      }
      this._toast.show('success', '偏好设置已保存 ✓');
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  OptionsApp — 根节点，组合并初始化所有模块
// ═══════════════════════════════════════════════════════════════════════════

class OptionsApp {
  constructor() {
    const toast = new ToastManager(document.getElementById('toast'));

    this._modules = [
      new NavController(),
      new ApiConfigSection(toast),
      new BasicSettingsSection(toast),
      new LangMatchSection(toast),
      new TriggerRulesSection(toast),
      new PrefsSection(toast),
    ];
  }

  init() {
    // 先让各模块完成 DOM 构建（TriggerRulesSection 动态生成卡片）
    this._modules.forEach((m) => m.init?.());

    // 从 storage 全量读取，回填所有表单
    chrome.storage.local.get(null, (stored) => {
      this._modules.forEach((m) => m.load?.(stored || {}));
    });
  }
}

// ── 启动 ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  new OptionsApp().init();
});
