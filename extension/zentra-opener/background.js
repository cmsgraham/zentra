// Background service worker.
// Receives a list of URLs from the content script and opens each one in a
// background tab next to the current Zentra tab. Using chrome.tabs.create
// with active:false is the only reliable way to open background tabs from
// a web page — popup blockers and the trusted-event rule prevent the
// regular page from doing this directly.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'zentra-open-bg') return;

  const urls = Array.isArray(msg.urls) ? msg.urls : [];
  // Hard cap to avoid accidentally spawning hundreds of tabs.
  const MAX = 50;
  const safe = urls
    .filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
    .slice(0, MAX);

  const openerTabId = sender.tab && sender.tab.id;
  const windowId = sender.tab && sender.tab.windowId;
  let nextIndex = sender.tab && typeof sender.tab.index === 'number' ? sender.tab.index + 1 : undefined;

  (async () => {
    let opened = 0;
    for (const url of safe) {
      try {
        await chrome.tabs.create({
          url,
          active: false,
          windowId,
          openerTabId,
          index: nextIndex,
        });
        if (typeof nextIndex === 'number') nextIndex += 1;
        opened += 1;
      } catch (e) {
        // Swallow individual tab errors so one bad URL doesn't kill the batch.
        console.warn('[Zentra Opener] failed to open', url, e);
      }
    }
    sendResponse({ ok: true, opened, total: safe.length });
  })();

  // Returning true keeps the message channel open for the async sendResponse.
  return true;
});
