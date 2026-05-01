const DEFAULT_SETTINGS = {
  usageLimit: 60,
  breakTime: 5
};

const usageLimitInput = document.getElementById('usageLimit');
const breakTimeInput = document.getElementById('breakTime');
const dismissButton = document.getElementById('dismissBtn');
const saveButton = document.getElementById('saveBtn');
const savedMessage = document.getElementById('savedMsg');
const statusText = document.getElementById('statusText');

function getClampedNumberValue(input, fallbackValue) {
  const parsedValue = Number.parseInt(input.value, 10);
  const minValue = Number.parseInt(input.min, 10);
  const maxValue = Number.parseInt(input.max, 10);

  if (Number.isNaN(parsedValue)) return fallbackValue;
  return Math.min(Math.max(parsedValue, minValue), maxValue);
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      void chrome.runtime.lastError;
      resolve(response);
    });
  });
}

function getActiveTabHint() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      void chrome.runtime.lastError;
      resolve(tab ? { id: tab.id, url: tab.url } : null);
    });
  });
}

function formatSeconds(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function renderStatus(state) {
  if (document.activeElement !== usageLimitInput) {
    usageLimitInput.value = state.settings.usageLimit;
  }
  if (document.activeElement !== breakTimeInput) {
    breakTimeInput.value = state.settings.breakTime;
  }
  dismissButton.style.display = state.breakActive ? 'block' : 'none';

  if (state.breakActive) {
    const remaining = Math.max(0, Math.ceil((state.breakEndsAt - Date.now()) / 1000));
    statusText.textContent = `Break active, ${formatSeconds(remaining)} remaining.`;
    return;
  }

  if (!state.tabEligible) {
    statusText.textContent = 'Timer paused on Chrome/internal pages. Open a normal website tab.';
    return;
  }

  if (!state.eligible) {
    statusText.textContent = 'Timer ready — it resumes when the website tab has focus.';
    return;
  }

  const limitSeconds = state.settings.usageLimit * 60;
  const remainingSeconds = Math.max(0, state.remainingSeconds ?? (limitSeconds - state.usageSeconds));
  statusText.textContent = `${formatSeconds(remainingSeconds)} until next break. ${formatSeconds(state.usageSeconds)} counted.`;
}

async function refreshStatus() {
  const activeTabHint = await getActiveTabHint();
  const state = await sendMessage({
    type: 'GET_STATE',
    ignoreFocus: true,
    activeTabHint
  });
  if (state?.settings) renderStatus(state);
}

dismissButton.addEventListener('click', async () => {
  await sendMessage({ type: 'DISMISS_BREAK' });
  await refreshStatus();
});

saveButton.addEventListener('click', async () => {
  const settings = {
    usageLimit: getClampedNumberValue(usageLimitInput, DEFAULT_SETTINGS.usageLimit),
    breakTime: getClampedNumberValue(breakTimeInput, DEFAULT_SETTINGS.breakTime)
  };

  const response = await sendMessage({
    type: 'SET_SETTINGS',
    settings
  });

  if (response?.settings) {
    usageLimitInput.value = response.settings.usageLimit;
    breakTimeInput.value = response.settings.breakTime;
  }

  savedMessage.style.display = 'block';
  setTimeout(() => {
    savedMessage.style.display = 'none';
  }, 1800);

  await refreshStatus();
});

chrome.runtime.connect({ name: 'popup' });
refreshStatus();
setInterval(refreshStatus, 1000);
