# Tab Workspace Manager

[中文文档](README.md)

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
