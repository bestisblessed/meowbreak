(() => {
const CAT_VIDEO_URL = chrome.runtime.getURL('assets/meowbreak-pounce.webm');
const CAT_SLEEP_URL = chrome.runtime.getURL('assets/meowbreak-nap.webm');

const preloadVideo = document.createElement('video');
preloadVideo.src = CAT_VIDEO_URL;
preloadVideo.preload = 'auto';
preloadVideo.muted = true;

const preloadSleep = document.createElement('video');
preloadSleep.src = CAT_SLEEP_URL;
preloadSleep.preload = 'auto';
preloadSleep.muted = true;

const NEXT_BREAK_WIDGET_ID = 'meowbreak-next-break';

let overlayCountdownTimer = null;
let nextBreakWidgetTimer = null;

const preventScroll = (event) => event.preventDefault();

function formatSeconds(seconds) {
  const normalizedSeconds = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(normalizedSeconds / 60);
  const rest = normalizedSeconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function sendRuntimeMessage(message) {
  if (!chrome.runtime?.id) {
    teardown();
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }

      resolve(response);
    });
  });
}

function teardown() {
  if (nextBreakWidgetTimer) {
    clearInterval(nextBreakWidgetTimer);
    nextBreakWidgetTimer = null;
  }
  removeNextBreakWidget();
}

function removeNextBreakWidget() {
  document.getElementById(NEXT_BREAK_WIDGET_ID)?.remove();
}

function renderNextBreakWidget(state) {
  if (!state?.eligible || state.breakActive || document.getElementById('meowbreak-overlay')) {
    removeNextBreakWidget();
    return;
  }

  const remainingSeconds = state.nextBreakAt
    ? Math.max(0, Math.ceil((state.nextBreakAt - Date.now()) / 1000))
    : Math.max(0, state.remainingSeconds ?? 0);
  if (remainingSeconds <= 0) {
    removeNextBreakWidget();
    return;
  }

  let widget = document.getElementById(NEXT_BREAK_WIDGET_ID);
  if (!widget) {
    widget = document.createElement('div');
    widget.id = NEXT_BREAK_WIDGET_ID;
    widget.setAttribute('role', 'status');
    widget.setAttribute('aria-live', 'polite');
    document.body.appendChild(widget);
  }

  widget.textContent = `Break in ${formatSeconds(remainingSeconds)}`;
}

async function refreshNextBreakWidget() {
  if (!chrome.runtime?.id) {
    teardown();
    return;
  }
  const state = await sendRuntimeMessage({ type: 'GET_STATE' });
  if (state?.breakActive && state.breakEndsAt && !document.getElementById('meowbreak-overlay')) {
    showOverlay(state.breakEndsAt);
    return;
  }
  renderNextBreakWidget(state);
}

function startNextBreakWidgetTimer() {
  if (nextBreakWidgetTimer) return;

  refreshNextBreakWidget();
  nextBreakWidgetTimer = setInterval(refreshNextBreakWidget, 1000);
}

function formatOverlayRemaining(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function removeOverlay() {
  const overlay = document.getElementById('meowbreak-overlay');
  if (!overlay) return;

  if (overlayCountdownTimer) {
    clearInterval(overlayCountdownTimer);
    overlayCountdownTimer = null;
  }

  overlay.remove();
  document.documentElement.style.overflow = '';
  document.removeEventListener('wheel', preventScroll);
  document.removeEventListener('touchmove', preventScroll);
}

function updateCountdown(countdown, breakEndsAt) {
  countdown.textContent = formatOverlayRemaining(breakEndsAt - Date.now());
}

function showOverlay(breakEndsAt) {
  removeOverlay();
  removeNextBreakWidget();

  const overlay = document.createElement('div');
  overlay.id = 'meowbreak-overlay';

  const countdown = document.createElement('div');
  countdown.id = 'meowbreak-countdown';
  updateCountdown(countdown, breakEndsAt);

  const dismissButton = document.createElement('button');
  dismissButton.id = 'meowbreak-dismiss';
  dismissButton.type = 'button';
  dismissButton.textContent = 'Dismiss break';
  dismissButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'DISMISS_BREAK' }, () => {
      void chrome.runtime.lastError;
      removeOverlay();
    });
  });

  const video = document.createElement('video');
  video.src = CAT_VIDEO_URL;
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;

  const videoSleep = document.createElement('video');
  videoSleep.src = CAT_SLEEP_URL;
  videoSleep.muted = true;
  videoSleep.playsInline = true;
  videoSleep.loop = true;
  videoSleep.style.display = 'none';

  overlay.appendChild(countdown);
  overlay.appendChild(dismissButton);
  overlay.appendChild(video);
  overlay.appendChild(videoSleep);
  document.body.appendChild(overlay);

  document.documentElement.style.overflow = 'hidden';
  document.addEventListener('wheel', preventScroll, { passive: false });
  document.addEventListener('touchmove', preventScroll, { passive: false });

  document.querySelectorAll('video').forEach((pageVideo) => {
    if (pageVideo !== video && pageVideo !== videoSleep) {
      pageVideo.pause();
    }
  });

  video.addEventListener('ended', () => {
    video.style.display = 'none';
    videoSleep.style.display = 'block';
    videoSleep.classList.add('sleeping');
    videoSleep.play();
  });

  overlayCountdownTimer = setInterval(() => {
    updateCountdown(countdown, breakEndsAt);
    if (Date.now() >= breakEndsAt) removeOverlay();
  }, 1000);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'SHOW_BREAK_OVERLAY') {
    if (!document.getElementById('meowbreak-overlay')) {
      showOverlay(message.breakEndsAt);
    }
    sendResponse({ shown: true });
    return;
  }

  if (message?.type === 'HIDE_BREAK_OVERLAY') {
    removeOverlay();
    refreshNextBreakWidget();
    sendResponse({ hidden: true });
  }
});

chrome.runtime.sendMessage({ type: 'CONTENT_READY' }, () => {
  void chrome.runtime.lastError;
  startNextBreakWidgetTimer();
});

document.addEventListener('visibilitychange', () => {
  if (!chrome.runtime?.id) {
    teardown();
    return;
  }
  if (document.hidden) {
    removeNextBreakWidget();
    return;
  }

  refreshNextBreakWidget();
});
})();
