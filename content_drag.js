/**
 * content_drag.js — 交互层
 *
 * 包含：DragController（面板拖拽）、ResizeController（右下角缩放手柄）
 *
 * 依赖：无
 *
 * 核心机制：Pointer Events API + setPointerCapture
 *   - pointerdown 触发时立即调用 setPointerCapture，浏览器将后续所有指针事件
 *     强制路由到捕获元素，彻底绕过宿主页面 iframe / Canvas / 其他拦截元素；
 *   - pointermove / pointerup / pointercancel 均绑在 handleEl 本身，
 *     无需 window 级别委托，也无需 window.blur 兜底；
 *   - pointercancel 覆盖触控板手势冲突、系统弹窗等 Mouse Events 无法感知的取消；
 *   - touch-action:none + ondragstart:false 从 CSS/JS 双层封杀原生拖拽干扰；
 *   - RAF 节流保证每帧最多一次 DOM 写入，边界约束防面板拖飞。
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
//  DragController — 面板拖拽（Pointer Events + Pointer Capture）
// ═══════════════════════════════════════════════════════════════════════════

class DragController {
  constructor(panelEl, handleEl, onDragEnd = null) {
    this._panel     = panelEl;
    this._handle    = handleEl;
    this._onDragEnd = onDragEnd;

    this._active    = false;
    this._rafId     = null;
    this._pointerId = null;  // 记录当前活跃指针 ID

    // 指针起点（clientX/Y）与面板起点（left/top px）
    this._ox = 0; this._oy = 0;
    this._pl = 0; this._pt = 0;

    // pointermove 高频缓存：只在 RAF 帧内写 DOM
    this._curX = 0; this._curY = 0;

    // 预存绑定引用，addEventListener / removeEventListener 使用同一变量
    this._boundPointerDown   = this.handlePointerDown.bind(this);
    this._boundPointerMove   = this.handlePointerMove.bind(this);
    this._boundPointerUp     = this.handlePointerUp.bind(this);
    this._boundPointerCancel = this.handlePointerCancel.bind(this);

    // 核心 2：CSS + JS 双层封杀原生拖拽
    handleEl.style.touchAction    = 'none';   // Pointer Capture 必需
    handleEl.style.userSelect     = 'none';
    handleEl.style.webkitUserDrag = 'none';
    handleEl.ondragstart          = () => false;
    handleEl.style.cursor         = 'grab';

    handleEl.addEventListener('pointerdown', this._boundPointerDown);
  }

  // 核心 2：preventDefault 绝对置首，封死原生拖拽对后续事件的拦截
  handlePointerDown(e) {
    e.preventDefault();
    if (e.button !== 0) return;  // 仅响应左键（touch 的 button 也为 0）
    if (e.target.closest('button') || e.target.closest('select')) return;
    e.stopPropagation();

    // 核心 1：指针捕获——后续所有指针事件强制路由到此元素
    e.target.setPointerCapture(e.pointerId);
    this._pointerId = e.pointerId;

    this._active = true;
    this._ox   = e.clientX;
    this._oy   = e.clientY;
    this._curX = e.clientX;
    this._curY = e.clientY;
    this._pl   = parseInt(this._panel.style.left, 10) || 0;
    this._pt   = parseInt(this._panel.style.top,  10) || 0;

    // 监听绑在 handleEl 自身：capture 保证无论指针飞到哪里都能送达
    this._handle.addEventListener('pointermove',   this._boundPointerMove);
    this._handle.addEventListener('pointerup',     this._boundPointerUp);
    this._handle.addEventListener('pointercancel', this._boundPointerCancel);

    this._handle.style.cursor      = 'grabbing';
    this._panel.style.transition   = 'none';
    document.body.style.userSelect = 'none';
  }

  handlePointerMove(e) {
    if (e.pointerId !== this._pointerId) return;  // 忽略多点触控的其他指针

    // 仅缓存坐标，不直接操作 DOM
    this._curX = e.clientX;
    this._curY = e.clientY;

    // 核心 3：RAF 节流——同一帧内多次 pointermove 只触发一次布局
    if (this._rafId !== null) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      if (!this._active) return;

      const dx = this._curX - this._ox;
      const dy = this._curY - this._oy;
      const pw = this._panel.offsetWidth;
      const ph = this._panel.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const isFixed = this._panel.style.position === 'fixed';

      let left, top;
      if (isFixed) {
        // fixed 定位：相对视口约束，面板不得飞出屏幕
        left = Math.max(8, Math.min(this._pl + dx, vw - pw - 8));
        top  = Math.max(8, Math.min(this._pt + dy, vh - ph - 8));
      } else {
        // absolute 定位：叠加滚动偏移后约束
        const sx = window.scrollX, sy = window.scrollY;
        left = Math.max(sx + 8, Math.min(this._pl + dx, sx + vw - pw - 8));
        top  = Math.max(sy + 8, Math.min(this._pt + dy, sy + vh - ph - 8));
      }

      this._panel.style.left = `${left}px`;
      this._panel.style.top  = `${top}px`;
    });
  }

  handlePointerUp(e) {
    if (e.pointerId !== this._pointerId) return;
    // pointerup 时浏览器已自动释放 capture，显式调用更保险
    if (this._handle.hasPointerCapture(e.pointerId)) {
      this._handle.releasePointerCapture(e.pointerId);
    }
    this._stopDrag();
  }

  // 核心 4（兜底）：系统弹窗、触控板手势冲突等系统级取消
  handlePointerCancel(e) {
    if (e.pointerId !== this._pointerId) return;
    this._stopDrag();
  }

  _stopDrag() {
    if (!this._active) return;
    this._active    = false;
    this._pointerId = null;

    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    this._handle.removeEventListener('pointermove',   this._boundPointerMove);
    this._handle.removeEventListener('pointerup',     this._boundPointerUp);
    this._handle.removeEventListener('pointercancel', this._boundPointerCancel);

    this._handle.style.cursor      = 'grab';
    this._panel.style.transition   = '';
    document.body.style.userSelect = '';

    this._onDragEnd?.();
  }

  destroy() {
    this._handle.removeEventListener('pointerdown',   this._boundPointerDown);
    this._handle.removeEventListener('pointermove',   this._boundPointerMove);
    this._handle.removeEventListener('pointerup',     this._boundPointerUp);
    this._handle.removeEventListener('pointercancel', this._boundPointerCancel);

    // 兜底释放（面板被强制销毁时 _stopDrag 可能未执行）
    if (this._pointerId !== null && this._handle.hasPointerCapture(this._pointerId)) {
      this._handle.releasePointerCapture(this._pointerId);
    }
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    document.body.style.userSelect = '';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  ResizeController — 面板右下角缩放手柄（Pointer Events + Pointer Capture）
// ═══════════════════════════════════════════════════════════════════════════

class ResizeController {
  constructor(panelEl, handleEl, options = {}) {
    this._panel     = panelEl;
    this._handle    = handleEl;
    this._minWidth  = options.minWidth  ?? 300;
    this._minHeight = options.minHeight ?? 200;

    this._active    = false;
    this._rafId     = null;
    this._pointerId = null;

    this._ox = 0; this._oy = 0;
    this._ow = 0; this._oh = 0;

    this._curX = 0; this._curY = 0;

    this._boundPointerDown   = this.handlePointerDown.bind(this);
    this._boundPointerMove   = this.handlePointerMove.bind(this);
    this._boundPointerUp     = this.handlePointerUp.bind(this);
    this._boundPointerCancel = this.handlePointerCancel.bind(this);

    // 封杀原生拖拽
    handleEl.style.touchAction    = 'none';
    handleEl.style.userSelect     = 'none';
    handleEl.style.webkitUserDrag = 'none';
    handleEl.ondragstart          = () => false;

    handleEl.addEventListener('pointerdown', this._boundPointerDown);
  }

  handlePointerDown(e) {
    e.preventDefault();
    if (e.button !== 0) return;
    e.stopPropagation();

    e.target.setPointerCapture(e.pointerId);
    this._pointerId = e.pointerId;

    this._active = true;
    this._ox   = e.clientX;
    this._oy   = e.clientY;
    this._curX = e.clientX;
    this._curY = e.clientY;
    this._ow   = this._panel.offsetWidth;
    this._oh   = this._panel.offsetHeight;

    this._handle.addEventListener('pointermove',   this._boundPointerMove);
    this._handle.addEventListener('pointerup',     this._boundPointerUp);
    this._handle.addEventListener('pointercancel', this._boundPointerCancel);

    this._panel.style.transition   = 'none';
    document.body.style.userSelect = 'none';
  }

  handlePointerMove(e) {
    if (e.pointerId !== this._pointerId) return;

    this._curX = e.clientX;
    this._curY = e.clientY;

    if (this._rafId !== null) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      if (!this._active) return;

      const newW = Math.max(this._minWidth,  this._ow + (this._curX - this._ox));
      const newH = Math.max(this._minHeight, this._oh + (this._curY - this._oy));

      this._panel.style.width  = `${newW}px`;
      this._panel.style.height = `${newH}px`;
    });
  }

  handlePointerUp(e) {
    if (e.pointerId !== this._pointerId) return;
    if (this._handle.hasPointerCapture(e.pointerId)) {
      this._handle.releasePointerCapture(e.pointerId);
    }
    this._stopResize();
  }

  handlePointerCancel(e) {
    if (e.pointerId !== this._pointerId) return;
    this._stopResize();
  }

  _stopResize() {
    if (!this._active) return;
    this._active    = false;
    this._pointerId = null;

    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    this._handle.removeEventListener('pointermove',   this._boundPointerMove);
    this._handle.removeEventListener('pointerup',     this._boundPointerUp);
    this._handle.removeEventListener('pointercancel', this._boundPointerCancel);

    this._panel.style.transition   = '';
    document.body.style.userSelect = '';
  }

  destroy() {
    this._handle.removeEventListener('pointerdown',   this._boundPointerDown);
    this._handle.removeEventListener('pointermove',   this._boundPointerMove);
    this._handle.removeEventListener('pointerup',     this._boundPointerUp);
    this._handle.removeEventListener('pointercancel', this._boundPointerCancel);

    if (this._pointerId !== null && this._handle.hasPointerCapture(this._pointerId)) {
      this._handle.releasePointerCapture(this._pointerId);
    }
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    document.body.style.userSelect = '';
  }
}
