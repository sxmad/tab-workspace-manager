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
let state = normalize({});
let query = "";
let selectedIndex = 0;
installErrorLogging("side-panel");
init().catch((e) => logError("side-panel.init", e));
async function init() {
  searchInput.addEventListener("input", (e) => {
    query = e.target.value.trim().toLowerCase();
    selectedIndex = 0;
    render();
  });
  searchInput.addEventListener("keydown", (e) => {
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
  summary.textContent = `${s.windowCount || 0} 窗口 · ${s.groupCount || 0} 分组 · ${s.tabCount || 0} 标签`;
  app.replaceChildren();
  const rows = query ? search(query) : recentRows();
  if (!query && rows.length) {
    const heading = document.createElement("div");
    heading.className = "section-label";
    heading.textContent = "最近使用";
    app.append(heading);
  }
  app.append(
    ...(rows.length
      ? rows
      : [empty(query ? "没有匹配内容" : "暂无最近记录，直接搜索即可")]),
  );
  updateSelection();
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
  for (const w of state.windows) {
    const name = w.displayName || `窗口 ${w.id}`;
    if (match(name, q))
      rows.push(section(name, `${count(w)} 标签`, () => focusWindow(w.id)));
    for (const g of w.groups || []) {
      if (match(`${g.title} ${name}`, q))
        rows.push(
          section(
            g.title || "未命名分组",
            `${name} · ${g.tabs?.length || 0} 标签`,
            () => activateGroup(g.id, w.id),
            g.color,
          ),
        );
      for (const t of g.tabs || [])
        if (
          !isWorkspaceNewTab(t) &&
          match(`${t.title} ${t.url} ${t.domain}`, q)
        )
          rows.push(tabRow(t, `${name} / ${g.title || "分组"}`));
    }
    for (const t of w.ungroupedTabs || [])
      if (!isWorkspaceNewTab(t) && match(`${t.title} ${t.url} ${t.domain}`, q))
        rows.push(tabRow(t, `${name} / 未分组`));
  }
  for (const ws of state.savedWorkspaces) {
    if (match(ws.name, q))
      rows.push(
        section(ws.name, `${count(ws)} 标签 · 快照`, () => restore(ws)),
      );
    for (const g of ws.groups || []) {
      if (match(`${g.title} ${ws.name}`, q))
        rows.push(
          section(
            g.title || "未命名分组",
            `${ws.name} · ${g.tabs?.length || 0} 标签 · 快照`,
            () => restoreGroup(ws, g),
            g.color,
          ),
        );
      for (const t of g.tabs || [])
        if (!isWorkspaceNewTab(t) && match(`${t.title} ${t.url}`, q))
          rows.push(tabRow(t, `${ws.name} / ${g.title || "分组"}`, true));
    }
    for (const t of ws.ungroupedTabs || [])
      if (!isWorkspaceNewTab(t) && match(`${t.title} ${t.url}`, q))
        rows.push(tabRow(t, `${ws.name} / 未分组`, true));
  }
  return rows
    .map((button, index) => ({ button, index }))
    .sort(
      (a, b) =>
        resultScore(b.button, q) - resultScore(a.button, q) ||
        a.index - b.index,
    )
    .map(({ button }) => button)
    .slice(0, 100);
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
  const text = button.textContent.toLowerCase();
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
  return /^(https?:|data:image\/)/.test(String(url || "")) ? url : "";
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
