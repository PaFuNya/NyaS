/**
 * content_drag.js — 交互层
 *
 * 包含：DragController（面板拖拽 + 视口边界碰撞 + RAF 丝滑）、
 *       ResizeController（右下角缩放手柄 + RAF 丝滑）
 *
 * 依赖：无
 *
 * 核心修复说明：
 *   - mousemove / mouseup 统一绑定到 window（覆盖鼠标飞出浏览器的场景）
 *   - DOM 坐标更新严格包裹在 requestAnimationFrame 中，高频事件只更新缓存坐标
 *   - 拖拽开始时 document.body 加 user-select:none，结束后还原，防文本误选
 *   - destroy() 彻底清理 RAF、window 监听和 userSelect 残留
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
//  DragController — 鼠标拖拽面板
// ═══════════════════════════════════════════════════════════════════════════

class DragController {
  constructor(panelEl, handleEl, onDragEnd = null) {
    this._panel     = panelEl;
    this._handle    = handleEl;
    this._onDragEnd = onDragEnd;

    this._active    = false;
    this._rafId     = null;

    // 鼠标起点（clientX/Y）与面板起点（left/top）
    this._ox = 0; this._oy = 0;
    this._pl = 0; this._pt = 0;

    // mousemove 缓存：RAF 帧内读取最新值
    this._curX = 0; this._curY = 0;

    this._down = this._down.bind(this);
    this._move = this._move.bind(this);
    this._up   = this._up.bind(this);

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
    this._curX = e.clientX;
    this._curY = e.clientY;
    this._pl = parseInt(this._panel.style.left, 10) || 0;
    this._pt = parseInt(this._panel.style.top,  10) || 0;

    // ★ 绑定到 window：确保鼠标快速移出窗口后仍能捕获 mouseup
    window.addEventListener('mousemove', this._move, { passive: true });
    window.addEventListener('mouseup',   this._up);

    this._handle.style.cursor    = 'grabbing';
    this._panel.style.transition = 'none';

    // ★ 防止拖拽途中误触发文字选中
    document.body.style.userSelect = 'none';
  }

  _move(e) {
    if (!this._active) return;

    // 仅缓存最新坐标，不直接操作 DOM
    this._curX = e.clientX;
    this._curY = e.clientY;

    // ★ RAF 节流：每帧最多执行一次 DOM 写入
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
        // fixed 定位：直接相对视口约束
        left = Math.max(8, Math.min(this._pl + dx, vw - pw - 8));
        top  = Math.max(8, Math.min(this._pt + dy, vh - ph - 8));
      } else {
        // absolute 定位：叠加滚动偏移约束
        const sx = window.scrollX, sy = window.scrollY;
        left = Math.max(sx + 8, Math.min(this._pl + dx, sx + vw - pw - 8));
        top  = Math.max(sy + 8, Math.min(this._pt + dy, sy + vh - ph - 8));
      }

      this._panel.style.left = `${left}px`;
      this._panel.style.top  = `${top}px`;
    });
  }

  _up() {
    if (!this._active) return;
    this._active = false;

    // ★ 立即取消未执行的 RAF，避免 up 后再次触发残余帧
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    // ★ 从 window 上彻底解绑，不留任何残余监听
    window.removeEventListener('mousemove', this._move);
    window.removeEventListener('mouseup',   this._up);

    this._handle.style.cursor    = 'grab';
    this._panel.style.transition = '';

    // ★ 恢复文字选中能力
    document.body.style.userSelect = '';

    if (typeof this._onDragEnd === 'function') {
      this._onDragEnd();
    }
  }

  destroy() {
    this._handle.removeEventListener('mousedown', this._down);
    window.removeEventListener('mousemove', this._move);
    window.removeEventListener('mouseup',   this._up);
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    // 兜底清理（面板被强制销毁时 _up 可能未执行）
    document.body.style.userSelect = '';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  ResizeController — 面板右下角缩放手柄
// ═══════════════════════════════════════════════════════════════════════════

class ResizeController {
  constructor(panelEl, handleEl, options = {}) {
    this._panel     = panelEl;
    this._handle    = handleEl;
    this._minWidth  = options.minWidth  ?? 300;
    this._minHeight = options.minHeight ?? 200;

    this._active = false;
    this._rafId  = null;

    this._ox = 0; this._oy = 0;
    this._ow = 0; this._oh = 0;

    // mousemove 缓存
    this._curX = 0; this._curY = 0;

    this._down = this._down.bind(this);
    this._move = this._move.bind(this);
    this._up   = this._up.bind(this);

    handleEl.addEventListener('mousedown', this._down);
  }

  _down(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    this._active = true;
    this._ox   = e.clientX;
    this._oy   = e.clientY;
    this._curX = e.clientX;
    this._curY = e.clientY;
    this._ow   = this._panel.offsetWidth;
    this._oh   = this._panel.offsetHeight;

    // ★ 绑定到 window
    window.addEventListener('mousemove', this._move, { passive: true });
    window.addEventListener('mouseup',   this._up);

    this._panel.style.transition   = 'none';
    document.body.style.userSelect = 'none';
  }

  _move(e) {
    if (!this._active) return;

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

  _up() {
    if (!this._active) return;
    this._active = false;

    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    window.removeEventListener('mousemove', this._move);
    window.removeEventListener('mouseup',   this._up);

    this._panel.style.transition   = '';
    document.body.style.userSelect = '';
  }

  destroy() {
    this._handle.removeEventListener('mousedown', this._down);
    window.removeEventListener('mousemove', this._move);
    window.removeEventListener('mouseup',   this._up);
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    document.body.style.userSelect = '';
  }
}
