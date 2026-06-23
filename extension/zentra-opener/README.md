# Zentra Opener (Chrome / Edge / Brave extension)

A tiny browser extension that lets Zentra shopping lists open all product
links from a section in **background tabs** with one click — focus stays on
Zentra so you can keep ticking items off.

## Install (load unpacked)

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked**.
4. Select this folder (`inkflow/extension/zentra-opener`).
5. Open a Zentra shopping list. Sections that contain product URLs will now
   show a small chain icon — tap it to open every link in a background tab.

## Updating

After pulling new code, click the refresh ↻ button on the extension card on
`chrome://extensions`.

## How it works

- The content script (runs only on `usezentra.app`) listens for
  `window.postMessage` events with `{ source: 'zentra', type: 'open-bg', urls }`.
- The background service worker uses `chrome.tabs.create({ active: false })`
  to open each URL in a background tab next to the current Zentra tab.
- A hard cap of 50 URLs per request prevents accidental tab floods.

## Permissions

- `tabs` — to open new tabs in the background.
- Host permission for `usezentra.app` only — the extension does **not** read
  any other site.
