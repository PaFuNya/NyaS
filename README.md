# 🐱 NyaTranslate-喵译

<p align="center">
  <strong>AI驱动的翻译与术语解释Chrome扩展 | 猫娘主题 · 精美动画 · 优雅体验</strong>
</p>


<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-green" alt="Manifest V3">
  <img src="https://img.shields.io/badge/许可-MIT-yellow" alt="许可证">
</p>

## ✨ 简介

**NyaTranslate-喵译** 是一款现代化的 Chrome 浏览器扩展，专为需要频繁翻译和查阅专业术语的用户设计。它不仅提供精准的 AI 翻译和术语解释，还拥有令人愉悦的猫娘主题界面和流畅的动画效果，让翻译工作变得轻松有趣喵~

### 🎯 核心功能

- **智能划词翻译**：在任意网页划选文字，即刻获得翻译结果
- **专业术语解释**：获取选中文档的详细解释和上下文含义
- **双AI引擎支持**：DeepSeek 与 通义千问 双重支持，智能切换

## 🚀 特性

### ⚡ **核心功能**
- **多种触发方式**：图标点击、双击文字、组合键等
- **智能语言检测**：自动检测源语言，智能匹配目标语言
- **实时翻译**：毫秒级响应，翻译结果即时显示
- **专业术语库**：针对技术文档、学术论文的专业解释
- **历史记录**：自动保存最近的翻译记录（即将推出）

### 🔧 **技术特性**
- **Manifest V3**：采用最新的 Chrome 扩展标准
- **CSS隔离**：所有样式以 `my-ext-` 为前缀，避免污染页面
- **模块化设计**：清晰的文件结构和职责分离
- **错误处理**：完善的错误提示和恢复机制

## 📸 截图展示

### 设置页面
<img width="1223" height="886" alt="image" src="https://github.com/user-attachments/assets/272d2534-c610-4251-9d3d-55e87fc98438" />

*蓝白色主题，侧边栏滑入动画，卡片淡入效果喵~*

### 划词翻译
![划词翻译](https://via.placeholder.com/800x450/3a8eef/ffffff?text=划词翻译演示+喵~)
*在网页上划选文字，弹出翻译面板喵~*

### 弹出窗口
![弹出窗口](https://via.placeholder.com/400x600/5b6af0/ffffff?text=弹出窗口+喵~)
*扩展图标点击后的快速操作面板喵~*

> **提示**：以上为占位图片，实际使用时请替换为真实截图喵~

## 📦 安装指南

### 方法一：加载已解压的扩展（推荐）
1. **下载最新版本**：从 [Releases](https://github.com/your-username/NyaTranslate/releases) 页面下载 `NyaTranslate-v2.0.0.zip`
2. **解压文件**：将压缩包解压到本地文件夹
3. **打开扩展管理**：Chrome浏览器地址栏输入 `chrome://extensions/`
4. **开启开发者模式**：点击右上角的"开发者模式"开关
5. **加载扩展**：点击"加载已解压的扩展程序"按钮
6. **选择文件夹**：选择刚才解压的文件夹
7. **完成**：扩展已成功加载，可以在任意网页上使用喵~

### 方法二：开发者模式（代码贡献者）
```bash
# 克隆仓库
git clone https://github.com/your-username/NyaTranslate.git

# 进入项目目录
cd NyaTranslate

# 安装依赖（如果有的话）
# npm install

# 在Chrome中加载
# 打开 chrome://extensions/ → 开启开发者模式 → 加载已解压的扩展程序 → 选择当前目录
```

### 系统要求
- **Chrome 浏览器**：版本 88 或更高（支持 Manifest V3）
- **操作系统**：Windows 10/11, macOS 10.15+, Linux
- **网络连接**：需要访问 DeepSeek 或 通义千问 API

## 🎮 使用指南

### 基础使用
1. **划词翻译**：在任意网页上，用鼠标划选想要翻译的文字
2. **触发面板**：松开鼠标后，翻译面板会自动弹出
3. **选择功能**：点击"翻译"或"解释"按钮获取结果
4. **关闭面板**：点击空白处、按 Esc 键或滚动页面

### 触发方式
在设置页面可以配置不同的触发方式：
- **图标触发**：划词后点击气泡图标
- **双击触发**：双击划选的文字
- **组合键触发**：按住 Ctrl/Alt/Shift 键划词
- **自动触发**：划词后自动显示面板

### 配置 API 密钥
1. 点击扩展图标，选择"打开设置"
2. 进入"API配置"页面
3. 输入你的 DeepSeek 或 通义千问 API 密钥
4. 点击"保存"按钮

### 高级设置
- **语言匹配**：设置源语言和目标语言
- **触发规则**：根据网站类型配置不同的触发方式
- **界面主题**：切换亮色/暗色模式（即将推出）
- **快捷键**：自定义翻译快捷键

## ⚙️ 配置说明

### API 配置
扩展支持以下 AI 服务：
- **DeepSeek**：免费额度充足，响应快速
- **通义千问**：阿里云出品，中文优化

### 配置文件
主要配置文件位于 `manifest.json` 和 `background.js`：

```json
// manifest.json 关键配置
{
  "name": "NyaTranslate-喵译",
  "version": "2.0.0",
  "host_permissions": [
    "https://api.deepseek.com/*",
    "https://dashscope.aliyuncs.com/*"
  ]
}
```

```javascript
// background.js API 配置
const API_CONFIG = {
  deepseek: {
    apiKey: 'your-deepseek-api-key',
    endpoint: 'https://api.deepseek.com/chat/completions'
  },
  qwen: {
    apiKey: 'your-qwen-api-key', 
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
  }
};
```

## 🛠️ 开发指南

### 项目结构
```
NyaTranslate/
├── .github/                    # GitHub Actions 工作流
│   └── workflows/
│       └── release.yml         # 自动发布配置
├── icons/                      # 扩展图标
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── CHANGELOG.md               # 版本更新日志
├── RELEASE_NOTES.md           # 发布说明模板
├── README.md                  # 项目说明文档
├── background.js              # Service Worker，API 请求代理
├── content.js                 # 内容脚本，划词监听和面板注入
├── generate-icons.js          # 图标生成脚本
├── manifest.json              # 扩展清单 (Manifest V3)
├── options.css                # 设置页面样式（猫娘主题）
├── options.html               # 设置页面 HTML
├── options.js                 # 设置页面 JavaScript
├── popup.html                 # 弹出窗口 HTML
├── popup.js                   # 弹出窗口 JavaScript
└── style.css                  # 悬浮面板样式
```

### 开发环境搭建
1. **克隆代码**：`git clone https://github.com/your-username/NyaTranslate.git`
2. **修改代码**：使用 VS Code 或其他编辑器
3. **实时测试**：在 Chrome 中重新加载扩展即可看到更改
4. **调试工具**：使用 Chrome 开发者工具进行调试

### 构建与发布
项目包含 GitHub Actions 自动发布流程：
```yaml
# .github/workflows/release.yml
on:
  release:
    types: [published]
  push:
    tags:
      - 'v*'
```

发布新版本步骤：
1. 更新 `manifest.json` 中的版本号
2. 更新 `CHANGELOG.md` 记录更改
3. 创建 Git 标签：`git tag -a v2.0.0 -m "发布 v2.0.0"`
4. 推送标签：`git push origin v2.0.0`
5. 在 GitHub 创建 Release

## 🤝 贡献指南

我们欢迎各种形式的贡献喵~

### 如何贡献
1. **报告问题**：在 Issues 页面报告 bug 或提出功能建议
2. **提交代码**：Fork 仓库，创建分支，提交 Pull Request
3. **改进文档**：完善 README、注释或翻译文档
4. **分享创意**：提出新的功能想法或设计建议

### 开发规范
- **代码风格**：遵循现有的代码格式和命名约定
- **提交信息**：使用清晰的提交信息，说明更改内容
- **测试**：确保更改不会破坏现有功能
- **文档**：更新相关文档以反映更改

### 待开发功能
- [ ] 暗色模式支持
- [ ] 翻译历史记录
- [ ] 多语言界面
- [ ] 离线缓存
- [ ] 浏览器同步
- [ ] 更多 AI 模型支持

## 📄 许可证

本项目采用 [MIT 许可证](LICENSE)。

```
MIT License

Copyright (c) 2026 NyaTranslate Team

Permission is hereby granted, free of charge, to any person obtaining a copy
...
```

## 🙏 致谢

感谢以下项目和服务：
- **Chrome Extensions API**：提供强大的浏览器扩展能力
- **DeepSeek**：提供优质的免费 AI 翻译服务
- **通义千问**：阿里云的优秀大语言模型
- **所有贡献者**：感谢每一位为项目做出贡献的朋友

## 📞 联系与支持

- **问题反馈**：[GitHub Issues](https://github.com/your-username/NyaTranslate/issues)
- **功能建议**：在 Issues 中提出
- **代码贡献**：提交 Pull Request
- **使用帮助**：查阅本文档或 Issues 中的常见问题

---

<p align="center">
  Made with ❤️ and 🐱 by NyaTranslate Team
</p>

<p align="center">
  <sub>如果喜欢这个项目，请给我们一个 Star 喵~ ⭐</sub>
</p>
