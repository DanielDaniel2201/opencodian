# Opencodian 开发指南

## 项目概述

Opencodian 是一个 Obsidian 插件，将 OpenCode AI 集成到 Obsidian 侧边栏中，提供聊天界面和文件操作能力。

## 基础知识

### 1. Obsidian 插件架构

#### Plugin 类
主入口类，继承自 Obsidian 的 `Plugin`：
- `onload()`: 插件加载时调用，初始化所有功能
- `onunload()`: 插件卸载时调用，清理资源
- `loadSettings()` / `saveSettings()`: 持久化设置

#### ItemView 类
自定义视图（如侧边栏面板）：
- `getViewType()`: 返回视图唯一标识符
- `getDisplayText()`: 视图标题
- `getIcon()`: 图标名称
- `onOpen()`: 视图打开时渲染 UI
- `onClose()`: 视图关闭时清理

#### PluginSettingTab 类
设置界面：
- `display()`: 渲染设置选项

### 2. 项目架构

```
src/
├── main.ts                          # 插件入口 (OpencodianPlugin)
├── core/                            # 核心基础设施
│   ├── agent/                       # AI 集成层
│   │   ├── OpenCodeService.ts       # OpenCode 服务封装
│   │   └── index.ts
│   └── types/                       # TypeScript 类型定义
│       ├── chat.ts                  # 聊天相关类型
│       ├── settings.ts              # 设置类型
│       └── index.ts
├── features/                        # 功能模块
│   ├── chat/                        # 聊天功能
│   │   └── OpencodianView.ts        # 聊天视图
│   └── settings/                    # 设置功能
│       └── OpencodianSettings.ts    # 设置界面
└── utils/                           # 工具函数（未来扩展）
```

## 核心概念

### 1. 消息流处理（Streaming）

OpenCode 的响应是流式的，使用 AsyncGenerator：

```typescript
async *query(prompt: string): AsyncGenerator<StreamChunk> {
  yield { type: 'text', content: 'Hello' };
  yield { type: 'done' };
}
```

在 UI 中消费：
```typescript
for await (const chunk of service.query(prompt)) {
  if (chunk.type === 'text') {
    // 更新 UI 显示文本
  }
}
```

### 2. 会话管理（Conversation）

每个会话包含：
- `id`: 唯一标识符
- `title`: 会话标题
- `messages`: 消息数组（user 和 assistant）
- `sessionId`: OpenCode 的会话 ID（保持上下文）

### 3. 数据持久化

使用 Obsidian 的 `loadData()` 和 `saveData()`：
- 设置保存在 `.obsidian/plugins/opencodian/data.json`
- 包括会话历史、用户偏好等

## 关键文件说明

### src/main.ts
插件主入口，负责：
- 初始化 OpenCodeService
- 注册视图和命令
- 管理会话生命周期
- 保存/加载设置

关键方法：
- `activateView()`: 打开聊天侧边栏
- `createConversation()`: 创建新会话
- `getActiveConversation()`: 获取当前活动会话

### src/core/agent/OpenCodeService.ts
与 OpenCode 的接口层：
- `query()`: 发送提示词，返回流式响应
- `cancel()`: 取消当前查询
- `resetSession()`: 重置会话
- `cleanup()`: 清理资源

**TODO**: 需要集成实际的 OpenCode API/CLI

### src/features/chat/OpencodianView.ts
聊天界面，负责：
- 渲染消息列表
- 处理用户输入
- 显示流式响应
- 滚动管理

UI 结构：
```
opencodian-container
├── opencodian-messages (消息列表)
│   └── message (单条消息)
│       ├── message-role (角色标签)
│       └── message-content (内容)
└── opencodian-input-container (输入区)
    ├── textarea (输入框)
    └── button (发送按钮)
```

### src/core/types/
TypeScript 类型定义：

**chat.ts**:
- `ChatMessage`: 单条消息
- `Conversation`: 会话
- `StreamChunk`: 流式响应块
- `ImageAttachment`: 图片附件（未来扩展）

**settings.ts**:
- `OpencodianSettings`: 插件设置
- `DEFAULT_SETTINGS`: 默认配置
- `VIEW_TYPE_OPENCODIAN`: 视图类型常量

## 开发流程

### 1. 初始设置

```bash
# 安装依赖
npm install

# 配置开发环境（可选）
echo "OBSIDIAN_VAULT=/path/to/your/vault" > .env.local
```

### 2. 开发模式

```bash
# 启动监听模式
npm run dev
```

这会：
- 监听 `src/` 下的文件变化
- 自动编译到 `main.js`
- 如果设置了 `OBSIDIAN_VAULT`，自动复制到 vault 插件目录

### 3. 在 Obsidian 中测试

1. 打开 Obsidian
2. 进入 Settings → Community plugins
3. 启用 Developer mode
4. 重新加载插件（或重启 Obsidian）
5. 启用 Opencodian

### 4. 调试

使用 Obsidian 的开发者工具：
- 按 `Ctrl/Cmd + Shift + I` 打开
- 在 Console 中查看日志
- 使用 `console.log()` 调试

## 下一步扩展

### 优先级高
1. **集成 OpenCode API**
   - 研究 OpenCode 的 API/CLI 接口
   - 实现真实的查询功能
   - 处理错误和超时

2. **工具调用支持**
   - 实现文件读写
   - 实现代码执行
   - 权限管理（Safe 模式）

3. **会话历史**
   - 历史会话列表
   - 删除/重命名会话
   - 导入/导出

### 优先级中
4. **图片支持**
   - 拖放上传
   - 粘贴图片
   - Vision API 集成

5. **UI 增强**
   - Markdown 渲染
   - 代码高亮
   - 思考过程显示
   - 工具调用可视化

6. **高级功能**
   - Slash 命令
   - 自定义指令
   - MCP 服务器集成

## 常见问题

### Q: 如何修改默认设置？
A: 编辑 `src/core/types/settings.ts` 中的 `DEFAULT_SETTINGS`

### Q: 如何添加新的消息类型？
A: 在 `src/core/types/chat.ts` 中扩展 `StreamChunk` 类型

### Q: 样式怎么修改？
A: 编辑 `styles.css`，使用 Obsidian 的 CSS 变量

### Q: 如何调试构建错误？
A: 运行 `npm run typecheck` 查看类型错误

## 参考资源

- [Obsidian Plugin API](https://docs.obsidian.md/Plugins)
- [Claudian 源码](./reference/claudian/) - 参考架构
- [TypeScript 文档](https://www.typescriptlang.org/docs/)

## 学习路线

1. ✅ **基础框架** - 理解插件结构
2. **消息流** - 理解 AsyncGenerator 和流式处理
3. **OpenCode 集成** - 研究 API，实现真实功能
4. **UI 交互** - 完善用户体验
5. **高级功能** - 工具调用、MCP 等

享受构建的过程！🚀
