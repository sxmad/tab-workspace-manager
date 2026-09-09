# Tab Workspace Manager 实施计划

## 1. 当前阶段目标

先完成最基础、最关键的能力：**同步现有窗口、Chrome Tab Group 和 Tab，并在 Side Panel 中展示和跳转**。

这个阶段不做复杂 Workspace、自定义分组、Dashboard 和云同步，先把用户当前已经打开的浏览器状态纳入插件管理。

## 2. 实施顺序

### 2.1 插件基础骨架

- 创建 Manifest V3 配置。
- 注册 background service worker。
- 注册 Side Panel 页面。
- 配置基础权限：
  - `tabs`
  - `tabGroups`
  - `windows`
  - `storage`
  - `sidePanel`

### 2.2 同步现有浏览器状态

- 使用 `chrome.windows.getAll({ populate: true })` 获取所有普通窗口和标签。
- 使用 `chrome.tabGroups.query({})` 获取所有原生 Tab Group 元数据。
- 将 Chrome 运行态转换为插件 Runtime State：
  - Window
  - Group
  - Tab
  - Ungrouped Tabs
- 保存同步摘要：
  - 窗口数量
  - 分组数量
  - 标签数量
  - 同步时间

### 2.3 持续同步

监听以下事件并 debounce 后重新同步：

- `chrome.tabs.onCreated`
- `chrome.tabs.onRemoved`
- `chrome.tabs.onMoved`
- `chrome.tabs.onAttached`
- `chrome.tabs.onDetached`
- `chrome.tabs.onUpdated`
- `chrome.tabs.onActivated`
- `chrome.windows.onCreated`
- `chrome.windows.onRemoved`
- `chrome.windows.onFocusChanged`
- `chrome.tabGroups.onCreated`
- `chrome.tabGroups.onRemoved`
- `chrome.tabGroups.onUpdated`
- `chrome.tabGroups.onMoved`

### 2.4 Side Panel 展示

- 展示同步摘要。
- 按窗口展示所有分组。
- 每个分组展示：
  - 名称
  - 颜色
  - Tab 数量
  - 是否当前活跃
- 展开分组后展示组内 Tab。
- 展示未分组 Tab。

### 2.5 基础操作

- 点击 Tab：聚焦窗口并激活该 Tab。
- 点击 Group：聚焦窗口、展开 Chrome Tab Group，并激活该组最近使用的 Tab。
- 手动同步按钮：重新读取当前浏览器状态。
- 搜索：按 Group 名称、Tab 标题、URL、域名过滤。

## 3. 后续阶段

### 阶段 2：自定义 Workspace / Group

- 创建插件自定义 Workspace。
- 创建插件自定义 Group。
- 将当前 Tab / URL 加入自定义 Group。
- 从 Chrome 原生 Tab Group 导入为自定义 Group。

### 阶段 3：Workspace 打开 / 保存 / 恢复

- 保存当前窗口为 Workspace。
- 恢复 Workspace 时创建 Chrome Tab Group。
- 关闭 Workspace 但保留 URL。
- 避免重复打开已存在 Tab。

### 阶段 4：Dashboard

- 整页展示所有 Workspace / Group。
- 批量整理、移动、关闭、休眠。
- 可选设置为 New Tab 页面。

## 4. 当前已开始实现

已完成第一阶段的基础代码：

- `manifest.json`
- `src/background.js`
- `src/side-panel.html`
- `src/side-panel.css`
- `src/side-panel.js`
