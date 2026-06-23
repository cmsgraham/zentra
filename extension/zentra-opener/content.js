// Content script injected into usezentra.app. Acts as a bridge between the
// page (which can only postMessage) and the background service worker
// (which has chrome.tabs permission).
//
// Protocol:
//   page -> content: window.postMessage({ source: 'zentra', type: 'open-bg', urls: [...], reqId })
//   content -> page: window.postMessage({ source: 'zentra-opener', type: 'ack', reqId, ok, opened, total })
//   content -> page (on load): window.postMessage({ source: 'zentra-opener', type: 'ready' })
//
// We also stamp the document element with a data attribute so the page can
// synchronously detect that the extension is installed (used to decide
// whether to render the "Open all" button).

(function () {
  try {
    document.documentElement.setAttribute('data-zentra-opener', '1');
  } catch (_) {
    // documentElement might not exist yet at document_start in rare cases.
  }

  // Re-announce on every page load so SPA navigations within Zentra still
  // see us. The page listens for both the data attribute and this message.
  function announceReady() {
    window.postMessage({ source: 'zentra-opener', type: 'ready', version: '1.0.0' }, window.location.origin);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', announceReady, { once: true });
  } else {
    announceReady();
  }

  window.addEventListener('message', (event) => {
    // Only trust messages from the same window/origin — never from iframes
    // or other tabs.
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'zentra' || data.type !== 'open-bg') return;
    if (event.origin && event.origin !== window.location.origin) return;

    const urls = Array.isArray(data.urls) ? data.urls : [];
    const reqId = data.reqId;

    chrome.runtime.sendMessage({ type: 'zentra-open-bg', urls }, (resp) => {
      const err = chrome.runtime.lastError;
      window.postMessage(
        {
          source: 'zentra-opener',
          type: 'ack',
          reqId,
          ok: !err && resp && resp.ok === true,
          opened: resp && resp.opened,
          total: resp && resp.total,
          error: err && err.message,
        },
        window.location.origin
      );
    });
  });
})();
