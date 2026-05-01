# MeowBreak

MeowBreak is a user-owned Manifest V3 extension that counts active Chrome browsing time across the browser and nudges you into cat-powered breaks.

## Install in Chrome2/Profile 1

1. Open Chrome2/Profile 1.
2. Go to `chrome://extensions`.
3. Enable Developer Mode.
4. Choose Load unpacked.
5. Select this directory: `/Users/pablo/Code/chrome-break-gatekeeper`.

## Behavior

- The content script is configured for `<all_urls>` so normal websites are broadly eligible.
- Chrome does not allow extension content scripts on chrome:// pages, the Chrome Web Store, or other restricted browser/internal pages. The timer pauses when the active/focused tab is not an eligible normal web page.
- Usage time is browser-wide. A background service worker stores one shared `usageSeconds` value in `chrome.storage.local`, so separate tabs do not run independent countdowns.
- The counter advances only while Chrome has a focused active eligible tab.
- Normal eligible websites show a small bottom-right countdown pill with the time remaining until the next break. The pill is removed while the break overlay is active.
- If Chrome loses focus and is refocused in less than 15 minutes, the stored `usageSeconds` resumes where it left off. If Chrome is away for 15 minutes or longer, that away time counts as a real break and usage resets to zero when tracking is reconciled.
- When the usage limit is reached, the break overlay is sent to the current active eligible tab. Switching to another eligible tab during the break asks that tab to show the overlay too.
- The overlay and popup both include a dismiss action so the break is escapable.

## Controls

Use the extension popup to set:

- Browsing limit before break, in minutes.
- Break duration, in minutes.
- Dismiss current break, shown only while a break is active.

## Implementation summary

- `manifest.json` keeps Manifest V3, adds a background service worker, and broadens matching to `<all_urls>`.
- `background.js` owns the shared browser-wide timer, watches active tab/window focus changes, stores state in `chrome.storage.local`, applies the 15-minute focus resume grace period, and routes break overlay messages.
- `content.js` renders the small next-break countdown pill and the dismissible cat overlay. It does not run a per-tab usage timer.
- `popup.html` and `popup.js` keep browser-wide limit and break controls, show remaining time until the next break, and remove the original site checkbox list.
- `assets/` contains the local cat video and icon assets used by the break overlay.

## Validation

JSON and static sanity checks are provided in `test/static-sanity.test.mjs` and can be run with:

```sh
node --test test/static-sanity.test.mjs
```

Chrome was not run from this build environment, so runtime validation in Chrome2/Profile 1 still needs to be done manually after loading the unpacked extension.
