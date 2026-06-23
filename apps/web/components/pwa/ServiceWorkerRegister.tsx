'use client';

/**
 * Registers the Zentra service worker on first paint.
 *
 * - Skips registration in dev (`localhost`) where it would fight with HMR.
 *   Override by adding `?sw=1` if you want to test locally.
 * - Listens for an updated worker and prompts a reload via simple confirm()
 *   so the user always gets the latest UI.
 */

import { useEffect } from 'react';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const isLocalhost =
      location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const force = new URLSearchParams(location.search).get('sw') === '1';
    if (isLocalhost && !force) return;

    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        if (cancelled) return;

        // Aggressively check for SW updates so iOS / installed PWAs don't
        // get stuck on an old worker (which would keep serving stale API
        // data via cache). Browsers re-fetch sw.js when update() is called
        // unless the same byte-identical script was fetched in the last
        // 24h, so this is cheap.
        try { reg.update(); } catch {}

        // When the worker that controls this page changes (i.e. the new
        // SW activated and called clients.claim()), force a one-time reload
        // so the page picks up the new JS bundle. Without this, mobile
        // users keep running the old client code that uses the prior SW's
        // cache strategy — exactly the "deletes/adds don't appear" bug.
        let reloadedForUpdate = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloadedForUpdate) return;
          reloadedForUpdate = true;
          window.location.reload();
        });

        // When a new worker takes control, optionally prompt the user.
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (
              installing.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              // A new version is waiting. Only prompt if the user has been
              // here at least once before (i.e. there's already a controller).
              // Use a quiet log + a tiny in-page banner via custom event so
              // we don't disrupt mid-task work.
              window.dispatchEvent(new CustomEvent('zentra:sw-updated'));
            }
          });
        });
      } catch (err) {
        // Registration failures are non-fatal — app still works online.
        // eslint-disable-next-line no-console
        console.warn('Service worker registration failed', err);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return null;
}
