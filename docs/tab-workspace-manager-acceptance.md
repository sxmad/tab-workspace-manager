# Tab Workspace Manager 验收文档

## 1. 验收目标

验证 Tab Workspace Manager MVP 是否达成最终产品方向：

> **New Tab 搜索工作台 + 侧边栏快速入口 + 自动同步快照。**

MVP 通过标准：

1. 自动同步当前 Chrome Profile 下所有 normal window、Tab Group、Tab。
2. New Tab 作为主工作台，支持搜索当前状态和同步快照。
3. Side Panel 作为快速入口，支持搜索、最近 Group、快速跳转。
4. 默认 Group-first，不平铺几百个 Tab。
5. 点击当前 Group / Tab 可直接跳转真实页面。
6. 点击快照 Workspace / Group / Tab 可恢复或打开。
7. 使用伪预览卡片，不使用真实网页截图。
8. 不做手动收藏夹系统，不提供核心 `+URL` / `+分组` 入口。

## 2. 验收环境

- Chrome 最新稳定版。
- Manifest V3 开发者模式加载插件。
- macOS 优先，Windows 可补充验证。

测试数据规模：

```text
4 个 Chrome 窗口
每个窗口 1-8 个 Tab Group
每个 Group 3-20 个 Tab
总 Group 数不少于 16
总 Tab 数不少于 120
```

测试数据应包含：

- 有标题 Group。
- 未命名 Group。
- 未分组 Tab。
- pinned Tab。
- muted Tab。
- discarded Tab。
- 相同域名 Tab。
- 跨窗口相同关键词 Tab。

## 3. Manifest 与权限验收

### MF-001 Manifest V3

操作：检查 `manifest.json`。

预期：

- `manifest_version` 为 3。
- background 使用 service worker。
- 配置 side panel。
- 配置 newtab override。

### MF-002 New Tab override

操作：检查 `manifest.json` 并新建标签页。

预期：

- 存在：

```json
{
  "chrome_url_overrides": {
    "newtab": "src/new-tab.html"
  }
}
```

- 新建标签页打开 Tab Workspace 工作台。

### MF-003 侧边栏快捷键

操作：检查 `manifest.json`。

预期：

- `_execute_action` 快捷键为：
  - macOS：`Command+Shift+E`
  - 默认：`Ctrl+Shift+E`
- 按快捷键可打开插件侧边栏或触发插件 action。

### MF-004 权限最小化

操作：检查 `manifest.json`。

预期权限仅包含 MVP 必要项：

```text
tabs
tabGroups
windows
storage
sidePanel
```

不包含：

```text
history
bookmarks
scripting
contextMenus
host permissions
```

## 4. 自动同步验收

### SY-001 初次同步

前置：Chrome 中已打开至少 4 个窗口、16 个 Tab Group、120 个 Tab。

操作：首次加载插件后打开 New Tab 或 Side Panel。

预期：

- 插件读取所有 normal window。
- 插件读取所有 Chrome 原生 Tab Group。
- 插件读取所有已打开 Tab。
- 未分组 Tab 被归入对应窗口的未分组区域。
- 摘要中的窗口数、Group 数、Tab 数与实际状态一致。

### SY-002 同步 Group 元数据

前置：存在多个不同名称、颜色、折叠状态的 Tab Group。

操作：打开 New Tab 工作台。

预期：

- Group 名称正确。
- Group 颜色正确。
- Group 所属窗口正确。
- Group 内 Tab 数正确。
- Group 折叠状态可被读取。

### SY-003 持续同步 Tab 变化

操作：在 Chrome 中新建一个 Tab，再关闭一个 Tab。

预期：

- New Tab / Side Panel 在短时间内更新。
- 新建 Tab 出现在对应窗口或 Group。
- 关闭 Tab 后对应条目消失。
- 统计数量更新。

### SY-004 持续同步 Group 变化

操作：在 Chrome 原生界面中新建 Group、重命名、改色、移动 Tab、删除 Group。

预期：

- 新 Group 出现在插件中。
- 重命名和改色被同步。
- Tab 加入 / 移出 Group 被同步。
- 删除 Group 后运行态视图更新。

### SY-005 手动同步并生成快照

操作：点击 New Tab 或 Side Panel 中的“同步”。

预期：

- Runtime State 重新读取。
- 同步摘要时间更新。
- `savedWorkspaces` 被更新为当前窗口快照。
- 同步快照区域展示当前窗口对应快照。

### SY-006 同步摘要展示

操作：查看 New Tab 顶部摘要。

预期展示：

- 当前窗口数。
- 当前 Group 数。
- 当前 Tab 数。
- 最近同步时间。

## 5. New Tab 工作台验收

### NT-001 新标签页打开主工作台

操作：新建 Chrome Tab。

预期：

- 打开 `src/new-tab.html`。
- 搜索框自动聚焦。
- 页面显示顶部摘要、同步按钮、最近使用、当前打开、同步快照。

### NT-002 默认 Group-first 视图

前置：每个窗口有多个 Group。

操作：打开 New Tab。

预期：

- 默认展示窗口 / Workspace 卡片。
- 卡片内展示 Group 预览。
- 不默认平铺全部 Tab。

### NT-003 当前窗口卡片

操作：查看“当前打开”区域。

预期：

- 每个 Chrome window 对应一个卡片。
- 卡片显示窗口名、Group 数、Tab 数、未分组数量。
- 卡片列出 Top Groups。
- 当前窗口与其他窗口可区分。

### NT-004 同步快照卡片

前置：点击过“同步”。

操作：查看“同步快照”区域。

预期：

- 每个同步窗口对应一个快照卡片。
- 快照显示名称、Group 数、Tab 数。
- 快照卡片提供恢复入口。

### NT-005 伪预览卡片

操作：查看窗口卡片和快照卡片中的 Group 预览。

预期：

- 展示 Group 颜色。
- 展示 Group 名称。
- 展示主要域名或首个 Tab 标题。
- 展示 Tab 数量。
- 不展示真实网页截图。
- 不要求截图权限。

## 6. 最近使用验收

### RG-001 记录最近 Group

前置：存在多个 Group。

操作：依次激活 Group A、Group B、Group C 中的 Tab。

预期：

- 最近 Group 区域按 C、B、A 顺序展示。
- 每个最近 Group 显示最近 Tab 标题。
- 最多展示约 8 个。

### RG-002 点击最近 Group

操作：点击最近 Group chip。

预期：

- 聚焦目标窗口。
- 展开目标 Group。
- 激活最近使用 Tab。

## 7. 搜索验收

### SR-001 搜索当前 Group

前置：存在名为“配置中心”的当前 Group。

操作：在 New Tab 搜索框输入“配置”。

预期：

- “当前分组”区域展示“配置中心”。
- 结果包含窗口上下文和 Tab 数量。
- 点击后切换到该 Group。

### SR-002 搜索当前 Tab 标题

前置：存在标题包含“Jenkins”的当前 Tab。

操作：输入“Jenkins”。

预期：

- “当前标签”区域展示匹配 Tab。
- 结果包含窗口 / Group 上下文。
- 点击后聚焦窗口并激活真实 Tab。

### SR-003 搜索 URL / 域名

前置：存在多个 gitlab 域名 Tab。

操作：输入“gitlab”。

预期：

- 当前标签出现匹配项。
- 域名区域展示 `gitlab...` 聚合结果。
- 点击域名结果可跳转到该域名下某个当前 Tab。

### SR-004 搜索同步快照 Workspace

前置：同步快照中存在名称包含“活动 A”的 Workspace。

操作：输入“活动”。

预期：

- “同步快照”区域展示对应 Workspace。
- 点击后进入恢复流程。

### SR-005 搜索快照 Group

前置：同步快照中存在名为“GitLab”的 Group。

操作：输入“GitLab”。

预期：

- “快照分组”区域展示匹配 Group。
- 结果显示所属 Workspace 与 Tab 数。
- 点击后进入恢复该 Group 流程。

### SR-006 搜索快照 Tab

前置：同步快照中存在标题包含“Chrome extension”的 Tab。

操作：输入“Chrome extension”。

预期：

- “快照标签”区域展示匹配 Tab。
- 点击后在当前窗口打开该 URL。

### SR-007 无结果状态

操作：输入不存在的关键词。

预期：

- 展示清晰空状态。
- 页面无报错。

## 8. 跳转验收

### JP-001 点击当前 Tab

操作：搜索或展开后点击当前 Tab。

预期：

- 如果 Tab 在当前窗口，则直接激活。
- 如果 Tab 在其他窗口，则先聚焦窗口再激活。

### JP-002 点击当前 Group

操作：点击当前 Group 结果或卡片中的 Group 预览。

预期：

- 聚焦目标窗口。
- 目标 Group 展开。
- 激活最近使用 Tab；无记录时激活第一个 Tab。

### JP-003 聚焦窗口

操作：点击当前窗口卡片上的“聚焦窗口”。

预期：

- Chrome 聚焦对应窗口。

## 9. 快照恢复验收

### RS-001 恢复 Workspace 到新窗口

前置：存在同步快照 Workspace。

操作：点击恢复，选择“恢复到新窗口”。

预期：

- 创建新窗口。
- 打开快照中的所有 URL。
- 按原 Group 重新分组。
- 恢复 Group 名称、颜色、折叠状态。

### RS-002 恢复 Workspace 到当前窗口

操作：点击恢复，选择“恢复到当前窗口”。

预期：

- URL 被添加到当前窗口。
- Group 被正确创建。
- Group 元数据恢复。

### RS-003 恢复快照 Group

操作：点击快照中的某个 Group。

预期：

- 只恢复该 Group 内的 Tab。
- 恢复后 Group 名称和颜色正确。

### RS-004 恢复快照未分组 Tab

前置：快照中存在未分组 Tab。

操作：点击未分组恢复入口。

预期：

- 恢复未分组 Tab。
- 不强行创建 Group。

### RS-005 打开单个快照 Tab

操作：点击快照 Tab 搜索结果。

预期：

- 在当前窗口打开对应 URL。
- 不恢复整个 Workspace。

### RS-006 空快照保护

前置：构造一个没有 URL 的快照。

操作：点击恢复。

预期：

- 提示用户不可恢复。
- 不创建空窗口。

## 10. Side Panel 验收

### SP-001 打开侧边栏

操作：点击插件图标或按 `Cmd/Ctrl + Shift + E`。

预期：

- Side Panel 打开。
- 页面无报错。
- 显示搜索框、摘要、最近 Group、窗口 / Group 列表。

### SP-002 Side Panel 快速搜索

操作：在侧边栏输入关键词。

预期：

- 搜索当前 Group / Tab / 快照。
- 点击结果直接跳转或恢复。

### SP-003 Side Panel Group-first

操作：查看侧边栏默认状态。

预期：

- 默认以窗口和 Group 展示。
- 不默认展开全部 Tab。

### SP-004 展开 Group 查看 Tab

操作：展开某个 Group。

预期：

- 展示内部 Tab。
- Tab 展示 favicon、标题、域名和状态。
- 点击 Tab 可跳转。

### SP-005 Side Panel 同步

操作：点击侧边栏同步按钮。

预期：

- Runtime State 更新。
- 同步快照更新。
- 侧边栏显示最新统计。

## 11. 窗口别名验收

### WA-001 设置窗口别名

操作：在侧边栏或 New Tab 中为窗口设置别名。

预期：

- 窗口展示名更新为别名。
- 别名保存到本地。
- 搜索别名可命中该窗口下 Group / Tab。

### WA-002 清空窗口别名

操作：将别名设置为空。

预期：

- 恢复默认窗口展示名。
- 本地别名记录删除。

## 12. 性能验收

### PF-001 New Tab 大数据打开性能

前置：至少 4 窗口、32 Group、300+ Tab。

操作：打开 New Tab。

预期：

- 页面可正常渲染。
- 搜索框可快速输入。
- 无明显长时间卡顿。

### PF-002 搜索响应

操作：连续输入关键词。

预期：

- 搜索结果随输入更新。
- 输入过程无明显阻塞。

### PF-003 事件更新

操作：新建、关闭、移动 Tab。

预期：

- 插件在短时间内更新状态。
- 不需要刷新页面。

## 13. 安全与隐私验收

### SEC-001 不读取网页 DOM

操作：检查代码。

预期：

- 无 content script。
- 无 `chrome.scripting`。
- 无 DOM 注入读取网页内容。

### SEC-002 不做真实截图

操作：检查代码与权限。

预期：

- 无截图 API 依赖。
- UI 使用伪预览卡片。

### SEC-003 本地存储

操作：检查 Workspace 保存实现。

预期：

- 快照保存到 `chrome.storage.local`。
- 不向外部服务器发送数据。

### SEC-004 用户可控字段安全渲染

操作：构造包含 HTML 字符的 Group / Tab 标题。

预期：

- UI 正常显示文本。
- 不执行 HTML / JS。

## 14. 明确不验收范围

以下不属于 MVP：

- 手动维护收藏夹。
- `+URL`。
- `+分组`。
- 复杂 Workspace 编辑器。
- 真实网页截图预览。
- 强制去重。
- AI 自动分类。
- 云同步。
- 团队协作。
- 跨 Chrome Profile 管理。
- 书签导入 / 导出。
- History 搜索。

## 15. MVP 完成标准

以下全部通过，视为 MVP 完成：

- Manifest V3 可加载。
- New Tab 被替换为搜索工作台。
- Side Panel 可打开。
- 自动同步当前窗口 / Group / Tab。
- 手动同步生成同步快照。
- New Tab 展示最近使用、当前打开、同步快照。
- 默认 Group-first。
- 搜索覆盖当前 Group / Tab / URL / 域名。
- 搜索覆盖快照 Workspace / Group / Tab。
- 当前 Group / Tab 点击可跳转。
- 快照 Workspace / Group 可恢复到新窗口或当前窗口。
- 快照 Tab 可单独打开。
- 最近 Group 可记录并跳转。
- 使用伪预览卡片，无真实截图。
- 权限最小化，不读取网页内容。
