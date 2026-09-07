import { useEffect, useState } from "react";

const STORAGE_KEY = "lucy_access_token";

/**
 * Access-code based "login": no accounts/passwords, just a per-subscriber
 * token issued after Stripe checkout (see api/billing/session), pasted
 * once and remembered in this browser. Simple on purpose - see
 * PROJECT_CONTEXT.md "Pricing" for why this was chosen over full auth.
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
