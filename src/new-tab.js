const $ = (selector) => document.querySelector(selector);
const summary = $("#summary");
const status = $("#status");
const searchInput = $("#searchInput");
const syncButton = $("#syncButton");
const exportLogsButton = $("#exportLogsButton");
const recentSection = $("#recentSection");
const recentMeta = $("#recentMeta");
const recentList = $("#recentList");
const resultsSection = $("#resultsSection");
const resultsMeta = $("#resultsMeta");
const resultsList = $("#resultsList");
const windowSection = $("#windowSection");
const windowMeta = $("#windowMeta");
const windowGrid = $("#windowGrid");
const currentSection = $("#currentSection");
const currentMeta = $("#currentMeta");
const currentGrid = $("#currentGrid");
const snapshotSection = $("#snapshotSection");
const snapshotMeta = $("#snapshotMeta");
const snapshotGrid = $("#snapshotGrid");
const WINDOW_ORDER_KEY = "windowOrder";
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
let state = normalizeState({});
let query = "";
let selectedIndex = 0;
let resizeTimer = null;
let selectedWindowId = null;
let switchRequestId = 0;
let switchWindowChain = Promise.resolve();
let pendingFocusWindowId = null;
let pointerInteractionActive = false;
let pendingRuntimeState = null;
let pendingRender = false;
let pointerReleaseTimer = null;
let pointerSequence = 0;
let suppressWindowClickUntil = 0;
let pointerWindowDrag = null;
const expandedGroups = new Set();

installErrorLogging("new-tab");
init().catch((error) => logClientError("new-tab.init", error));

async function init() {
  searchInput.addEventListener("input", (event) => {
    query = event.target.value.trim().toLowerCase();
    selectedIndex = 0;
    render();
  });
  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pointerSequence += 1;
    clearTimeout(pointerReleaseTimer);
    pointerInteractionActive = true;
  });
  document.addEventListener("pointerup", finishPointerInteraction);
  document.addEventListener("pointercancel", finishPointerInteraction);
  document.addEventListener("pointermove", handleWindowDragMove, {
    passive: false,
  });
  document.addEventListener("pointerup", handleWindowDragEnd);
  document.addEventListener("pointercancel", cancelWindowDrag);
  window.addEventListener("blur", () => {
    cancelWindowDrag();
    deferPointerRelease();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== searchInput) {
      event.preventDefault();
      searchInput.focus();
    }
    if (
      event.key === "Escape" &&
      document.activeElement === searchInput &&
      searchInput.value
    ) {
      searchInput.value = "";
      query = "";
      selectedIndex = 0;
      render();
    }
    if (
      document.activeElement === searchInput &&
      query &&
      !event.isComposing &&
      event.keyCode !== 229 &&
      ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)
    ) {
      event.preventDefault();
      if (event.key === "Enter") activateSelectedResult();
      else moveSelection(event.key === "ArrowDown" ? 1 : -1);
    }
  });
  syncButton.addEventListener("click", resync);
  exportLogsButton.addEventListener("click", exportDiagnosticLogs);
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!query) renderCurrentView();
    }, 100);
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "RUNTIME_STATE_CHANGED") {
      const nextState = normalizeState(message.runtimeState);
      if (pointerInteractionActive) {
        pendingRuntimeState = nextState;
        pendingRender = true;
        return;
      }
      state = nextState;
      ensureSelectedWindow();
      render();
    }
  });
  try {
    state = normalizeState(
      (await sendMessage({ type: "GET_RUNTIME_STATE" })).result,
    );
    ensureSelectedWindow();
  } catch (error) {
    logClientError("new-tab.getRuntimeState", error);
    showError("读取失败，请点击同步重试");
  }
  render();
  searchInput.focus();
}
function deferPointerRelease() {
  // Switching windows can blur this page before the browser dispatches click.
  // Keep the current DOM stable long enough for that click to reach its card.
  clearTimeout(pointerReleaseTimer);
  const sequence = pointerSequence;
  pointerReleaseTimer = setTimeout(() => {
    if (sequence !== pointerSequence) return;
    finishPointerInteraction();
  }, 500);
}
function finishPointerInteraction() {
  clearTimeout(pointerReleaseTimer);
  pointerReleaseTimer = null;
  if (!pointerInteractionActive) return;
  const sequence = pointerSequence;
  setTimeout(() => {
    if (sequence !== pointerSequence) return;
    pointerInteractionActive = false;
    if (pendingRuntimeState) {
      state = pendingRuntimeState;
      pendingRuntimeState = null;
      ensureSelectedWindow();
    }
    if (pendingRender) {
      pendingRender = false;
      render();
    }
  }, 0);
}
function renderCurrentView() {
  if (pointerInteractionActive) {
    pendingRender = true;
    return;
  }
  renderCurrent(state.windows);
}
async function resync() {
  syncButton.disabled = true;
  syncButton.textContent = "同步中...";
  try {
    state = normalizeState(
      (await sendMessage({ type: "RESYNC_RUNTIME_STATE" })).result,
    );
    status.textContent = "";
    render();
  } catch (error) {
    logClientError("new-tab.resync", error);
    showError("同步失败，请点击同步重试");
  } finally {
    syncButton.disabled = false;
    syncButton.textContent = "同步";
    searchInput.focus();
  }
}
function render() {
  const s = state.summary || {};
  summary.textContent = s.syncedAt
    ? `已同步 ${formatTime(s.syncedAt)}`
    : "等待同步";
  if (query) {
    recentSection.classList.add("hidden");
    windowSection.classList.add("hidden");
    currentSection.classList.add("hidden");
    snapshotSection.classList.add("hidden");
    resultsSection.classList.remove("hidden");
    const results = search(state.windows, state.savedWorkspaces, query);
    resultsMeta.textContent = `${results.length} 条`;
    resultsList.replaceChildren(
      ...(results.length ? results.map(renderResult) : [empty("没有匹配内容")]),
    );
    updateSelection();
    return;
  }
  resultsSection.classList.add("hidden");
  windowSection.classList.remove("hidden");
  currentSection.classList.remove("hidden");
  snapshotSection.classList.remove("hidden");
  renderRecent(
    state.recentTabs?.length
      ? state.recentTabs
      : state.recentItems?.filter((item) => item.type === "tab"),
  );
  renderCurrent(state.windows);
  renderSnapshots(state.savedWorkspaces);
}
function renderRecent(items) {
  recentList.replaceChildren();
  items = (items || []).filter((item) => !isWorkspaceRecentItem(item));
  if (!items?.length) {
    recentSection.classList.add("hidden");
    return;
  }
  recentSection.classList.remove("hidden");
  recentMeta.textContent = `${Math.min(items.length, 20)} 个标签`;
  recentList.append(
    ...items
      .slice(0, 20)
      .map((item) =>
        row(
          item.title,
          item.subtitle || item.windowName || "最近打开",
          item.color,
          () => activateTab(item.tabId, item.windowId),
          item.icon,
        ),
      ),
  );
}
function renderCurrent(windows) {
  windowGrid.replaceChildren();
  currentGrid.replaceChildren();
  const list = (windows || []).filter((w) => tabCount(w));
  windowMeta.textContent = list.length ? `${list.length} 个` : "";
  currentMeta.textContent = "";
  if (!list.length) {
    windowGrid.append(empty("没有打开的窗口"));
    currentGrid.append(empty("没有打开的标签"));
    return;
  }
  if (!list.some((windowState) => windowState.id === selectedWindowId))
    selectedWindowId =
      list.find((windowState) => windowState.focused)?.id ?? list[0].id;
  const windowTitles = list.map(
    (windowState) =>
      `${windowState.alias || windowState.displayName || `窗口 ${windowState.id}`}${windowState.id === selectedWindowId ? " (current)" : ""}`,
  );
  const showWindowContext = list.length > 1;
  windowGrid.append(
    ...list.map((windowState, index) =>
      renderWindowCard(
        windowState,
        windowTitles[index],
        windowState.id === selectedWindowId,
      ),
    ),
  );
  const groups = list.flatMap((windowState, index) => [
    ...(windowState.groups || []).map((group) => ({
      ...group,
      windowLabel: showWindowContext ? windowTitles[index] : "",
    })),
    ...(windowState.ungroupedTabs?.length
      ? [
          {
            title: "未分组",
            color: "grey",
            tabs: windowState.ungroupedTabs,
            id: null,
            windowId: windowState.id,
            windowLabel: showWindowContext ? windowTitles[index] : "",
          },
        ]
      : []),
  ]);
  groups.sort(
    (a, b) =>
      Number(b.windowId === selectedWindowId) -
      Number(a.windowId === selectedWindowId),
  );
  const columnCount = Math.max(
    1,
    Math.floor((currentGrid.clientWidth + 12) / 332),
  );
  const columns = Array.from({ length: columnCount }, () => {
    const column = document.createElement("div");
    column.className = "group-column";
    return column;
  });
  groups.forEach((group, index) => {
    columns[index % columnCount].append(renderGroup(group));
  });
  currentGrid.append(...columns);
}
function renderWindowCard(windowState, title, selected) {
  const card = document.createElement("article");
  card.className = "window-card";
  card.dataset.windowId = String(windowState.id);
  if (selected) card.classList.add("is-focused");
  card.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    startWindowDrag(event, card, windowState.id);
  });
  const handle = document.createElement("span");
  handle.className = "window-drag-handle";
  handle.textContent = "⋮⋮";
  handle.title = "拖动调整窗口顺序";
  handle.setAttribute("aria-hidden", "true");
  const button = action(title, () => {
    if (Date.now() < suppressWindowClickUntil) return;
    return switchWindow(windowState.id);
  });
  button.className = "window-switch";
  button.setAttribute("aria-label", `切换到${title}`);
  if (selected) button.setAttribute("aria-current", "true");
  const rename = action("重命名", () => renameWindow(windowState));
  rename.className = "window-rename";
  rename.setAttribute("aria-label", `重命名${title}`);
  card.append(handle, button, rename);
  return card;
}

function startWindowDrag(event, card, windowId) {
  if (event.button !== 0 || pointerWindowDrag) return;
  const rect = card.getBoundingClientRect();
  pointerWindowDrag = {
    card,
    windowId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    originRect: {
      left: rect.left,
      top: rect.top,
    },
    initialOrder: getWindowOrderFromDom(),
    moved: false,
    active: false,
    ghost: null,
    landingPreview: null,
    target: null,
  };
  logClientEvent("new-tab.window-drag.start", { windowId });
}

function handleWindowDragMove(event) {
  const drag = pointerWindowDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const distance = Math.hypot(
    event.clientX - drag.startX,
    event.clientY - drag.startY,
  );
  if (!drag.moved && distance < 4) return;
  if (!drag.moved) {
    drag.moved = true;
    activateWindowDrag(drag);
  }
  if (!drag.active) return;
  event.preventDefault();
  updateDragGhost(drag, event.clientX, event.clientY);

  const target = findWindowCardAt(event.clientX, event.clientY, drag.card);
  clearDragHighlight();
  if (!target) {
    drag.target = null;
    drag.landingPreview.classList.remove("is-visible");
    drag.ghost.classList.add("is-invalid-drop");
    return;
  }
  drag.ghost.classList.remove("is-invalid-drop");

  const sourceRect = drag.originRect;
  const targetRect = getWindowCardLayoutRect(target);
  target.style.setProperty(
    "--drag-dx",
    `${sourceRect.left - targetRect.left}px`,
  );
  target.style.setProperty("--drag-dy", `${sourceRect.top - targetRect.top}px`);
  target.classList.add("is-drag-over");
  target.classList.toggle(
    "is-after",
    event.clientY > targetRect.top + targetRect.height / 2,
  );
  drag.landingPreview.style.left = `${targetRect.left}px`;
  drag.landingPreview.style.top = `${targetRect.top}px`;
  drag.landingPreview.classList.add("is-visible");
  drag.target = target;
}

function activateWindowDrag(drag) {
  const rect = drag.card.getBoundingClientRect();
  drag.card.classList.add("is-drag-source");

  const ghost = drag.card.cloneNode(true);
  ghost.className = "window-card window-drag-ghost";
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.pointerEvents = "none";
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  document.body.append(ghost);
  const landingPreview = drag.card.cloneNode(true);
  landingPreview.className = "window-card window-drop-preview";
  landingPreview.style.width = `${rect.width}px`;
  landingPreview.style.height = `${rect.height}px`;
  landingPreview.style.pointerEvents = "none";
  landingPreview.setAttribute("aria-hidden", "true");
  landingPreview.inert = true;
  document.body.append(landingPreview);
  drag.ghost = ghost;
  drag.landingPreview = landingPreview;
  drag.active = true;
  drag.card.classList.add("is-dragging");
  windowGrid.classList.add("is-dragging");
  document.body.classList.add("is-window-dragging");
  drag.card.setPointerCapture?.(drag.pointerId);
}

function updateDragGhost(drag, clientX, clientY) {
  drag.ghost.style.left = `${clientX - drag.offsetX}px`;
  drag.ghost.style.top = `${clientY - drag.offsetY}px`;
}

function handleWindowDragEnd(event) {
  const drag = pointerWindowDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  pointerWindowDrag = null;

  if (!drag.active) {
    logClientEvent("new-tab.window-drag.end", {
      windowId: drag.windowId,
      dropped: false,
    });
    return;
  }

  const targetId = Number(drag.target?.dataset.windowId);
  const validTarget = Number.isInteger(targetId) && targetId !== drag.windowId;
  const order = validTarget
    ? swapWindowOrder(drag.initialOrder, drag.windowId, targetId)
    : null;
  cleanupWindowDrag(drag);
  suppressWindowClickUntil = Date.now() + 250;

  if (!order) {
    logClientEvent("new-tab.window-drag.cancel", {
      windowId: drag.windowId,
      reason: "no-target",
    });
    return;
  }

  state.windows = reorderWindows(state.windows, order);
  renderCurrent(state.windows);
  logClientEvent("new-tab.window-drag.drop", {
    windowId: drag.windowId,
    targetWindowId: targetId,
    order,
  });
  persistWindowOrder(order);
}

function cancelWindowDrag() {
  if (!pointerWindowDrag) return;
  const drag = pointerWindowDrag;
  pointerWindowDrag = null;
  if (drag.active) cleanupWindowDrag(drag);
}

function cleanupWindowDrag(drag) {
  clearDragHighlight();
  drag.ghost?.remove();
  drag.landingPreview?.remove();
  drag.card.classList.remove("is-dragging");
  drag.card.classList.remove("is-drag-source");
  windowGrid.classList.remove("is-dragging");
  document.body.classList.remove("is-window-dragging");
}

function findWindowCardAt(clientX, clientY, source) {
  return [...windowGrid.querySelectorAll(".window-card")].find((card) => {
    if (card === source || card.style.display === "none") return false;
    const rect = getWindowCardLayoutRect(card);
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  });
}

function getWindowCardLayoutRect(card) {
  const rect = card.getBoundingClientRect();
  const dx = Number.parseFloat(card.style.getPropertyValue("--drag-dx")) || 0;
  const dy = Number.parseFloat(card.style.getPropertyValue("--drag-dy")) || 0;
  return {
    left: rect.left - dx,
    top: rect.top - dy,
    right: rect.right - dx,
    bottom: rect.bottom - dy,
    width: rect.width,
    height: rect.height,
  };
}

function clearDragHighlight() {
  windowGrid.querySelectorAll(".window-card.is-drag-over").forEach((card) => {
    card.classList.remove("is-drag-over", "is-after");
    card.style.removeProperty("--drag-dx");
    card.style.removeProperty("--drag-dy");
  });
}

function swapWindowOrder(order, sourceId, targetId) {
  const next = [...order];
  const sourceIndex = next.indexOf(sourceId);
  const targetIndex = next.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex)
    return null;
  [next[sourceIndex], next[targetIndex]] = [
    next[targetIndex],
    next[sourceIndex],
  ];
  return next;
}
function renderGroup(group) {
  const section = document.createElement("section");
  section.className = "group-row";
  if (group.active) section.classList.add("is-active");
  section.addEventListener("click", (event) => {
    if (event.target?.closest?.("button")) return;
    Promise.resolve()
      .then(() =>
        group.id == null
          ? activateTab(group.tabs?.[0]?.id, group.windowId)
          : activateGroup(group.id, group.windowId),
      )
      .catch(reportActionError);
  });
  section.style.setProperty(
    "--group-color",
    COLORS[group.color] || COLORS.grey,
  );
  const key = `${group.windowId}:${group.id ?? "ungrouped"}`;
  const expanded = expandedGroups.has(key);
  const head = document.createElement("div");
  head.className = "group-head";
  const open = action(`${group.title || "未命名分组"}`, () =>
    group.id == null
      ? activateTab(group.tabs?.[0]?.id, group.windowId)
      : activateGroup(group.id, group.windowId),
  );
  open.className = "group-open";
  head.append(open);
  const count = document.createElement("span");
  count.className = "group-count";
  count.textContent = `${group.tabs?.length || 0} 标签`;
  head.append(count);
  if (group.windowLabel) {
    const context = document.createElement("span");
    context.className = "group-window";
    context.textContent = group.windowLabel;
    head.append(context);
  }
  section.append(head);
  const tabs = document.createElement("div");
  tabs.className = "mini-tabs";
  const visible = expanded ? group.tabs || [] : (group.tabs || []).slice(0, 3);
  for (const tab of visible)
    tabs.append(
      row(
        tab.title || tab.url,
        tab.domain || tab.url,
        null,
        () => activateTab(tab.id, tab.windowId),
        tab.favIconUrl,
      ),
    );
  section.append(tabs);
  if ((group.tabs || []).length > 3) {
    const more = action(
      expanded ? "收起标签" : `查看全部 ${group.tabs.length} 个标签`,
      () => {
        const scrollTop = window.scrollY;
        if (expanded) expandedGroups.delete(key);
        else expandedGroups.add(key);
        render();
        requestAnimationFrame(() => window.scrollTo(0, scrollTop));
      },
    );
    more.className = "preview-toggle";
    more.setAttribute("aria-expanded", String(expanded));
    section.append(more);
  }
  return section;
}
function renderSnapshots(workspaces) {
  snapshotGrid.replaceChildren();
  snapshotMeta.textContent = `${workspaces?.length || 0} 个快照`;
  if (!workspaces?.length) {
    snapshotGrid.append(empty("同步后会在这里保留快照"));
    return;
  }
  snapshotGrid.append(
    ...workspaces.map((workspace) => {
      const card = document.createElement("article");
      card.className = "snapshot-card";
      card.append(
        row(
          workspace.name,
          `${workspace.groups?.length || 0} 分组 · ${tabCount(workspace)} 标签 · ${relative(workspace.updatedAt)}`,
          null,
          () => restoreWorkspace(workspace),
        ),
      );
      const restore = action("恢复", () => restoreWorkspace(workspace));
      restore.className = "inline-action";
      card.append(restore);
      return card;
    }),
  );
}
function search(windows, workspaces, q) {
  const results = [];
  for (const w of windows || []) {
    const wn = w.displayName || `窗口 ${w.id}`;
    if (matches(wn, q))
      results.push({
        title: wn,
        meta: `${w.groups?.length || 0} 分组 · ${tabCount(w)} 标签`,
        onClick: () => switchWindow(w.id),
      });
    for (const g of w.groups || []) {
      if (matches(`${g.title} ${wn}`, q))
        results.push({
          title: g.title || "未命名分组",
          meta: `${wn} · ${g.tabs?.length || 0} 标签`,
          color: g.color,
          badge: "分组",
          onClick: () => activateGroup(g.id, w.id),
        });
      for (const t of g.tabs || [])
        if (!isWorkspaceNewTab(t) && tabMatches(t, q))
          results.push({
            title: t.title || t.url,
            meta: `${wn} / ${g.title} · ${t.domain || t.url}`,
            icon: t.favIconUrl,
            badge: "标签",
            onClick: () => activateTab(t.id, t.windowId),
          });
    }
    for (const t of w.ungroupedTabs || [])
      if (!isWorkspaceNewTab(t) && tabMatches(t, q))
        results.push({
          title: t.title || t.url,
          meta: `${wn} / 未分组 · ${t.domain || t.url}`,
          icon: t.favIconUrl,
          badge: "标签",
          onClick: () => activateTab(t.id, t.windowId),
        });
  }
  for (const ws of workspaces || []) {
    if (matches(ws.name, q))
      results.push({
        title: ws.name,
        meta: `${ws.groups?.length || 0} 分组 · ${tabCount(ws)} 标签`,
        badge: "快照",
        onClick: () => restoreWorkspace(ws),
      });
    for (const g of ws.groups || [])
      if (matches(`${g.title} ${ws.name}`, q))
        results.push({
          title: g.title,
          meta: `${ws.name} · ${g.tabs?.length || 0} 标签`,
          color: g.color,
          badge: "快照分组",
          onClick: () => restoreGroup(ws, g),
        });
    for (const t of [
      ...(ws.ungroupedTabs || []),
      ...(ws.groups || []).flatMap((g) => g.tabs || []),
    ])
      if (!isWorkspaceNewTab(t) && savedTabMatches(t, q))
        results.push({
          title: t.title || t.url,
          meta: `${ws.name} · ${getDomain(t.url) || t.url}`,
          icon: t.favIconUrl,
          badge: "快照标签",
          onClick: () => sendMessage({ type: "OPEN_SAVED_TAB", url: t.url }),
        });
  }
  return results
    .map((result, index) => ({ result, index }))
    .sort(
      (a, b) =>
        resultScore(b.result, q) - resultScore(a.result, q) ||
        a.index - b.index,
    )
    .map(({ result }) => result)
    .slice(0, 100);
}
function renderResult(result) {
  return row(
    result.title,
    result.meta,
    result.color,
    result.onClick,
    result.icon,
    result.badge,
  );
}
function row(title, meta, color, onClick, icon, badge) {
  const button = document.createElement("button");
  button.className = "list-row";
  button.type = "button";
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    Promise.resolve()
      .then(onClick)
      .catch((e) => reportActionError(e));
  });
  if (icon && safeIconUrl(icon)) {
    const img = document.createElement("img");
    img.src = safeIconUrl(icon);
    img.alt = "";
    button.append(img);
  } else {
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = COLORS[color] || COLORS.grey;
    button.append(dot);
  }
  const content = document.createElement("span");
  content.className = "row-content";
  content.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(meta || "")}</span>`;
  button.append(content);
  if (badge) {
    const b = document.createElement("small");
    b.textContent = badge;
    button.append(b);
  }
  return button;
}
function action(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    Promise.resolve()
      .then(onClick)
      .catch((error) => reportActionError(error));
  });
  return button;
}
function empty(text) {
  const node = document.createElement("div");
  node.className = "empty";
  node.textContent = text;
  return node;
}
function tabCount(item) {
  return (
    (item?.ungroupedTabs?.length || 0) +
    (item?.groups || []).reduce((n, g) => n + (g.tabs?.length || 0), 0)
  );
}
function tabMatches(tab, q) {
  return matches(`${tab.title} ${tab.url} ${tab.domain}`, q);
}
function savedTabMatches(tab, q) {
  return matches(`${tab.title} ${tab.url} ${getDomain(tab.url)}`, q);
}
function matches(value, q) {
  return String(value || "")
    .toLowerCase()
    .includes(q);
}
function resultScore(result, q) {
  const title = String(result?.title || "").toLowerCase();
  if (title === q) return 3;
  if (title.startsWith(q)) return 2;
  return title.includes(q) ? 1 : 0;
}
function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
function relative(timestamp) {
  if (!timestamp) return "未知";
  const seconds = Math.max(0, (Date.now() - timestamp) / 1000);
  return seconds < 60
    ? "刚刚"
    : seconds < 3600
      ? `${Math.floor(seconds / 60)} 分钟前`
      : `${Math.floor(seconds / 3600)} 小时前`;
}
function formatTime(timestamp) {
  return timestamp
    ? new Date(timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "未同步";
}
function safeIconUrl(url) {
  return /^(https?:|data:image\/)/.test(String(url || "")) ? url : "";
}
function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>\"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function normalizeState(value) {
  return {
    windows: Array.isArray(value?.windows) ? value.windows : [],
    savedWorkspaces: Array.isArray(value?.savedWorkspaces)
      ? value.savedWorkspaces
      : [],
    recentItems: Array.isArray(value?.recentItems)
      ? value.recentItems.filter((item) => item && typeof item === "object")
      : [],
    recentGroups: Array.isArray(value?.recentGroups)
      ? value.recentGroups.filter((item) => item && typeof item === "object")
      : [],
    recentTabs: Array.isArray(value?.recentTabs)
      ? value.recentTabs.filter((item) => item && typeof item === "object")
      : [],
    summary: value?.summary || {},
  };
}
async function activateTab(tabId, windowId) {
  if (tabId) await sendMessage({ type: "ACTIVATE_TAB", tabId, windowId });
}
async function activateGroup(groupId, windowId) {
  if (groupId != null)
    await sendMessage({ type: "ACTIVATE_GROUP", groupId, windowId });
}
async function switchWindow(windowId) {
  const requestId = ++switchRequestId;
  const previousWindowId = selectedWindowId;
  pendingFocusWindowId = windowId;
  selectedWindowId = windowId;
  renderCurrent(state.windows);
  const switchRequest = async () => {
    if (requestId !== switchRequestId) return;
    try {
      await sendMessage({ type: "FOCUS_WINDOW", windowId });
      if (requestId === switchRequestId) pendingFocusWindowId = null;
    } catch (error) {
      if (requestId === switchRequestId) {
        pendingFocusWindowId = null;
        selectedWindowId = previousWindowId;
        renderCurrent(state.windows);
      }
      throw error;
    }
  };
  switchWindowChain = switchWindowChain.then(switchRequest, switchRequest);
  return switchWindowChain;
}
async function persistWindowOrder(order = getWindowOrderFromDom()) {
  if (!order.length) return;
  try {
    await chrome.storage.local.set({ [WINDOW_ORDER_KEY]: order });
    sendMessage({ type: "RESYNC_RUNTIME_STATE" }).catch(() => {});
  } catch (error) {
    logClientError("new-tab.persistWindowOrder", error);
    showError("窗口顺序保存失败，请重试");
  }
}

function getWindowOrderFromDom() {
  return [...windowGrid.querySelectorAll(".window-card")]
    .map((card) => Number(card.dataset.windowId))
    .filter(Number.isInteger);
}

function reorderWindows(windows, order) {
  const byId = new Map(
    (windows || []).map((windowState) => [windowState.id, windowState]),
  );
  const reordered = [];
  for (const id of order) {
    const windowState = byId.get(id);
    if (!windowState) continue;
    reordered.push(windowState);
    byId.delete(id);
  }
  return [...reordered, ...byId.values()];
}
function ensureSelectedWindow() {
  if (pendingFocusWindowId != null) {
    if (
      state.windows.some(
        (windowState) => windowState.id === pendingFocusWindowId,
      )
    ) {
      selectedWindowId = pendingFocusWindowId;
      return;
    }
    pendingFocusWindowId = null;
  }
  const focusedWindowId = state.windows.find(
    (windowState) => windowState.focused,
  )?.id;
  if (focusedWindowId != null) {
    selectedWindowId = focusedWindowId;
    return;
  }
  if (!state.windows.some((windowState) => windowState.id === selectedWindowId))
    selectedWindowId = state.windows[0]?.id;
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
async function renameWindow(windowState) {
  const alias = prompt("窗口名称", windowState.alias || "");
  if (alias === null) return;
  state = normalizeState(
    (
      await sendMessage({
        type: "SET_WINDOW_ALIAS",
        windowId: windowState.id,
        alias,
      })
    ).result,
  );
  render();
}
async function restoreWorkspace(workspace) {
  const target = chooseRestoreTarget();
  if (!target) return;
  await sendMessage({
    type: "RESTORE_SAVED_WORKSPACE",
    workspaceId: workspace.id,
    target,
  });
}
async function restoreGroup(workspace, group) {
  const index = (workspace.groups || []).indexOf(group);
  const target = chooseRestoreTarget();
  if (!target) return;
  await sendMessage({
    type: "RESTORE_SAVED_GROUP",
    workspaceId: workspace.id,
    groupIndex: index,
    target,
  });
}
function chooseRestoreTarget() {
  const choice = prompt(
    "恢复位置：输入 1 在当前窗口，输入 2 在新窗口；取消则放弃",
  );
  if (choice === "1") return "current";
  if (choice === "2") return "new";
  return null;
}
async function exportDiagnosticLogs() {
  try {
    const logs =
      (await sendMessage({ type: "GET_DIAGNOSTIC_LOGS" })).result || [];
    const blob = new Blob([JSON.stringify(logs, null, 2)], {
      type: "application/json",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "tab-workspace-logs.json";
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (error) {
    logClientError("new-tab.exportLogs", error);
  }
}
function sendMessage(message) {
  return new Promise((resolve, reject) =>
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      if (!response?.ok)
        return reject(new Error(response?.error || "操作失败"));
      resolve(response);
    }),
  );
}
function installErrorLogging(context) {
  window.addEventListener("error", (event) =>
    logClientError(`${context}.window`, event.error || event.message),
  );
  window.addEventListener("unhandledrejection", (event) =>
    logClientError(`${context}.promise`, event.reason),
  );
}
function logClientError(context, error) {
  if (!error) return;
  sendMessage({
    type: "LOG_CLIENT_ERROR",
    context,
    error: {
      message: error.message || String(error),
      stack: error.stack || "",
    },
  }).catch(() => {});
}
function logClientEvent(context, details) {
  console.debug("Tab Workspace Manager:", context, details || "");
  sendMessage({
    type: "LOG_CLIENT_EVENT",
    context,
    details: details || null,
  }).catch(() => {});
}
function showError(message) {
  status.textContent = message;
}
function reportActionError(error) {
  logClientError("new-tab.action", error);
  showError("操作失败，请重试");
}
function updateSelection() {
  const rows = [...resultsList.querySelectorAll(".list-row")];
  if (!rows.length) {
    selectedIndex = 0;
    return;
  }
  selectedIndex = Math.max(0, Math.min(selectedIndex, rows.length - 1));
  rows.forEach((row, index) =>
    row.classList.toggle("is-selected", index === selectedIndex),
  );
}
function moveSelection(step) {
  const count = resultsList.querySelectorAll(".list-row").length;
  if (!count) return;
  selectedIndex = (selectedIndex + step + count) % count;
  updateSelection();
  resultsList.querySelectorAll(".list-row")[selectedIndex]?.scrollIntoView({
    block: "nearest",
  });
}
function activateSelectedResult() {
  resultsList.querySelectorAll(".list-row")[selectedIndex]?.click();
}
