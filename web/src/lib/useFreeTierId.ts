import { useEffect, useState } from "react";

const STORAGE_KEY = "lucy_free_tier_id";

/**
 * Anonymous free-tier usage tracking: a random id generated once and kept in
 * this browser's localStorage, sent along with generate-preset/clone-voice
 * requests when there's no access token. Honest limitation - clearing site
 * data or switching browsers resets the counter, since there's no login to
 * tie it to (see @/lib/db's checkFreeQuota comment for why this is the
 * accepted tradeoff, not IP-based).
 */
export function useFreeTierId() {
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    try {
      let stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        stored = crypto.randomUUID();
        localStorage.setItem(STORAGE_KEY, stored);
      }
      setId(stored);
    } catch {
      // localStorage blocked (private browsing, etc.) - generation still
      // works, just without a persistent free-tier counter across visits.
      setId(crypto.randomUUID());
    }
  }, []);

  return id;
}
