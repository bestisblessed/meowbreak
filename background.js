const DEFAULT_SETTINGS = {
  usageLimit: 60,
  breakTime: 5
};

const DEFAULT_STATE = {
  usageSeconds: 0,
  trackingSince: null,
  breakEndsAt: null,
  focusLostAt: null
};

const ALARM_NAME = 'meowbreak-tick';
let popupPort = null;
const FOCUS_RESUME_GRACE_MS = 15 * 60 * 1000;
const RESTRICTED_HOSTS = new Set([
  'chrome.google.com',
  'chromewebstore.google.com'
]);

async function getStored(defaults) {
  return chrome.storage.local.get(defaults);
}

async function setStored(values) {
  await chrome.storage.local.set(values);
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function normalizeSettings(settings) {
  return {
    usageLimit: clampNumber(settings.usageLimit, DEFAULT_SETTINGS.usageLimit, 1, 480),
    breakTime: clampNumber(settings.breakTime, DEFAULT_SETTINGS.breakTime, 1, 60)
  };
}

function getEligibleUrl(url) {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (RESTRICTED_HOSTS.has(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isEligibleTab(tab) {
  return !!tab?.id && !!getEligibleUrl(tab.url);
}

function isEligibleTabHint(tab) {
  return !!tab?.id && !!getEligibleUrl(tab.url);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });
  return tab || null;
}

async function browserHasFocusedWindow() {
  if (popupPort) return true;
  const window = await chrome.windows.getLastFocused();
  return window.focused;
}

async function getState() {
  const stored = await getStored({
    ...DEFAULT_SETTINGS,
    ...DEFAULT_STATE
  });
  const settings = normalizeSettings(stored);
  return {
    settings,
    usageSeconds: Number(stored.usageSeconds) || 0,
    trackingSince: stored.trackingSince || null,
    breakEndsAt: stored.breakEndsAt || null,
    focusLostAt: stored.focusLostAt || null
  };
}

function applyElapsedUsage(state, now) {
  if (!state.trackingSince || state.breakEndsAt) return state;

  const elapsedSeconds = Math.max(0, Math.floor((now - state.trackingSince) / 1000));
  if (elapsedSeconds === 0) return state;

  return {
    ...state,
    usageSeconds: state.usageSeconds + elapsedSeconds,
    trackingSince: now
  };
}

function getLiveUsageSeconds(state, now) {
  if (!state.trackingSince || state.breakEndsAt || state.focusLostAt) {
    return state.usageSeconds;
  }

  return state.usageSeconds + Math.max(0, Math.floor((now - state.trackingSince) / 1000));
}

function getNextBreakAt(state, limitSeconds) {
  if (!state.trackingSince || state.breakEndsAt || state.focusLostAt) return null;
  return state.trackingSince + Math.max(0, limitSeconds - state.usageSeconds) * 1000;
}

async function sendToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    try {
      await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tabId, message);
    } catch {
      // Tab is not scriptable (e.g. chrome:// pages)
    }
  }
}

async function showBreakInActiveEligibleTab(breakEndsAt) {
  const tab = await getActiveTab();
  if (!isEligibleTab(tab)) return false;

  await sendToTab(tab.id, {
    type: 'SHOW_BREAK_OVERLAY',
    breakEndsAt
  });
  return true;
}

async function hideBreakInActiveEligibleTab() {
  const tab = await getActiveTab();
  if (!isEligibleTab(tab)) return;
  await sendToTab(tab.id, { type: 'HIDE_BREAK_OVERLAY' });
}

async function hideBreakInEligibleTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.filter(isEligibleTab).map((tab) => sendToTab(tab.id, { type: 'HIDE_BREAK_OVERLAY' }))
  );
}

async function startBreak(state, now) {
  const breakEndsAt = now + state.settings.breakTime * 60 * 1000;
  await setStored({
    usageSeconds: 0,
    trackingSince: null,
    breakEndsAt,
    focusLostAt: null
  });
  await showBreakInActiveEligibleTab(breakEndsAt);
  return {
    ...state,
    usageSeconds: 0,
    trackingSince: null,
    breakEndsAt,
    focusLostAt: null
  };
}

async function clearBreak(now) {
  await setStored({
    usageSeconds: 0,
    trackingSince: now,
    breakEndsAt: null,
    focusLostAt: null
  });
  await hideBreakInActiveEligibleTab();
}

async function reconcileTracking() {
  const now = Date.now();
  let state = await getState();
  const focused = await browserHasFocusedWindow();
  const activeTab = await getActiveTab();
  const eligible = focused && isEligibleTab(activeTab);

  if (!state.focusLostAt) {
    state = applyElapsedUsage(state, now);
  }

  if (focused && state.focusLostAt) {
    const tookRealBreak = now - state.focusLostAt >= FOCUS_RESUME_GRACE_MS;
    state = {
      ...state,
      usageSeconds: tookRealBreak ? 0 : state.usageSeconds,
      trackingSince: null,
      focusLostAt: null
    };
  }

  if (state.breakEndsAt) {
    if (now >= state.breakEndsAt) {
      await clearBreak(eligible ? now : null);
      return;
    }

    if (eligible) await showBreakInActiveEligibleTab(state.breakEndsAt);
    if (state.trackingSince !== null || state.focusLostAt !== null) {
      await setStored({
        trackingSince: null,
        focusLostAt: focused ? null : (state.focusLostAt || now)
      });
    }
    return;
  }

  const limitSeconds = state.settings.usageLimit * 60;
  if (state.usageSeconds >= limitSeconds) {
    await startBreak(state, now);
    return;
  }

  const nextTrackingSince = eligible ? (state.trackingSince || now) : null;
  await setStored({
    usageSeconds: state.usageSeconds,
    trackingSince: nextTrackingSince,
    focusLostAt: focused ? null : (state.focusLostAt || now),
    usageLimit: state.settings.usageLimit,
    breakTime: state.settings.breakTime,
    breakEndsAt: null
  });
}

async function handleFocusChanged() {
  await reconcileTracking();
}

async function resetUsageAfterSettingsChange(settings) {
  const normalized = normalizeSettings(settings);
  await setStored({
    ...normalized,
    usageSeconds: 0,
    trackingSince: null,
    breakEndsAt: null,
    focusLostAt: null
  });
  await hideBreakInEligibleTabs();
  await reconcileTracking();
  return normalized;
}

async function getPublicStatus(options = {}) {
  const preState = await getState();

  if (!preState.breakEndsAt) {
    await reconcileTracking();
  }

  const state = await getState();
  const now = Date.now();
  const activeTab = options.activeTabHint || await getActiveTab();
  const focused = await browserHasFocusedWindow();
  const tabEligible = isEligibleTabHint(activeTab);
  const eligible = options.ignoreFocus ? tabEligible : (focused && tabEligible);

  const limitSeconds = state.settings.usageLimit * 60;
  const usageSeconds = getLiveUsageSeconds(state, now);
  const nextBreakAt = getNextBreakAt(state, limitSeconds);
  const remainingSeconds = nextBreakAt
    ? Math.max(0, Math.ceil((nextBreakAt - now) / 1000))
    : Math.max(0, limitSeconds - usageSeconds);

  return {
    settings: state.settings,
    usageSeconds,
    remainingSeconds,
    nextBreakAt,
    breakEndsAt: state.breakEndsAt,
    breakActive: !!state.breakEndsAt,
    eligible,
    tabEligible,
    focused,
    activeTabUrl: activeTab?.url || null
  };
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await getStored(DEFAULT_SETTINGS);
  await setStored(normalizeSettings(stored));
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  await reconcileTracking();
});

chrome.runtime.onStartup.addListener(async () => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  await reconcileTracking();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    reconcileTracking();
  }
});

chrome.tabs.onActivated.addListener(() => {
  reconcileTracking();
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    reconcileTracking();
  }
});

chrome.windows.onFocusChanged.addListener(() => {
  handleFocusChanged();
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    popupPort = port;
    port.onDisconnect.addListener(() => {
      popupPort = null;
      reconcileTracking();
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'GET_STATE') {
    getPublicStatus({
      ignoreFocus: message.ignoreFocus === true,
      activeTabHint: message.activeTabHint || null
    }).then(sendResponse);
    return true;
  }

  if (message?.type === 'SET_SETTINGS') {
    resetUsageAfterSettingsChange(message.settings || {}).then((settings) => {
      sendResponse({ settings });
    });
    return true;
  }

  if (message?.type === 'DISMISS_BREAK') {
    setStored({
      usageSeconds: 0,
      trackingSince: null,
      breakEndsAt: null,
      focusLostAt: null
    }).then(async () => {
      await hideBreakInEligibleTabs();
      await reconcileTracking();
      sendResponse({ dismissed: true });
    });
    return true;
  }

  if (message?.type === 'CONTENT_READY') {
    reconcileTracking().then(() => sendResponse({ ok: true }));
    return true;
  }
});
