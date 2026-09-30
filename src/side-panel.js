const app = document.querySelector("#app");
const summary = document.querySelector("#syncSummary");
const status = document.querySelector("#status");
const searchInput = document.querySelector("#searchInput");
const syncButton = document.querySelector("#resyncButton");
const logsButton = document.querySelector("#exportLogsButton");
const COLORS = {
  grey: "#7a8694",
  blue: "#2f6fed",
  red: "#d94f4f",
  yellow: "#c58a00",
  green: "#2e8b57",
  pink: "#c34c91",
  purple: "#805ad5",
  cyan: "#198f9c",
  orange: "#c96b19",
};
const MAX_ICON_URL_LENGTH = 2048;
let state = normalize({});
let query = "";
let selectedIndex = 0;
const expandedGroups = new Set();
installErrorLogging("side-panel");
init().catch((e) => logError("side-panel.init", e));
async function init() {
  searchInput.addEventListener("input", (e) => {
    query = e.target.value.trim().toLowerCase();
    selectedIndex = 0;
    render();
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
      e.preventDefault();
      if (e.key === "ArrowDown") moveSelection(1);
      else if (e.key === "ArrowUp") moveSelection(-1);
      else activateSelection();
      return;
    }
    if (e.key === "Escape" && searchInput.value) {
      searchInput.value = "";
      query = "";
      selectedIndex = 0;
      render();
    }
  });
  syncButton.addEventListener("click", resync);
  logsButton.addEventListener("click", exportLogs);
  chrome.runtime.onMessage.addListener((m) => {
    if (m?.type === "RUNTIME_STATE_CHANGED") {
      state = normalize(m.runtimeState);
      render();
    }
  });
  try {
    state = normalize((await send({ type: "GET_RUNTIME_STATE" })).result);
  } catch (e) {
    logError("side-panel.getRuntimeState", e);
    showError("读取失败，请点击同步重试");
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
    }
  });
  render();
}
async function resync() {
  syncButton.disabled = true;
  syncButton.textContent = "同步中";
  try {
    state = normalize((await send({ type: "RESYNC_RUNTIME_STATE" })).result);
    status.textContent = "";
    render();
  } catch (e) {
    logError("side-panel.resync", e);
    showError("同步失败，请点击同步重试");
  } finally {
    syncButton.disabled = false;
    syncButton.textContent = "同步";
  }
}
function render() {
  const s = state.summary || {};
  pruneExpandedGroups(state.windows);
  summary.textContent = `${s.windowCount || 0} 窗口 · ${s.groupCount || 0} 分组 · ${s.tabCount || 0} 标签`;
  app.replaceChildren();
  if (query) {
    const rows = search(query);
    app.append(...(rows.length ? rows : [empty("没有匹配内容")]));
  } else {
    const rows = dashboardRows();
    app.append(...(rows.length ? rows : [empty("暂无打开的标签")]));
  }
  updateSelection();
}

function dashboardRows() {
  const rows = [];
  pruneExpandedGroups(state.windows);
  const recent = recentRows();
  if (recent.length) {
    rows.push(label("最近使用"), ...recent);
  }

  const windows = (state.windows || []).filter((windowState) => count(windowState));
  if (windows.length) {
    rows.push(label("当前窗口"));
    for (const windowState of windows) {
      const name = windowState.displayName || `窗口 ${windowState.id}`;
      rows.push(
        section(name, `${count(windowState)} 标签`, () => focusWindow(windowState.id)),
      );
      for (const group of windowState.groups || []) {
        rows.push(groupEntry(group, windowState, name));
      }
      if (windowState.ungroupedTabs?.length) {
        rows.push(
          section(
            "未分组",
            `${windowState.ungroupedTabs.length} 标签 · ${name}`,
            () => activateTab(windowState.ungroupedTabs[0].id, windowState.id),
            "grey",
          ),
        );
      }
    }
  }

  const workspaces = state.savedWorkspaces || [];
  if (workspaces.length) {
    rows.push(label("同步快照"));
    for (const workspace of workspaces) {
      rows.push(
        section(
          workspace.name,
          `${count(workspace)} 标签 · 快照`,
          () => restore(workspace),
        ),
      );
      for (const group of workspace.groups || []) {
        rows.push(
          section(
            group.title || "未命名分组",
            `${workspace.name} · ${group.tabs?.length || 0} 标签`,
            () => restoreGroup(workspace, group),
            group.color,
          ),
        );
      }
      if (workspace.ungroupedTabs?.length) {
        rows.push(
          section(
            "未分组标签",
            `${workspace.name} · ${workspace.ungroupedTabs.length} 标签`,
            () => restoreUngrouped(workspace),
            "grey",
          ),
        );
      }
    }
  }
  return rows;
}

function pruneExpandedGroups(windows) {
  const keys = new Set(
    (windows || []).flatMap((windowState) =>
      (windowState.groups || []).map(
        (group) => `${windowState.id}:${group.id}`,
      ),
    ),
  );
  for (const key of expandedGroups) {
    if (!keys.has(key)) expandedGroups.delete(key);
  }
}

function label(text) {
  const heading = document.createElement("div");
  heading.className = "section-label";
  heading.textContent = text;
  return heading;
}

function groupEntry(group, windowState, windowName) {
  const key = `${windowState.id}:${group.id}`;
  const expanded = expandedGroups.has(key);
  const wrapper = document.createElement("div");
  wrapper.className = "group-entry";
  const open = section(
    group.title || "未命名分组",
    `${windowName} · ${group.tabs?.length || 0} 标签`,
    () => activateGroup(group.id, windowState.id),
    group.color,
  );
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "group-toggle";
  toggle.textContent = expanded ? "收起" : "展开";
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    if (expanded) expandedGroups.delete(key);
    else expandedGroups.add(key);
    render();
  });
  wrapper.append(open, toggle);
  if (expanded) {
    for (const tab of group.tabs || []) {
      const tabNode = tabRow(
        tab,
        `${windowName} / ${group.title || "分组"}`,
      );
      tabNode.classList.add("group-tab-row");
      wrapper.append(tabNode);
    }
  }
  return wrapper;
}
function recentRows() {
  const items = state.recentItems?.length
    ? state.recentItems
    : state.recentGroups;
  return (items || [])
    .filter((item) => !isWorkspaceRecentItem(item))
    .slice(0, 8)
    .map((item) =>
      row(
        item.title,
        item.subtitle || item.windowName || "最近使用",
        () =>
          item.type === "tab"
            ? activateTab(item.tabId, item.windowId)
            : activateGroup(item.groupId, item.windowId),
        item.color,
        item.icon,
      ),
    );
}
function search(q) {
  const rows = [];
  const addSection = (title, meta, onClick, color) =>
    rows.push({ kind: "section", title, meta, onClick, color });
  const addTab = (tab, prefix, snapshot = false) =>
    rows.push({ kind: "tab", tab, prefix, snapshot });
  for (const w of state.windows) {
    const name = w.displayName || `窗口 ${w.id}`;
    if (match(name, q))
      addSection(name, `${count(w)} 标签`, () => focusWindow(w.id));
    for (const g of w.groups || []) {
      if (match(`${g.title} ${name}`, q))
        addSection(
          g.title || "未命名分组",
          `${name} · ${g.tabs?.length || 0} 标签`,
          () => activateGroup(g.id, w.id),
          g.color,
        );
      for (const t of g.tabs || [])
        if (
          !isWorkspaceNewTab(t) &&
          match(`${t.title} ${t.url} ${t.domain}`, q)
        )
          addTab(t, `${name} / ${g.title || "分组"}`);
    }
    for (const t of w.ungroupedTabs || [])
      if (!isWorkspaceNewTab(t) && match(`${t.title} ${t.url} ${t.domain}`, q))
        addTab(t, `${name} / 未分组`);
  }
  for (const ws of state.savedWorkspaces) {
    if (match(ws.name, q))
      addSection(ws.name, `${count(ws)} 标签 · 快照`, () => restore(ws));
    for (const g of ws.groups || []) {
      if (match(`${g.title} ${ws.name}`, q))
        addSection(
          g.title || "未命名分组",
          `${ws.name} · ${g.tabs?.length || 0} 标签 · 快照`,
          () => restoreGroup(ws, g),
          g.color,
        );
      for (const t of g.tabs || [])
        if (!isWorkspaceNewTab(t) && match(`${t.title} ${t.url}`, q))
          addTab(t, `${ws.name} / ${g.title || "分组"}`, true);
    }
    for (const t of ws.ungroupedTabs || [])
      if (!isWorkspaceNewTab(t) && match(`${t.title} ${t.url}`, q))
        addTab(t, `${ws.name} / 未分组`, true);
  }
  return rows
    .map((result, index) => ({ result, index }))
    .sort(
      (a, b) =>
        resultScore(b.result, q) - resultScore(a.result, q) ||
        a.index - b.index,
    )
    .map(({ result }) => result)
    .slice(0, 100)
    .map((result) =>
      result.kind === "tab"
        ? tabRow(result.tab, result.prefix, result.snapshot)
        : section(result.title, result.meta, result.onClick, result.color),
    );
}
function section(title, meta, onClick, color) {
  return row(title, meta, onClick, color);
}
function tabRow(tab, prefix, snapshot = false) {
  return row(
    tab.title || tab.url,
    `${prefix} · ${tab.domain || tab.url}`,
    () =>
      snapshot
        ? send({ type: "OPEN_SAVED_TAB", url: tab.url })
        : activateTab(tab.id, tab.windowId),
    null,
    tab.favIconUrl,
  );
}
function row(title, meta, onClick, color, icon) {
  const b = document.createElement("button");
  b.className = "list-row";
  b.type = "button";
  b.addEventListener("click", () =>
    Promise.resolve()
      .then(onClick)
      .then(() => {
        selectedIndex = 0;
      })
      .catch(reportActionError),
  );
  if (icon && safeIcon(icon)) {
    const i = document.createElement("img");
    i.src = safeIcon(icon);
    i.alt = "";
    b.append(i);
  } else {
    const d = document.createElement("span");
    d.className = "dot";
    d.style.background = COLORS[color] || COLORS.grey;
    b.append(d);
  }
  const c = document.createElement("span");
  c.className = "row-content";
  c.innerHTML = `<strong>${html(title)}</strong><span>${html(meta)}</span>`;
  b.append(c);
  return b;
}
function resultScore(button, q) {
  const title =
    button.kind === "tab" ? button.tab?.title || button.tab?.url : button.title;
  const meta =
    button.kind === "tab"
      ? `${button.prefix || ""} ${button.tab?.url || ""}`
      : button.meta;
  const text = `${title || ""} ${meta || ""}`.toLowerCase();
  if (text.startsWith(q)) return 3;
  if (text.includes(` ${q}`)) return 2;
  return 1;
}
function updateSelection() {
  const rows = [...app.querySelectorAll(".list-row")];
  if (!rows.length) {
    selectedIndex = 0;
    return;
  }
  selectedIndex = Math.max(0, Math.min(selectedIndex, rows.length - 1));
  rows.forEach((row, index) =>
    row.classList.toggle("is-selected", index === selectedIndex),
  );
  rows[selectedIndex]?.scrollIntoView({ block: "nearest" });
}
function moveSelection(step) {
  const count = app.querySelectorAll(".list-row").length;
  if (!count) return;
  selectedIndex = (selectedIndex + step + count) % count;
  updateSelection();
}
function activateSelection() {
  app.querySelectorAll(".list-row")[selectedIndex]?.click();
}
function empty(text) {
  const e = document.createElement("div");
  e.className = "empty";
  e.textContent = text;
  return e;
}
function count(item) {
  return (
    (item?.ungroupedTabs?.length || 0) +
    (item?.groups || []).reduce((n, g) => n + (g.tabs?.length || 0), 0)
  );
}
function match(value, q) {
  return String(value || "")
    .toLowerCase()
    .includes(q);
}
function safeIcon(url) {
  const value = String(url || "");
  return value.length <= MAX_ICON_URL_LENGTH && /^(https?:|data:image\/)/.test(value)
    ? value
    : "";
}
function html(value) {
  return String(value ?? "").replace(
    /[&<>\"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function normalize(v) {
  return {
    windows: Array.isArray(v?.windows) ? v.windows : [],
    savedWorkspaces: Array.isArray(v?.savedWorkspaces) ? v.savedWorkspaces : [],
    recentItems: Array.isArray(v?.recentItems)
      ? v.recentItems.filter((item) => item && typeof item === "object")
      : [],
    recentGroups: Array.isArray(v?.recentGroups)
      ? v.recentGroups.filter((item) => item && typeof item === "object")
      : [],
    summary: v?.summary || {},
  };
}
function isWorkspaceNewTab(tab) {
  try {
    const url = String(tab?.url || "");
    return (
      url === chrome.runtime.getURL("src/new-tab.html") ||
      /^chrome:\/\/(?:newtab|new-tab-page)\/?$/i.test(url)
    );
  } catch {
    return false;
  }
}
function isWorkspaceRecentItem(item) {
  if (isWorkspaceNewTab(item)) return true;
  return (
    item?.title === "Tab Workspace" ||
    /(?:^|[./ ])new[ -]?tab(?:$|[./ ])/i.test(String(item?.subtitle || ""))
  );
}
function send(message) {
  return new Promise((resolve, reject) =>
    chrome.runtime.sendMessage(message, (r) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      if (!r?.ok) return reject(new Error(r?.error || "操作失败"));
      resolve(r);
    }),
  );
}
async function activateTab(tabId, windowId) {
  const panelWindowId = await getPanelWindowId();
  if (tabId) await send({ type: "ACTIVATE_TAB", tabId, windowId });
  await closePanel(panelWindowId);
}
async function activateGroup(groupId, windowId) {
  const panelWindowId = await getPanelWindowId();
  await send({ type: "ACTIVATE_GROUP", groupId, windowId });
  await closePanel(panelWindowId);
}
async function focusWindow(windowId) {
  const panelWindowId = await getPanelWindowId();
  await send({ type: "FOCUS_WINDOW", windowId });
  await closePanel(panelWindowId);
}
async function restore(ws) {
  const target = chooseRestoreTarget();
  if (!target) return;
  const panelWindowId = await getPanelWindowId();
  await send({
    type: "RESTORE_SAVED_WORKSPACE",
    workspaceId: ws.id,
    target,
  });
  await closePanel(panelWindowId);
}
async function restoreGroup(ws, group) {
  const index = (ws.groups || []).indexOf(group);
  const target = chooseRestoreTarget();
  if (!target) return;
  const panelWindowId = await getPanelWindowId();
  await send({
    type: "RESTORE_SAVED_GROUP",
    workspaceId: ws.id,
    groupIndex: index,
    sourceGroupId: group.sourceGroupId,
    target,
  });
  await closePanel(panelWindowId);
}
async function restoreUngrouped(ws) {
  const target = chooseRestoreTarget();
  if (!target) return;
  const panelWindowId = await getPanelWindowId();
  await send({
    type: "RESTORE_SAVED_UNGROUPED",
    workspaceId: ws.id,
    target,
  });
  await closePanel(panelWindowId);
}
async function getPanelWindowId() {
  try {
    return (await chrome.windows.getCurrent())?.id;
  } catch {
    return undefined;
  }
}
async function closePanel(windowId) {
  if (!chrome.sidePanel?.close) return;
  try {
    const targetWindowId = windowId || (await getPanelWindowId());
    if (targetWindowId)
      await chrome.sidePanel.close({ windowId: targetWindowId });
  } catch {
    // Closing the panel is optional; navigation has already completed.
  }
}
function chooseRestoreTarget() {
  const choice = prompt(
    "恢复位置：输入 1 在当前窗口，输入 2 在新窗口；取消则放弃",
  );
  if (choice === "1") return "current";
  if (choice === "2") return "new";
  return null;
}
async function exportLogs() {
  try {
    const logs = (await send({ type: "GET_DIAGNOSTIC_LOGS" })).result || [];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(logs, null, 2)], { type: "application/json" }),
    );
    a.download = "tab-workspace-logs.json";
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    logError("side-panel.exportLogs", e);
  }
}
function installErrorLogging(context) {
  window.addEventListener("error", (e) =>
    logError(`${context}.window`, e.error || e.message),
  );
  window.addEventListener("unhandledrejection", (e) =>
    logError(`${context}.promise`, e.reason),
  );
}
function logError(context, error) {
  if (error)
    send({
      type: "LOG_CLIENT_ERROR",
      context,
      error: {
        message: error.message || String(error),
        stack: error.stack || "",
      },
    }).catch(() => {});
}
function showError(message) {
  status.textContent = message;
}
function reportActionError(error) {
  logError("side-panel.action", error);
  showError("操作失败，请重试");
}
