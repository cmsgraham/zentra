# Zentra Opener Browser Extension

## What it does

Lets you open all product links from a Zentra shopping list section in background tabs with one click — focus stays on Zentra so you can keep checking off items.

## How to install (Chrome, Edge, Brave)

1. Download or clone the Zentra repo.
2. Go to `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
3. Toggle **Developer mode** on (top right).
4. Click **Load unpacked**.
5. Select the folder: `inkflow/extension/zentra-opener`
6. Reload your Zentra shopping list page.

## How to use

- On any shopping list, if you have the extension loaded, a small chain-link icon appears next to each section header that contains product links.
- Click the icon — all product URLs in that section open in background tabs, and you stay on Zentra.
- Per-item link icons still work as before.

## How it works

- The extension only runs on `usezentra.app`.
- It listens for a message from the page, then opens each URL in a background tab using browser APIs (not possible from a normal web page).
- No data is sent anywhere; the extension is open source and can be audited in the repo.

## Uninstall

- Go to `chrome://extensions`, find "Zentra Opener", and click Remove.

---

For questions or help, contact support@usezentra.app.
