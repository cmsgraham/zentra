"use client";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

// Warm the SW navigation cache for every visited route by issuing a real
// document fetch (which the SW's navigationHandler caches as fresh SSR HTML).
//
// IMPORTANT: do NOT cache `document.documentElement.outerHTML` — that captures
// the *post-hydration* DOM (React-added attributes, mounted client components,
// browser-extension injections) which when served back on a future visit
// causes React hydration mismatch errors (Minified React error #418).
export default function CacheVisitedListPage() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname) return;
    if (typeof navigator === "undefined") return;
    if (!navigator.onLine) return;
    if (!("serviceWorker" in navigator)) return;
    const controller = new AbortController();
    const t = setTimeout(() => {
      // Fire-and-forget: SW's navigationHandler caches successful HTML responses.
      fetch(pathname, {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "text/html" },
        signal: controller.signal,
      }).catch(() => {});
    }, 500);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [pathname]);
  return null;
}
