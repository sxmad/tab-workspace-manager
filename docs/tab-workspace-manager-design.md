# Tab Workspace Manager 设计文档

## 1. 总体设计

Tab Workspace Manager 是 Chrome Manifest V3 插件，用于统一管理当前 Chrome Profile 下的窗口、Chrome 原生 Tab Group 和 Tab。

最终形态：

```text
New Tab 搜索工作台 + Side Panel 快速入口 + Background 自动同步服务
```

核心原则：

1. **自动同步**：浏览器真实状态自动纳管，用户不手动维护收藏夹。
2. **搜索优先**：New Tab 和 Side Panel 都以搜索为核心。
3. **Group-first**：默认展示窗口 / Workspace 下的 Group，不平铺几百个 Tab。
4. **当前 + 快照**：搜索同时覆盖当前打开状态与同步快照。
5. **伪预览**：不用网页截图，用 Group 颜色、域名、favicon、标题、数量形成识别。

## 2. 系统架构

```text
┌────────────────────────────────────────────┐
│ Chrome Extension MV3                       │
├────────────────────────────────────────────┤
│ New Tab UI                                 │
│ - 主搜索工作台                              │
│ - 当前窗口 / Group 卡片                     │
│ - 同步快照卡片                              │
│ - 搜索结果                                  │
├────────────────────────────────────────────┤
│ Side Panel UI                              │
│ - 快速搜索                                  │
│ - 最近 Group                                │
│ - 当前 / 其他窗口列表                       │
│ - 快照恢复入口                              │
├────────────────────────────────────────────┤
│ Background Service Worker                  │
│ - Runtime State 同步                        │
│ - 同步快照生成                              │
│ - 最近 Group 记录                           │
│ - 跳转 / 恢复 / 聚焦窗口                    │
├────────────────────────────────────────────┤
│ chrome.storage.local                       │
│ - runtimeState                              │
│ - savedWorkspaces                           │
│ - recentGroups                              │
│ - windowAliases                             │
│ - syncSummary                               │
├────────────────────────────────────────────┤
│ Chrome APIs                                │
│ tabs / tabGroups / windows / storage       │
│ sidePanel / action / commands              │
└────────────────────────────────────────────┘
```

## 3. Manifest 设计

```json
{
  "manifest_version": 3,
  "name": "Tab Workspace Manager",
  "description": "Group-first Chrome tab workspace manager.",
  "permissions": [
    "tabs",
    "tabGroups",
    "windows",
    "storage",
    "sidePanel"
  ],
  "background": {
    "service_worker": "src/background.js",
    "type": "module"
  },
  "side_panel": {
    "default_path": "src/side-panel.html"
  },
  "chrome_url_overrides": {
    "newtab": "src/new-tab.html"
  },
  "action": {
    "default_title": "Tab Workspace Manager"
  },
  "commands": {
    "_execute_action": {
      "suggested_key": {
        "default": "Ctrl+Shift+E",
        "mac": "Command+Shift+E"
      },
      "description": "打开 Tab Workspace Manager 侧边栏"
    }
  }
}
```

MVP 不申请：`history`、`bookmarks`、`scripting`、host permissions。

## 4. Chrome API 使用

### 4.1 tabs

用途：

- 读取 Tab 元数据。
- 激活 Tab。
- 创建快照恢复 Tab。
- 将恢复出来的 Tab 重新组成 Group。

关键调用：

```js
chrome.tabs.get(tabId)
chrome.tabs.query({ active: true, currentWindow: true })
chrome.tabs.update(tabId, { active: true })
chrome.tabs.create({ windowId, url, active })
chrome.tabs.group({ windowId, tabIds })
```

监听：

```js
chrome.tabs.onCreated
chrome.tabs.onRemoved
chrome.tabs.onMoved
chrome.tabs.onAttached
chrome.tabs.onDetached
chrome.tabs.onUpdated
chrome.tabs.onActivated
```

### 4.2 tabGroups

用途：

- 读取 Group 元数据。
- 展开 / 收起 Group。
- 恢复快照 Group 的名称、颜色、折叠状态。

关键调用：

```js
chrome.tabGroups.query({})
chrome.tabGroups.update(groupId, { title, color, collapsed })
```

监听：

```js
chrome.tabGroups.onCreated
chrome.tabGroups.onRemoved
chrome.tabGroups.onUpdated
chrome.tabGroups.onMoved
```

### 4.3 windows

用途：

- 读取全部 normal window。
- 聚焦窗口。
- 恢复快照到新窗口。

关键调用：

```js
chrome.windows.getAll({ populate: true, windowTypes: ['normal'] })
chrome.windows.update(windowId, { focused: true })
chrome.windows.create({ url, focused: true })
```

### 4.4 storage

使用 `chrome.storage.local`。

Key：

```text
runtimeState
syncSummary
recentGroups
windowAliases
savedWorkspaces
```

## 5. 数据模型

### 5.1 RuntimeState

```ts
interface RuntimeState {
  version: 1;
  syncedAt: number;
  windows: RuntimeWindow[];
  recentGroups: RuntimeGroupPreview[];
  savedWorkspaces: SyncedWorkspace[];
  summary: SyncSummary;
}
```

### 5.2 RuntimeWindow

```ts
interface RuntimeWindow {
  id: number;
  alias: string;
  displayName: string;
  focused: boolean;
  incognito: boolean;
  type: string;
  groups: RuntimeGroup[];
  ungroupedTabs: RuntimeTab[];
}
```

### 5.3 RuntimeGroup

```ts
interface RuntimeGroup {
  id: number;
  windowId: number;
  windowAlias: string;
  windowName: string;
  title: string;
  color: string;
  collapsed: boolean;
  index: number;
  tabCount: number;
  active: boolean;
  lastActiveAt?: number;
  lastActiveTabId?: number;
  tabs: RuntimeTab[];
}
```

### 5.4 RuntimeTab

```ts
interface RuntimeTab {
  id: number;
  windowId: number;
  groupId: number;
  index: number;
  title: string;
  url: string;
  favIconUrl?: string;
  active: boolean;
  pinned: boolean;
  muted: boolean;
  discarded: boolean;
  audible: boolean;
  domain: string;
  lastActiveAt?: number;
}
```

### 5.5 SyncedWorkspace

```ts
interface SyncedWorkspace {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  sourceWindowId: number;
  groups: SyncedGroup[];
  ungroupedTabs: SyncedTab[];
}
```

### 5.6 SyncedGroup / SyncedTab

```ts
interface SyncedGroup {
  title: string;
  color: string;
  collapsed: boolean;
  index: number;
  tabs: SyncedTab[];
}

interface SyncedTab {
  title: string;
  url: string;
  favIconUrl?: string;
  pinned: boolean;
  muted: boolean;
  index: number;
}
```

## 6. 同步流程

### 6.1 Runtime State 同步

```js
async function syncRuntimeState() {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  const groups = await chrome.tabGroups.query({});
  const localMeta = await chrome.storage.local.get([
    'recentGroups',
    'windowAliases',
    'savedWorkspaces'
  ]);

  const runtimeWindows = buildRuntimeWindows(windows, groups, localMeta.windowAliases);
  const recentGroups = buildRecentGroups(runtimeWindows, localMeta.recentGroups);
  const summary = buildSyncSummary(runtimeWindows);

  const runtimeState = {
    version: 1,
    syncedAt: Date.now(),
    windows: runtimeWindows,
    recentGroups,
    savedWorkspaces: localMeta.savedWorkspaces || [],
    summary
  };

  await chrome.storage.local.set({ runtimeState, syncSummary: summary });
  chrome.runtime.sendMessage({ type: 'RUNTIME_STATE_CHANGED', runtimeState }).catch(() => {});
  return runtimeState;
}
```

### 6.2 事件同步

所有 Chrome 事件触发 `scheduleSync()`，使用 100-300ms debounce。

```js
function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => runSafely(syncRuntimeState), 150);
}
```

### 6.3 同步快照生成

手动点击“同步”时执行：

```js
async function syncAndSaveRuntimeState() {
  const runtimeState = await syncRuntimeState();
  const syncedWorkspaces = buildSyncedWorkspaces(runtimeState.windows);
  await chrome.storage.local.set({ savedWorkspaces: syncedWorkspaces });
  return syncRuntimeState();
}
```

快照 ID 使用窗口来源：

```text
synced_window_<windowId>
```

MVP 允许 windowId 生命周期级稳定；后续可增强为特征匹配。

## 7. 最近 Group 设计

触发：`chrome.tabs.onActivated`。

流程：

1. `chrome.tabs.get(tabId)` 获取当前 Tab。
2. 若 `tab.groupId !== TAB_GROUP_ID_NONE`，记录：
   - groupId
   - windowId
   - tabId
   - lastActiveAt
3. 写入 `recentGroups`，最多保留 8 个。
4. UI 中 merge 当前 RuntimeGroup，补充最近 Tab 标题和域名。

## 8. New Tab UI 设计

### 8.1 页面结构

```text
Header
  Title / Summary / Sync Button
Hero Search
  搜索框
Recent Groups
  Chip list
Search Results（有 query 时）
  当前分组
  当前标签
  同步快照
  快照分组
  快照标签
  域名
Default Dashboard（无 query 时）
  当前打开
  同步快照
```

### 8.2 默认页面线框

```text
┌────────────────────────────────────────────────────────┐
│ Tab Workspace                         4窗口 · 32组 · 640标签 │
│                                             [同步]       │
│                                                        │
│ 你要找什么？                                            │
│ ┌────────────────────────────────────────────────────┐ │
│ │ 搜索 Workspace / Group / Tab / URL / 域名           │ │
│ └────────────────────────────────────────────────────┘ │
│                                                        │
│ 最近使用                                                │
│ [配置中心] [GitLab] [飞书需求] [日志排查] [AI调研]        │
│                                                        │
│ 当前打开                                                │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐    │
│ │ 日常工作      │ │ 活动 A        │ │ AI 调研       │    │
│ │ 6组 58标签    │ │ 5组 42标签    │ │ 7组 96标签    │    │
│ │ GitLab · 8   │ │ 配置中心 · 9  │ │ Chrome API ·14│    │
│ │ 飞书 · 12    │ │ PRD · 6       │ │ 文档 · 20     │    │
│ └──────────────┘ └──────────────┘ └──────────────┘    │
│                                                        │
│ 同步快照                                                │
│ ┌──────────────┐ ┌──────────────┐                     │
│ │ 上次同步：活动A │ │ 上次同步：临时资料 │                 │
│ │ 5组 42标签    │ │ 3组 21标签    │                     │
│ │ [恢复]        │ │ [恢复]        │                     │
│ └──────────────┘ └──────────────┘                     │
└────────────────────────────────────────────────────────┘
```

### 8.3 搜索结果线框

```text
┌────────────────────────────────────────────────────────┐
│ 搜索：gitlab                                           │
├────────────────────────────────────────────────────────┤
│ 当前分组                                                │
│ ● [活动 A] GitLab · 8 tabs                              │
│                                                        │
│ 当前标签                                                │
│ [活动 A / GitLab] MR - xxx                              │
│ [活动 A / GitLab] Pipeline #123                         │
│                                                        │
│ 同步快照                                                │
│ [活动 B] 5组 · 42标签                                   │
│                                                        │
│ 快照标签                                                │
│ [AI 调研 / GitHub] Chrome extension examples            │
│                                                        │
│ 域名                                                    │
│ gitlab.xxx.com · 12 tabs                                │
└────────────────────────────────────────────────────────┘
```

## 9. Side Panel UI 设计

侧边栏是快速入口，不承担复杂管理。

结构：

```text
Header / Summary / Sync
Search
Recent Groups
Current Window
  Group rows
Other Windows
  Group rows
Snapshots
```

交互：

- 搜索输入后只展示匹配结果。
- 点击 Group：激活该 Group。
- 点击 Tab：激活该 Tab。
- 点击 Snapshot：恢复前选择目标。
- 点击同步：更新 Runtime State + Saved Workspaces。

## 10. 搜索设计

搜索不单独持久化索引，MVP 在 UI 侧根据 RuntimeState 即时计算。

搜索范围：

- 当前窗口名 / 别名
- 当前 Group 名
- 当前 Tab 标题 / URL / domain
- 快照 Workspace 名
- 快照 Group 名
- 快照 Tab 标题 / URL / domain

结果结构：

```ts
interface SearchResults {
  groups: RuntimeGroup[];
  tabs: { tab: RuntimeTab; groupTitle: string; windowName: string }[];
  domains: DomainResult[];
  savedWorkspaces: { workspace: SyncedWorkspace }[];
  savedGroups: { workspace: SyncedWorkspace; group: SyncedGroup }[];
  savedTabs: { workspace: SyncedWorkspace; groupTitle: string; tab: SyncedTab }[];
}
```

## 11. 跳转与恢复流程

### 11.1 激活 Tab

```js
async function activateTab(tabId, windowId) {
  await chrome.windows.update(windowId, { focused: true });
  return chrome.tabs.update(tabId, { active: true });
}
```

### 11.2 激活 Group

```js
async function activateGroup(groupId, windowId) {
  const group = findRuntimeGroup(groupId, windowId);
  await chrome.windows.update(windowId, { focused: true });
  await chrome.tabGroups.update(groupId, { collapsed: false });
  const targetTabId = group.lastActiveTabId || group.tabs[0]?.id;
  return chrome.tabs.update(targetTabId, { active: true });
}
```

### 11.3 恢复快照

恢复目标：

```text
new      新窗口
current  当前窗口
```

流程：

1. 展平待恢复 tabs，同时保留所属 group。
2. 如果目标是新窗口，用第一个 URL 创建窗口。
3. 其余 URL 创建 inactive tabs。
4. 对每个 group 收集 tabIds。
5. `chrome.tabs.group()` 重新分组。
6. `chrome.tabGroups.update()` 恢复标题、颜色、折叠状态。
7. 同步 Runtime State。

MVP 不做 URL 去重。

## 12. 错误处理

- UI 收到不完整 RuntimeState 时必须 normalize，避免旧缓存导致崩溃。
- `windows`、`groups`、`tabs`、`savedWorkspaces` 等数组字段必须用空数组兜底。
- 恢复空快照时提示用户。
- Background message 统一返回 `{ ok, result, error }`。

## 13. 安全设计

- 不注入 content script。
- 不读取 DOM。
- 不上传数据。
- 不申请 `history`、`bookmarks`、`scripting`、host permissions。
- 不生成网页截图。
- 使用 `textContent` 或 HTML escape 渲染用户可控字段。

## 14. MVP 文件结构

```text
manifest.json
src/background.js
src/new-tab.html
src/new-tab.css
src/new-tab.js
src/side-panel.html
src/side-panel.css
src/side-panel.js
docs/tab-workspace-manager-requirements.md
docs/tab-workspace-manager-design.md
docs/tab-workspace-manager-acceptance.md
```

## 15. 后续优化

- 恢复目标用自定义弹窗替代 `prompt`。
- 侧边栏与 New Tab 复用搜索渲染模块。
- 固定 Group。
- Tab 操作菜单。
- 更好的 fuzzy search。
- 快照导入 / 导出。
