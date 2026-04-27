/**
 * content_screenshot.js — 多模态层
 *
 * 包含：VisionResultPanel（视觉翻译结果悬浮面板）、
 *       ScreenshotOverlay（全屏 Canvas 截图选区遮罩）
 *
 * 依赖：NS、SVG_CLOSE（content_utils.js）；
 *       DragController（content_drag.js）；
 *       NyaAppearance（appearance.js）
 */

'use strict';

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
    closeBtn.innerHTML = SVG_CLOSE;
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
