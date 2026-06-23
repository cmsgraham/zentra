'use client';

/**
 * Tiny banner that appears when navigator.onLine flips to false. Lets the
 * user know they're seeing cached data so they don't think the app is broken.
 */

import { useEffect, useState } from 'react';

export default function OfflineBanner() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (online) return null;
  return (
    <div
      className="px-3 py-1.5 text-xs text-center"
      role="status"
      aria-live="polite"
      style={{
        background: 'color-mix(in srgb, var(--ink-warn, #b45309) 15%, transparent)',
        color: 'var(--ink-text)',
        borderBottom: '1px solid color-mix(in srgb, var(--ink-warn, #b45309) 30%, transparent)',
      }}
    >
      You’re offline — showing the latest cached data. Changes will not save until you reconnect.
    </div>
  );
}
