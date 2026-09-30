const RUNTIME_STATE_KEY = "runtimeState";
const SYNC_SUMMARY_KEY = "syncSummary";
const RECENT_GROUPS_KEY = "recentGroups";
const RECENT_ITEMS_KEY = "recentItems";
const WINDOW_ALIASES_KEY = "windowAliases";
const WINDOW_ORDER_KEY = "windowOrder";
const SAVED_WORKSPACES_KEY = "savedWorkspaces";
const DIAGNOSTIC_LOGS_KEY = "diagnosticLogs";
const MAX_RECENT_GROUPS = 8;
const MAX_RECENT_ITEMS = 20;
const MAX_SAVED_WORKSPACES = 24;
const MAX_DIAGNOSTIC_LOGS = 200;
const MAX_ICON_URL_LENGTH = 2048;
const MAX_PENDING_ACTIVITY_WRITES = 100;
const MAX_PENDING_DIAGNOSTIC_WRITES = 100;
const MAX_DIAGNOSTIC_DETAIL_LENGTH = 4096;
const MAX_WINDOW_ALIAS_LENGTH = 200;
const UNGROUPED_GROUP_ID = chrome.tabGroups.TAB_GROUP_ID_NONE;

let syncTimer = null;
let syncInFlight = null;
let syncRequested = false;
let lastRuntimeState = null;
let lastActiveByGroup = new Map();
let diagnosticLogWriteChain = Promise.resolve();
let diagnosticLogQueueDepth = 0;
let recentActivityWriteChain = Promise.resolve();
let recentActivityQueueDepth = 0;
const pendingTabActivations = new Map();
let tabActivationDrain = null;
let restoreInFlight = false;
let restoreCompletion = null;

chrome.runtime.onInstalled.addListener(() => {
  runSafely(async () => {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    await syncAndSaveRuntimeState();
  }, "runtime.onInstalled");
});

chrome.runtime.onStartup.addListener(() => {
  runSafely(syncAndSaveRuntimeState, "runtime.onStartup");
});

chrome.action.onClicked.addListener((tab) => {
  runSafely(async () => {
    if (!tab?.windowId) return;
    await openSidePanel(tab.windowId);
  }, "action.onClicked");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "RUNTIME_STATE_CHANGED") return false;

  handleMessage(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch(async (error) => {
      await writeDiagnosticLog(
        "error",
        `message.${message?.type || "unknown"}`,
        error,
      );
      sendResponse({ ok: false, error: error.message });
    });
  return true;
});

chrome.tabs.onCreated.addListener(scheduleSync);
chrome.tabs.onRemoved.addListener(scheduleSync);
chrome.tabs.onMoved.addListener(scheduleSync);
chrome.tabs.onAttached.addListener(scheduleSync);
chrome.tabs.onDetached.addListener(scheduleSync);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (
    changeInfo.title !== undefined ||
    changeInfo.url !== undefined ||
    changeInfo.favIconUrl !== undefined ||
    changeInfo.groupId !== undefined ||
    changeInfo.pinned !== undefined ||
    changeInfo.mutedInfo !== undefined ||
    changeInfo.discarded !== undefined ||
    changeInfo.audible !== undefined ||
    changeInfo.status !== undefined
  ) {
    scheduleSync();
  }
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  queueTabActivation(tabId);
});

chrome.windows.onCreated.addListener(scheduleSync);
chrome.windows.onRemoved.addListener(scheduleSync);
chrome.windows.onFocusChanged.addListener(scheduleSync);

chrome.tabGroups.onCreated.addListener(scheduleSync);
chrome.tabGroups.onRemoved.addListener(scheduleSync);
chrome.tabGroups.onUpdated.addListener(scheduleSync);
chrome.tabGroups.onMoved.addListener(scheduleSync);

async function handleMessage(message) {
  switch (message?.type) {
    case "GET_RUNTIME_STATE":
      return getRuntimeState();
    case "RESYNC_RUNTIME_STATE":
      return syncAndSaveRuntimeState();
    case "ACTIVATE_TAB":
      return activateTab(message.tabId, message.windowId);
    case "ACTIVATE_GROUP":
      return activateGroup(message.groupId, message.windowId);
    case "SET_GROUP_COLLAPSED":
      return setGroupCollapsed(message.groupId, message.collapsed);
    case "SET_WINDOW_ALIAS":
      return setWindowAlias(message.windowId, message.alias);
    case "SET_WINDOW_ORDER":
      return setWindowOrder(message.order);
    case "SAVE_WINDOW_WORKSPACE":
      return saveWindowWorkspace(message.windowId, message.target || "new");
    case "SAVE_GROUP_WORKSPACE":
      return saveGroupWorkspace(
        message.windowId,
        message.groupId,
        message.name,
      );
    case "RESTORE_SAVED_WORKSPACE":
      return restoreSavedWorkspace(
        message.workspaceId,
        message.target || "new",
      );
    case "RESTORE_SAVED_GROUP":
      return restoreSavedGroup(
        message.workspaceId,
        message.groupIndex,
        message.target || "new",
        message.sourceGroupId,
      );
    case "RESTORE_SAVED_UNGROUPED":
      return restoreSavedUngrouped(
        message.workspaceId,
        message.target || "new",
      );
    case "OPEN_SAVED_TAB":
      return openSavedTab(message.url);
    case "FOCUS_WINDOW":
      return focusWindow(message.windowId);
    case "LOG_CLIENT_ERROR":
      await writeDiagnosticLog(
        "error",
        message.context || "client",
        message.error,
        message.details,
      );
      return null;
    case "LOG_CLIENT_EVENT":
      await writeDiagnosticLog(
        "info",
        message.context || "client.event",
        "client event",
        message.details,
      );
      return null;
    case "GET_DIAGNOSTIC_LOGS":
      return getDiagnosticLogs();
    default:
      throw new Error(`Unsupported message type: ${message?.type}`);
  }
}

function scheduleSync() {
  if (restoreInFlight) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    if (restoreInFlight) return;
    runSafely(syncRuntimeState, "scheduledSync");
  }, 150);
}

function queueTabActivation(tabId) {
  if (!Number.isInteger(tabId)) return;
  pendingTabActivations.set(tabId, tabId);
  while (pendingTabActivations.size > MAX_PENDING_ACTIVITY_WRITES) {
    pendingTabActivations.delete(pendingTabActivations.keys().next().value);
  }
  if (tabActivationDrain) return;
  startTabActivationDrain();
}

function startTabActivationDrain() {
  if (tabActivationDrain) return;
  tabActivationDrain = drainTabActivations().finally(() => {
    tabActivationDrain = null;
    if (pendingTabActivations.size) startTabActivationDrain();
  });
}

async function drainTabActivations() {
  while (pendingTabActivations.size) {
    const tabIds = [...pendingTabActivations.values()];
    pendingTabActivations.clear();
    for (const tabId of tabIds) {
      await runSafely(async () => {
        const tab = await chrome.tabs.get(tabId);
        await recordTabActivity(tab);
        scheduleSync();
      }, "tabs.onActivated");
    }
  }
}

async function getRuntimeState() {
  if (lastRuntimeState) {
    if (Array.isArray(lastRuntimeState.recentTabs)) return lastRuntimeState;
    return syncRuntimeState();
  }
  const stored = await chrome.storage.local.get([
    RUNTIME_STATE_KEY,
    SAVED_WORKSPACES_KEY,
  ]);
  if (stored[RUNTIME_STATE_KEY]?.summary) {
    lastRuntimeState = hydrateRuntimeState(stored);
    if (Array.isArray(lastRuntimeState.recentTabs)) return lastRuntimeState;
    return syncRuntimeState();
  }
  return syncRuntimeState();
}

async function syncAndSaveRuntimeState() {
  if (restoreInFlight && restoreCompletion) await restoreCompletion;
  return syncRuntimeState();
}

async function syncRuntimeState(options = {}) {
  if (restoreInFlight && !options.allowDuringRestore && restoreCompletion) {
    await restoreCompletion;
    return syncRuntimeState(options);
  }
  if (syncInFlight) {
    syncRequested = true;
    return syncInFlight;
  }

  syncInFlight = (async () => {
    let runtimeState;
    do {
      syncRequested = false;
      runtimeState = await performSyncRuntimeState();
    } while (syncRequested);
    return runtimeState;
  })();

  try {
    return await syncInFlight;
  } finally {
    syncInFlight = null;
  }
}

async function performSyncRuntimeState() {
  const windows = await chrome.windows.getAll({
    populate: true,
    windowTypes: ["normal"],
  });
  const groups = await chrome.tabGroups.query({});
  await recordActiveGroupedTabs(windows);
  const stored = await chrome.storage.local.get([
    RECENT_GROUPS_KEY,
    RECENT_ITEMS_KEY,
    WINDOW_ALIASES_KEY,
    WINDOW_ORDER_KEY,
    SAVED_WORKSPACES_KEY,
  ]);
  const recentRecords = asArray(stored[RECENT_GROUPS_KEY]);
  const recentItemRecords = asArray(stored[RECENT_ITEMS_KEY]);
  const storedWindowAliases = asObject(stored[WINDOW_ALIASES_KEY]);
  const activeWindowIds = new Set(windows.map((window) => String(window.id)));
  const windowAliases = Object.fromEntries(
    Object.entries(storedWindowAliases)
      .filter(([windowId]) => activeWindowIds.has(windowId))
      .map(([windowId, alias]) => [
        windowId,
        String(alias || "").trim().slice(0, MAX_WINDOW_ALIAS_LENGTH),
      ])
      .filter(([, alias]) => alias),
  );
  const existingSavedWorkspaces = asArray(stored[SAVED_WORKSPACES_KEY]);
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const runtimeWindows = orderRuntimeWindows(
    windows.map((window) =>
      buildRuntimeWindow(window, groupById, windowAliases[String(window.id)]),
    ),
    stored[WINDOW_ORDER_KEY],
  );
  const cleanedWindowOrder = runtimeWindows.map((window) => window.id);
  pruneLastActiveGroups(runtimeWindows);
  const cleanedRecentItemRecords = pruneRecentItemRecords(
    runtimeWindows,
    recentItemRecords,
  );
  if (
    cleanedRecentItemRecords.length !== recentItemRecords.length ||
    cleanedRecentItemRecords.some(
      (record, index) => record !== recentItemRecords[index],
    )
  ) {
    await chrome.storage.local.set({
      [RECENT_ITEMS_KEY]: cleanedRecentItemRecords,
    });
  }
  const savedWorkspaces = buildSyncedWorkspaces(
    runtimeWindows,
    existingSavedWorkspaces,
  );
  const recentGroups = buildRecentGroups(runtimeWindows, recentRecords);
  const recentItems = buildRecentItems(
    runtimeWindows,
    cleanedRecentItemRecords,
    recentGroups,
  );
  const recentTabs = buildRecentTabs(runtimeWindows, cleanedRecentItemRecords);
  const summary = buildSyncSummary(runtimeWindows);
  const runtimeState = {
    version: 1,
    syncedAt: Date.now(),
    windows: runtimeWindows,
    recentGroups,
    recentItems,
    recentTabs,
    savedWorkspaces,
    summary,
  };

  const persistedRuntimeState = { ...runtimeState };
  delete persistedRuntimeState.savedWorkspaces;
  const persistedValues = {
    [RUNTIME_STATE_KEY]: persistedRuntimeState,
    [SYNC_SUMMARY_KEY]: summary,
    [SAVED_WORKSPACES_KEY]: savedWorkspaces,
  };
  if (!sameArray(cleanedWindowOrder, stored[WINDOW_ORDER_KEY])) {
    persistedValues[WINDOW_ORDER_KEY] = cleanedWindowOrder;
  }
  if (!sameObject(windowAliases, storedWindowAliases)) {
    persistedValues[WINDOW_ALIASES_KEY] = windowAliases;
  }
  await chrome.storage.local.set(persistedValues);
  lastRuntimeState = runtimeState;
  notifyRuntimeStateChanged(runtimeState);
  return runtimeState;
}

function hydrateRuntimeState(stored) {
  const runtimeState = stored?.[RUNTIME_STATE_KEY];
  if (!runtimeState || typeof runtimeState !== "object") return null;
  const storedWorkspaces = stored?.[SAVED_WORKSPACES_KEY];
  return {
    ...runtimeState,
    savedWorkspaces: Array.isArray(storedWorkspaces)
      ? storedWorkspaces
      : asArray(runtimeState.savedWorkspaces),
  };
}

function pruneLastActiveGroups(windows) {
  const activeKeys = new Set(
    (windows || []).flatMap((windowState) =>
      (windowState.groups || []).map((group) =>
        groupRuntimeKey(windowState.id, group.id),
      ),
    ),
  );
  for (const key of lastActiveByGroup.keys()) {
    if (!activeKeys.has(key)) lastActiveByGroup.delete(key);
  }
}

function sameArray(left, right) {
  return (
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => Number(value) === Number(right[index]))
  );
}

function sameObject(left, right) {
  const rightObject = asObject(right);
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(rightObject);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => String(left[key]) === String(rightObject[key]))
  );
}

function orderRuntimeWindows(windows, savedOrder) {
  const available = new Map(
    (windows || []).map((window) => [window.id, window]),
  );
  const ordered = [];
  const seen = new Set();
  for (const value of Array.isArray(savedOrder) ? savedOrder : []) {
    const windowId = Number(value);
    if (!available.has(windowId) || seen.has(windowId)) continue;
    seen.add(windowId);
    ordered.push(available.get(windowId));
  }
  for (const window of windows || []) {
    if (seen.has(window.id)) continue;
    seen.add(window.id);
    ordered.push(window);
  }
  return ordered;
}

function buildRuntimeWindow(window, groupById, alias) {
  const tabs = window.tabs || [];
  const groupedTabs = new Map();
  const ungroupedTabs = [];

  for (const tab of tabs) {
    const runtimeTab = buildRuntimeTab(tab);
    if (tab.groupId === UNGROUPED_GROUP_ID) {
      ungroupedTabs.push(runtimeTab);
      continue;
    }
    if (!groupedTabs.has(tab.groupId)) groupedTabs.set(tab.groupId, []);
    groupedTabs.get(tab.groupId).push(runtimeTab);
  }

  const groups = Array.from(groupedTabs.entries())
    .map(([groupId, groupTabs]) =>
      buildRuntimeGroup(
        groupId,
        window.id,
        alias || "",
        groupTabs,
        groupById.get(groupId),
      ),
    )
    .sort((a, b) => a.index - b.index);

  return {
    id: window.id,
    alias: alias || "",
    displayName: alias || `窗口 ${window.id}`,
    focused: Boolean(window.focused),
    incognito: Boolean(window.incognito),
    type: window.type,
    groups,
    ungroupedTabs: ungroupedTabs.sort((a, b) => a.index - b.index),
  };
}

function buildRuntimeGroup(groupId, windowId, windowAlias, tabs, chromeGroup) {
  const activeTab = tabs.find((tab) => tab.active);
  const lastActive = lastActiveByGroup.get(groupRuntimeKey(windowId, groupId));
  const lastActiveTab = tabs.find((tab) => tab.id === lastActive?.tabId);

  return {
    id: groupId,
    windowId,
    windowAlias,
    windowName: windowAlias || `窗口 ${windowId}`,
    title: chromeGroup?.title || "未命名分组",
    color: chromeGroup?.color || "grey",
    collapsed: Boolean(chromeGroup?.collapsed),
    index: chromeGroup?.index ?? tabs[0]?.index ?? 0,
    tabCount: tabs.length,
    active: Boolean(activeTab),
    pinned: false,
    lastActiveAt: lastActive?.timestamp,
    lastActiveTabId: lastActiveTab?.id || activeTab?.id || tabs[0]?.id,
    tabs: tabs.sort((a, b) => a.index - b.index),
  };
}

function buildRuntimeTab(tab) {
  return {
    id: tab.id,
    windowId: tab.windowId,
    groupId: tab.groupId,
    index: tab.index,
    title: tab.title || tab.url || "未命名标签",
    url: tab.url || "",
    favIconUrl: safeIconUrl(tab.favIconUrl),
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    muted: Boolean(tab.mutedInfo?.muted),
    discarded: Boolean(tab.discarded),
    audible: Boolean(tab.audible),
    domain: getDomain(tab.url),
    lastActiveAt: tab.active ? Date.now() : undefined,
  };
}

function buildRecentGroups(windows, recentRecords) {
  const groupsByKey = new Map();
  for (const windowState of windows || []) {
    for (const group of windowState.groups || []) {
      groupsByKey.set(groupRuntimeKey(windowState.id, group.id), group);
    }
  }

  return asArray(recentRecords)
    .filter((record) => record && typeof record === "object")
    .map((record) => {
      const group = groupsByKey.get(
        groupRuntimeKey(record.windowId, record.groupId),
      );
      if (!group) return null;
      const lastActiveTabId =
        group.tabs.find((tab) => tab.id === record.tabId)?.id ||
        group.lastActiveTabId ||
        group.tabs[0]?.id;
      const lastActiveTab =
        group.tabs.find((tab) => tab.id === lastActiveTabId) || group.tabs[0];
      return {
        ...group,
        windowAlias: group.windowAlias || "",
        lastActiveAt: record.lastActiveAt || group.lastActiveAt,
        lastActiveTabId,
        lastActiveTab,
        lastActiveTabTitle: lastActiveTab?.title || "最近标签未知",
        lastActiveTabDomain: lastActiveTab?.domain || lastActiveTab?.url || "",
      };
    })
    .filter(Boolean)
    .slice(0, MAX_RECENT_GROUPS);
}

function buildRecentItems(windows, recentItemRecords, recentGroups) {
  const tabsByKey = new Map();
  const groupsByKey = new Map();

  for (const windowState of windows || []) {
    for (const group of windowState.groups || []) {
      groupsByKey.set(groupRuntimeKey(windowState.id, group.id), group);
      for (const tab of group.tabs || []) {
        tabsByKey.set(tabRuntimeKey(windowState.id, tab.id), {
          tab,
          group,
          windowState,
        });
      }
    }
    for (const tab of windowState.ungroupedTabs || []) {
      tabsByKey.set(tabRuntimeKey(windowState.id, tab.id), {
        tab,
        group: null,
        windowState,
      });
    }
  }

  const recentGroupKeys = new Set();
  const items = [];
  for (const record of asArray(recentItemRecords)) {
    if (!record || typeof record !== "object") continue;
    const tabInfo = tabsByKey.get(tabRuntimeKey(record.windowId, record.tabId));
    if (!tabInfo) continue;
    const { tab, group, windowState } = tabInfo;
    if (group) {
      const key = groupRuntimeKey(record.windowId, group.id);
      if (recentGroupKeys.has(key)) continue;
      recentGroupKeys.add(key);
      items.push({
        type: "group",
        id: key,
        groupId: group.id,
        windowId: record.windowId,
        title: group.title || "未命名分组",
        subtitle: tab.title || "最近标签未知",
        color: group.color || "grey",
        tabCount: group.tabCount,
        lastActiveAt: record.lastActiveAt,
        lastActiveTabId: tab.id,
        windowName: windowState.displayName,
      });
    } else {
      items.push({
        type: "tab",
        id: tabRuntimeKey(record.windowId, tab.id),
        tabId: tab.id,
        windowId: record.windowId,
        title: tab.title || tab.url || "未命名标签",
        url: tab.url || "",
        subtitle: `${windowState.displayName} / 未分组${tab.domain ? ` · ${tab.domain}` : ""}`,
        icon: safeIconUrl(tab.favIconUrl),
        color: "grey",
        lastActiveAt: record.lastActiveAt,
      });
    }
  }

  if (items.length) return items.slice(0, MAX_RECENT_ITEMS);

  return (recentGroups || []).map((group) => ({
    type: "group",
    id: groupRuntimeKey(group.windowId, group.id),
    groupId: group.id,
    windowId: group.windowId,
    title: group.title || "未命名分组",
    subtitle: group.lastActiveTabTitle || "最近标签未知",
    color: group.color || "grey",
    tabCount: group.tabCount,
    lastActiveAt: group.lastActiveAt,
    lastActiveTabId: group.lastActiveTabId,
    windowName: group.windowName,
  }));
}

function buildRecentTabs(windows, recentItemRecords) {
  const tabsByKey = new Map();
  for (const windowState of windows || []) {
    for (const group of windowState.groups || []) {
      for (const tab of group.tabs || []) {
        tabsByKey.set(tabRuntimeKey(windowState.id, tab.id), {
          tab,
          group,
          windowState,
        });
      }
    }
    for (const tab of windowState.ungroupedTabs || []) {
      tabsByKey.set(tabRuntimeKey(windowState.id, tab.id), {
        tab,
        group: null,
        windowState,
      });
    }
  }

  return asArray(recentItemRecords)
    .map((record) => {
      if (!record || typeof record !== "object") return null;
      const tabInfo = tabsByKey.get(
        tabRuntimeKey(record.windowId, record.tabId),
      );
      if (!tabInfo) return null;
      const { tab, group, windowState } = tabInfo;
      if (isWorkspaceNewTab(tab)) return null;
      return {
        type: "tab",
        id: tabRuntimeKey(record.windowId, tab.id),
        tabId: tab.id,
        windowId: record.windowId,
        title: tab.title || tab.url || "未命名标签",
        url: tab.url || "",
        subtitle: `${windowState.displayName} / ${group?.title || "未分组"}${tab.domain ? ` · ${tab.domain}` : ""}`,
        icon: safeIconUrl(tab.favIconUrl),
        color: group?.color || "grey",
        lastActiveAt: Number(record.lastActiveAt) || 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .slice(0, MAX_RECENT_ITEMS);
}

function pruneRecentItemRecords(windows, records) {
  const currentTabKeys = new Set();
  for (const windowState of windows || []) {
    for (const group of windowState.groups || []) {
      for (const tab of group.tabs || []) {
        if (isWorkspaceNewTab(tab)) continue;
        currentTabKeys.add(tabRuntimeKey(windowState.id, tab.id));
      }
    }
    for (const tab of windowState.ungroupedTabs || []) {
      if (isWorkspaceNewTab(tab)) continue;
      currentTabKeys.add(tabRuntimeKey(windowState.id, tab.id));
    }
  }

  const seen = new Set();
  return asArray(records).filter((record) => {
    if (!record || typeof record !== "object") return false;
    const key = tabRuntimeKey(record.windowId, record.tabId);
    if (!currentTabKeys.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildSyncSummary(windows) {
  const safeWindows = Array.isArray(windows) ? windows : [];
  const groupCount = safeWindows.reduce(
    (count, window) => count + (window.groups || []).length,
    0,
  );
  const tabCount = safeWindows.reduce(
    (count, window) =>
      count +
      (window.ungroupedTabs || []).length +
      (window.groups || []).reduce(
        (groupTotal, group) => groupTotal + (group.tabs || []).length,
        0,
      ),
    0,
  );
  return {
    syncedAt: Date.now(),
    windowCount: safeWindows.length,
    groupCount,
    tabCount,
    error: null,
  };
}

async function recordActiveGroupedTabs(windows) {
  const activeTabs = windows
    .flatMap((window) => window.tabs || [])
    .filter((tab) => tab.active);

  for (const tab of activeTabs) {
    await recordTabActivity(tab, { initializeOnly: true });
  }
}

function recordTabActivity(tab, options = {}) {
  if (recentActivityQueueDepth >= MAX_PENDING_ACTIVITY_WRITES) {
    return Promise.resolve();
  }
  const write = async () => {
    if (isWorkspaceNewTab(tab)) return;
    if (tab.groupId !== UNGROUPED_GROUP_ID) {
      await recordGroupActivity(tab, options);
    }
    await recordRecentItem(tab, options);
  };
  recentActivityQueueDepth += 1;
  const result = recentActivityWriteChain.then(write, write);
  recentActivityWriteChain = result
    .catch(() => {})
    .finally(() => {
      recentActivityQueueDepth = Math.max(0, recentActivityQueueDepth - 1);
      if (recentActivityQueueDepth === 0) {
        recentActivityWriteChain = Promise.resolve();
      }
    });
  return result;
}

async function recordRecentItem(tab, options = {}) {
  const stored = await chrome.storage.local.get([RECENT_ITEMS_KEY]);
  const recentItems = asArray(stored[RECENT_ITEMS_KEY]).filter(
    (item) => item && typeof item === "object",
  );
  const existing = recentItems.find(
    (item) => item.tabId === tab.id && item.windowId === tab.windowId,
  );
  if (options.initializeOnly && existing) return;

  const timestamp = Date.now();
  const currentItem = {
    type: tab.groupId === UNGROUPED_GROUP_ID ? "tab" : "group",
    groupId: tab.groupId,
    windowId: tab.windowId,
    tabId: tab.id,
    lastActiveAt: timestamp,
  };
  const otherItems = recentItems.filter(
    (item) => item.tabId !== tab.id || item.windowId !== tab.windowId,
  );
  const nextRecentItems = options.initializeOnly
    ? [...recentItems, currentItem].slice(0, MAX_RECENT_ITEMS)
    : [currentItem, ...otherItems].slice(0, MAX_RECENT_ITEMS);

  await chrome.storage.local.set({ [RECENT_ITEMS_KEY]: nextRecentItems });
}

async function recordGroupActivity(tab, options = {}) {
  const stored = await chrome.storage.local.get([RECENT_GROUPS_KEY]);
  const recentGroups = asArray(stored[RECENT_GROUPS_KEY]).filter(
    (group) => group && typeof group === "object",
  );
  const existing = recentGroups.find(
    (group) => group.groupId === tab.groupId && group.windowId === tab.windowId,
  );
  if (options.initializeOnly && existing) {
    lastActiveByGroup.set(groupRuntimeKey(tab.windowId, tab.groupId), {
      tabId: existing.tabId || tab.id,
      timestamp: existing.lastActiveAt,
    });
    return;
  }

  const timestamp = Date.now();

  lastActiveByGroup.set(groupRuntimeKey(tab.windowId, tab.groupId), {
    tabId: tab.id,
    timestamp,
  });

  const currentRecord = {
    groupId: tab.groupId,
    windowId: tab.windowId,
    tabId: tab.id,
    lastActiveAt: timestamp,
  };
  const otherRecords = recentGroups.filter(
    (group) => group.groupId !== tab.groupId || group.windowId !== tab.windowId,
  );
  const nextRecentGroups = options.initializeOnly
    ? [...recentGroups, currentRecord].slice(0, MAX_RECENT_GROUPS)
    : [currentRecord, ...otherRecords].slice(0, MAX_RECENT_GROUPS);

  await chrome.storage.local.set({ [RECENT_GROUPS_KEY]: nextRecentGroups });
}

async function activateTab(tabId, windowId) {
  await chrome.windows.update(windowId, { focused: true });
  const tab = await chrome.tabs.update(tabId, { active: true });
  await recordTabActivity(tab);
  scheduleSync();
  return tab;
}

async function activateGroup(groupId, windowId) {
  let state = await getRuntimeState();
  let targetWindow = state.windows.find((window) => window.id === windowId);
  let targetGroup = targetWindow?.groups.find(
    (group) => group.id === groupId,
  );
  if (!targetGroup) {
    state = await syncRuntimeState();
    targetWindow = state.windows.find((window) => window.id === windowId);
    targetGroup = targetWindow?.groups.find((group) => group.id === groupId);
  }
  if (!targetGroup) throw new Error("Group not found");

  const liveTabs = await chrome.tabs.query({ windowId, groupId });
  if (!liveTabs.length) {
    await syncRuntimeState();
    throw new Error("Group has no tabs");
  }

  const liveTabIds = new Set(liveTabs.map((tab) => tab.id));
  const targetTabId = [
    targetGroup.lastActiveTabId,
    liveTabs.find((tab) => tab.active)?.id,
    liveTabs[0]?.id,
  ].find((tabId) => liveTabIds.has(tabId));
  if (!targetTabId) throw new Error("Group has no tabs");

  await chrome.windows.update(windowId, { focused: true });
  await chrome.tabGroups.update(groupId, { collapsed: false });
  const tab = await chrome.tabs.update(targetTabId, { active: true });
  await recordTabActivity(tab);
  scheduleSync();
  return tab;
}

async function setGroupCollapsed(groupId, collapsed) {
  const group = await chrome.tabGroups.update(groupId, { collapsed });
  scheduleSync();
  return group;
}

async function focusWindow(windowId) {
  return chrome.windows.update(windowId, { focused: true });
}

async function openSidePanelForCurrentWindow() {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (activeTab?.windowId) {
    await openSidePanel(activeTab.windowId);
    return;
  }

  const focusedWindow = await chrome.windows.getCurrent();
  if (focusedWindow?.id) await openSidePanel(focusedWindow.id);
}

async function openSidePanel(windowId) {
  const openPromise = chrome.sidePanel.open({ windowId });
  const syncPromise = syncRuntimeState();
  const [openResult, syncResult] = await Promise.allSettled([
    openPromise,
    syncPromise,
  ]);
  if (syncResult.status === "rejected") throw syncResult.reason;
  if (openResult.status === "rejected") throw openResult.reason;
}

async function setWindowAlias(windowId, alias) {
  const stored = await chrome.storage.local.get([WINDOW_ALIASES_KEY]);
  const aliases = asObject(stored[WINDOW_ALIASES_KEY]);
  const normalizedAlias = String(alias || "")
    .trim()
    .slice(0, MAX_WINDOW_ALIAS_LENGTH);
  if (normalizedAlias) {
    aliases[String(windowId)] = normalizedAlias;
  } else {
    delete aliases[String(windowId)];
  }
  await chrome.storage.local.set({ [WINDOW_ALIASES_KEY]: aliases });
  return syncRuntimeState();
}

async function setWindowOrder(order) {
  const normalized = [];
  const seen = new Set();
  for (const value of Array.isArray(order) ? order : []) {
    const windowId = Number(value);
    if (!Number.isInteger(windowId) || seen.has(windowId)) continue;
    seen.add(windowId);
    normalized.push(windowId);
  }
  await chrome.storage.local.set({ [WINDOW_ORDER_KEY]: normalized });
  return syncRuntimeState();
}

async function saveWindowWorkspace(windowId, target = "new") {
  const state = await syncAndSaveRuntimeState();
  const targetWindow = state.windows.find((window) => window.id === windowId);
  if (!targetWindow) throw new Error("Window not found");
  return restoreSavedWorkspace(workspaceIdFromWindow(targetWindow), target);
}

async function saveGroupWorkspace(windowId, groupId) {
  const state = await syncAndSaveRuntimeState();
  const targetWindow = state.windows.find((window) => window.id === windowId);
  const targetGroup = targetWindow?.groups.find(
    (group) => group.id === groupId,
  );
  if (!targetGroup) throw new Error("Group not found");
  return restoreSavedGroup(
    workspaceIdFromWindow(targetWindow),
    targetWindow.groups.indexOf(targetGroup),
    "new",
    targetGroup.id,
  );
}

async function openSavedTab(url) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) throw new Error("URL is required");
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  return chrome.tabs.create({
    windowId: activeTab?.windowId,
    url: normalizedUrl,
    active: true,
  });
}

async function restoreSavedWorkspace(workspaceId, target = "new") {
  const workspace = await getSavedWorkspace(workspaceId);
  const allTabs = [
    ...(workspace.groups || []).flatMap((group) =>
      asArray(group.tabs).map((tab) => ({ tab, group })),
    ),
    ...asArray(workspace.ungroupedTabs).map((tab) => ({ tab, group: null })),
  ]
    .filter((item) => item.tab?.url)
    .sort((a, b) => (a.tab.index ?? 0) - (b.tab.index ?? 0));

  return restoreSavedItems(allTabs, target);
}

async function restoreSavedGroup(
  workspaceId,
  groupIndex,
  target = "new",
  sourceGroupId,
) {
  const workspace = await getSavedWorkspace(workspaceId);
  const group =
    sourceGroupId !== undefined && sourceGroupId !== null
      ? (workspace.groups || []).find(
          (candidate) =>
            String(candidate.sourceGroupId) === String(sourceGroupId),
        )
      : (workspace.groups || [])[Number(groupIndex)];
  if (!group) throw new Error("Group not found");

  const groupTabs = asArray(group.tabs)
    .filter((tab) => tab && typeof tab === "object")
    .map((tab) => ({ tab, group }))
    .filter((item) => item.tab?.url);

  return restoreSavedItems(groupTabs, target);
}

async function restoreSavedUngrouped(workspaceId, target = "new") {
  const workspace = await getSavedWorkspace(workspaceId);
  const tabs = (workspace.ungroupedTabs || [])
    .map((tab) => ({ tab, group: null }))
    .filter((item) => item.tab?.url);

  return restoreSavedItems(tabs, target);
}

async function getSavedWorkspace(workspaceId) {
  const stored = await chrome.storage.local.get([SAVED_WORKSPACES_KEY]);
  const savedWorkspaces = asArray(stored[SAVED_WORKSPACES_KEY]);
  const workspace = savedWorkspaces.find(
    (item) => item && typeof item === "object" && item.id === workspaceId,
  );
  if (!workspace) throw new Error("Workspace not found");
  return {
    ...workspace,
    groups: asArray(workspace.groups).filter(
      (group) => group && typeof group === "object",
    ),
    ungroupedTabs: asArray(workspace.ungroupedTabs).filter(
      (tab) => tab && typeof tab === "object",
    ),
  };
}

async function restoreSavedItems(items, target = "new") {
  if (items.length === 0) throw new Error("No tabs to restore");
  if (restoreInFlight)
    throw new Error("Another restore is already in progress");

  clearTimeout(syncTimer);
  syncTimer = null;
  restoreInFlight = true;
  let resolveRestoreCompletion;
  restoreCompletion = new Promise((resolve) => {
    resolveRestoreCompletion = resolve;
  });
  let createdWindowId = null;
  const createdTabIds = [];

  try {
    if (syncInFlight) await syncInFlight;
    return await restoreSavedItemsTransaction(
      items,
      target,
      createdTabIds,
      (windowId) => {
        createdWindowId = windowId;
      },
    );
  } catch (error) {
    if (createdWindowId) {
      await chrome.windows.remove(createdWindowId).catch(() => {});
    } else if (createdTabIds.length > 0) {
      await Promise.all(
        createdTabIds.map((tabId) => chrome.tabs.remove(tabId).catch(() => {})),
      );
    }
    throw error;
  } finally {
    await syncRuntimeState({ allowDuringRestore: true }).catch(() => {});
    restoreInFlight = false;
    resolveRestoreCompletion?.();
    restoreCompletion = null;
  }
}

async function restoreSavedItemsTransaction(
  items,
  target,
  createdTabIds,
  onWindowCreated,
) {
  const targetWindowId =
    target === "current" ? await getCurrentWindowId() : null;
  const groupTabIds = new Map();
  const restoredTabIds = [];
  let restoredWindowId = targetWindowId;
  let itemsToCreate = items;

  if (!targetWindowId) {
    const firstItem = items[0];
    const createdWindow = await chrome.windows.create({
      url: firstItem.tab.url,
      focused: true,
    });
    const firstTab = createdWindow.tabs?.[0];
    restoredWindowId = createdWindow.id;
    onWindowCreated(restoredWindowId);
    itemsToCreate = items.slice(1);
    if (firstTab?.id) {
      restoredTabIds.push(firstTab.id);
      createdTabIds.push(firstTab.id);
    }

    if (firstTab && firstItem.group) {
      groupTabIds.set(firstItem.group, [firstTab.id]);
    }
  } else {
    await chrome.windows.update(targetWindowId, { focused: true });
  }

  for (const item of itemsToCreate) {
    const createOptions = {
      windowId: restoredWindowId,
      url: item.tab.url,
      active: false,
    };
    if (!targetWindowId && Number.isInteger(item.tab.index)) {
      createOptions.index = item.tab.index;
    }
    const createdTab = await chrome.tabs.create(createOptions);
    restoredTabIds.push(createdTab.id);
    createdTabIds.push(createdTab.id);
    if (!item.group) continue;
    if (!groupTabIds.has(item.group)) groupTabIds.set(item.group, []);
    groupTabIds.get(item.group).push(createdTab.id);
  }

  for (const [group, tabIds] of groupTabIds.entries()) {
    const groupId = await chrome.tabs.group({
      tabIds,
      createProperties: { windowId: restoredWindowId },
    });
    await chrome.tabGroups.update(groupId, {
      title: group.title,
      color: group.color || "grey",
      collapsed: Boolean(group.collapsed),
    });
  }

  for (let index = 0; index < restoredTabIds.length; index += 1) {
    await applySavedTabState(restoredTabIds[index], items[index]?.tab);
  }
  const activeItem = items.find((item) => item.tab.active) || items[0];
  const activeIndex = items.indexOf(activeItem);
  if (restoredTabIds[activeIndex]) {
    await chrome.tabs.update(restoredTabIds[activeIndex], { active: true });
  }

  return { windowId: restoredWindowId, target, tabCount: items.length };
}

async function applySavedTabState(tabId, tab) {
  const update = {};
  if (typeof tab?.pinned === "boolean") update.pinned = tab.pinned;
  if (typeof tab?.muted === "boolean") update.muted = tab.muted;
  if (Object.keys(update).length > 0) await chrome.tabs.update(tabId, update);
}

async function getCurrentWindowId() {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (activeTab?.windowId) return activeTab.windowId;
  const focusedWindow = await chrome.windows.getCurrent();
  return focusedWindow?.id;
}

function buildSyncedWorkspaces(windows, existingWorkspaces = []) {
  existingWorkspaces = asArray(existingWorkspaces).filter(
    (workspace) => workspace && typeof workspace === "object",
  );
  const existingById = new Map(
    existingWorkspaces.map((workspace) => [workspace.id, workspace]),
  );
  const recoveriesByWindowId = new Map(
    existingWorkspaces
      .filter((workspace) => Number.isInteger(workspace.recoveryFor))
      .map((workspace) => [workspace.recoveryFor, workspace]),
  );
  const currentTabIds = new Set(
    (windows || [])
      .flatMap((window) => [
        ...(window.ungroupedTabs || []),
        ...(window.groups || []).flatMap((group) => group.tabs || []),
      ])
      .map((tab) => tab.id),
  );
  const currentIds = new Set();
  const now = Date.now();
  const mergedWorkspaces = [];

  for (const windowState of windows || []) {
    const id = workspaceIdFromWindow(windowState);
    const existing = existingById.get(id);
    const closedGroups = buildClosedGroupRecovery(existing, currentTabIds);
    if (closedGroups.length) {
      const recovery = recoveriesByWindowId.get(windowState.id);
      recoveriesByWindowId.set(
        windowState.id,
        recovery
          ? appendRecoveryGroups(recovery, closedGroups)
          : createRecoveryWorkspace(existing, windowState, closedGroups, now),
      );
    }
    currentIds.add(id);
    const currentSnapshot = mergeWorkspaceSnapshot(windowState, existing, now);
    if (snapshotHasTabs(currentSnapshot))
      mergedWorkspaces.push(currentSnapshot);
  }

  for (const workspace of existingWorkspaces) {
    if (
      !currentIds.has(workspace.id) &&
      !Number.isInteger(workspace.recoveryFor)
    ) {
      mergedWorkspaces.push(sanitizeWorkspaceSnapshot(workspace));
    }
  }

  const recoveryWorkspaces = [...recoveriesByWindowId.values()]
    .map(sanitizeWorkspaceSnapshot)
    .filter(snapshotHasTabs)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const currentWorkspaces = mergedWorkspaces.filter((workspace) =>
    currentIds.has(workspace.id),
  );
  const historicalWorkspaces = mergedWorkspaces.filter(
    (workspace) => !currentIds.has(workspace.id),
  );
  const candidates = [
    ...currentWorkspaces,
    ...recoveryWorkspaces,
    ...historicalWorkspaces,
  ];
  const seen = new Set();
  return candidates
    .filter((workspace) => {
      if (!workspace?.id || seen.has(workspace.id)) return false;
      seen.add(workspace.id);
      return snapshotHasTabs(workspace);
    })
    .slice(0, MAX_SAVED_WORKSPACES);
}

function buildClosedGroupRecovery(workspace, currentTabIds) {
  return asArray(workspace?.groups)
    .filter((group) => {
      const tabs = asArray(group.tabs);
      return (
        tabs.length > 0 &&
        tabs.every(
          (tab) =>
            Number.isInteger(tab.sourceTabId) &&
            !currentTabIds.has(tab.sourceTabId),
        )
      );
    })
    .map((group) => ({ ...group, tabs: asArray(group.tabs).slice() }));
}

function createRecoveryWorkspace(existing, windowState, groups, now) {
  return {
    id: `recovery_window_${windowState.id}`,
    recoveryFor: windowState.id,
    name: `${existing?.name || windowState.displayName || `窗口 ${windowState.id}`} · 关闭前`,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    sourceWindowId: windowState.id,
    groups,
    ungroupedTabs: [],
  };
}

function appendRecoveryGroups(recovery, groups) {
  const existingKeys = new Set(
    asArray(recovery.groups).map(
      (group) => group.sourceGroupId ?? savedGroupKey(group),
    ),
  );
  const appended = groups.filter((group) => {
    const key = group.sourceGroupId ?? savedGroupKey(group);
    if (existingKeys.has(key)) return false;
    existingKeys.add(key);
    return true;
  });
  return {
    ...recovery,
    updatedAt: Date.now(),
    groups: [...asArray(recovery.groups), ...appended].sort(
      (a, b) => (a.index ?? 0) - (b.index ?? 0),
    ),
  };
}

function snapshotHasTabs(snapshot) {
  return Boolean(
    asArray(snapshot?.ungroupedTabs).length ||
      asArray(snapshot?.groups).some((group) => asArray(group?.tabs).length),
  );
}

function sanitizeWorkspaceSnapshot(workspace) {
  return {
    ...workspace,
    groups: asArray(workspace.groups)
      .filter((group) => group && typeof group === "object")
      .map((group) => ({
        ...group,
        tabs: asArray(group.tabs)
          .filter((tab) => !isWorkspaceNewTab(tab))
          .map(sanitizeSavedTab),
      }))
      .filter((group) => group.tabs.length),
    ungroupedTabs: asArray(workspace.ungroupedTabs)
      .filter((tab) => !isWorkspaceNewTab(tab))
      .map(sanitizeSavedTab),
  };
}

function sanitizeSavedTab(tab) {
  return {
    ...tab,
    favIconUrl: safeIconUrl(tab?.favIconUrl),
  };
}

function mergeWorkspaceSnapshot(windowState, existing, now) {
  const currentGroups = (windowState.groups || [])
    .map((group) => ({
      ...group,
      tabs: (group.tabs || []).filter((tab) => !isWorkspaceNewTab(tab)),
    }))
    .filter((group) => group.tabs.length)
    .map(buildSavedGroup);
  const currentUngroupedTabs = (windowState.ungroupedTabs || [])
    .filter((tab) => !isWorkspaceNewTab(tab))
    .map(buildSavedTab);
  return {
    id: workspaceIdFromWindow(windowState),
    name: windowState.displayName || existing?.name || `窗口 ${windowState.id}`,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    sourceWindowId: windowState.id,
    groups: mergeSavedGroups(currentGroups, []),
    ungroupedTabs: mergeSavedTabs(currentUngroupedTabs, []),
  };
}

function buildSavedGroup(group) {
  return {
    sourceGroupId: group.id,
    title: group.title,
    color: group.color,
    collapsed: group.collapsed,
    index: group.index,
    lastSeenAt: Date.now(),
    tabs: (group.tabs || []).map(buildSavedTab),
  };
}

function mergeSavedGroups(currentGroups, existingGroups) {
  const existingByKey = new Map(
    (existingGroups || []).map((group) => [savedGroupKey(group), group]),
  );
  return (currentGroups || [])
    .map((group) => {
      const existing = existingByKey.get(savedGroupKey(group));
      return {
        ...existing,
        ...group,
        createdAt: existing?.createdAt || group.lastSeenAt || Date.now(),
        lastSeenAt: group.lastSeenAt || Date.now(),
        tabs: mergeSavedTabs(group.tabs || [], []),
      };
    })
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

function mergeSavedTabs(currentTabs, _existingTabs) {
  return (currentTabs || [])
    .filter((tab) => tab.url)
    .map((tab) => ({ ...tab, lastSeenAt: Date.now() }))
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

function savedGroupKey(group) {
  return `${normalizeSnapshotKey(group.title || "未命名分组")}:${group.color || "grey"}`;
}

function normalizeSnapshotKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-_./|:()[\]{}]+/g, "");
}

function workspaceIdFromWindow(windowState) {
  return `synced_window_${windowState.id}`;
}

function buildSavedTab(tab) {
  return {
    sourceTabId: tab.id,
    title: tab.title,
    url: tab.url,
    favIconUrl: safeIconUrl(tab.favIconUrl),
    pinned: tab.pinned,
    muted: tab.muted,
    active: tab.active,
    index: tab.index,
  };
}

function notifyRuntimeStateChanged(runtimeState) {
  chrome.runtime
    .sendMessage({ type: "RUNTIME_STATE_CHANGED", runtimeState })
    .catch(() => {});
}

function groupRuntimeKey(windowId, groupId) {
  return `${windowId}:${groupId}`;
}

function tabRuntimeKey(windowId, tabId) {
  return `${windowId}:${tabId}`;
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

function safeIconUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (value.length > MAX_ICON_URL_LENGTH) return "";
  if (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("data:image/")
  )
    return value;
  return "";
}

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function runSafely(task, context = "background") {
  return Promise.resolve()
    .then(task)
    .catch((error) => {
      console.warn("Tab Workspace Manager:", error);
      return writeDiagnosticLog("error", context, error);
    });
}

async function getDiagnosticLogs() {
  const stored = await chrome.storage.local.get([DIAGNOSTIC_LOGS_KEY]);
  return Array.isArray(stored[DIAGNOSTIC_LOGS_KEY])
    ? stored[DIAGNOSTIC_LOGS_KEY]
    : [];
}

async function writeDiagnosticLog(level, context, error, details) {
  if (diagnosticLogQueueDepth >= MAX_PENDING_DIAGNOSTIC_WRITES) return;
  const entry = {
    timestamp: Date.now(),
    level,
    context,
    message:
      error instanceof Error
        ? error.message
        : String(error?.message || error || "Unknown error"),
    stack:
      error instanceof Error ? error.stack || "" : String(error?.stack || ""),
    details: sanitizeDiagnosticDetails(details),
    extensionVersion: chrome.runtime.getManifest().version,
  };

  diagnosticLogQueueDepth += 1;
  diagnosticLogWriteChain = diagnosticLogWriteChain
    .catch(() => {})
    .then(async () => {
      const stored = await chrome.storage.local.get([DIAGNOSTIC_LOGS_KEY]);
      const logs = Array.isArray(stored[DIAGNOSTIC_LOGS_KEY])
        ? stored[DIAGNOSTIC_LOGS_KEY]
            .filter((log) => log && typeof log === "object")
            .map((log) => ({
              ...log,
              details: sanitizeDiagnosticDetails(log.details),
            }))
        : [];
      await chrome.storage.local.set({
        [DIAGNOSTIC_LOGS_KEY]: [entry, ...logs].slice(0, MAX_DIAGNOSTIC_LOGS),
      });
    })
    .finally(() => {
      diagnosticLogQueueDepth = Math.max(0, diagnosticLogQueueDepth - 1);
      if (diagnosticLogQueueDepth === 0) {
        diagnosticLogWriteChain = Promise.resolve();
      }
    });

  try {
    await diagnosticLogWriteChain;
  } catch (loggingError) {
    console.warn(
      "Tab Workspace Manager: failed to persist diagnostic log",
      loggingError,
    );
  }
}

function sanitizeDiagnosticDetails(details) {
  if (!details) return null;
  try {
    const serialized = JSON.stringify(details);
    if (!serialized) return null;
    return serialized.length > MAX_DIAGNOSTIC_DETAIL_LENGTH
      ? `${serialized.slice(0, MAX_DIAGNOSTIC_DETAIL_LENGTH)}…`
      : JSON.parse(serialized);
  } catch {
    return String(details).slice(0, MAX_DIAGNOSTIC_DETAIL_LENGTH);
  }
}
