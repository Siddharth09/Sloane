import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "lucy_access_token";

/**
 * Same access-code approach as web/src/lib/useAccessToken.ts: no
 * accounts/passwords, just a per-subscriber token issued after Stripe
 * checkout (completed in the phone's browser, since Checkout is a hosted
 * web flow - see App.tsx's "See plans" link), pasted once and remembered
 * on-device.
 */
export function useAccessToken() {
  const [token, setTokenState] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(setTokenState)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  function setToken(value: string | null) {
    setTokenState(value);
    if (value) {
      AsyncStorage.setItem(STORAGE_KEY, value).catch(() => {});
    } else {
      AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    }
  }

  return { token, setToken, loaded };
}
