"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const SESSION_KEY = "lucy_visit_session";
const PING_INTERVAL_MS = 20_000;

function getOrCreateSessionId(): string {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    // Private browsing / storage blocked - fall back to a per-load id
    // rather than crashing; this just means the visitor is counted as
    // "new" on the next page instead of being deduped.
    return crypto.randomUUID();
  }
}

// Invisible - just a heartbeat for the live-visitors admin dashboard (see
// web/src/app/admin/page.tsx). Pings on mount and every 20s while the tab
// is visible; stops pinging when backgrounded so idle tabs don't inflate
// the "active now" count.
export function VisitTracker() {
  const pathname = usePathname();

  useEffect(() => {
    const sessionId = getOrCreateSessionId();

    function ping() {
      if (document.visibilityState !== "visible") return;
      fetch("/api/track-visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, path: pathname }),
        keepalive: true,
      }).catch(() => {
        // Best-effort only - a dropped heartbeat just means this visitor
        // briefly ages out of the "active now" window.
      });
    }

    ping();
    const interval = setInterval(ping, PING_INTERVAL_MS);
    document.addEventListener("visibilitychange", ping);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", ping);
    };
  }, [pathname]);

  return null;
}
