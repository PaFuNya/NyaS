# NyaTranslate Chrome 扩展

一个基于 Manifest V3 的 Chrome 扩展，在用户划词选中文本后弹出悬浮面板，提供**翻译**和**专业术语解释**功能。

## 项目结构

```
selection-helper/
├── manifest.json          # 扩展清单（MV3）
├── content.js             # 内容脚本：划词监听、面板注入、UI 交互
├── background.js          # Service Worker：API 请求代理
├── style.css              # 悬浮面板样式（my-ext- 命名空间隔离）
├── generate-icons.js      # 临时图标生成说明脚本
└── icons/
    ├── icon16.png         # 扩展工具栏小图标（需自行生成/替换）
    ├── icon48.png
    └── icon128.png
```

## 快速开始

### 加载扩展到 Chrome

1. 打开 Chrome，地址栏输入 `chrome://extensions/`
2. 右上角开启**开发者模式**
3. 点击**加载已解压的扩展程序**
4. 选择本项目的 `selection-helper/` 目录
5. 扩展加载成功后，在任意网页上划词即可看到悬浮面板

## 功能说明

| 功能 | 描述 |
|------|------|
| 划词弹出面板 | 选中任意文本后，鼠标松开即触发 |
| 翻译按钮 | 发送文本至翻译接口，展示翻译结果 |
| 解释术语按钮 | 发送文本至术语解释接口，展示详细解释 |
| Loading 状态 | 请求进行中显示动画，防止重复点击 |
| 错误处理 | API 失败时展示友好错误提示 |
| 自动隐藏 | 点击空白处、滚动页面或按 Esc 关闭面板 |

## 对接真实 API

修改 `background.js` 顶部的 `API_CONFIG` 配置，并将 `mockFetchTranslate` / `mockFetchExplain` 函数中注释掉的真实 `fetch` 代码块解除注释。

```js
// background.js
const API_CONFIG = {
  apiKey: 'your-real-api-key',
  translateUrl: 'https://your-api.com/translate',
  explainUrl: 'https://your-api.com/explain',
};
```

若需要访问其他来源的 API，还需在 `manifest.json` 的 `host_permissions` 字段中添加对应域名：

```json
"host_permissions": ["https://your-api.com/*"]
```

## 设计规范

- 所有 CSS 类名和 ID 均以 `my-ext-` 为前缀，避免污染宿主页面样式
- `content.js` 使用 IIFE 包裹，防止全局变量泄漏
- 面板使用 `all: initial` 重置继承样式，确保在各类网页上渲染一致
