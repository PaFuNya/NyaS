# 🚀 发布指南 喵~

本指南帮助你发布NyaTranslate-喵译的新版本喵~

## 📋 发布流程喵~

### 1. 更新版本号喵~

修改 `manifest.json` 中的版本号：

```json
{
  "version": "2.0.0"  // 更新这里喵~
}
```

### 2. 更新更新日志喵~

编辑 `CHANGELOG.md`，添加新版本的更新内容喵~

### 3. 提交更改喵~

```bash
# 添加所有更改
git add .

# 提交
git commit -m "chore: 发布 v2.0.0 喵~"

# 推送
git push origin main
```

### 4. 创建并推送标签喵~

```bash
# 创建标签
git tag -a v2.0.0 -m "Release v2.0.0 喵~"

# 推送标签
git push origin v2.0.0
```

### 5. 发布Release喵~

#### 方法一：GitHub网页界面喵~
1. 访问仓库的 Releases 页面
2. 点击 "Draft a new release"
3. 选择标签 `v2.0.0`
4. 填写Release标题：`🐱 NyaTranslate-喵译 v2.0.0 喵~`
5. 复制 `RELEASE_NOTES.md` 的内容到说明框
6. 上传构建的 `.zip` 文件
7. 点击 "Publish release"

#### 方法二：GitHub CLI喵~
```bash
# 创建Release（草稿模式）
gh release create v2.0.0 \
  --title "🐱 NyaTranslate-喵译 v2.0.0 喵~" \
  --notes-file RELEASE_NOTES.md \
  --draft

# 发布Release
gh release edit v2.0.0 --draft=false
```

#### 方法三：使用GitHub Actions自动发布喵~
1. 推送标签后，GitHub Actions会自动构建并上传到Release
2. 查看 Actions 页面确认构建状态
3. 构建完成后，Release会自动发布

## 🏷️ 版本命名规范喵~

遵循语义化版本控制 (SemVer)：

```
v主版本.次版本.修订号
```

- **主版本**：不兼容的API修改
- **次版本**：向后兼容的功能性新增
- **修订号**：向后兼容的问题修正

示例：
- `v1.0.0` - 首次发布
- `v1.1.0` - 新增功能
- `v1.1.1` - 修复bug
- `v2.0.0` - 重大更新

## 📦 构建产物喵~

发布时应包含的文件：

```
NyaTranslate-v2.0.0.zip
├── manifest.json      # 扩展配置
├── background.js      # 后台脚本
├── content.js         # 内容脚本
├── popup.html         # 弹出页面
├── popup.js           # 弹出页面脚本
├── options.html       # 设置页面
├── options.js         # 设置页面脚本
├── options.css        # 设置页面样式
├── style.css          # 内容样式
└── icons/             # 图标文件夹
```

## ✅ 发布前检查清单喵~

- [ ] 更新 `manifest.json` 版本号
- [ ] 更新 `CHANGELOG.md`
- [ ] 更新 `RELEASE_NOTES.md`
- [ ] 测试所有功能正常
- [ ] 提交并推送代码
- [ ] 创建并推送标签
- [ ] 发布Release
- [ ] 上传构建产物

## 🔧 故障排除喵~

### GitHub Actions构建失败喵~
1. 检查 `.github/workflows/release.yml` 语法
2. 确认仓库有写入权限
3. 查看Actions日志排查问题

### 标签已存在喵~
```bash
# 删除本地标签
git tag -d v2.0.0

# 删除远程标签
git push --delete origin v2.0.0

# 重新创建
git tag -a v2.0.0 -m "Release v2.0.0 喵~"
git push origin v2.0.0
```

---

<p align="center">
  <strong>🐱 发布愉快喵~ 🐱</strong>
</p>
