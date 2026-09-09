# Tab Workspace Manager 需求文档

## 1. 背景

用户当前通过多个 Chrome 窗口 + Chrome 原生 Tab Group 管理大量页面。典型规模：

- 约 4 个 Chrome 窗口
- 每个窗口 1-8 个 Tab Group
- 每个 Group 内 3-20 个 Tab
- 总体约 4-32 个 Group、12-640 个 Tab

在该规模下，Chrome 顶部 Tab 栏标题不可读、容易点错；多窗口、多分组之间缺少统一搜索入口；手动保存、整理、恢复 Session 又容易和真实浏览状态割裂。

本插件的目标不是替代 Chrome 顶部 Tab 栏，而是让顶部 Tab 栏退居后台，提供一个以搜索为核心的浏览器工作台。

## 2. 产品定位

最终产品形态：

> **New Tab 搜索工作台 + 侧边栏快速入口。**

它不是：

- 不是 OneTab 式一键收纳工具。
- 不是传统 Session Manager。
- 不是手动维护收藏夹系统。
- 不是复杂 Workspace 编辑器。
- 不是替换 Chrome 浏览器外壳。

它是：

> 一个以搜索为核心的浏览器工作台：自动同步所有窗口、Tab Group 和 Tab，用 New Tab 做全局搜索与管理，用侧边栏做快速跳转。

核心逻辑：

```text
浏览器真实状态 → 自动同步 → 同步快照 → 可搜索 → 可跳转 / 可恢复
```

## 3. 核心原则

### 3.1 默认自动同步，不让用户手动维护

用户不应该反复思考：

```text
我要不要保存这个？
我要不要加入分组？
我要不要维护 URL？
```

正确体验是：

```text
当前浏览器状态自动纳管
点击“同步”就是更新快照
快照自动保存
用户只需要搜索、点击、恢复
```

### 3.2 搜索优先

主入口是搜索：

```text
搜索 Workspace / Window / Group / Tab / URL / 域名
```

搜索结果按类型展示：

```text
当前分组
当前标签
同步快照
快照分组
快照标签
域名
```

点击即执行：

- 当前 Tab：直接切过去。
- 当前 Group：切到该 Group 最近使用 Tab。
- 快照 Tab：在当前窗口打开 URL。
- 快照 Group：恢复该 Group。
- 快照 Workspace：恢复整个窗口快照。
- 域名：跳转到该域名下最近或第一个匹配 Tab。

### 3.3 Group-first，而不是 Tab-first

默认视图不要平铺几百个 Tab。

默认展示：

```text
Window / Workspace
  Group
    Tab 数量
    最近 Tab
    主要域名
```

Tab 只在以下场景出现：

- 搜索结果
- 展开 Group
- 详情区域

### 3.4 复用 Chrome 原生能力

插件应尊重用户现有习惯：

- Chrome Window 作为当前工作容器。
- Chrome 原生 Tab Group 作为核心组织单位。
- Chrome Tab 作为真实页面。
- 插件只做同步、搜索、跳转、恢复，不强迫用户迁移到另一套系统。

### 3.5 不做手动收藏夹系统

MVP 不提供核心入口：

```text
+ 新建 Workspace
+ 新建 Group
+ 手动添加 URL
复杂 Workspace 编辑器
```

Workspace 来自当前浏览器状态的同步快照，而不是用户手动维护的资料库。

## 4. 入口设计

### 4.1 New Tab：主工作台

New Tab 是主体验。每次打开新标签页，展示：

```text
搜索框
最近使用
当前打开状态
同步快照
Workspace / Group 卡片
```

定位：

> 浏览器工作台 / Tab 控制中心。

核心任务：

- 全局搜索当前状态和同步快照。
- 查看当前打开的窗口、Group、Tab 概览。
- 查看同步快照。
- 恢复 Workspace / Group / 单个 URL。
- 快速聚焦窗口或切换 Group。

### 4.2 Side Panel：快速入口

侧边栏是轻量导航器，用于：

```text
快速搜索
快速跳转
最近使用
展开 / 收起 Group
从同步快照恢复
```

特点：

- 快捷键 `Cmd/Ctrl + Shift + E` 呼出。
- 找到后直接跳转真实 Tab。
- 不承担复杂管理。
- 不打断当前浏览页面。

## 5. 功能需求

## 5.1 自动同步当前浏览器状态

插件应自动同步当前 Chrome Profile 下：

- 所有 normal window
- 所有 Chrome 原生 Tab Group
- 所有已打开 Tab
- 所有未分组 Tab

同步字段包括：

- Window：id、focused、incognito、type、别名。
- Group：id、windowId、title、color、collapsed、index、tabCount、active、lastActiveTab。
- Tab：id、windowId、groupId、index、title、url、favIconUrl、active、pinned、muted、discarded、audible、domain。

### 5.1.1 初次同步

插件安装、启动、New Tab 打开、Side Panel 打开时，应能从 Chrome API 构建 Runtime State。

### 5.1.2 持续同步

应监听：

```text
chrome.tabs.onCreated / onRemoved / onMoved / onAttached / onDetached / onUpdated / onActivated
chrome.windows.onCreated / onRemoved / onFocusChanged
chrome.tabGroups.onCreated / onRemoved / onUpdated / onMoved
```

MVP 允许使用 debounce 后全量同步。

### 5.1.3 手动同步

New Tab 和 Side Panel 应提供“同步”按钮。

点击后：

1. 重新读取当前浏览器状态。
2. 更新 Runtime State。
3. 基于当前窗口状态生成同步快照。
4. 更新同步摘要。

### 5.1.4 同步摘要

展示：

- 窗口数
- 分组数
- 标签数
- 上次同步时间
- 错误状态（如有）

## 5.2 同步快照

同步快照是当前浏览器状态的本地持久化版本。

每个打开窗口生成一个快照 Workspace：

```text
SyncedWorkspace
  groups
    tabs
  ungroupedTabs
```

保存字段：

- Workspace：id、name、createdAt、updatedAt、sourceWindowId。
- Group：title、color、collapsed、index、tabs。
- Tab：title、url、favIconUrl、pinned、muted、index。

要求：

- 点击“同步”后更新快照。
- 不需要用户手动创建 Workspace。
- 快照用于恢复窗口、恢复 Group、打开单个 URL。
- 快照数据保存在 `chrome.storage.local`。
- 每个窗口最多保留一份 Group 关闭恢复备份，关闭多个 Group 时合并保存。

## 5.3 New Tab 工作台

默认替换 Chrome New Tab。

Manifest：

```json
{
  "chrome_url_overrides": {
    "newtab": "src/new-tab.html"
  }
}
```

New Tab 必须包含：

1. 顶部摘要和同步按钮。
2. 全局搜索框。
3. 最近使用 Group。
4. 当前打开窗口卡片。
5. 同步快照卡片。
6. 搜索结果分区。

### 5.3.1 默认首页布局

```text
Tab Workspace                              同步

你要找什么？
[ 搜索 Workspace / Group / Tab / URL / 域名 ]

最近使用
[配置中心] [GitLab] [飞书需求] [日志排查]

当前打开
[窗口卡片] [窗口卡片] [窗口卡片]

同步快照
[快照卡片] [快照卡片]
```

### 5.3.2 窗口 / 快照卡片

卡片展示：

- 名称：窗口别名 / 当前窗口 / 窗口 id / 快照名称。
- 来源：当前 / 快照。
- Group 数量。
- Tab 数量。
- 未分组 Tab 数量。
- Top Groups 伪预览列表。
- 操作：聚焦窗口、恢复快照。

### 5.3.3 Group 伪预览

不做真实网页截图。伪预览使用：

- Group 颜色
- Group 名称
- favicon / 域名
- 最近或首个 Tab 标题
- Tab 数量
- 当前 / 快照标识

原因：

- 稳定。
- 快。
- 隐私风险低。
- 不需要截图权限。
- 几百个 Tab 也能承受。

## 5.4 搜索

搜索覆盖当前状态 + 同步快照。

搜索字段：

- Window 别名 / 展示名
- Workspace 名称
- Group 名称
- Tab 标题
- Tab URL
- 域名

结果分区：

```text
当前分组
当前标签
同步快照
快照分组
快照标签
域名
```

动作：

- 当前 Group：聚焦窗口、展开 Group、激活最近 Tab。
- 当前 Tab：聚焦窗口、激活 Tab。
- 同步快照：恢复窗口到新窗口或当前窗口。
- 快照 Group：恢复分组到新窗口或当前窗口。
- 快照 Tab：当前窗口打开 URL。
- 域名：跳转到第一个当前匹配 Tab。

## 5.5 最近使用

插件应记录最近使用 Group。

触发：

- `chrome.tabs.onActivated`
- 当前 active tab 属于某个 group

记录：

- groupId
- windowId
- tabId
- lastActiveAt

展示：

- New Tab 最近使用 chips。
- Side Panel 最近使用区。

点击最近 Group 后：

1. 聚焦窗口。
2. 展开 Group。
3. 激活最近使用 Tab。

## 5.6 Side Panel 快速入口

Side Panel 必须包含：

- 搜索框。
- 同步摘要。
- 最近使用 Group。
- 当前窗口 / 其他窗口 Group-first 列表。
- 同步快照入口。

基础操作：

- 点击 Group：切换 Group。
- 展开 Group：查看 Tab。
- 点击 Tab：跳转 Tab。
- 点击同步：刷新 Runtime State 并更新快照。
- 恢复快照：选择恢复到新窗口或当前窗口。

## 5.7 恢复策略

恢复时不要直接执行，应让用户选择：

```text
1：恢复到当前窗口
2：恢复到新窗口
```

MVP 不做强制去重。

原因：

- 去重策略容易误伤真实工作状态。
- 用户当前更需要明确、可控地恢复。

支持恢复对象：

- Workspace 快照。
- Group 快照。
- 未分组 Tab 集合。
- 单个快照 Tab URL。

## 5.8 窗口别名

用户可以给窗口设置别名，例如：

```text
日常工作
活动 A
AI 调研
日志排查
```

MVP 以 Chrome windowId 绑定，生命周期内稳定即可。后续可按特征恢复匹配。

## 6. 非功能需求

### 6.1 性能

- 支持至少 4 窗口、32 Group、640 Tab。
- New Tab 打开不应明显卡顿。
- 搜索输入应流畅。
- Chrome 事件更新使用 debounce，避免事件风暴。

### 6.2 易用性

- 默认 Group-first。
- 搜索框自动聚焦。
- 点击结果直接执行真实跳转或恢复。
- 不强迫用户学习复杂 Workspace 编辑器。
- 不影响日常浏览。

### 6.3 安全和隐私

- 不读取网页 DOM。
- 不注入 content script。
- 不请求 history / bookmarks / scripting / host permissions。
- 不做真实网页截图。
- 数据保存在 `chrome.storage.local`。

## 7. 权限需求

MVP 权限：

```json
{
  "permissions": ["tabs", "tabGroups", "windows", "storage", "sidePanel"]
}
```

暂不需要：

```text
history
bookmarks
scripting
contextMenus
sessions
host permissions
```

## 8. MVP 范围

必须包含：

1. Manifest V3 插件。
2. New Tab override 主工作台。
3. Side Panel 快速入口。
4. 自动同步当前窗口 / Group / Tab。
5. 手动同步并保存同步快照。
6. 当前状态 Group-first 展示。
7. 同步快照展示。
8. 搜索当前状态 + 快照。
9. 最近使用 Group。
10. 点击当前 Tab 跳转。
11. 点击当前 Group 切换。
12. 恢复 Workspace 快照。
13. 恢复 Group 快照。
14. 打开单个快照 URL。
15. 窗口别名。
16. 快捷键 `Cmd/Ctrl + Shift + E` 呼出侧边栏。

不包含：

- 手动维护收藏夹。
- `+分组`。
- `+URL`。
- 复杂 Workspace 编辑器。
- 真实网页截图预览。
- 强制去重。
- AI 自动分类。
- 云同步。
- 团队协作。
- 跨 Chrome Profile 管理。

## 9. 后续迭代

- 更好的恢复弹窗 UI，替代 `prompt`。
- 更强模糊搜索。
- 固定高频 Group。
- Tab 操作菜单：关闭、静音、休眠。
- 窗口别名跨重启智能匹配。
- 可选导入 / 导出快照。
- 可选书签互导。
