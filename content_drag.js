/**
 * content_drag.js — 交互层
 *
 * 包含：DragController（面板拖拽 + 视口边界碰撞）、
 *       ResizeController（右下角缩放手柄）
 *
 * 依赖：无
 */

'use strict';

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
