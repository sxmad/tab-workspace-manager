# Tab Workspace Manager

一个以搜索为核心的 Chrome 标签页工作台。它复用 Chrome 原生窗口、Tab Group 和 Tab，只负责同步、搜索、快速跳转与恢复，不替代 Chrome 自带的标签页管理能力。

## 功能

- New Tab 全局搜索窗口、分组、标签页、网址和域名。
- 侧边栏快速查看和切换当前窗口、分组与标签页。
- 自动同步所有普通 Chrome 窗口及其 Tab Group。
- 显示最近使用的标签页，标签关闭后自动清理记录。
- 保存同步快照，可恢复整个窗口、分组或单个标签页。
- New Tab 中拖动窗口卡片交换顺序，顺序会持久化保存。
- 支持窗口重命名，并标记当前窗口。
- 支持导出诊断日志，便于排查运行问题。

## 安装

1. 打开 Chrome 的 `chrome://extensions`。
2. 开启右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本仓库目录：`/Users/happyelements/Documents/git/tab-workspace-manager`。
5. 打开一个新的标签页，或点击扩展图标打开侧边栏。

项目不需要构建步骤，源码可直接作为未打包扩展加载。

## 使用

- 打开 New Tab 后直接输入关键词即可搜索窗口、Group、Tab 或 URL。
- 点击搜索结果可跳转到对应窗口、分组或标签页。
- 在“窗口”区域拖动卡片可交换窗口顺序。拖动时灰色卡片表示原位置，亮色卡片表示即将放置的位置。
- 点击“同步”可立即刷新当前浏览器状态。
- “同步快照”用于恢复之前同步到的窗口和分组结构。

## 权限说明

插件使用以下 Chrome 权限：

- `tabs`：读取标签页信息并切换标签页。
- `tabGroups`：读取和恢复原生 Tab Group。
- `windows`：读取、聚焦和恢复浏览器窗口。
- `storage`：保存窗口顺序、别名、同步快照和诊断日志。
- `sidePanel`：提供 Chrome 侧边栏入口。

所有数据默认保存在本地 Chrome 扩展存储中，不需要账号或远程服务。

## 项目结构

```text
manifest.json       Chrome Extension Manifest V3
src/background.js   Service worker、同步、恢复和消息处理
src/new-tab.*       New Tab 工作台
src/side-panel.*    Chrome 侧边栏
docs/               需求、设计、实现计划和验收文档
```

## 开发校验

仓库没有运行时依赖。提交前可执行：

```bash
for f in src/*.js; do node --check "$f" || exit 1; done
npx --yes prettier@3.6.2 --check manifest.json src/*.js src/*.css src/*.html
npx --yes eslint@8 src/*.js --no-eslintrc \
  --env browser,es2022 \
  --global chrome \
  --global browser \
  --global requestAnimationFrame \
  --rule 'no-undef:error' \
  --rule 'no-dupe-keys:error' \
  --rule 'no-unreachable:error'
```

详细产品约束和设计背景见 [`docs/`](docs/)。

---

# English

Tab Workspace Manager is a search-first Chrome tab workspace. It works with Chrome's native windows, Tab Groups, and tabs, adding synchronization, search, quick navigation, and restoration without replacing Chrome's built-in tab management.

## Features

- Search windows, groups, tabs, URLs, and domains from the New Tab page.
- Quickly inspect and switch windows, groups, and tabs from the side panel.
- Automatically synchronize all normal Chrome windows and their Tab Groups.
- Keep a recent-tab list and remove entries automatically when tabs are closed.
- Save synchronized snapshots and restore a whole window, group, or individual tab.
- Drag window cards on the New Tab page to exchange their order; the order is persisted.
- Rename windows and mark the focused window.
- Export diagnostic logs for troubleshooting.

## Installation

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository directory: `/Users/happyelements/Documents/git/tab-workspace-manager`.
5. Open a new tab, or click the extension icon to open the side panel.

No build step is required. The source can be loaded directly as an unpacked extension.

## Usage

- Open a New Tab and type a keyword to search windows, groups, tabs, or URLs.
- Select a result to jump to the matching window, group, or tab.
- Drag a card in the **Windows** section to exchange window order. During a drag, the gray card marks the original position and the bright card marks the pending destination.
- Click **Sync** to refresh the browser state immediately.
- Use **Sync snapshots** to restore a previously synchronized window or group structure.

## Permissions

The extension requests these Chrome permissions:

- `tabs`: read tab information and activate tabs.
- `tabGroups`: read and restore native Tab Groups.
- `windows`: inspect, focus, and restore browser windows.
- `storage`: persist window order, aliases, snapshots, and diagnostic logs.
- `sidePanel`: provide the Chrome side-panel entry point.

Data is stored locally in Chrome extension storage by default. No account or remote service is required.

## Project Structure

```text
manifest.json       Chrome Extension Manifest V3
src/background.js   Service worker, synchronization, restoration, and messaging
src/new-tab.*       New Tab workspace
src/side-panel.*    Chrome side panel
docs/               Requirements, design, implementation, and acceptance documents
```

## Development Checks

The repository has no runtime dependencies. Run the following before committing:

```bash
for f in src/*.js; do node --check "$f" || exit 1; done
npx --yes prettier@3.6.2 --check manifest.json src/*.js src/*.css src/*.html
npx --yes eslint@8 src/*.js --no-eslintrc \
  --env browser,es2022 \
  --global chrome \
  --global browser \
  --global requestAnimationFrame \
  --rule 'no-undef:error' \
  --rule 'no-dupe-keys:error' \
  --rule 'no-unreachable:error'
```

See [`docs/`](docs/) for detailed product requirements and design notes.
