# 快速开始指南

## 方法一：使用符号链接（推荐，用于开发）

### 步骤：

1. **运行链接脚本**（需要管理员权限）
   - 右键点击 `link-to-vault.bat`
   - 选择"以管理员身份运行"
   
   这会创建符号链接，把项目文件链接到你的 vault。

2. **启动开发模式**
   ```bash
   npm run dev
   ```
   
   现在每次你修改代码，esbuild 会自动重新构建 `main.js`。

3. **在 Obsidian 中启用插件**
   - 打开 Obsidian
   - 进入 Settings → Community plugins
   - 打开 "Safe mode" 开关（关闭安全模式）
   - 刷新插件列表
   - 找到 "Opencodian" 并启用

4. **重新加载插件**（每次修改后）
   - 按 `Ctrl+Shift+I` 打开开发者工具
   - 在控制台输入：`app.plugins.disablePlugin('opencodian')`
   - 然后：`app.plugins.enablePlugin('opencodian')`
   - 或者直接重启 Obsidian

### 优点：
- ✅ 修改代码后不需要手动复制文件
- ✅ 只需重新加载插件即可看到效果
- ✅ 开发体验最佳

---

## 方法二：手动复制（用于分发）

### 步骤：

1. **构建插件**
   ```bash
   npm run build
   ```

2. **手动复制文件**
   把这三个文件复制到：
   `D:\PersonalObsidianVault\PersonalObsidianVault\.obsidian\plugins\opencodian\`
   
   - `main.js`
   - `manifest.json`
   - `styles.css`

3. **在 Obsidian 中启用插件**（同上）

### 优点：
- ✅ 不需要管理员权限
- ✅ 适合给别人安装

---

## 使用插件

启用后，你可以：

1. **点击左侧栏的机器人图标** 🤖
   - 或者使用命令面板：`Ctrl/Cmd+P` → 输入 "Open Opencodian"

2. **开始聊天**
   - 在输入框输入消息
   - 按 Enter 发送（Shift+Enter 换行）
   - 当前是模拟响应，显示 "OpenCode integration coming soon..."

3. **修改设置**
   - Settings → Opencodian
   - 可以设置用户名、权限模式等

---

## 开发调试

### 查看日志
按 `Ctrl+Shift+I` 打开开发者工具的控制台

### 类型检查
```bash
npm run typecheck
```

### 代码规范检查
```bash
npm run lint
```

---

## 常见问题

**Q: 符号链接创建失败？**
A: 需要以管理员身份运行 `link-to-vault.bat`

**Q: 插件列表看不到 Opencodian？**
A: 确保已关闭 Safe mode，并重启 Obsidian

**Q: 修改代码后没有效果？**
A: 
1. 确保 `npm run dev` 正在运行
2. 重新加载插件或重启 Obsidian
3. 检查控制台是否有错误

**Q: 如何删除符号链接？**
A: 直接删除 vault 中的 `opencodian` 文件夹即可

---

## 下一步

现在你已经有了一个可运行的插件框架！

接下来可以：
1. 阅读 `DEVELOPMENT.md` 了解架构
2. 研究 OpenCode 的 API
3. 修改 `src/core/agent/OpenCodeService.ts` 集成真实功能
4. 享受开发过程！🚀
