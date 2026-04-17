/**
 * 图标生成脚本（Node.js 环境运行）
 * 用途：在没有设计资源时，临时生成纯色 PNG 图标以满足 manifest.json 的要求。
 *
 * 运行方式：
 *   node generate-icons.js
 *
 * 依赖：Node.js 内置的 canvas 模块（若未安装，运行 npm install canvas）
 *
 * 生成后会在 icons/ 目录下生成 icon16.png, icon48.png, icon128.png。
 */

// 方式一：使用浏览器 Canvas API（在 Chrome 开发者控制台运行此代码，另存为 PNG）
// ──────────────────────────────────────────────────────────────────────────────
// 将以下代码粘贴至 Chrome 任意页面的 DevTools Console 中运行，
// 浏览器会自动下载三个图标文件。

const script = `
[16, 48, 128].forEach(size => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // 背景：渐变蓝紫色
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#5b6af0');
  gradient.addColorStop(1, '#7c3aed');
  ctx.fillStyle = gradient;

  // 圆角矩形（使用圆形简化）
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();

  // 中心文字 "词"
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold ' + Math.floor(size * 0.45) + 'px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('词', size / 2, size / 2);

  // 下载
  const link = document.createElement('a');
  link.download = 'icon' + size + '.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});
`;

console.log('=== 图标生成说明 ===\n');
console.log('请将以下代码复制并粘贴至 Chrome DevTools Console 中运行：\n');
console.log(script);
console.log('\n图标下载后，将三个文件放入 icons/ 目录即可。');
