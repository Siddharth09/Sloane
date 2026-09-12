import { useEffect, useState } from "react";

const STORAGE_KEY = "lucy_access_token";

// Module-level, not per-hook-instance (2026-09-12) - useAccessToken is
// called from several places on the same page (character picker, custom
// video, cinematic, pay-as-you-go), and each would otherwise fire its own
// identical /api/account/access-token request on mount. Shared across every
// instance so a page load only ever makes this call once. Reset by the
// full-page reload signOut() already does, so a stale cached value can't
// outlive a real sign-out.
let syncPromise: Promise<string | null> | null = null;
function syncAccessTokenFromSession(): Promise<string | null> {
  if (!syncPromise) {
    syncPromise = fetch("/api/account/access-token")
      .then((r) => (r.ok ? r.json() : { accessToken: null }))
      .then((json) => (json.accessToken as string | null) ?? null)
      .catch(() => null);
  }
  return syncPromise;
}

/**
 * Access-code based "login": no accounts/passwords, just a per-subscriber
 * token issued after Stripe checkout (see api/billing/session), pasted
 * once and remembered in this browser. Simple on purpose - see
 * PROJECT_CONTEXT.md "Pricing" for why this was chosen over full auth.
 *
 * Auto-synced from the signed-in email session too (2026-09-12), not just
 * a manual paste - if this browser is signed in (magic link or Google) and
 * that email is linked to a real subscription, that's more authoritative
 * than whatever's in localStorage, so it wins. Previously this sync only
 * ever happened on /account; a subscriber landing straight on the
 * generator after signing in on a new device had to paste their code
 * manually even though the server already knew who they were. Never
 * clears an existing token when there's no server-linked one - that could
 * be a manually-pasted code for a different account entirely.
 */
export function useAccessToken() {
  const [token, setTokenState] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      setTokenState(localStorage.getItem(STORAGE_KEY));
    } catch {
      // localStorage can throw in private-browsing contexts - fall back to no token.
    }
    setLoaded(true);
    syncAccessTokenFromSession().then((serverToken) => {
      if (serverToken) setToken(serverToken);
    });
  }, []);

  function setToken(value: string | null) {
    setTokenState(value);
    try {
      if (value) localStorage.setItem(STORAGE_KEY, value);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore - the in-memory state still updates for this session
    }
  }

  return { token, setToken, loaded };
}
